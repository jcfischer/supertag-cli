/**
 * Error Formatter
 * Spec: 073-error-context
 * Task: T-2.3, T-2.4
 *
 * Formats errors for CLI (human-readable) and MCP (JSON) output.
 */

import { StructuredError } from "./structured-errors";
import type { StructuredErrorData } from "../types/errors";

// =============================================================================
// CLI Formatting
// =============================================================================

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/**
 * Options for CLI error formatting
 */
export interface CliFormatOptions {
  /** Enable debug mode for verbose output (default: false) */
  debug?: boolean;
  /** Enable color output (default: true) */
  color?: boolean;
}

/**
 * Format a structured error for CLI output (human-readable)
 *
 * @param error - The structured error to format
 * @param options - Formatting options
 * @returns Formatted string for terminal output
 */
export function formatErrorForCli(
  error: StructuredError,
  options?: CliFormatOptions
): string {
  const debug = options?.debug ?? false;
  const useColor = options?.color ?? true;

  // Color helpers
  const c = (code: string, text: string) => (useColor ? `${code}${text}${colors.reset}` : text);
  const red = (text: string) => c(colors.red, text);
  const yellow = (text: string) => c(colors.yellow, text);
  const cyan = (text: string) => c(colors.cyan, text);
  const gray = (text: string) => c(colors.gray, text);
  const bold = (text: string) => c(colors.bold, text);
  const dim = (text: string) => c(colors.dim, text);

  const lines: string[] = [];

  // Header with error code
  lines.push(`${red("Error")} ${gray(`[${error.code}]`)}`);
  lines.push(bold(error.message));

  // Validation errors (if present)
  if (error.validationErrors && error.validationErrors.length > 0) {
    lines.push("");
    lines.push(yellow("Validation Errors:"));
    for (const ve of error.validationErrors) {
      lines.push(`  ${dim("•")} ${cyan(ve.field)}: ${ve.message}`);
      if (ve.expected) {
        lines.push(`    ${dim("Expected:")} ${ve.expected}`);
      }
      if (ve.suggestion) {
        lines.push(`    ${dim("Hint:")} ${ve.suggestion}`);
      }
    }
  }

  // Suggestion
  if (error.suggestion) {
    lines.push("");
    lines.push(`${yellow("Suggestion:")} ${error.suggestion}`);
  }

  // Example
  if (error.example) {
    lines.push("");
    lines.push(`${yellow("Example:")} ${error.example}`);
  }

  // Recovery info
  if (error.recovery?.retryable) {
    lines.push("");
    let retryInfo = `${cyan("Retryable:")} Yes`;
    if (error.recovery.retryAfter) {
      retryInfo += ` (after ${error.recovery.retryAfter}s)`;
    }
    if (error.recovery.retryStrategy) {
      retryInfo += ` [${error.recovery.retryStrategy}]`;
    }
    lines.push(retryInfo);
  }

  // Documentation link
  if (error.docUrl) {
    lines.push("");
    lines.push(`${dim("Docs:")} ${error.docUrl}`);
  }

  // Debug mode: show details and stack
  if (debug) {
    if (error.details && Object.keys(error.details).length > 0) {
      lines.push("");
      lines.push(gray("Details:"));
      lines.push(gray(JSON.stringify(error.details, null, 2)));
    }

    if (error.stack) {
      lines.push("");
      lines.push(gray("Stack:"));
      lines.push(gray(error.stack));
    }

    if (error.cause) {
      lines.push("");
      lines.push(gray("Cause:"));
      lines.push(gray(error.cause.message));
    }
  }

  return lines.join("\n");
}

// =============================================================================
// MCP Formatting
// =============================================================================

/**
 * MCP error response format
 */
export interface McpErrorResponse {
  error: StructuredErrorData;
}

/**
 * Format a structured error for MCP response (JSON)
 *
 * @param error - The structured error to format
 * @returns Object suitable for JSON serialization
 */
export function formatErrorForMcp(error: StructuredError): McpErrorResponse {
  const data = error.toStructuredData();

  // Remove undefined fields for cleaner JSON
  const cleaned: StructuredErrorData = {
    code: data.code,
    message: data.message,
  };

  if (data.details !== undefined) {
    cleaned.details = data.details;
  }
  if (data.suggestion !== undefined) {
    cleaned.suggestion = data.suggestion;
  }
  if (data.example !== undefined) {
    cleaned.example = data.example;
  }
  if (data.docUrl !== undefined) {
    cleaned.docUrl = data.docUrl;
  }
  if (data.recovery !== undefined) {
    cleaned.recovery = data.recovery;
  }
  if (data.validationErrors !== undefined) {
    cleaned.validationErrors = data.validationErrors;
  }

  return { error: cleaned };
}
