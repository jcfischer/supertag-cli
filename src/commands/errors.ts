/**
 * Errors Command
 * Spec: 073-error-context
 * Task: T-4.3
 *
 * View, manage, and export error logs.
 */

import { Command } from "commander";
import {
  readErrorLog,
  clearErrorLog,
  exportErrorLog,
  getErrorLogPath,
} from "../utils/error-logger";
import type { ErrorLogEntry } from "../types/errors";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the errors command
 */
export interface ErrorsCommandOptions {
  /** Show last N errors */
  last?: number;
  /** Clear the error log */
  clear?: boolean;
  /** Export errors as JSON */
  export?: boolean;
  /** Output in JSON format */
  json?: boolean;
}

/**
 * Internal options for testing
 */
interface InternalOptions {
  /** Custom log path for testing */
  logPath?: string;
  /** Custom console for testing */
  console?: Console;
}

// =============================================================================
// Formatters
// =============================================================================

/**
 * Format a single error entry for display
 */
function formatErrorEntry(entry: ErrorLogEntry): string {
  const date = new Date(entry.timestamp);
  const timeStr = date.toLocaleString();

  let output = `[${timeStr}] ${entry.code}`;
  output += `\n  ${entry.message}`;

  if (entry.command) {
    output += `\n  Command: ${entry.command}`;
  }
  if (entry.workspace) {
    output += `\n  Workspace: ${entry.workspace}`;
  }

  return output;
}

// =============================================================================
// Command Implementation
// =============================================================================

/**
 * Execute the errors command
 *
 * @param options - Command options
 * @param internal - Internal options for testing
 */
export async function errorsCommand(
  options: ErrorsCommandOptions,
  internal?: InternalOptions
): Promise<void> {
  const logPath = internal?.logPath ?? getErrorLogPath();
  const output = internal?.console ?? console;

  // Handle --clear
  if (options.clear) {
    clearErrorLog({ logPath });
    output.log("Error log cleared.");
    return;
  }

  // Handle --export
  if (options.export) {
    const entries = exportErrorLog({ logPath });
    output.log(JSON.stringify(entries, null, 2));
    return;
  }

  // Read errors with optional limit
  const entries = readErrorLog({
    logPath,
    last: options.last,
  });

  // Handle --json
  if (options.json) {
    output.log(JSON.stringify(entries, null, 2));
    return;
  }

  // Default: display formatted errors
  if (entries.length === 0) {
    output.log("No errors logged.");
    output.log(`Log path: ${logPath}`);
    return;
  }

  output.log(`Showing ${entries.length} error(s):`);
  output.log("");

  for (const entry of entries) {
    output.log(formatErrorEntry(entry));
    output.log("");
  }

  output.log(`Log path: ${logPath}`);
}

// =============================================================================
// Command Registration
// =============================================================================

/**
 * Create the errors command for CLI registration
 *
 * @returns Commander Command instance
 */
export function createErrorsCommand(): Command {
  const cmd = new Command("errors")
    .description("View and manage error logs")
    .option("-l, --last <n>", "Show last N errors", parseInt)
    .option("-c, --clear", "Clear the error log")
    .option("-e, --export", "Export errors as JSON")
    .option("-j, --json", "Output in JSON format")
    .action(async (options) => {
      await errorsCommand({
        last: options.last,
        clear: options.clear,
        export: options.export,
        json: options.json,
      });
    });

  return cmd;
}
