/**
 * JSON to TanaNode Converter
 * Generic converter that transforms arbitrary JSON into TanaNode structure
 */

import type { TanaNode, GenericJson } from '../types';

/**
 * Convert generic JSON to TanaNode array
 * @param json Input JSON (object or array)
 * @returns Array of TanaNode objects
 */
export function jsonToTanaNodes(json: GenericJson | GenericJson[]): TanaNode[] {
  if (Array.isArray(json)) {
    return json.map((item, index) => convertObjectToNode(item, `Item ${index + 1}`));
  }

  return [convertObjectToNode(json, 'Root')];
}

/**
 * Convert a JSON object to a TanaNode
 * @param obj JSON object
 * @param defaultName Default name if no obvious title field
 * @returns TanaNode
 */
function convertObjectToNode(obj: GenericJson, defaultName: string): TanaNode {
  // Try to find a suitable name field
  const nameField = findNameField(obj);
  const name = nameField ? String(obj[nameField]) : defaultName;

  // Extract supertag if present
  const supertag = extractSupertag(obj);

  // Convert remaining fields
  const fields: Record<string, string | string[] | TanaNode[]> = {};
  const children: TanaNode[] = [];

  for (const [key, value] of Object.entries(obj)) {
    // Skip fields we've already used
    if (key === nameField || key === 'supertag' || key === 'tag') {
      continue;
    }

    // Handle children array specially
    if (key === 'children' && Array.isArray(value)) {
      // Convert array items to child nodes
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          children.push(convertObjectToNode(item as GenericJson, 'Child'));
        }
      }
      continue;
    }

    // Handle different value types
    if (value === null || value === undefined) {
      continue;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields[key] = String(value);
    } else if (Array.isArray(value)) {
      fields[key] = convertArray(value);
    } else if (typeof value === 'object') {
      // Nested object becomes a child node
      children.push(convertObjectToNode(value as GenericJson, key));
    }
  }

  const node: TanaNode = { name };
  if (supertag) node.supertag = supertag;
  if (Object.keys(fields).length > 0) node.fields = fields;
  if (children.length > 0) node.children = children;

  return node;
}

/**
 * Find the most likely name field in an object
 * @param obj JSON object
 * @returns Field name or null
 */
function findNameField(obj: GenericJson): string | null {
  const nameFields = ['name', 'title', 'label', 'heading', 'subject', 'summary'];

  for (const field of nameFields) {
    if (field in obj && (typeof obj[field] === 'string' || typeof obj[field] === 'number')) {
      return field;
    }
  }

  return null;
}

/**
 * Extract supertag from object
 * @param obj JSON object
 * @returns Supertag string or undefined
 */
function extractSupertag(obj: GenericJson): string | undefined {
  if ('supertag' in obj && typeof obj.supertag === 'string') {
    return obj.supertag;
  }
  if ('tag' in obj && typeof obj.tag === 'string') {
    return obj.tag;
  }
  return undefined;
}

/**
 * Convert array to appropriate format
 * @param arr Array to convert
 * @returns String array or TanaNode array
 */
function convertArray(arr: unknown[]): string[] | TanaNode[] {
  if (arr.length === 0) {
    return [];
  }

  // If all items are objects, convert to TanaNodes
  if (arr.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
    return arr.map((item, index) =>
      convertObjectToNode(item as GenericJson, `Item ${index + 1}`)
    );
  }

  // Otherwise, convert to strings
  return arr.map(item => String(item));
}

/**
 * Convert TanaNode to Tana Input API format
 * @param node TanaNode
 * @returns API-compatible node structure
 */
export function tanaNodeToApiNode(node: TanaNode): {
  name: string;
  description?: string;
  supertags?: Array<{ id: string }>;
  children?: Array<{ name: string; description?: string }>;
} {
  const apiNode: {
    name: string;
    description?: string;
    supertags?: Array<{ id: string }>;
    children?: Array<{ name: string; description?: string }>;
  } = {
    name: node.name,
  };

  // Convert supertag (only if it's an ID format)
  if (node.supertag && node.supertag.startsWith('SYS_')) {
    apiNode.supertags = [{ id: node.supertag }];
  }

  // Convert fields to description (simple text format)
  if (node.fields) {
    const fieldLines: string[] = [];
    for (const [key, value] of Object.entries(node.fields)) {
      if (typeof value === 'string') {
        fieldLines.push(`${key}: ${value}`);
      } else if (Array.isArray(value)) {
        fieldLines.push(`${key}: ${value.join(', ')}`);
      }
    }
    if (fieldLines.length > 0) {
      apiNode.description = fieldLines.join('\n');
    }
  }

  // Convert children recursively
  if (node.children && node.children.length > 0) {
    apiNode.children = node.children.map(child => tanaNodeToApiNode(child) as any);
  }

  return apiNode;
}

/**
 * Smart JSON parser that handles various input formats
 * @param input String input (JSON, JSON lines, or plain text)
 * @returns Parsed JSON object or array
 */
export function parseJsonInput(input: string): GenericJson | GenericJson[] {
  const trimmed = input.trim();

  // Try parsing as regular JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    // Not valid JSON, try JSON lines format
    const lines = trimmed.split('\n').filter(line => line.trim());

    if (lines.length === 1) {
      throw new Error('Invalid JSON input');
    }

    // Try parsing each line as JSON
    try {
      return lines.map(line => JSON.parse(line));
    } catch {
      throw new Error('Invalid JSON input (not valid JSON or JSON Lines format)');
    }
  }
}
