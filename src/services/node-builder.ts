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

import { existsSync } from 'fs';
import type { SchemaRegistry, SupertagSchema } from '../schema/registry';
import type { TanaApiNode, ChildNodeInput, CreateNodeInput, CreateNodeResult } from '../types';
import { UnifiedSchemaService } from './unified-schema-service';
import { withDatabase } from '../db/with-database';
import { normalizeFieldInput } from './field-normalizer';

/**
 * Recursively parse a child node object from unknown input
 * Used by CLI (from JSON.parse) and MCP (from Zod-validated input)
 *
 * @param obj Unknown object to parse
 * @returns ChildNodeInput if valid, null if invalid
 *
 * @example
 * // Simple child
 * parseChildObject({ name: "Task 1" })
 * // => { name: "Task 1" }
 *
 * @example
 * // Nested children
 * parseChildObject({
 *   name: "Section",
 *   children: [{ name: "Item 1" }, { name: "Item 2" }]
 * })
 * // => { name: "Section", children: [{ name: "Item 1" }, { name: "Item 2" }] }
 */
export function parseChildObject(obj: Record<string, unknown>): ChildNodeInput | null {
  if (!obj.name || typeof obj.name !== 'string') return null;

  const child: ChildNodeInput = { name: obj.name };

  if (typeof obj.id === 'string') {
    child.id = obj.id;
  }
  if (obj.dataType === 'url' || obj.dataType === 'reference') {
    child.dataType = obj.dataType;
  }

  // Recursively parse nested children
  if (Array.isArray(obj.children)) {
    const nestedChildren: ChildNodeInput[] = [];
    for (const nestedChild of obj.children) {
      if (typeof nestedChild === 'object' && nestedChild !== null) {
        const parsed = parseChildObject(nestedChild as Record<string, unknown>);
        if (parsed) nestedChildren.push(parsed);
      }
    }
    if (nestedChildren.length > 0) {
      child.children = nestedChildren;
    }
  }

  return child;
}

/**
 * Parse an array of child objects recursively
 * Convenience wrapper around parseChildObject for array inputs
 *
 * @param children Array of objects to parse (or undefined)
 * @returns Array of ChildNodeInput, or undefined if input is empty/undefined
 */
export function parseChildArray(
  children: Array<Record<string, unknown>> | undefined
): ChildNodeInput[] | undefined {
  if (!children || children.length === 0) return undefined;

  const result: ChildNodeInput[] = [];
  for (const child of children) {
    if (typeof child === 'object' && child !== null) {
      const parsed = parseChildObject(child);
      if (parsed) result.push(parsed);
    }
  }

  return result.length > 0 ? result : undefined;
}

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
export async function buildNodePayloadFromDatabase(
  dbPath: string,
  input: CreateNodeInput
): Promise<TanaApiNode> {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  return withDatabase({ dbPath, readonly: true }, (ctx) => {
    const schemaService = new UnifiedSchemaService(ctx.db);

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
  });
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
  // Normalize field input: handles both nested {fields: {...}} and flat {...} formats
  // This is the single integration point for MCP and CLI field normalization
  const normalizedInput = normalizeFieldInput(input as unknown as Record<string, unknown>);

  // Create a new input object with normalized fields
  const processedInput: CreateNodeInput = {
    ...input,
    fields: Object.keys(normalizedInput.fields).length > 0 ? normalizedInput.fields : input.fields,
  };

  // Use processedInput for all downstream operations
  const inputToUse = processedInput;

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
  let dbPath: string | undefined = inputToUse._dbPathOverride;

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
    payload = await buildNodePayloadFromDatabase(dbPath, inputToUse);
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
    payload = buildNodePayload(registry, inputToUse);
  }

  // Determine target
  const target = inputToUse.target || config.defaultTargetNode || 'INBOX';

  // If dry run, return without posting
  if (inputToUse.dryRun) {
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
