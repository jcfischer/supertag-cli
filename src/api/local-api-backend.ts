/**
 * Local API Backend Implementation
 * Spec: F-094 tana-local API Integration
 * Task: T-3.3
 *
 * Implements TanaBackend using the tana-local REST API.
 * Supports full CRUD: create, update, tag, field, check, trash.
 *
 * createNodes() converts Input API format (TanaApiNode[]) to Tana Paste
 * format before calling importTanaPaste(), bridging the two APIs.
 */
import type {
  TanaApiNode,
  TanaApiResponse,
  TanaApiFieldNode,
  TanaApiDateNode,
  TanaApiReferenceNode,
} from '../types';
import type {
  UpdateResponse,
  TagOperationResponse,
  FieldContentResponse,
  FieldOptionResponse,
  FieldSetMode,
  DoneResponse,
  TrashResponse,
} from '../types/local-api';
import type { TanaBackend } from './backend';
import type { LocalApiClient } from './local-api-client';

// =============================================================================
// Tana Paste Conversion
// =============================================================================

/**
 * Type guard: is this a field node (TanaApiFieldNode)?
 */
function isFieldNode(
  node: TanaApiNode | TanaApiFieldNode | TanaApiDateNode | TanaApiReferenceNode,
): node is TanaApiFieldNode {
  return 'type' in node && node.type === 'field' && 'attributeId' in node;
}

/**
 * Type guard: is this a date node (TanaApiDateNode)?
 */
function isDateNode(
  node: TanaApiNode | TanaApiFieldNode | TanaApiDateNode | TanaApiReferenceNode,
): node is TanaApiDateNode {
  return 'dataType' in node && node.dataType === 'date';
}

/**
 * Type guard: is this a reference node (TanaApiReferenceNode)?
 */
function isReferenceNode(
  node: TanaApiNode | TanaApiFieldNode | TanaApiDateNode | TanaApiReferenceNode,
): node is TanaApiReferenceNode {
  return 'dataType' in node && node.dataType === 'reference' && 'id' in node;
}

/**
 * Convert a single TanaApiNode (and its children) to Tana Paste lines.
 *
 * Tana Paste format:
 *   - Node name #[[^tagId]]
 *     - FieldAttrId:: value
 *     - Child node
 *     - [[^refId]]
 *
 * @param node - Input API node to convert
 * @param indent - Current indentation level (0 = top level)
 * @returns Array of Tana Paste lines
 */
function nodeToTanaPaste(node: TanaApiNode, indent: number = 0): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent) + '- ';

  // Build the node line: name + supertag references
  let nodeLine = prefix + node.name;

  if (node.supertags && node.supertags.length > 0) {
    for (const tag of node.supertags) {
      nodeLine += ` #[[^${tag.id}]]`;
    }
  }

  lines.push(nodeLine);

  // Add description as an indented child if present
  if (node.description) {
    lines.push('  '.repeat(indent + 1) + '- ' + node.description);
  }

  // Process children
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      if (isFieldNode(child)) {
        // Field node: attributeId:: value
        const fieldLines = fieldNodeToTanaPaste(child, indent + 1);
        lines.push(...fieldLines);
      } else if (isReferenceNode(child)) {
        // Reference node: [[^id]]
        lines.push('  '.repeat(indent + 1) + '- ' + `[[^${child.id}]]`);
      } else if (isDateNode(child)) {
        // Date node: just the date string
        lines.push('  '.repeat(indent + 1) + '- ' + child.name);
      } else {
        // Regular child node (TanaApiNode) - recurse
        const childNode = child as TanaApiNode;
        // Check if child itself is a field type via its own properties
        if (childNode.type === 'field' && childNode.attributeId) {
          const fieldLines = fieldNodeFromApiNode(childNode, indent + 1);
          lines.push(...fieldLines);
        } else if (childNode.dataType === 'reference' && childNode.id) {
          lines.push('  '.repeat(indent + 1) + '- ' + `[[^${childNode.id}]]`);
        } else {
          lines.push(...nodeToTanaPaste(childNode, indent + 1));
        }
      }
    }
  }

  return lines;
}

/**
 * Convert a TanaApiFieldNode to Tana Paste field format.
 * Format: `- attributeId:: value`
 *
 * @param field - Field node with attributeId and children (values)
 * @param indent - Current indentation level
 * @returns Array of Tana Paste lines
 */
