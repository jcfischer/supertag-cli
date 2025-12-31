/**
 * Output Formatter - Strategy Pattern Implementation (Spec 054)
 *
 * Centralizes output formatting logic for CLI commands.
 * Three modes: unix (TSV), pretty (human-readable), json (structured)
 *
 * @example
 * const formatter = createFormatter({ mode: 'pretty' });
 * formatter.header('Search Results', 'search');
 * formatter.table(['ID', 'Name'], [['abc', 'Node 1']]);
 * formatter.tip('Use --show for details');
 * formatter.finalize();
 */

import { EMOJI } from "./format";

// ============================================================================
// Types and Interfaces (T-1.1)
// ============================================================================

/**
 * Output mode enum - matches existing CLI flag patterns
 */
export type OutputMode = "unix" | "pretty" | "json";

/**
 * Options for creating a formatter
 */
export interface FormatterOptions {
  /** Output mode: unix (TSV), pretty (human-readable), json (structured) */
  mode: OutputMode;
  /** Use human-readable date format instead of ISO */
  humanDates?: boolean;
  /** Include technical details (IDs, timing, etc.) */
  verbose?: boolean;
  /** Output stream (defaults to process.stdout) */
  stream?: NodeJS.WriteStream;
}

/**
 * Output formatting strategy interface
 *
 * All formatter implementations must implement these methods.
 * Methods that don't apply to a mode (e.g., header in unix mode)
 * should be implemented as no-ops.
 */
export interface OutputFormatter {
  /**
   * Format and output a single value
   * - Unix: outputs value as string with newline
   * - Pretty: outputs value as string with newline
   * - JSON: buffers value for array output
   */
  value(value: unknown): void;

  /**
   * Output a header/title with optional emoji
   * - Unix: no-op (skip headers)
   * - Pretty: outputs emoji + title
   * - JSON: no-op
   *
   * @param text - Header text
   * @param emoji - Optional emoji key from EMOJI constant
   */
  header(text: string, emoji?: keyof typeof EMOJI): void;

  /**
   * Output tabular data
   * - Unix: outputs TSV rows (no headers)
   * - Pretty: outputs formatted table with headers and separators
   * - JSON: buffers rows as objects using headers as keys
   *
   * @param headers - Column headers
   * @param rows - Table rows (array of arrays)
   */
  table(headers: string[], rows: (string | number | undefined)[][]): void;

  /**
   * Output a key-value record
   * - Unix: outputs YAML-like "key: value" lines
   * - Pretty: outputs aligned key-value pairs
   * - JSON: buffers record object
   *
   * @param fields - Key-value pairs
   */
  record(fields: Record<string, unknown>): void;

  /**
   * Output a list of items
   * - Unix: outputs one item per line
   * - Pretty: outputs bulleted list
   * - JSON: buffers items
   *
   * @param items - List items
   * @param bullet - Optional bullet character (default: '•')
   */
  list(items: string[], bullet?: string): void;

  /**
   * Output a separator/divider
   * - Unix: no-op
   * - Pretty: outputs horizontal line
   * - JSON: no-op
   */
  divider(): void;

  /**
   * Output a tip/hint message
   * - Unix: no-op
   * - Pretty: outputs tip with emoji
   * - JSON: no-op
   */
  tip(message: string): void;

  /**
   * Output an error message
   * - All modes: writes to stderr
   *
   * @param message - Error message
   */
  error(message: string): void;

  /**
   * Finalize output
   * - Unix: no-op
   * - Pretty: no-op
   * - JSON: outputs buffered data as JSON array/object
   *
   * Must be called at end of output to ensure all data is written.
   */
  finalize(): void;
}

// ============================================================================
// UnixFormatter Implementation (T-1.2)
// ============================================================================

/**
 * Unix-style formatter: TSV output, pipe-friendly, no decoration
 *
 * Output characteristics:
 * - Tab-separated values for tables
 * - YAML-like records with "---" separator
 * - One item per line for lists
 * - No headers, tips, or dividers
 *
 * @example
 * const formatter = new UnixFormatter({ mode: 'unix' });
 * formatter.table(['ID', 'Name'], [['abc', 'Node 1']]);
 * // Output: "abc\tNode 1\n"
 */
