/**
 * Graph Traversal Service (Spec 065)
 *
 * Provides graph traversal capabilities to find nodes related to a given node
 * through parent/child relationships, references, and field links.
 */

import { TanaQueryEngine } from '../query/tana-query-engine';
import { StructuredError } from '../utils/structured-errors';
import type {
  RelatedQuery,
  RelatedResult,
  RelatedNode,
  RelationshipType,
  RelationshipMetadata,
} from '../types/graph';

/**
 * Service for traversing the Tana node graph
 */
export class GraphTraversalService {
  private engine: TanaQueryEngine;

  constructor(dbPath: string) {
    this.engine = new TanaQueryEngine(dbPath);
  }

  /**
   * Traverse the graph from a source node
   *
   * @param query - Traversal query parameters
   * @param workspace - Workspace alias for result
   * @returns Related nodes with relationship metadata
   * @throws StructuredError if source node not found
   */
  async traverse(query: RelatedQuery, workspace: string): Promise<RelatedResult> {
    const { nodeId, direction, types, depth, limit } = query;

    // Validate source node exists
    const sourceNode = await this.getNodeById(nodeId);
    if (!sourceNode) {
      throw new StructuredError('NODE_NOT_FOUND', `Node '${nodeId}' not found`, {
        details: { nodeId },
        suggestion: 'Check that the node ID is correct',
        recovery: { canRetry: false },
      });
    }

    // Perform traversal
    const related = await this.traverseFromNode(
      nodeId,
      direction,
      types,
      depth,
      limit
    );

    // Build result
    return {
      workspace,
      sourceNode: {
        id: sourceNode.id,
        name: sourceNode.name,
      },
      related,
      count: related.length,
      truncated: related.length >= limit,
    };
  }

  /**
   * Traverse from a node and collect related nodes
   */
  private async traverseFromNode(
    nodeId: string,
    direction: 'in' | 'out' | 'both',
    types: RelationshipType[],
    depth: number,
    limit: number
  ): Promise<RelatedNode[]> {
    const visited = new Set<string>([nodeId]);
    const results: RelatedNode[] = [];

    // BFS queue: [currentNodeId, currentPath, currentDistance]
    type QueueItem = [string, string[], number];
    const queue: QueueItem[] = [[nodeId, [nodeId], 0]];

    while (queue.length > 0 && results.length < limit) {
      const [currentId, path, distance] = queue.shift()!;

      // Skip if we've reached max depth
      if (distance >= depth) {
        continue;
      }

      // Get related nodes based on direction
      const related = await this.getRelatedInDirection(currentId, direction, types, limit);

      for (const { targetId, type, relDirection } of related) {
        if (visited.has(targetId)) {
          continue;
        }

        visited.add(targetId);

        // Get node details
        const node = await this.getNodeById(targetId);
        if (!node) {
          continue;
        }

        // Get tags
        const tags = this.engine.getNodeTags(targetId);

        const newPath = [...path, targetId];
        const newDistance = distance + 1;

        const relatedNode: RelatedNode = {
          id: targetId,
          name: node.name,
          tags: tags.length > 0 ? tags : undefined,
          relationship: {
            type,
            direction: relDirection,
            path: newPath,
            distance: newDistance,
          },
        };

        results.push(relatedNode);

        if (results.length >= limit) {
          break;
        }

        // Add to queue for further traversal
        if (newDistance < depth) {
          queue.push([targetId, newPath, newDistance]);
        }
      }
    }

    return results;
  }

  /**
   * Get related nodes in the specified direction
   */
  private async getRelatedInDirection(
    nodeId: string,
    direction: 'in' | 'out' | 'both',
    types: RelationshipType[],
    limit: number
  ): Promise<Array<{ targetId: string; type: RelationshipType; relDirection: 'in' | 'out' }>> {
    const results: Array<{ targetId: string; type: RelationshipType; relDirection: 'in' | 'out' }> = [];

    if (direction === 'out' || direction === 'both') {
      const outbound = await this.engine.getRelatedNodes(nodeId, 'out', types, limit);
      for (const r of outbound) {
        results.push({ targetId: r.nodeId, type: r.type, relDirection: 'out' });
      }
    }

    if (direction === 'in' || direction === 'both') {
      const inbound = await this.engine.getRelatedNodes(nodeId, 'in', types, limit);
      for (const r of inbound) {
        results.push({ targetId: r.nodeId, type: r.type, relDirection: 'in' });
      }
    }

    return results;
  }

  /**
   * Get a node by ID
   */
  private async getNodeById(nodeId: string): Promise<{ id: string; name: string } | null> {
    const nodes = await this.engine.findNodesByIds([nodeId]);
    if (nodes.length === 0) {
      return null;
    }
    return {
      id: nodes[0].id,
      name: nodes[0].name ?? '',
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.engine.close();
  }
}
