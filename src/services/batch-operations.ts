/**
 * Batch Operations Service
 *
 * Provides batch operations for fetching and creating multiple nodes.
 * Used by both CLI (commands/batch.ts) and MCP (mcp/tools/batch-*.ts).
 *
 * Spec: 062-batch-operations
 */

import { Database } from 'bun:sqlite';
import type { NodeContents } from '../mcp/tools/node.js';
import type { CreateNodeInput, TanaApiNode } from '../types.js';
import { withDbRetrySync } from '../db/retry.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum nodes per batch get request */
export const BATCH_GET_MAX_NODES = 100;

/** Maximum nodes per batch create request */
export const BATCH_CREATE_MAX_NODES = 50;

/** Chunk size for API calls (rate limit consideration) */
export const BATCH_CREATE_CHUNK_SIZE = 10;

// =============================================================================
// Types
// =============================================================================

/**
 * Request for fetching multiple nodes by ID
 */
export interface BatchGetRequest {
  /** Array of node IDs to fetch (max 100) */
  nodeIds: string[];
  /** Optional field projection */
  select?: string[];
  /** Child traversal depth (0-3) */
  depth?: number;
  /** Workspace alias */
  workspace?: string;
}

/**
 * Result for a single node in batch get
 */
export interface BatchGetResult {
  /** Node ID that was requested */
  id: string;
  /** Node contents if found, null if not found */
  node: NodeContents | null;
  /** Error message if lookup failed */
  error?: string;
}

/**
 * Request for creating multiple nodes
 */
export interface BatchCreateRequest {
  /** Array of node definitions to create (max 50) */
  nodes: CreateNodeInput[];
  /** Default target node ID for all nodes */
  target?: string;
  /** Validate only, don't post to API */
  dryRun?: boolean;
  /** Workspace alias */
  workspace?: string;
}

/**
 * Result of batch create operation
 */
export interface BatchCreateResult {
  /** Overall success status */
  success: boolean;
  /** Number of successfully created nodes */
  created: number;
  /** Created node IDs in input order (null if that node failed) */
  nodeIds: (string | null)[];
  /** Validated payloads (always present, useful for dry-run) */
  payloads: TanaApiNode[];
  /** Target node ID used */
  target: string;
  /** Was this a dry run */
  dryRun: boolean;
  /** Errors encountered during creation */
  errors: BatchError[];
}

/**
 * Error for a specific node in a batch operation
 */
export interface BatchError {
  /** Index in the input array (0-based) */
  index: number;
  /** Error message */
  message: string;
}

// =============================================================================
// Internal Types
// =============================================================================

interface NodeData {
  id: string;
  name: string | null;
  created: number | null;
  rawData: string;
}

interface TagData {
  data_node_id: string;
  tag_name: string;
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Fetch multiple nodes by ID from local database
 *
 * Uses efficient batch SQL queries to avoid N+1 problem:
 * - Single query to fetch all nodes
 * - Single query to fetch all tags for those nodes
 * - Results assembled in input order
 *
 * @param dbPath - Path to workspace database
 * @param nodeIds - Array of node IDs to fetch (max 100)
 * @param options - Depth and select projection options
 * @returns Array of results in same order as input
 */
export function batchGetNodes(
  dbPath: string,
  nodeIds: string[],
  options?: { depth?: number; select?: string[] }
): BatchGetResult[] {
  // Handle empty input
  if (nodeIds.length === 0) {
    return [];
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    // Batch query all nodes in a single SQL statement
    const placeholders = nodeIds.map(() => '?').join(',');
    const nodesData = withDbRetrySync(
      () =>
        db
          .query(
            `SELECT id, name, created, raw_data as rawData FROM nodes WHERE id IN (${placeholders})`
          )
          .all(...nodeIds) as NodeData[],
      'batchGetNodes nodes'
    );

    // Create a map for O(1) lookup
    const nodeMap = new Map(nodesData.map((n) => [n.id, n]));

    // Batch query all tags for found nodes
    const foundIds = nodesData.map((n) => n.id);
    let tagMap = new Map<string, string[]>();

    if (foundIds.length > 0) {
      const tagPlaceholders = foundIds.map(() => '?').join(',');
      const tagsData = withDbRetrySync(
        () =>
          db
            .query(
              `SELECT data_node_id, tag_name FROM tag_applications WHERE data_node_id IN (${tagPlaceholders})`
            )
            .all(...foundIds) as TagData[],
        'batchGetNodes tags'
      );

      // Group tags by node ID
      for (const tag of tagsData) {
        const existing = tagMap.get(tag.data_node_id) || [];
        existing.push(tag.tag_name);
        tagMap.set(tag.data_node_id, existing);
      }
    }

    // Assemble results in input order
    return nodeIds.map((id) => {
      const nodeData = nodeMap.get(id);

      if (!nodeData) {
        return { id, node: null };
      }

      const node: NodeContents = {
        id: nodeData.id,
        name: nodeData.name || '(unnamed)',
        created: nodeData.created ? new Date(nodeData.created) : null,
        tags: tagMap.get(id) || [],
        fields: [],
        children: [],
      };

      return { id, node };
    });
  } finally {
    db.close();
  }
}

/**
 * Create multiple nodes via Tana API
 *
 * @param nodes - Array of node definitions to create (max 50)
 * @param options - Target, dryRun, workspace options
 * @returns Creation result with node IDs or errors
 */
export async function batchCreateNodes(
  nodes: CreateNodeInput[],
  options?: { target?: string; dryRun?: boolean; workspace?: string }
): Promise<BatchCreateResult> {
  // Skeleton implementation - to be completed in T-3.1
  return {
    success: false,
    created: 0,
    nodeIds: nodes.map(() => null),
    payloads: [],
    target: options?.target || 'INBOX',
    dryRun: options?.dryRun || false,
    errors: [{ index: -1, message: 'Not implemented yet' }],
  };
}
