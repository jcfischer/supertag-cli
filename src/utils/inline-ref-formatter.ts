/**
 * Utility for formatting inline references in field values.
 * Handles both node references and date references from Tana export data.
 *
 * Fixes GitHub issue #26: Field values with inline references are truncated to first reference only
 */

export interface FormatInlineRefOptions {
  /** Format for node refs: 'bracket' for [[id]], 'display' for display text */
  nodeRefFormat?: "bracket" | "display";
  /** Fallback value when input is null/undefined */
  fallback?: string;
}

/**
 * Decode common HTML entities found in Tana export data
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Format inline references in a field value string.
 * Handles both node references and date references, processing ALL occurrences.
 *
 * @param value - Raw field value potentially containing inline refs
 * @param options - Formatting options
 * @returns Formatted string with all inline references processed
 *
 * @example
 * // Node references (bracket mode - default)
 * formatInlineRefs('Meeting with <span data-inlineref-node="abc">John</span> and <span data-inlineref-node="def">Jane</span>')
 * // => 'Meeting with [[abc]] and [[def]]'
 *
 * @example
 * // Node references (display mode)
 * formatInlineRefs('Meeting with <span data-inlineref-node="abc">John</span>', { nodeRefFormat: 'display' })
 * // => 'Meeting with John'
 *
 * @example
 * // Date references
 * formatInlineRefs('Due: <span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-14&quot;}">Jan 14</span>')
 * // => 'Due: 2026-01-14'
 */
export function formatInlineRefs(
  value: string | null | undefined,
  options: FormatInlineRefOptions = {}
): string {
  const { nodeRefFormat = "bracket", fallback = "" } = options;

  if (value === null || value === undefined) {
    return fallback;
  }

  let result = value;

  // Process date references first
  // Pattern: <span ... data-inlineref-date="JSON" ...>display text</span>
  // The JSON contains dateTimeString with the actual date
  // Note: [^>]* allows other attributes before/after the data-inlineref-date attribute
  if (result.includes("data-inlineref-date")) {
    const datePattern =
      /<span[^>]*\sdata-inlineref-date="([^"]+)"[^>]*>([^<]*)<\/span>/g;

    result = result.replace(datePattern, (_, jsonAttr) => {
      // Decode HTML entities in the JSON attribute
      const decoded = decodeHtmlEntities(jsonAttr);
      // Extract dateTimeString from the JSON
      const dateMatch = decoded.match(/dateTimeString":\s*"([^"]+)"/);
      if (dateMatch) {
        return dateMatch[1];
      }
      // Fallback: return empty string if parsing fails
      return "";
    });
  }

  // Process node references
  // Pattern: <span ... data-inlineref-node="NODE_ID" ...>display text</span>
  // Note: [^>]* allows other attributes before/after the data-inlineref-node attribute
  if (result.includes("data-inlineref-node")) {
    const nodePattern =
      /<span[^>]*\sdata-inlineref-node="([^"]+)"[^>]*>([^<]*)<\/span>/g;

    result = result.replace(nodePattern, (_, nodeId, displayText) => {
      if (nodeRefFormat === "display") {
        // Return display text, or node ID if display text is empty
        return displayText || nodeId;
      }
      // Default: bracket format [[nodeId]]
      return `[[${nodeId}]]`;
    });
  }

  return result;
}
