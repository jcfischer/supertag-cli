/**
 * Node Builder Service
 *
 * Shared module for creating Tana nodes via the Input API.
 * Used by both CLI (commands/create.ts) and MCP (mcp/tools/create.ts).
 *
 * @example
 * // Create a simple node
 * const result = await createNode({
 *   supertag: 'todo',
 *   name: 'Buy groceries',
 *   dryRun: true,
 * });
 *
 * @example
 * // Create node with fields and children
 * const result = await createNode({
 *   supertag: 'meeting',
 *   name: 'Team Standup',
 *   fields: { status: 'scheduled' },
 *   children: [
 *     { name: 'Agenda item 1' },
 *     { name: 'https://zoom.us/meeting', dataType: 'url' },
 *   ],
 * });
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import type { SchemaRegistry, SupertagSchema } from '../schema/registry';
import type { TanaApiNode, ChildNodeInput, CreateNodeInput, CreateNodeResult } from '../types';
import { UnifiedSchemaService } from './unified-schema-service';

/**
 * Validate supertag names exist in registry
 * @param registry Schema registry instance
 * @param supertagInput Single supertag name or comma-separated list
 * @returns Array of resolved SupertagSchema objects
 * @throws Error with suggestions if unknown tag
 */
export function validateSupertags(
  registry: SchemaRegistry,
  supertagInput: string
): SupertagSchema[] {
  // Parse comma-separated tags
  const tagNames = supertagInput.includes(',')
    ? supertagInput.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : [supertagInput.trim()];

  const schemas: SupertagSchema[] = [];

  for (const tagName of tagNames) {
    const schema = registry.getSupertag(tagName);
    if (!schema) {
      // Get similar supertags for suggestion
      const similar = registry.searchSupertags(tagName);
      const suggestion =
        similar.length > 0
          ? `. Did you mean: ${similar.slice(0, 3).map((s) => s.name).join(', ')}?`
          : '';
      throw new Error(`Unknown supertag: ${tagName}${suggestion}`);
    }
    schemas.push(schema);
  }

  return schemas;
}

/**
 * Build child nodes from input array (recursive)
 * Handles plain text, URLs, references, and nested children
 * @param children Array of child node inputs
 * @returns Array of TanaApiNode ready for API
 */
export function buildChildNodes(
  children: ChildNodeInput[]
): TanaApiNode[] {
  return children.map((child) => {
    // Reference node (has ID)
    if (child.id) {
      return {
        dataType: 'reference' as const,
        id: child.id,
      } as unknown as TanaApiNode;
    }

    // URL node (explicit dataType)
    if (child.dataType === 'url') {
      return {
        name: child.name,
        dataType: 'url' as const,
      } as unknown as TanaApiNode;
    }

    // Plain text or nested node
    const node: TanaApiNode = { name: child.name };

    // Recursively process nested children
    if (child.children && child.children.length > 0) {
      node.children = buildChildNodes(child.children);
    }

    return node;
  });
}

/**
 * Build complete node payload ready for API
 * Uses registry.buildNodePayload internally, then appends children
 * @param registry Schema registry instance
 * @param input Node creation input
 * @returns TanaApiNode ready for posting
 */
export function buildNodePayload(
  registry: SchemaRegistry,
  input: CreateNodeInput
): TanaApiNode {
  // Validate supertags first
  validateSupertags(registry, input.supertag);

  // Build base payload using registry (handles supertags and fields)
  const fieldValues: Record<string, string | string[]> = {};
  if (input.fields) {
    for (const [key, value] of Object.entries(input.fields)) {
      fieldValues[key] = value;
    }
  }

  const nodePayload = registry.buildNodePayload(
    input.supertag,
    input.name,
    fieldValues
  );

  // Add children if provided
  if (input.children && input.children.length > 0) {
    const childNodes = buildChildNodes(input.children);

    // Append to existing children (fields) or create new array
    nodePayload.children = nodePayload.children
      ? [...nodePayload.children, ...childNodes]
      : childNodes;
  }

  return nodePayload;
}

