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
import { getOutputConfig } from "./output-options";

// ============================================================================
// Types and Interfaces (T-1.1)
// ============================================================================

/**
 * Output mode enum - matches existing CLI flag patterns (legacy)
 * @deprecated Use OutputFormat instead for new code
 */
export type OutputMode = "unix" | "pretty" | "json";

/**
 * Output format types (Spec 060)
 *
 * Extended format options for universal output formatting:
 * - json: Pretty-printed JSON array (default for pipes)
 * - table: ASCII table with headers (default for TTY, was "pretty")
 * - csv: RFC 4180 compliant CSV
 * - ids: One ID per line, no decoration (for xargs)
 * - minimal: JSON with only id, name, tags fields
 * - jsonl: JSON Lines (one object per line, stream-friendly)
 */
export type OutputFormat = "json" | "table" | "csv" | "ids" | "minimal" | "jsonl";

/**
 * Format metadata for help text and validation
 */
export interface FormatInfo {
  format: OutputFormat;
  description: string;
  example: string;
}

/**
 * Metadata for all supported output formats
 */
export const OUTPUT_FORMATS: FormatInfo[] = [
  {
    format: "json",
    description: "Pretty-printed JSON array",
    example: '--format json (default when piping)',
  },
  {
    format: "table",
    description: "ASCII table with headers",
    example: '--format table (default in terminal)',
  },
  {
    format: "csv",
    description: "RFC 4180 compliant CSV",
    example: '--format csv > export.csv',
  },
  {
    format: "ids",
    description: "One ID per line, no decoration",
    example: '--format ids | xargs supertag nodes show',
  },
  {
    format: "minimal",
    description: "JSON with only id, name, tags",
    example: '--format minimal | jq .name',
  },
  {
    format: "jsonl",
    description: "JSON Lines (one object per line)",
    example: '--format jsonl | jq -c .',
  },
];

/**
 * Options for creating a formatter
 */
export interface FormatterOptions {
  /** Output mode: unix (TSV), pretty (human-readable), json (structured) - legacy */
  mode?: OutputMode;
  /** Output format (Spec 060) - preferred over mode */
  format?: OutputFormat;
  /** Suppress header row (table/csv) */
  noHeader?: boolean;
  /** Max column width for table */
  maxWidth?: number;
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

// ============================================================================
// JsonFormatter Implementation (T-1.4)
// ============================================================================

/**
 * JSON-style formatter: Structured output for programmatic consumption
 *
 * Output characteristics:
 * - Buffers all data until finalize() is called
 * - Outputs JSON array for multiple items, single object for one item
 * - Tables converted to array of objects using headers as keys
 * - Headers, tips, dividers are ignored (no-op)
 *
 * @example
 * const formatter = new JsonFormatter({ mode: 'json' });
 * formatter.table(['ID', 'Name'], [['abc', 'Node 1']]);
 * formatter.finalize();
 * // Output: [{"ID":"abc","Name":"Node 1"}]
 */
export class JsonFormatter implements OutputFormatter {
  private out: NodeJS.WriteStream;
  private buffer: unknown[] = [];
  private finalized = false;
  private outputType: "value" | "array" | "none" = "none";

  constructor(options: FormatterOptions) {
    this.out = options.stream ?? process.stdout;
  }

  value(value: unknown): void {
    this.buffer.push(value);
    // value() uses special single-item logic
    if (this.outputType === "none") {
      this.outputType = "value";
    }
  }

  header(_text: string, _emoji?: keyof typeof EMOJI): void {
    // No headers in json mode
  }

  table(headers: string[], rows: (string | number | undefined)[][]): void {
    // table() always outputs array
    this.outputType = "array";
    // Convert rows to objects using headers as keys
    for (const row of rows) {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, i) => {
        obj[header] = row[i] === undefined ? null : row[i];
      });
      this.buffer.push(obj);
    }
  }

  record(fields: Record<string, unknown>): void {
    // Convert undefined values to null for JSON compatibility
    const cleanedFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      cleanedFields[key] = value === undefined ? null : value;
    }
    this.buffer.push(cleanedFields);
    // Multiple records = array output
    if (this.outputType === "none") {
      this.outputType = "value";
    }
  }

  list(items: string[], _bullet?: string): void {
    // list() always outputs array
    this.outputType = "array";
    // Add items to buffer
    for (const item of items) {
      this.buffer.push(item);
    }
  }

  divider(): void {
    // No dividers in json mode
  }

  tip(_message: string): void {
    // No tips in json mode
  }

  error(message: string): void {
    process.stderr.write(JSON.stringify({ error: message }) + "\n");
  }

  finalize(): void {
    if (this.finalized) {
      return; // Only output once
    }
    this.finalized = true;

    // Output based on buffer contents and type
    if (this.buffer.length === 0) {
      this.out.write("[]\n");
    } else if (this.outputType === "array") {
      // table() and list() always output arrays
      this.out.write(JSON.stringify(this.buffer) + "\n");
    } else if (this.buffer.length === 1) {
      // Single value() or record() outputs single item
      this.out.write(JSON.stringify(this.buffer[0]) + "\n");
    } else {
      // Multiple items = array
      this.out.write(JSON.stringify(this.buffer) + "\n");
    }
  }
}

// ============================================================================
// Factory Function (T-1.5)
// ============================================================================

/**
 * Create an output formatter based on options
 *
 * Factory function that returns the appropriate formatter instance
 * based on the specified output mode.
 *
 * @param options - Formatter options including mode
 * @returns OutputFormatter instance
 *
 * @example
 * const formatter = createFormatter({ mode: 'pretty' });
 * formatter.header('Results', 'search');
 * formatter.table(['ID', 'Name'], [['abc', 'Node 1']]);
 * formatter.finalize();
 */
export function createFormatter(options: FormatterOptions): OutputFormatter {
  switch (options.mode) {
    case "unix":
      return new UnixFormatter(options);
    case "pretty":
      return new PrettyFormatter(options);
    case "json":
      return new JsonFormatter(options);
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = options.mode;
      throw new Error(`Unknown output mode: ${_exhaustive}`);
    }
  }
}

// ============================================================================
// Mode Resolution Helper (T-1.6)
// ============================================================================

/**
 * CLI options that affect output mode
 */
export interface OutputModeOptions {
  /** JSON output mode (--json flag) */
  json?: boolean;
  /** Pretty output mode (--pretty flag) */
  pretty?: boolean;
}

/**
 * Resolve output mode from CLI options and config
 *
 * Precedence: --json > --pretty > config > unix default
 *
 * @param options - CLI options (may include json and pretty flags)
 * @returns Resolved output mode
 *
 * @example
 * resolveOutputMode({ json: true }) // => 'json'
 * resolveOutputMode({ pretty: true }) // => 'pretty'
 * resolveOutputMode({}) // => 'unix' (or 'pretty' if config.pretty is true)
 */
export function resolveOutputMode(options?: OutputModeOptions): OutputMode {
  // Handle undefined/null options
  if (!options) {
    options = {};
  }

  // CLI flags have highest priority
  if (options.json === true) {
    return "json";
  }

  if (options.pretty === true) {
    return "pretty";
  }

  // Explicit --no-pretty (pretty: false) overrides config
  if (options.pretty === false) {
    return "unix";
  }

  // Check config for default pretty mode
  const config = getOutputConfig();
  if (config.pretty === true) {
    return "pretty";
  }

  // Default to unix mode
  return "unix";
}
