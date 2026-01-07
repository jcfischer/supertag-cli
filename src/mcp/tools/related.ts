/**
 * tana_related Tool (Spec 065: Graph Traversal)
 *
 * Find nodes related to a given node through references, children, and field links.
 * Supports multi-hop traversal with direction and type filtering.
 */

import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import type { RelatedInput } from '../schemas.js';
import { GraphTraversalService } from '../../services/graph-traversal.js';
import type { RelatedResult, RelationshipType } from '../../types/graph.js';
import {
  parseSelectPaths,
  applyProjection,
} from '../../utils/select-projection.js';

/**
 * Find nodes related to a given node
 *
 * @param input - Tool input with nodeId, direction, types, depth, limit
 * @returns Related nodes with relationship metadata, or null if source not found
 */
export async function related(input: RelatedInput): Promise<Partial<Record<string, unknown>> | null> {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });

  const service = new GraphTraversalService(workspace.dbPath);

  try {
    const result = await service.traverse(
      {
        nodeId: input.nodeId,
        direction: input.direction,
        types: input.types as RelationshipType[],
        depth: input.depth,
        limit: input.limit,
      },
      workspace.alias
    );

    // Apply field projection if select is specified
    const projection = parseSelectPaths(input.select);
    return applyProjection(result, projection) as Partial<Record<string, unknown>>;
  } finally {
    service.close();
  }
}
