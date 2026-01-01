/**
 * Batch Operations Service
 *
 * Provides batch operations for fetching and creating multiple nodes.
 * Used by both CLI (commands/batch.ts) and MCP (mcp/tools/batch-*.ts).
 *
 * Spec: 062-batch-operations
 */

import type { NodeContents } from '../mcp/tools/node.js';
import type { CreateNodeInput, TanaApiNode } from '../types.js';

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
// Service Functions (Skeleton - to be implemented in T-1.2 and T-3.1)
// =============================================================================

/**
 * Fetch multiple nodes by ID from local database
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
  // Skeleton implementation - to be completed in T-1.2
  return nodeIds.map((id) => ({
    id,
    node: null,
    error: 'Not implemented yet',
  }));
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
