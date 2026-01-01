/**
 * tana_semantic_search Tool
 *
 * Semantic/vector similarity search on Tana nodes using embeddings.
 * Finds conceptually similar content even without exact keyword matches.
 *
 * Uses resona/LanceDB for vector storage and search.
 */

import type { Database } from "bun:sqlite";
import { resolveWorkspaceContext } from "../../config/workspace-resolver.js";
import { ConfigManager } from "../../config/manager.js";
import { TanaEmbeddingService } from "../../embeddings/tana-embedding-service.js";
import { getModelDimensionsFromResona } from "../../embeddings/embed-config-new.js";
import {
  getNodeContents,
  getNodeContentsWithDepth,
  type NodeContents,
  type NodeContentsWithChildren,
} from "../../commands/show.js";
import { findMeaningfulAncestor, type AncestorResult } from "../../embeddings/ancestor-resolution.js";
import { isEntityById, findNearestEntityAncestor } from "../../db/entity.js";
import { isReferenceSyntax, deduplicateResults, getOverfetchLimit, type EnrichedSearchResult } from "../../embeddings/search-filter.js";
import type { SemanticSearchInput } from "../schemas.js";
import { existsSync } from "node:fs";
import { withDbRetrySync } from "../../db/retry.js";
import { withDatabase } from "../../db/with-database.js";
import {
  parseSelectPaths,
  applyProjectionToArray,
} from "../../utils/select-projection.js";

export interface SemanticSearchResultItem {
  nodeId: string;
  name: string;
  similarity: number;
  distance: number;
  tags?: string[];
  /**
   * Whether this node is an "entity" - a meaningful node in Tana.
   * Entities are: tagged items, library items, or items created via "Create new".
   * Based on Tana's entity detection (props.flags LSB or _entityOverride).
   */
  isEntity?: boolean;
  // Ancestor context (when includeAncestor is true and node has tagged ancestor)
  ancestor?: {
    id: string;
    name: string;
    tags: string[];
    /** Whether the ancestor is an entity */
    isEntity?: boolean;
  };
  pathFromAncestor?: string[];
  depthFromAncestor?: number;
  // Rich node contents (when includeContents is true)
  created?: Date | null;
  fields?: Array<{
    fieldName: string;
    fieldId: string;
    value: string;
    valueId: string;
  }>;
  children?: Array<{ id: string; name: string; isContent: boolean }> | NodeContentsWithChildren[];
}

export interface SemanticSearchResult {
  workspace: string;
  query: string;
  results: SemanticSearchResultItem[];
  count: number;
  model: string;
  dimensions: number;
}

/**
 * Check if a node has a trash ancestor (deleted node)
 * A node is considered deleted if any ancestor has _ownerId ending with '_TRASH'
 */
function isNodeInTrash(db: Database, nodeId: string): boolean {
  const result = withDbRetrySync(
    () => db
      .query(`
        WITH RECURSIVE ancestor_chain AS (
          SELECT
            id,
            parent_id,
            json_extract(raw_data, '$.props._ownerId') as owner_id,
            0 as level
          FROM nodes
          WHERE id = ?

          UNION ALL

          SELECT
            n.id,
            n.parent_id,
            json_extract(n.raw_data, '$.props._ownerId') as owner_id,
            ac.level + 1
          FROM nodes n
          INNER JOIN ancestor_chain ac ON n.id = ac.parent_id
          WHERE ac.parent_id IS NOT NULL AND ac.level < 50
        )
        SELECT COUNT(*) as has_trash
        FROM ancestor_chain
        WHERE owner_id LIKE '%_TRASH'
      `)
      .get(nodeId) as { has_trash: number } | null,
    "isNodeInTrash"
  );

  return result ? result.has_trash > 0 : false;
}

/**
 * Perform semantic search using vector embeddings
 *
 * Uses TanaEmbeddingService (resona/LanceDB) for vector search
 * and workspace-specific SQLite database for node enrichment.
 */
