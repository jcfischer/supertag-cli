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

import type { SchemaRegistry, SupertagSchema } from '../schema/registry';
import type { TanaApiNode, ChildNodeInput, CreateNodeInput, CreateNodeResult } from '../types';

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
 * Build child nodes from input array
 * Handles plain text, URLs, and references
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

    // Plain text node
    return { name: child.name };
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

  // Get configuration
  const configManager = ConfigManager.getInstance();
  const config = configManager.getConfig();

  // Load schema registry
  const registry = getSchemaRegistry();
  const supertags = registry.listSupertags();

  if (supertags.length === 0) {
    throw new Error(
      'Schema registry is empty. Sync it first with: supertag schema sync'
    );
  }

  // Build the node payload (validates supertag and builds structure)
  const payload = buildNodePayload(registry, input);

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
