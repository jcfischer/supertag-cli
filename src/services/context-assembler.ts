/**
 * Context Assembler Service (Spec F-098)
 *
 * Orchestrates the 6-phase context assembly pipeline:
 * Resolve → Traverse → Enrich → Score → Budget → Format
 */

import { Database } from 'bun:sqlite';
import { resolveReadBackend } from '../api/read-backend-resolver';
import type { TanaReadBackend, ReadSearchResult, ReadNodeContent } from '../api/read-backend';
import { GraphTraversalService } from './graph-traversal';
import { scoreNode } from './relevance-scorer';
import { pruneToFitBudget, DEFAULT_BUDGET } from './token-budgeter';
import { getLensConfig } from './lens-config';
import { getFieldValuesForNode } from '../embeddings/context-builder';
import { resolveWorkspaceContext } from '../config/workspace-resolver';
import { isDebugMode } from '../utils/debug';
import type {
  ContextDocument,
  ContextNode,
  ContextOptions,
  RelationshipPath,
  ScoringOptions,
  TokenBudget,
} from '../types/context';
import type { RelatedNode } from '../types/graph';

/** Options for the assembleContext function */
export interface AssembleOptions {
  workspace?: string;
  depth?: number;
  maxTokens?: number;
  includeFields?: boolean;
  lens?: 'general' | 'writing' | 'coding' | 'planning' | 'meeting-prep';
  offline?: boolean;
}

/**
 * Assemble a context document from the Tana knowledge graph.
 *
 * Pipeline:
 * 1. Resolve: find starting node(s) via search or direct ID
 * 2. Traverse: walk graph outward using GraphTraversalService
 * 3. Enrich: extract field values for collected nodes
 * 4. Score: rank by relevance (distance + recency, optionally semantic)
 * 5. Budget: prune lowest-relevance nodes to fit token budget
 * 6. Format: build ContextDocument structure
 */
