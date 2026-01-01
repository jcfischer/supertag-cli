/**
 * tana_batch_create MCP Tool
 *
 * Create multiple nodes in a single request.
 * Reduces latency for AI agents that need to create several nodes.
 *
 * Spec: 062-batch-operations
 */

import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import {
  batchCreateNodes,
  type BatchCreateResult,
  type BatchError,
} from '../../services/batch-operations.js';
import type { BatchCreateInput } from '../schemas.js';
import type { TanaApiNode, CreateNodeInput } from '../../types.js';

/**
 * Result type for MCP tool response
 */
export interface BatchCreateResponse {
  /** Whether all nodes were processed successfully */
  success: boolean;
  /** Number of nodes created (0 in dry-run mode) */
  created: number;
  /** Per-node results in input order */
  results: BatchCreateResult[];
  /** Validated payloads for all successful nodes */
  payloads: TanaApiNode[];
  /** Errors encountered during creation */
  errors: BatchError[];
  /** Whether this was a dry-run */
  dryRun: boolean;
  /** Target used for node creation */
  target?: string;
}

/**
 * Create multiple nodes via Tana API
 *
 * @param input - Validated batch create input from schema
 * @returns Batch create response with results array
 */
export async function batchCreate(
  input: BatchCreateInput
): Promise<BatchCreateResponse> {
  // Resolve workspace for database path
  let dbPath: string | undefined;
  try {
    const workspace = resolveWorkspaceContext({
      workspace: input.workspace,
      requireDatabase: false,
    });
    dbPath = workspace.dbPath;
  } catch {
    // Workspace resolution failed, continue without database
  }

  // Convert schema input to service input
  const nodes: CreateNodeInput[] = input.nodes.map((node) => ({
    supertag: node.supertag,
    name: node.name,
    fields: node.fields,
    children: node.children,
  }));

  // Call the batch operations service
  const results = await batchCreateNodes(nodes, {
    target: input.target,
    dryRun: input.dryRun ?? false,
    workspace: input.workspace,
    _dbPathOverride: dbPath,
  });

  // Collect successful payloads and errors
  const payloads: TanaApiNode[] = [];
  const errors: BatchError[] = [];
  let created = 0;

  for (const result of results) {
    if (result.error) {
      errors.push({
        index: result.index,
        message: result.error,
      });
    }
    if (result.payload) {
      payloads.push(result.payload);
    }
    if (result.nodeId) {
      created++;
    }
  }

  // Success if no errors
  const success = errors.length === 0;

  return {
    success,
    created,
    results,
    payloads,
    errors,
    dryRun: input.dryRun ?? false,
    target: input.target,
  };
}
