/**
 * tana_batch_get MCP Tool
 *
 * Fetch multiple nodes by ID in a single request.
 * Reduces latency for AI agents that need to retrieve several nodes.
 *
 * Spec: 062-batch-operations
 */

import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import { batchGetNodes } from '../../services/batch-operations.js';
import type { BatchGetInput } from '../schemas.js';
import {
  parseSelectPaths,
  applyProjection,
} from '../../utils/select-projection.js';
import type { BatchGetResult } from '../../services/batch-operations.js';

/**
 * Result type for MCP tool response
 */
export interface BatchGetResponse {
  /** Array of results in same order as input nodeIds */
  results: Array<{
    id: string;
    node: Partial<Record<string, unknown>> | null;
    error?: string;
  }>;
  /** Count of successfully fetched nodes */
  found: number;
  /** Count of nodes not found */
  missing: number;
}

/**
 * Fetch multiple nodes by ID
 *
 * @param input - Validated batch get input from schema
 * @returns Batch get response with results array
 */
export async function batchGet(input: BatchGetInput): Promise<BatchGetResponse> {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });
  const depth = input.depth || 0;

  // Call the batch operations service
  const results = batchGetNodes(workspace.dbPath, input.nodeIds, { depth });

  // Apply field projection if select is specified
  const projection = parseSelectPaths(input.select);

  // Transform results with projection
  const transformedResults = results.map((result: BatchGetResult) => ({
    id: result.id,
    node: result.node ? applyProjection(result.node, projection) : null,
    error: result.error,
  }));

  // Count found and missing
  const found = results.filter((r: BatchGetResult) => r.node !== null).length;
  const missing = results.length - found;

  return {
    results: transformedResults,
    found,
    missing,
  };
}