/**
 * Build node payload from database using UnifiedSchemaService (T-5.3)
 *
 * This function uses the database directly instead of SchemaRegistry cache,
 * providing access to enhanced schema data including inferred types.
 *
 * @param dbPath - Path to the SQLite database
 * @param input - Node creation input
 * @returns TanaApiNode ready for posting
 * @throws Error if database doesn't exist or supertag not found
 */
export function buildNodePayloadFromDatabase(
  dbPath: string,
  input: CreateNodeInput
): TanaApiNode {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = new Database(dbPath);
  try {
    const schemaService = new UnifiedSchemaService(db);

    // Build base payload using UnifiedSchemaService
    const fieldValues: Record<string, string | string[]> = {};
    if (input.fields) {
      for (const [key, value] of Object.entries(input.fields)) {
        fieldValues[key] = value;
      }
    }

    const nodePayload = schemaService.buildNodePayload(
      input.supertag,
      input.name,
      fieldValues
    );

    // Add children if provided
    if (input.children && input.children.length > 0) {
      const childNodes = buildChildNodes(input.children);

      // Append to existing children (fields) or create new array
      nodePayload.children = nodePayload.children
        ? [...nodePayload.children, ...childNodes]
        : childNodes;
    }

    return nodePayload;
  } finally {
    db.close();
  }
}

/**
 * Create node in Tana (or validate in dry run mode)
 * Orchestrates validation, building, and API posting
 * @param input Node creation input with all options
 * @returns Promise resolving to creation result
 */
export async function createNode(
  input: CreateNodeInput
): Promise<CreateNodeResult> {
  // Lazy imports to avoid circular dependencies
  const { getSchemaRegistry } = await import('../commands/schema');
  const { ConfigManager } = await import('../config/manager');
  const { createApiClient } = await import('../api/client');
  const { resolveWorkspace } = await import('../config/paths');

  // Get configuration
  const configManager = ConfigManager.getInstance();
  const config = configManager.getConfig();

  // Try to use database-backed payload building (has explicit field types)
  let payload: TanaApiNode | undefined;

  // Determine database path (test override or resolved workspace)
  let dbPath: string | undefined = input._dbPathOverride;

  if (!dbPath) {
    try {
      const workspace = resolveWorkspace(undefined, config);
      dbPath = workspace.dbPath;
    } catch {
      // Workspace resolution failed, fall back to registry
    }
  }

  if (dbPath && existsSync(dbPath)) {
    // Use database for explicit field types
    payload = buildNodePayloadFromDatabase(dbPath, input);
  }

  // Fall back to schema registry if database not available
  if (!payload) {
    const registry = getSchemaRegistry();
    const supertags = registry.listSupertags();

    if (supertags.length === 0) {
      throw new Error(
        'Schema registry is empty. Sync it first with: supertag schema sync'
      );
    }

    // Build the node payload (validates supertag and builds structure)
    payload = buildNodePayload(registry, input);
  }

  // Determine target
  const target = input.target || config.defaultTargetNode || 'INBOX';

  // If dry run, return without posting
  if (input.dryRun) {
    return {
      success: true,
      payload,
      target,
      dryRun: true,
    };
  }

  // Check for API token (only needed for actual posting)
  const apiToken = config.apiToken;
  if (!apiToken) {
    throw new Error(
      'API token not configured. Set it via: supertag config --token <token>'
    );
  }

  // Create API client and post
  const client = createApiClient(apiToken, config.apiEndpoint);

  const response = await client.postNodes(target, [payload], false);

  if (response.success) {
    return {
      success: true,
      nodeId: response.nodeIds && response.nodeIds.length > 0
        ? response.nodeIds[0]
        : undefined,
      payload,
      target,
      dryRun: false,
    };
  }

  return {
    success: false,
    payload,
    target,
    dryRun: false,
    error: 'API returned success: false',
  };
}
