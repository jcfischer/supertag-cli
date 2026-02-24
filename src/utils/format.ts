/**
 * Output formatting utilities for supertag CLI
 *
 * Core philosophy:
 * - Unix-style output by default (TSV, pipe-friendly)
 * - Pretty mode for human-readable output (opt-in via --pretty)
 * - ISO dates by default, human dates opt-in
 */

/**
 * Options for output formatting
 */
export interface OutputOptions {
  /** Human-friendly output with emojis and tables */
  pretty?: boolean;
  /** JSON output mode */
  json?: boolean;
  /** Use human-readable date format instead of ISO */
  humanDates?: boolean;
  /** Include technical details (IDs, timing, etc.) */
  verbose?: boolean;
}

// ============================================================================
// Unix-style output functions (default mode)
// ============================================================================

/**
 * Format fields as tab-separated values (TSV)
 * Unix-style output suitable for piping to grep, awk, cut, etc.
 *
 * @example
 * tsv('abc123', 'Meeting Notes', 'meeting')
 * // => 'abc123\tMeeting Notes\tmeeting'
 */
export function tsv(...fields: (string | number | null | undefined)[]): string {
  return fields.map(f => f ?? '').join('\t');
}

/**
 * Format key-value pairs as YAML-like records
 * Used for --show mode output
 *
 * @example
 * record({ id: 'abc', name: 'Test', tags: 'todo' })
 * // => 'id: abc\nname: Test\ntags: todo'
 */
export function record(fields: Record<string, string | undefined>): string {
  return Object.entries(fields)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

// ============================================================================
// Date formatting functions
// ============================================================================

/**
 * Format date as ISO 8601 date string (YYYY-MM-DD)
 * This is the default date format - sortable and unambiguous
 *
 * @example
 * formatDateISO(new Date('2025-12-17')) // => '2025-12-17'
 */
export function formatDateISO(date: Date | string | number): string {
  const d = toDate(date);
  return d.toISOString().split('T')[0];
}

/**
 * Format date as human-readable string
 * Used when --human-dates flag is set
 *
 * @example
 * formatDateHuman(new Date('2025-12-17')) // => 'Dec 17, 2025'
 */
export function formatDateHuman(date: Date | string | number): string {
  const d = toDate(date);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format date as relative time (e.g., "2 hours ago")
 * Falls back to ISO date for dates older than 7 days
 *
 * @example
 * formatDateRelative(new Date(Date.now() - 3600000)) // => '1 hour ago'
 */
export function formatDateRelative(date: Date | string | number): string {
  const d = toDate(date);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  }
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffDays <= 7) {
    return diffDays === 1 ? 'yesterday' : `${diffDays} days ago`;
  }
  // Fall back to ISO date for older dates
  return formatDateISO(d);
}

// ============================================================================
// Number formatting functions
// ============================================================================

/**
 * Format number, optionally with thousand separators
 *
 * @param n - The number to format
 * @param pretty - If true, add thousand separators
 * @example
 * formatNumber(1234567) // => '1234567'
 * formatNumber(1234567, true) // => '1,234,567'
 */
export function formatNumber(n: number, pretty = false): string {
  return pretty ? n.toLocaleString('en-US') : String(n);
}

/**
 * Format decimal as percentage or raw decimal
 *
 * @param n - The decimal to format (0.0 to 1.0)
 * @param pretty - If true, format as percentage with % sign
 * @example
 * formatPercentage(0.568) // => '0.568'
 * formatPercentage(0.568, true) // => '56.8%'
 */
export function formatPercentage(n: number, pretty = false): string {
  return pretty ? `${(n * 100).toFixed(1)}%` : n.toFixed(3);
}

// ============================================================================
// Pretty-mode utilities (T-1.3)
// ============================================================================

/**
 * Emoji constants for pretty output mode
 */
