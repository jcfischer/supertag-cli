/**
 * tana_semantic_search Tool
 *
 * Semantic/vector similarity search on Tana nodes using embeddings.
 * Finds conceptually similar content even without exact keyword matches.
 *
 * Uses resona/LanceDB for vector storage and search.
 */

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
import { runSemanticSearchPipeline, type SemanticEmbeddingService, type SemanticSearchDeps } from "../../embeddings/search-filter.js";
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
  results: Partial<Record<string, unknown>>[];
  count: number;
  model: string;
  dimensions: number;
}

/**
 * Perform semantic search using vector embeddings
 *
 * Uses TanaEmbeddingService (resona/LanceDB) for vector search
 * and workspace-specific SQLite database for node enrichment.
 */
export async function semanticSearch(
  input: SemanticSearchInput,
  deps: SemanticSearchDeps = {}
): Promise<SemanticSearchResult> {
  // Resolve workspace using unified resolver
  const ws = deps.workspace ?? resolveWorkspaceContext({ workspace: input.workspace });
  const workspace = ws.alias;
  const dbPath = ws.dbPath;

  // Get embedding configuration from ConfigManager
  const embeddingConfig = ConfigManager.getInstance().getEmbeddingConfig();

  // Derive LanceDB path from SQLite path
  const lanceDbPath = dbPath.replace(/\.db$/, ".lance");

  const openEmbeddingService =
    deps.openEmbeddingService ??
    ((path: string): SemanticEmbeddingService => {
      if (!existsSync(path)) {
        throw new Error(
          `No embeddings found for workspace "${workspace}". Run: supertag embed generate`
        );
      }
      return new TanaEmbeddingService(path, {
        model: embeddingConfig.model,
        endpoint: embeddingConfig.endpoint,
      });
    });
  const embeddingService = openEmbeddingService(lanceDbPath);

  try {
    // Check if we have any embeddings
    const stats = await embeddingService.getStats();
    if (stats.totalEmbeddings === 0) {
      throw new Error(
        "No embeddings generated yet. Run: supertag embed generate"
      );
    }

    const requestedLimit = input.limit || 20;

    const finalResults = await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      // Shared with the CLI so both surfaces return the same nodes (#98)
      const matches = await runSemanticSearchPipeline(embeddingService, ctx.db, input.query, {
        limit: requestedLimit,
        minSimilarity: input.minSimilarity,
        typeHint: input.typeHint,
      });

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

      return matches.map((r) => {
        const item: SemanticSearchResultItem = {
          nodeId: r.nodeId,
          name: r.name,
          similarity: r.similarity,
          distance: r.distance,
          tags: input.raw ? undefined : r.tags,
        };

        if (includeContents) {
          // Get full node contents using show.ts functions
          const contents = depth > 0
            ? getNodeContentsWithDepth(ctx.db, r.nodeId, 0, depth)
            : getNodeContents(ctx.db, r.nodeId);
          if (contents) {
            item.name = contents.name;
            item.tags = contents.tags.length > 0 ? contents.tags : undefined;
            item.created = contents.created;
            item.fields = contents.fields.length > 0 ? contents.fields : undefined;
            item.children = contents.children.length > 0 ? contents.children : undefined;
          }
        }

        addEntityAndAncestorInfo(item, r.nodeId);
        return item;
      });
    });

    // Get dimensions from resona
    const dimensions = getModelDimensionsFromResona(embeddingConfig.model) || 0;

    // Apply field projection if select is specified
    const projection = parseSelectPaths(input.select);
    const projectedResults = applyProjectionToArray(finalResults, projection);

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