export async function semanticSearch(
  input: SemanticSearchInput
): Promise<SemanticSearchResult> {
  // Resolve workspace using unified resolver
  const ws = resolveWorkspaceContext({ workspace: input.workspace });
  const workspace = ws.alias;
  const dbPath = ws.dbPath;

  // Get embedding configuration from ConfigManager
  const embeddingConfig = ConfigManager.getInstance().getEmbeddingConfig();

  // Derive LanceDB path from SQLite path
  const lanceDbPath = dbPath.replace(/\.db$/, ".lance");

  // Check if LanceDB directory exists
  if (!existsSync(lanceDbPath)) {
    throw new Error(
      `No embeddings found for workspace "${workspace}". Run: supertag embed generate`
    );
  }

  // Create TanaEmbeddingService for vector search
  const embeddingService = new TanaEmbeddingService(lanceDbPath, {
    model: embeddingConfig.model,
    endpoint: embeddingConfig.endpoint,
  });

  try {
    // Check if we have any embeddings
    const stats = await embeddingService.getStats();
    if (stats.totalEmbeddings === 0) {
      throw new Error(
        "No embeddings generated yet. Run: supertag embed generate"
      );
    }

    // Perform search with over-fetch to account for filtering/deduplication
    const requestedLimit = input.limit || 20;
    const overfetchLimit = getOverfetchLimit(requestedLimit);
    const minSimilarity = input.minSimilarity;

    // Search using TanaEmbeddingService
    const searchResults = await embeddingService.search(input.query, overfetchLimit);

    // Apply minSimilarity filter (TanaEmbeddingService doesn't support threshold natively)
    const thresholdedResults = minSimilarity !== undefined
      ? searchResults.filter(r => r.similarity >= minSimilarity)
      : searchResults;

    // Enrich results with node names and tags within database context
    const results = await withDatabase({ dbPath, readonly: true }, (ctx) => {
      const enrichedResults: SemanticSearchResultItem[] = [];
      const includeContents = input.includeContents ?? false;
      const includeAncestor = input.includeAncestor ?? true;
      const depth = Math.min(input.depth ?? 0, 3); // Cap at 3 to prevent huge responses

      // Helper to add entity and ancestor info to an item
      const addEntityAndAncestorInfo = (item: SemanticSearchResultItem, nodeId: string) => {
        // Check if this node is an entity
        item.isEntity = isEntityById(ctx.db, nodeId);

        if (includeAncestor && !input.raw) {
          // First, try to find nearest entity ancestor (more reliable than just tagged)
          const entityAncestor = findNearestEntityAncestor(ctx.db, nodeId);

          if (entityAncestor && entityAncestor.depth > 0) {
            // Found an entity ancestor above us
            // Get tags for the entity ancestor
            const tags = withDbRetrySync(
              () => ctx.db
                .query(
                  `SELECT DISTINCT tag_name as name
                   FROM tag_applications
                   WHERE data_node_id = ?`
                )
                .all(entityAncestor.id) as { name: string }[],
              "getEntityAncestorTags"
            );

            item.ancestor = {
              id: entityAncestor.id,
              name: entityAncestor.name,
              tags: tags.map((t) => t.name),
              isEntity: true,
            };
            item.depthFromAncestor = entityAncestor.depth;
          } else {
            // No entity ancestor, fall back to tagged ancestor
            const ancestorResult = findMeaningfulAncestor(ctx.db, nodeId);
            if (ancestorResult && ancestorResult.depth > 0) {
              // Check if this tagged ancestor is also an entity
              const ancestorIsEntity = isEntityById(ctx.db, ancestorResult.ancestor.id);
              item.ancestor = {
                ...ancestorResult.ancestor,
                isEntity: ancestorIsEntity,
              };
              item.pathFromAncestor = ancestorResult.path;
              item.depthFromAncestor = ancestorResult.depth;
            } else {
              // No tagged ancestor found, use direct parent instead
              const parentNode = withDbRetrySync(
                () => ctx.db
                  .query(`
                    SELECT n.id, n.name
                    FROM nodes n
                    INNER JOIN nodes child ON child.parent_id = n.id
                    WHERE child.id = ?
                  `)
                  .get(nodeId) as { id: string; name: string } | null,
                "getParentNode"
              );

              if (parentNode && parentNode.name) {
                const parentIsEntity = isEntityById(ctx.db, parentNode.id);
                item.ancestor = {
                  id: parentNode.id,
                  name: parentNode.name,
                  tags: [],
                  isEntity: parentIsEntity,
                };
                item.depthFromAncestor = 1;
              }
            }
          }
        }
      };

      for (const r of thresholdedResults) {
        // Skip deleted nodes (nodes with trash ancestor)
        if (isNodeInTrash(ctx.db, r.nodeId)) {
          continue;
        }

        if (includeContents) {
          // Get full node contents using show.ts functions
          if (depth > 0) {
            const contents = getNodeContentsWithDepth(ctx.db, r.nodeId, 0, depth);
            if (contents) {
              const item: SemanticSearchResultItem = {
                nodeId: r.nodeId,
                name: contents.name,
                similarity: r.similarity,
                distance: r.distance,
                tags: contents.tags.length > 0 ? contents.tags : undefined,
                created: contents.created,
                fields: contents.fields.length > 0 ? contents.fields : undefined,
                children: contents.children.length > 0 ? contents.children : undefined,
              };
              addEntityAndAncestorInfo(item, r.nodeId);
              enrichedResults.push(item);
            }
          } else {
            const contents = getNodeContents(ctx.db, r.nodeId);
            if (contents) {
              const item: SemanticSearchResultItem = {
                nodeId: r.nodeId,
                name: contents.name,
                similarity: r.similarity,
                distance: r.distance,
                tags: contents.tags.length > 0 ? contents.tags : undefined,
                created: contents.created,
                fields: contents.fields.length > 0 ? contents.fields : undefined,
                children: contents.children.length > 0 ? contents.children : undefined,
              };
              addEntityAndAncestorInfo(item, r.nodeId);
              enrichedResults.push(item);
            }
          }
        } else {
          // Basic mode - just name and tags
          const node = withDbRetrySync(
            () => ctx.db
              .query("SELECT name FROM nodes WHERE id = ?")
              .get(r.nodeId) as { name: string } | null,
            "semanticSearch getNode"
          );

          if (node) {
            const item: SemanticSearchResultItem = {
              nodeId: r.nodeId,
              name: node.name,
              similarity: r.similarity,
              distance: r.distance,
            };

            // Get tags if not raw mode
            if (!input.raw) {
              const tags = withDbRetrySync(
                () => ctx.db
                  .query(
                    `SELECT DISTINCT tag_name as name
                     FROM tag_applications
                     WHERE data_node_id = ?`
                  )
                  .all(r.nodeId) as { name: string }[],
                "semanticSearch getTags"
              );
              if (tags.length > 0) {
                item.tags = tags.map((t) => t.name);
              }
            }

            addEntityAndAncestorInfo(item, r.nodeId);
            enrichedResults.push(item);
          }
        }
      }

      return enrichedResults;
    });

    // Filter out reference-syntax text nodes (names like "[[Something]]")
    // These are text artifacts, not actual content - the real nodes have plain names
    const filteredResults = results.filter(r => !isReferenceSyntax(r.name));

    // Deduplicate by name+tags, keeping highest similarity
    // Nodes with same name but different tags are preserved
    const enrichedForDedup: EnrichedSearchResult[] = filteredResults.map(r => ({
      nodeId: r.nodeId,
      distance: r.distance,
      similarity: r.similarity,
      name: r.name,
      tags: r.tags,
    }));
    const deduplicatedResults = deduplicateResults(enrichedForDedup).map(r => {
      // Map back to SemanticSearchResultItem (find original with full data)
      return filteredResults.find(f => f.nodeId === r.nodeId) || filteredResults[0];
    });

    // Apply the originally requested limit after filtering/deduplication
    const finalResults = deduplicatedResults.slice(0, requestedLimit);

    // Get dimensions from resona
    const dimensions = getModelDimensionsFromResona(embeddingConfig.model) || 0;

    // Apply field projection if select is specified
    const projection = parseSelectPaths(input.select);
    const projectedResults = applyProjectionToArray(
      finalResults,
      projection
    ) as SemanticSearchResultItem[];

    return {
      workspace,
      query: input.query,
      results: projectedResults,
      count: projectedResults.length,
      model: embeddingConfig.model,
      dimensions,
    };
  } finally {
    embeddingService.close();
  }
}