export async function assembleContext(
  query: string,
  options: AssembleOptions = {},
): Promise<ContextDocument> {
  const {
    workspace,
    depth = 2,
    maxTokens = 4000,
    includeFields = true,
    lens = 'general',
    offline,
  } = options;

  const lensConfig = getLensConfig(lens);
  const effectiveDepth = Math.min(depth, lensConfig.maxDepth, 5);

  // Resolve workspace
  const ws = resolveWorkspaceContext({
    workspace,
    requireDatabase: true,
  });

  // Phase 1: Resolve — find starting node(s)
  const backend = await resolveReadBackend({ workspace, offline });
  const { sourceNodes, resolvedQuery } = await resolveStartingNodes(backend, query);

  if (sourceNodes.length === 0) {
    return buildEmptyContext(query, ws.alias, lens, maxTokens, backend.type);
  }

  // Phase 2: Traverse — walk graph from each source node
  const traverser = new GraphTraversalService(ws.dbPath);
  const collectedNodes = new Map<string, { node: RelatedNode; distance: number; path: RelationshipPath[] }>();

  // Always include source nodes at distance 0
  for (const source of sourceNodes) {
    collectedNodes.set(source.id, {
      node: { id: source.id, name: source.name, tags: source.tags || [], relationship: { type: 'child', direction: 'out', path: [], distance: 0 } },
      distance: 0,
      path: [],
    });
  }

  for (const source of sourceNodes) {
    try {
      const result = await traverser.traverse(
        {
          nodeId: source.id,
          direction: 'both',
          types: lensConfig.priorityTypes,
          depth: effectiveDepth,
          limit: 100,
        },
        ws.alias,
      );

      for (const related of result.related) {
        const existing = collectedNodes.get(related.id);
        if (!existing || related.relationship.distance < existing.distance) {
          collectedNodes.set(related.id, {
            node: related,
            distance: related.relationship.distance,
            path: related.relationship.path.map((nodeId, i) => ({
              nodeId,
              type: related.relationship.type,
              direction: related.relationship.direction,
            })),
          });
        }
      }
    } catch (err) {
      // Node not found or traversal error — continue with what we have
      if (isDebugMode()) {
        console.error(`[context-assembler] Graph traversal failed for ${id}:`, err);
      }
    }
  }

  // Phase 3: Enrich — extract field values
  let db: Database | null = null;
  const contextNodes: ContextNode[] = [];

  try {
    db = new Database(ws.dbPath, { readonly: true });

    for (const [id, entry] of collectedNodes) {
      const fields: Record<string, string | string[]> = {};

      if (includeFields) {
        try {
          const fieldValues = getFieldValuesForNode(db, id);
          // Filter by lens-specific fields if defined
          const allowedFields = lensConfig.includeFields;
          for (const fv of fieldValues) {
            if (!allowedFields || allowedFields.includes(fv.fieldName.toLowerCase())) {
              const existing = fields[fv.fieldName];
              if (existing) {
                if (Array.isArray(existing)) {
                  existing.push(fv.valueText);
                } else {
                  fields[fv.fieldName] = [existing, fv.valueText];
                }
              } else {
                fields[fv.fieldName] = fv.valueText;
              }
            }
          }
        } catch {
          // Field extraction failed for this node — skip
        }
      }

      // Get node content
      let content = '';
      try {
        const nodeContent = await backend.readNode(id, 0);
        content = nodeContent.markdown || '';
      } catch {
        // Content read failed — use name only
      }

      // Get node creation time from DB
      let created: string | undefined;
      try {
        const row = db.query('SELECT created FROM nodes WHERE id = ?').get(id) as { created?: number } | null;
        if (row?.created) {
          created = new Date(row.created).toISOString();
        }
      } catch {
        // No created timestamp available
      }

      contextNodes.push({
        id,
        name: entry.node.name,
        content,
        tags: entry.node.tags || [],
        fields: Object.keys(fields).length > 0 ? fields : undefined,
        score: 0, // Placeholder — scored in Phase 4
        distance: entry.distance,
        path: entry.path,
        created,
      });
    }
  } finally {
    db?.close();
  }

  // Phase 4: Score — rank by relevance
  const scoringOptions: ScoringOptions = {
    sourceNodeId: sourceNodes[0].id,
    queryText: resolvedQuery,
    embeddingsAvailable: false, // TODO: integrate with semantic search when available
  };

  for (const node of contextNodes) {
    const score = scoreNode(node.distance, undefined, node.created, scoringOptions);
    node.score = score.total;
  }

  // Sort by score descending (lens boosts already applied in scoreNode via scoringOptions)
  contextNodes.sort((a, b) => b.score - a.score);

  // Phase 5: Budget — prune to fit token limit
  const budget: TokenBudget = {
    maxTokens,
    headerReserve: DEFAULT_BUDGET.headerReserve,
    minPerNode: DEFAULT_BUDGET.minPerNode,
  };

  const { included, overflow, usage } = await pruneToFitBudget(contextNodes, budget);

  // Phase 6: Build ContextDocument
  return {
    meta: {
      query: resolvedQuery,
      workspace: ws.alias,
      lens,
      tokens: usage,
      assembledAt: new Date().toISOString(),
      backend: backend.type,
      embeddingsAvailable: false,
    },
    nodes: included,
    overflow,
  };
}

/**
 * Resolve starting nodes from either a node ID or search query.
 */
async function resolveStartingNodes(
  backend: TanaReadBackend,
  query: string,
): Promise<{ sourceNodes: ReadSearchResult[]; resolvedQuery: string }> {
  // Heuristic: if query looks like a node ID (alphanumeric, 8+ chars, no spaces)
  if (isNodeId(query)) {
    try {
      const node = await backend.readNode(query, 0);
      return {
        sourceNodes: [{ id: node.id, name: node.name, tags: node.tags || [] }],
        resolvedQuery: node.name,
      };
    } catch {
      // Not a valid node ID — fall through to search
    }
  }

  // Search for the query
  const results = await backend.search(query, { limit: 5 });
  return {
    sourceNodes: results,
    resolvedQuery: query,
  };
}

/**
 * Check if a string looks like a Tana node ID.
 * Node IDs are alphanumeric, 8+ characters, no spaces.
 */
function isNodeId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{6,}$/.test(value) && !value.includes(' ');
}

/**
 * Build an empty context document when no nodes are found.
 */
function buildEmptyContext(
  query: string,
  workspace: string,
  lens: 'general' | 'writing' | 'coding' | 'planning' | 'meeting-prep',
  maxTokens: number,
  backendType: 'local-api' | 'sqlite',
): ContextDocument {
  return {
    meta: {
      query,
      workspace,
      lens,
      tokens: { budget: maxTokens, used: 0, utilization: 0, nodesIncluded: 0, nodesSummarized: 0 },
      assembledAt: new Date().toISOString(),
      backend: backendType,
      embeddingsAvailable: false,
    },
    nodes: [],
    overflow: [],
  };
}
