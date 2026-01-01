/**
 * Shared Command Helpers for CLI Harmonization
 *
 * Provides common utilities used across all harmonized commands:
 * - resolveDbPath: Resolve database path from options
 * - checkDb: Verify database exists
 * - addStandardOptions: Add standard flags to commands
 * - formatJsonOutput: Format data as JSON
 * - formatTableOutput: Format data as human-readable table
 */

import { Command } from "commander";
import { existsSync } from "fs";
import { getDatabasePath } from "../config/paths";
import {
  resolveWorkspaceContext,
  WorkspaceNotFoundError,
  WorkspaceDatabaseMissingError,
} from "../config/workspace-resolver";
import type { StandardOptions } from "../types";

// Default database path - uses XDG with legacy fallback
const DEFAULT_DB_PATH = getDatabasePath();

/**
 * Resolve the database path from options
 * Priority: --db-path > --workspace > default workspace > legacy
 *
 * Uses the unified workspace resolver (spec 052) internally.
 */
export function resolveDbPath(options: { dbPath?: string; workspace?: string }): string {
  // Explicit db-path takes precedence
  if (options.dbPath && options.dbPath !== DEFAULT_DB_PATH) {
    return options.dbPath;
  }

  // Use unified workspace resolver (requireDatabase: false to maintain backward compatibility)
  const ws = resolveWorkspaceContext({
    workspace: options.workspace,
    requireDatabase: false,
  });
  return ws.dbPath;
}

/**
 * Check if database exists, print error message if not
 * Returns true if database exists, false otherwise
 *
 * Note: Consider using resolveWorkspaceContext({ requireDatabase: true }) instead,
 * which throws WorkspaceDatabaseMissingError with a helpful message.
 */
export function checkDb(dbPath: string, workspaceAlias?: string): boolean {
  if (!existsSync(dbPath)) {
    console.error(`❌ Database not found: ${dbPath}`);
    if (workspaceAlias) {
      console.error(`   Run 'supertag sync index --workspace ${workspaceAlias}' first`);
    } else {
      console.error(`   Run 'supertag sync index' first`);
    }
    return false;
  }
  return true;
}

/**
 * Options for addStandardOptions helper
 */
export interface AddStandardOptionsConfig {
  /** Include --show/-s flag (default: false) */
  includeShow?: boolean;
  /** Include --depth/-d flag (default: false) */
  includeDepth?: boolean;
  /** Include --db-path flag (default: true) */
  includeDbPath?: boolean;
  /** Default limit value (default: "10") */
  defaultLimit?: string;
}

/**
 * Add standard options to a Commander command
 * Ensures consistent flags across all harmonized commands
 */
export function addStandardOptions(
  cmd: Command,
  config: AddStandardOptionsConfig = {}
): Command {
  const {
    includeShow = false,
    includeDepth = false,
    includeDbPath = true,
    defaultLimit = "10",
  } = config;

  // Always add workspace and json options
  cmd.option("-w, --workspace <alias>", "Workspace alias or nodeid");
  cmd.option("-l, --limit <n>", "Limit results", defaultLimit);
  cmd.option("--json", "Output as JSON", false);

  // Output formatting options (T-2.1)
  cmd.option("--pretty", "Human-friendly output with formatting");
  cmd.option("--no-pretty", "Force Unix output (overrides config)");
  cmd.option("--human-dates", "Human-readable date format");
  cmd.option("--verbose", "Include technical details");

  // Optional db-path (usually included for backward compatibility)
  if (includeDbPath) {
    cmd.option("--db-path <path>", "Database path (overrides workspace)");
  }

  // Optional show flag
  if (includeShow) {
    cmd.option("-s, --show", "Show full node contents (fields, children, tags)");
  }

  // Optional depth flag
  if (includeDepth) {
    cmd.option("-d, --depth <n>", "Child traversal depth", "0");
  }

  return cmd;
}

/**
 * Format data as pretty JSON
 */
export function formatJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Format array of objects as human-readable table rows
 */
export function formatTableOutput(
  data: Array<Record<string, unknown>>,
  columns: string[]
): string {
  if (data.length === 0) {
    return "No results found";
  }

  const lines: string[] = [];

  for (const row of data) {
    const parts: string[] = [];
    for (const col of columns) {
      const value = row[col];
      if (value !== undefined && value !== null) {
        parts.push(String(value));
      }
    }
    lines.push(parts.join(" | "));
  }

  return lines.join("\n");
}

/**
 * Parse a date string into UNIX timestamp (milliseconds)
 * Supports: YYYY-MM-DD, YYYY-MM-DD HH:MM, ISO 8601
 */
export function parseDate(dateStr: string): number {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD or ISO 8601`);
  }
  return date.getTime();
}

/**
 * Parse date range options from CLI into timestamps
 */
export function parseDateRangeOptions(options: {
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
}): {
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
} {
  const result: {
    createdAfter?: number;
    createdBefore?: number;
    updatedAfter?: number;
    updatedBefore?: number;
  } = {};

  if (options.createdAfter) {
    result.createdAfter = parseDate(options.createdAfter);
  }
  if (options.createdBefore) {
    result.createdBefore = parseDate(options.createdBefore);
  }
  if (options.updatedAfter) {
    result.updatedAfter = parseDate(options.updatedAfter);
  }
  if (options.updatedBefore) {
    result.updatedBefore = parseDate(options.updatedBefore);
  }

  return result;
}

/**
 * Parse --select CLI option into string array for projection
 * Spec: 059-universal-select-parameter
 *
 * @param select - Comma-separated field names from CLI
 * @returns Array of field names, or undefined if not specified
 *
 * @example
 * parseSelectOption("id,name,fields.Status")
 * // => ["id", "name", "fields.Status"]
 */
export function parseSelectOption(select: string | undefined): string[] | undefined {
  if (!select) {
    return undefined;
  }

  return select
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