export class UnixFormatter implements OutputFormatter {
  private out: NodeJS.WriteStream;

  constructor(options: FormatterOptions) {
    this.out = options.stream ?? process.stdout;
  }

  value(value: unknown): void {
    this.out.write(String(value) + "\n");
  }

  header(_text: string, _emoji?: keyof typeof EMOJI): void {
    // No headers in unix mode
  }

  table(_headers: string[], rows: (string | number | undefined)[][]): void {
    for (const row of rows) {
      this.out.write(row.map((v) => v ?? "").join("\t") + "\n");
    }
  }

  record(fields: Record<string, unknown>): void {
    this.out.write("---\n");
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) {
        this.out.write(`${key}: ${value}\n`);
      }
    }
  }

  list(items: string[], _bullet?: string): void {
    for (const item of items) {
      this.out.write(item + "\n");
    }
  }

  divider(): void {
    // No dividers in unix mode
  }

  tip(_message: string): void {
    // No tips in unix mode
  }

  error(message: string): void {
    process.stderr.write(message + "\n");
  }

  finalize(): void {
    // Nothing to finalize
  }
}

// ============================================================================
// PrettyFormatter Implementation (T-1.3)
// ============================================================================

/**
 * Pretty-style formatter: Human-readable output with emojis and formatting
 *
 * Output characteristics:
 * - Formatted tables with headers and alignment
 * - Emoji-prefixed headers
 * - Tips with emoji
 * - Bulleted lists
 * - Horizontal dividers
 *
 * @example
 * const formatter = new PrettyFormatter({ mode: 'pretty' });
 * formatter.header('Search Results', 'search');
 * // Output: "\n🔍 Search Results\n"
 */
export class PrettyFormatter implements OutputFormatter {
  private out: NodeJS.WriteStream;

  constructor(options: FormatterOptions) {
    this.out = options.stream ?? process.stdout;
  }

  value(value: unknown): void {
    this.out.write(String(value) + "\n");
  }

  header(text: string, emoji?: keyof typeof EMOJI): void {
    if (emoji && EMOJI[emoji]) {
      this.out.write(`\n${EMOJI[emoji]} ${text}\n`);
    } else {
      this.out.write(`\n${text}\n`);
    }
  }

  table(headers: string[], rows: (string | number | undefined)[][]): void {
    if (rows.length === 0) {
      return; // Don't output anything for empty tables
    }

    // Convert rows to string arrays
    const stringRows = rows.map((row) =>
      row.map((v) => (v === undefined || v === null ? "" : String(v)))
    );

    // Calculate column widths (max of header and all values)
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...stringRows.map((r) => (r[i] || "").length))
    );

    // Format a single row with padding
    const formatRow = (row: string[]) =>
      row.map((cell, i) => cell.padEnd(widths[i])).join("  ");

    const indent = "  ";

    // Output header row
    this.out.write(indent + formatRow(headers) + "\n");
    // Output separator
    this.out.write(indent + widths.map((w) => "─".repeat(w)).join("──") + "\n");
    // Output data rows
    for (const row of stringRows) {
      this.out.write(indent + formatRow(row) + "\n");
    }
  }

  record(fields: Record<string, unknown>): void {
    const entries = Object.entries(fields).filter(
      ([, value]) => value !== undefined && value !== null
    );

    if (entries.length === 0) {
      return; // Don't output anything for empty records
    }

    // Calculate max key length for alignment
    const maxKeyLength = Math.max(...entries.map(([key]) => key.length));

    for (const [key, value] of entries) {
      this.out.write(`  ${key.padEnd(maxKeyLength)}: ${value}\n`);
    }
  }

  list(items: string[], bullet = "•"): void {
    for (const item of items) {
      this.out.write(`  ${bullet} ${item}\n`);
    }
  }

  divider(): void {
    this.out.write("─".repeat(60) + "\n");
  }

  tip(message: string): void {
    this.out.write(`\n${EMOJI.tip} Tip: ${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`${EMOJI.error} ${message}\n`);
  }

  finalize(): void {
    // Nothing to finalize in pretty mode
  }
}