function fieldNodeToTanaPaste(field: TanaApiFieldNode, indent: number): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent) + '- ';

  if (field.children.length === 0) {
    // Empty field
    lines.push(prefix + field.attributeId + '::');
    return lines;
  }

  // First child value goes on the same line as the field
  const firstChild = field.children[0];
  const firstValue = getChildValueFromUnion(firstChild);
  lines.push(prefix + field.attributeId + ':: ' + firstValue);

  // Additional values go as indented children
  for (let i = 1; i < field.children.length; i++) {
    const child = field.children[i];
    const value = getChildValueFromUnion(child);
    lines.push('  '.repeat(indent + 1) + '- ' + value);
  }

  return lines;
}

/**
 * Convert a TanaApiNode that has type='field' to Tana Paste field format.
 * This handles the case where field data comes as a regular TanaApiNode
 * with type and attributeId properties.
 */
function fieldNodeFromApiNode(node: TanaApiNode, indent: number): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent) + '- ';

  if (!node.children || node.children.length === 0) {
    lines.push(prefix + node.attributeId + '::');
    return lines;
  }

  const firstChild = node.children[0];
  const firstValue = getChildValueFromUnion(firstChild);
  lines.push(prefix + node.attributeId + ':: ' + firstValue);

  for (let i = 1; i < node.children.length; i++) {
    const child = node.children[i];
    const value = getChildValueFromUnion(child);
    lines.push('  '.repeat(indent + 1) + '- ' + value);
  }

  return lines;
}

/**
 * Extract the display value from any child node union type.
 * Handles TanaApiNode, TanaApiFieldNode, TanaApiDateNode, TanaApiReferenceNode.
 */
function getChildValueFromUnion(
  child: TanaApiNode | TanaApiFieldNode | TanaApiDateNode | TanaApiReferenceNode,
): string {
  if (isReferenceNode(child)) {
    return `[[^${child.id}]]`;
  }
  if (isDateNode(child)) {
    return child.name;
  }
  if (isFieldNode(child)) {
    // Nested field in a field value -- use the attributeId as the label
    return child.attributeId;
  }
  // Regular node - use name
  return (child as TanaApiNode).name;
}

/**
 * Convert an array of TanaApiNode to a single Tana Paste string.
 *
 * @param nodes - Input API nodes to convert
 * @returns Tana Paste formatted string
 */
export function convertNodesToTanaPaste(nodes: TanaApiNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    lines.push(...nodeToTanaPaste(node, 0));
  }
  return lines.join('\n');
}

// =============================================================================
// LocalApiBackend
// =============================================================================

/**
 * Backend implementation using the tana-local REST API.
 *
 * Capabilities:
 * - createNodes: converts to Tana Paste, then calls importTanaPaste()
 * - Full mutation support: update, tag, field, check, trash
 *
 * The Local API runs on Tana Desktop (default: http://localhost:8262).
 */
export class LocalApiBackend implements TanaBackend {
  readonly type = 'local-api' as const;

  private client: LocalApiClient;

  constructor(client: LocalApiClient) {
    this.client = client;
  }

  async createNodes(
    targetNodeId: string,
    nodes: TanaApiNode[],
    _verbose?: boolean,
  ): Promise<TanaApiResponse> {
    const tanaPaste = convertNodesToTanaPaste(nodes);

    const result = await this.client.importTanaPaste(targetNodeId, tanaPaste);

    return {
      success: true,
      nodeIds: result.createdNodes.map((n) => n.id),
    };
  }

  supportsMutations(): boolean {
    return true;
  }

  async updateNode(
    nodeId: string,
    update: { name?: string | null; description?: string | null },
  ): Promise<UpdateResponse> {
    return this.client.updateNode(nodeId, update);
  }

  async addTags(
    nodeId: string,
    tagIds: string[],
  ): Promise<TagOperationResponse> {
    return this.client.addTags(nodeId, tagIds);
  }

  async removeTags(
    nodeId: string,
    tagIds: string[],
  ): Promise<TagOperationResponse> {
    return this.client.removeTags(nodeId, tagIds);
  }

  async setFieldContent(
    nodeId: string,
    attributeId: string,
    content: string,
    mode?: FieldSetMode,
  ): Promise<FieldContentResponse> {
    return this.client.setFieldContent(nodeId, attributeId, content, mode);
  }

  async setFieldOption(
    nodeId: string,
    attributeId: string,
    optionId: string,
    mode?: FieldSetMode,
  ): Promise<FieldOptionResponse> {
    return this.client.setFieldOption(nodeId, attributeId, optionId, mode);
  }

  async checkNode(nodeId: string): Promise<DoneResponse> {
    return this.client.checkNode(nodeId);
  }

  async uncheckNode(nodeId: string): Promise<DoneResponse> {
    return this.client.uncheckNode(nodeId);
  }

  async trashNode(nodeId: string): Promise<TrashResponse> {
    return this.client.trashNode(nodeId);
  }
}
