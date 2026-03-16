/**
 * Tana Paste Formatter
 * Converts TanaNode structure to Tana Paste format
 */

import type { TanaNode } from '../types';
import { formatDateComponents } from '../utils/format';

/**
 * Format TanaNode array as Tana Paste
 * @param nodes Array of TanaNode objects
 * @returns Formatted Tana Paste string with %%tana%% header
 */
export function formatTanaPaste(nodes: TanaNode[]): string {
  let output = '%%tana%%\n';

  for (const node of nodes) {
    output += formatNode(node, 0);
  }

  return output;
}

/**
 * Format a single TanaNode with proper indentation
 * @param node The node to format
 * @param depth Current indentation depth
 * @returns Formatted node string
 */
function formatNode(node: TanaNode, depth: number): string {
  const indent = '  '.repeat(depth);
  let output = `${indent}- ${node.name}`;

  // Add supertag if present
  if (node.supertag) {
    const tag = node.supertag.includes(' ')
      ? `#[[${node.supertag}]]`
      : `#${node.supertag}`;
    output += ` ${tag}`;
  }
  output += '\n';

  // Format fields
  if (node.fields) {
    for (const [key, value] of Object.entries(node.fields)) {
      output += formatField(key, value, depth + 1);
    }
  }

  // Format children
  if (node.children) {
    for (const child of node.children) {
      output += formatNode(child, depth + 1);
    }
  }

  return output;
}

/**
 * Format a field (key-value pair)
 * @param key Field name
 * @param value Field value (string, array, or nested nodes)
 * @param depth Current indentation depth
 * @returns Formatted field string
 */
function formatField(
  key: string,
  value: string | string[] | TanaNode[],
  depth: number
): string {
  const indent = '  '.repeat(depth);
  let output = '';

  if (Array.isArray(value)) {
    // Check if it's an array of TanaNodes
    if (value.length > 0 && isNodeArray(value)) {
      // Format as nested nodes under field
      output += `${indent}- ${key}::\n`;
      for (const node of value as TanaNode[]) {
        output += formatNode(node, depth + 1);
      }
    } else {
      // Format as bullet list under field
      output += `${indent}- ${key}::\n`;
      for (const item of value as string[]) {
        output += `${indent}  - ${item}\n`;
      }
    }
  } else if (typeof value === 'string') {
    // Simple field value
    output += `${indent}- ${key}:: ${value}\n`;
  }

  return output;
}

/**
 * Type guard to check if value is TanaNode array
 */
function isNodeArray(value: unknown[]): value is TanaNode[] {
  return value.length > 0 &&
         typeof value[0] === 'object' &&
         value[0] !== null &&
         'name' in value[0];
}

/**
 * Escape special characters in Tana Paste
 * @param text Text to escape
 * @returns Escaped text
 */
export function escapeTanaText(text: string): string {
  // Tana Paste doesn't require much escaping, but we handle common cases
  return text
    .replace(/\n/g, ' ')  // Replace newlines with spaces
    .trim();
}

/**
 * Format a date for Tana (Tana date format)
 * @param date Date object or ISO string
 * @returns Formatted date reference [[date:YYYY-MM-DD]] or [[date:YYYY-MM-DD HH:mm]]
 */
export function formatTanaDate(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const { year, month, day, hours, minutes } = formatDateComponents(dateObj);

  // If time is 00:00, just return date
  if (hours === '00' && minutes === '00') {
    return `[[date:${year}-${month}-${day}]]`;
  }

  // Include time
  return `[[date:${year}-${month}-${day} ${hours}:${minutes}]]`;
}

/**
 * Format a date range for Tana
 * @param start Start date
 * @param end End date
 * @returns Formatted date range [[date:START/END]]
 */
export function formatTanaDateRange(start: Date | string, end: Date | string): string {
  const startObj = typeof start === 'string' ? new Date(start) : start;
  const endObj = typeof end === 'string' ? new Date(end) : end;

  const s = formatDateComponents(startObj);
  const e = formatDateComponents(endObj);

  const startStr = `${s.year}-${s.month}-${s.day} ${s.hours}:${s.minutes}`;
  const endStr = `${e.year}-${e.month}-${e.day} ${e.hours}:${e.minutes}`;

  return `[[date:${startStr}/${endStr}]]`;
}

/**
 * Create a reference to another Tana node
 * @param nodeName Name of the node to reference
 * @param nodeId Optional node ID for direct reference
 * @returns Formatted reference [[nodeName]] or [[nodeName^nodeId]]
 */
export function formatTanaReference(nodeName: string, nodeId?: string): string {
  if (nodeId) {
    return `[[${nodeName}^${nodeId}]]`;
  }
  return `[[${nodeName}]]`;
}
