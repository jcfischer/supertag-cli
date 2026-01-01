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
import { StructuredError } from '../utils/structured-errors.js';

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
 * Result for a single node in batch create
 */
export interface BatchCreateResult {
  /** Index in the input array (0-based) */
  index: number;
  /** Whether this node was created/validated successfully */
  success?: boolean;
  /** Created node ID (only present if actually created) */
  nodeId?: string;
  /** Validated payload (always present for valid nodes) */
  payload?: TanaApiNode;
  /** Error message if this node failed */
  error?: string;
}

/**
 * Summary result of batch create operation
 */
export interface BatchCreateSummary {
  /** Overall success status (all nodes succeeded) */
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
// Validation Functions
// =============================================================================

/** Valid node ID pattern: alphanumeric, underscores, hyphens */
const NODE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Maximum allowed depth for child traversal */
const MAX_DEPTH = 3;

/**
 * Validate batch get inputs
 * @throws StructuredError if validation fails
 */
function validateBatchGetInputs(
  nodeIds: string[],
  options?: { depth?: number; select?: string[] }
): void {
  // Validate array size
  if (nodeIds.length > BATCH_GET_MAX_NODES) {
    throw new StructuredError('VALIDATION_ERROR', `Too many node IDs: ${nodeIds.length} exceeds maximum of ${BATCH_GET_MAX_NODES}`, {
      details: {
        provided: nodeIds.length,
        maximum: BATCH_GET_MAX_NODES,
      },
      suggestion: `Split your request into multiple batches of ${BATCH_GET_MAX_NODES} or fewer node IDs`,
      recovery: {
        canRetry: true,
        alternatives: [`Reduce to ${BATCH_GET_MAX_NODES} IDs or fewer`],
      },
    });
  }

  // Validate each node ID
  for (let i = 0; i < nodeIds.length; i++) {
    const id = nodeIds[i];

    // Check for empty strings
    if (!id || id.length === 0) {
      throw new StructuredError('VALIDATION_ERROR', `Empty node ID at index ${i}`, {
        details: { index: i },
        suggestion: 'Remove empty strings from your node IDs array',
        recovery: { canRetry: true },
      });
    }

    // Check for invalid characters
    if (!NODE_ID_PATTERN.test(id)) {
      throw new StructuredError('VALIDATION_ERROR', `Invalid node ID format at index ${i}: "${id}"`, {
        details: { index: i, invalidId: id },
        suggestion: 'Node IDs should contain only alphanumeric characters, underscores, and hyphens',
        recovery: { canRetry: true },
      });
    }
  }

  // Validate depth option
  if (options?.depth !== undefined) {
    if (options.depth < 0 || options.depth > MAX_DEPTH) {
      throw new StructuredError('VALIDATION_ERROR', `Invalid depth: ${options.depth}. Must be between 0 and ${MAX_DEPTH}`, {
        details: { provided: options.depth, minimum: 0, maximum: MAX_DEPTH },
        suggestion: `Use a depth value between 0 and ${MAX_DEPTH}`,
        recovery: { canRetry: true },
      });
    }
  }
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

  // Validate inputs
  validateBatchGetInputs(nodeIds, options);

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
 * Validate a single node's supertag using UnifiedSchemaService
 * Returns error message if invalid, undefined if valid
 */
async function validateSupertagExists(
  dbPath: string,
  supertag: string
): Promise<string | undefined> {
  const { existsSync } = await import('fs');
  const { withDatabase } = await import('../db/with-database');
  const { UnifiedSchemaService } = await import('./unified-schema-service');

  if (!existsSync(dbPath)) {
    return `Database not found: ${dbPath}`;
  }

  return withDatabase({ dbPath, readonly: true }, (ctx) => {
    const schemaService = new UnifiedSchemaService(ctx.db);
    const schema = schemaService.getSupertag(supertag);
    if (!schema) {
      // Get similar supertags for suggestion
      const similar = schemaService.searchSupertags(supertag);
      const suggestion = similar.length > 0
        ? `. Did you mean: ${similar.slice(0, 3).map((s) => s.name).join(', ')}?`
        : '';
      return `Unknown supertag: ${supertag}${suggestion}`;
    }
    return undefined;
  });
}

/**
 * Validate batch create inputs
 * @throws StructuredError if validation fails
 */
function validateBatchCreateInputs(nodes: CreateNodeInput[]): void {
  // Validate array size
  if (nodes.length > BATCH_CREATE_MAX_NODES) {
    throw new StructuredError('VALIDATION_ERROR', `Too many nodes: ${nodes.length} exceeds maximum of ${BATCH_CREATE_MAX_NODES}`, {
      details: {
        provided: nodes.length,
        maximum: BATCH_CREATE_MAX_NODES,
      },
      suggestion: `Split your request into multiple batches of ${BATCH_CREATE_MAX_NODES} or fewer nodes`,
      recovery: {
        canRetry: true,
        alternatives: [`Reduce to ${BATCH_CREATE_MAX_NODES} nodes or fewer`],
      },
    });
  }
}

/**
 * Validate a single node's structure
 * Returns error message if invalid, undefined if valid
 */
function validateNodeStructure(node: CreateNodeInput, index: number): string | undefined {
  // Validate supertag
  if (!node.supertag || node.supertag.trim().length === 0) {
    return `Node at index ${index}: supertag is required`;
  }

  // Validate name
  if (!node.name || node.name.trim().length === 0) {
    return `Node at index ${index}: name is required`;
  }

  return undefined;
}

/**
 * Create multiple nodes via Tana API
 *
 * Processing:
 * 1. Validate batch size (max 50)
 * 2. Validate each node structure
 * 3. Validate supertags exist
 * 4. Build payloads for valid nodes
 * 5. If dry-run, return validation results
 * 6. Otherwise, post to API in chunks
 *
 * @param nodes - Array of node definitions to create (max 50)
 * @param options - Target, dryRun, workspace options
 * @returns Array of results for each node in input order
 * @throws StructuredError if batch size exceeds maximum
 */
export async function batchCreateNodes(
  nodes: CreateNodeInput[],
  options?: { target?: string; dryRun?: boolean; workspace?: string; _dbPathOverride?: string }
): Promise<BatchCreateResult[]> {
  // Handle empty input
  if (nodes.length === 0) {
    return [];
  }

  // Validate batch size (throws if too many)
  validateBatchCreateInputs(nodes);

  // Lazy imports
  const { existsSync } = await import('fs');
  const { ConfigManager } = await import('../config/manager');
  const { resolveWorkspace } = await import('../config/paths');

  // Get configuration
  const configManager = ConfigManager.getInstance();
  const config = configManager.getConfig();

  // Determine database path
  let dbPath: string | undefined = options?._dbPathOverride;
  if (!dbPath) {
    try {
      const workspace = resolveWorkspace(options?.workspace, config);
      dbPath = workspace.dbPath;
    } catch {
      // Workspace resolution failed
    }
  }

  const results: BatchCreateResult[] = [];

  // Process each node
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const result: BatchCreateResult = { index: i };

    // Validate node structure
    const structureError = validateNodeStructure(node, i);
    if (structureError) {
      result.error = structureError;
      results.push(result);
      continue;
    }

    // Validate supertag exists
    if (dbPath && existsSync(dbPath)) {
      const error = await validateSupertagExists(dbPath, node.supertag);
      if (error) {
        result.error = error;
        results.push(result);
        continue;
      }
    }

    // Build payload
    try {
      const { buildNodePayloadFromDatabase } = await import('./node-builder');

      if (dbPath && existsSync(dbPath)) {
        const payload = await buildNodePayloadFromDatabase(dbPath, node);
        result.success = true;
        result.payload = payload;
      } else {
        // Fallback: use schema registry
        const { getSchemaRegistry } = await import('../commands/schema');
        const { buildNodePayload } = await import('./node-builder');
        const registry = getSchemaRegistry();
        const payload = buildNodePayload(registry, node);
        result.success = true;
        result.payload = payload;
      }
    } catch (error) {
      result.error = (error as Error).message;
    }

    results.push(result);
  }

  // If dry-run, we're done after validation
  if (options?.dryRun) {
    return results;
  }

  // TODO: Implement actual API posting in chunks (T-3.2+)
  // For now, mark all nodes as not-yet-created
  for (const result of results) {
    if (result.success && !result.nodeId) {
      result.success = false;
      result.error = 'API posting not implemented yet';
    }
  }

  return results;
}
