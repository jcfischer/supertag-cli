/**
 * Debug Mode Utilities
 * Spec: 073-error-context
 * Task: T-5.4
 *
 * Provides debug mode functionality for enhanced error output.
 * When debug mode is enabled, errors include stack traces and full details.
 */

import { formatErrorForCli } from "./error-formatter";
import type { StructuredError } from "./structured-errors";

// =============================================================================
// State
// =============================================================================

/** Debug mode flag - can be set programmatically or via environment */
let debugModeEnabled = false;

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Check if debug mode is currently enabled
 *
 * Debug mode can be enabled by:
 * 1. Calling setDebugMode(true)
 * 2. Setting DEBUG=1 environment variable
 * 3. Using --debug flag in CLI commands
 *
 * @returns true if debug mode is enabled
 */
export function isDebugMode(): boolean {
  // Check environment variable as fallback
  if (process.env.DEBUG === "1" || process.env.DEBUG === "true") {
    return true;
  }
  return debugModeEnabled;
}

/**
 * Enable or disable debug mode programmatically
 *
 * @param enabled - Whether to enable debug mode
 */
export function setDebugMode(enabled: boolean): void {
  debugModeEnabled = enabled;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for StructuredError (avoids circular import)
 */
function isStructuredError(error: unknown): error is StructuredError {
  return (
    error instanceof Error &&
    "code" in error &&
    "toStructuredData" in error &&
    typeof (error as StructuredError).toStructuredData === "function"
  );
}

// =============================================================================
// Formatting Functions
// =============================================================================

/**
 * Format an error for debug output
 *
 * In debug mode, includes:
 * - Full error code and message
 * - Stack trace
 * - Complete error details
 *
 * In non-debug mode, uses standard CLI formatting.
 *
 * @param error - The error to format
 * @returns Formatted error string
 */
export function formatDebugError(error: unknown): string {
  if (!isDebugMode()) {
    // Use standard formatting in non-debug mode
    if (isStructuredError(error)) {
      return formatErrorForCli(error);
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  // Debug mode - include full details
  if (isStructuredError(error)) {
    return formatStructuredErrorDebug(error);
  }

  if (error instanceof Error) {
    return formatGenericErrorDebug(error);
  }

  // Non-error value
  return `Debug: ${String(error)}`;
}

/**
 * Format a StructuredError with debug information
 */
function formatStructuredErrorDebug(error: StructuredError): string {
  const lines: string[] = [];

  // Header with code
  lines.push(`[${error.code}] ${error.message}`);
  lines.push("");

  // Details section
  const data = error.toStructuredData();
  if (data.details && Object.keys(data.details).length > 0) {
    lines.push("Details:");
    for (const [key, value] of Object.entries(data.details)) {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
    lines.push("");
  }

  // Suggestion if present
  if (data.suggestion) {
    lines.push(`Suggestion: ${data.suggestion}`);
    lines.push("");
  }

  // Stack trace
  if (error.stack) {
    lines.push("Stack Trace:");
    // Remove the first line (error message) from stack
    const stackLines = error.stack.split("\n").slice(1);
    lines.push(...stackLines);
  }

  return lines.join("\n");
}

/**
 * Format a generic Error with debug information
 */
function formatGenericErrorDebug(error: Error): string {
  const lines: string[] = [];

  lines.push(`Error: ${error.message}`);
  lines.push("");

  if (error.stack) {
    lines.push("Stack Trace:");
    const stackLines = error.stack.split("\n").slice(1);
    lines.push(...stackLines);
  }

  return lines.join("\n");
}
