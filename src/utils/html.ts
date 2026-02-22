/**
 * HTML Utilities
 *
 * Strips HTML tags from field values for clean comparison and display.
 * Tana stores option field values with HTML formatting (e.g., <span data-color="blue">DONE</span>).
 */

/**
 * Strip all HTML tags from a string, returning only text content.
 *
 * Examples:
 *   stripHtml('<span data-color="blue">DONE</span>') → 'DONE'
 *   stripHtml('plain text') → 'plain text'
 *   stripHtml('<b>bold</b> and <i>italic</i>') → 'bold and italic'
 *   stripHtml('') → ''
 */
export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}