export const EMOJI = {
  search: '🔍',
  tags: '🏷️',
  stats: '📊',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  workspace: '📂',
  embeddings: '🧠',
  serverRunning: '▶️',
  serverStopped: '⏹️',
  node: '📄',
  tip: '💡',
  link: '🔗',
  recent: '⏱️',
  transcribe: '🎙️',
  aggregate: '📈',
  // Attachments
  download: '📥',
  file: '📎',
  folder: '📁',
  check: '✓',
  skip: '⏭️',
  info: 'ℹ️',
  time: '⏱️',
  data: '💾',
} as const;

/**
 * Pad string with spaces on the right (left-align)
 *
 * @param s - String to pad
 * @param width - Target width
 * @example
 * padRight('hello', 10) // => 'hello     '
 */
export function padRight(s: string, width: number): string {
  return s.padEnd(width);
}

/**
 * Pad string with spaces on the left (right-align)
 *
 * @param s - String to pad
 * @param width - Target width
 * @example
 * padLeft('42', 5) // => '   42'
 */
export function padLeft(s: string, width: number): string {
  return s.padStart(width);
}

/**
 * Create a horizontal divider line
 *
 * @param width - Line width (default: 60)
 * @param char - Character to use (default: '─')
 * @example
 * divider(10) // => '──────────'
 */
export function divider(width = 60, char = '─'): string {
  return char.repeat(width);
}

/**
 * Format a section header with emoji
 *
 * @param emoji - Emoji to prefix
 * @param title - Header text
 * @example
 * header('🔍', 'Search Results') // => '🔍 Search Results'
 */
export function header(emoji: string, title: string): string {
  return `${emoji} ${title}`;
}

/**
 * Format a labeled field with indentation
 *
 * @param label - Field label
 * @param value - Field value
 * @param indent - Indentation spaces (default: 2)
 * @example
 * field('Status', 'running') // => '  Status: running'
 */
export function field(label: string, value: string, indent = 2): string {
  return `${' '.repeat(indent)}${label}: ${value}`;
}

/**
 * Format a helpful tip message
 *
 * @param message - Tip message
 * @example
 * tip('Use --show for details') // => '\n💡 Tip: Use --show for details'
 */
export function tip(message: string): string {
  return `\n${EMOJI.tip} Tip: ${message}`;
}

/**
 * Table formatting options
 */
interface TableOptions {
  /** Column alignment ('left' or 'right' per column) */
  align?: ('left' | 'right')[];
  /** Left indentation spaces (default: 2) */
  indent?: number;
}

/**
 * Format data as an aligned table
 *
 * @param headers - Column headers
 * @param rows - Table rows (array of arrays)
 * @param options - Formatting options
 * @example
 * table(['Name', 'Count'], [['meeting', '42'], ['todo', '17']])
 */
export function table(
  headers: string[],
  rows: string[][],
  options: TableOptions = {}
): string {
  const { align = [], indent = 2 } = options;

  // Calculate column widths (max of header and all values)
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || '').length))
  );

  // Format a single row
  const formatRow = (row: string[]) =>
    row
      .map((cell, i) =>
        align[i] === 'right' ? padLeft(cell, widths[i]) : padRight(cell, widths[i])
      )
      .join('  ');

  const prefix = ' '.repeat(indent);

  return [
    prefix + formatRow(headers),
    prefix + widths.map(w => '─'.repeat(w)).join('──'),
    ...rows.map(r => prefix + formatRow(r)),
  ].join('\n');
}

// ============================================================================
// Byte formatting
// ============================================================================

/**
 * Format bytes into human-readable string (KB, MB, GB, TB)
 *
 * @param bytes - Number of bytes to format
 * @param decimals - Number of decimal places (default: 1)
 * @example
 * formatBytes(0) // => '0 B'
 * formatBytes(1024) // => '1.0 KB'
 * formatBytes(1024, 2) // => '1.00 KB'
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(decimals)} ${units[i]}`;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Convert various date representations to Date object
 */
function toDate(date: Date | string | number): Date {
  if (date instanceof Date) {
    return date;
  }
  if (typeof date === 'number') {
    return new Date(date);
  }
  return new Date(date);
}
