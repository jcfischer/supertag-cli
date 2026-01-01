/**
 * Error Logger
 * Spec: 073-error-context
 * Task: T-4.1, T-4.2
 *
 * Persistent error logging with privacy filtering and log rotation.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { StructuredError } from "./structured-errors";
import type { ErrorLogEntry, ErrorCode } from "../types/errors";

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of log entries before rotation */
const MAX_LOG_ENTRIES = 1000;

/** Sensitive field patterns to redact */
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /password/i,
  /pass/i,
  /pwd/i,
  /secret/i,
  /credential/i,
  /auth/i,
  /bearer/i,
];

/** Placeholder for redacted values */
const REDACTED = "[REDACTED]";

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the default error log path
 */
export function getErrorLogPath(): string {
  const cacheDir = join(homedir(), ".cache", "supertag");
  return join(cacheDir, "errors.log");
}

// =============================================================================
// Privacy Filtering
// =============================================================================

/**
 * Check if a field name is sensitive
 */
function isSensitiveField(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively sanitize an object, redacting sensitive values
 *
 * @param obj - The object to sanitize
 * @returns A new object with sensitive values redacted
 */
export function sanitizeForLogging(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj === null || obj === undefined) {
    return obj;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value;
    } else if (isSensitiveField(key)) {
      result[key] = REDACTED;
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? sanitizeForLogging(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object") {
      result[key] = sanitizeForLogging(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// =============================================================================
// Log Operations
// =============================================================================

/**
 * Options for logging an error
 */
export interface LogErrorOptions {
  /** Custom log path (default: ~/.cache/supertag/errors.log) */
  logPath?: string;
  /** Additional context */
  context?: {
    command?: string;
    workspace?: string;
  };
  /** Include error details (default: false for privacy) */
  includeDetails?: boolean;
  /** Include stack trace (default: false) */
  includeStack?: boolean;
}

/**
 * Log an error to the persistent log file
 *
 * @param error - The structured error to log
 * @param options - Logging options
 */
export function logError(error: StructuredError, options?: LogErrorOptions): void {
  const logPath = options?.logPath ?? getErrorLogPath();
  const includeDetails = options?.includeDetails ?? false;
  const includeStack = options?.includeStack ?? false;

  // Ensure directory exists
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Build log entry
  const entry: ErrorLogEntry = {
    timestamp: new Date().toISOString(),
    code: error.code,
    message: error.message,
  };

  // Add context if provided
  if (options?.context?.command) {
    entry.command = options.context.command;
  }
  if (options?.context?.workspace) {
    entry.workspace = options.context.workspace;
  }

  // Add sanitized details if requested
  if (includeDetails && error.details) {
    entry.details = sanitizeForLogging(error.details);
  }

  // Add stack if requested
  if (includeStack && error.stack) {
    entry.stack = error.stack;
  }

  // Append to log file (JSONL format)
  appendFileSync(logPath, JSON.stringify(entry) + "\n");

  // Check for log rotation
  rotateLogIfNeeded(logPath);
}

/**
 * Rotate log file if it exceeds the maximum entries
 */
function rotateLogIfNeeded(logPath: string): void {
  if (!existsSync(logPath)) {
    return;
  }

  try {
    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    if (lines.length > MAX_LOG_ENTRIES) {
      // Keep only the last MAX_LOG_ENTRIES entries
      const trimmedLines = lines.slice(-MAX_LOG_ENTRIES);
      const fs = require("fs");
      fs.writeFileSync(logPath, trimmedLines.join("\n") + "\n");
    }
  } catch {
    // Ignore rotation errors
  }
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Options for reading the error log
 */
export interface ReadErrorLogOptions {
  /** Custom log path */
  logPath?: string;
  /** Return only the last N entries */
  last?: number;
  /** Return entries since this date */
  since?: Date;
}

/**
 * Read error log entries
 *
 * @param options - Read options
 * @returns Array of error log entries
 */
export function readErrorLog(options?: ReadErrorLogOptions): ErrorLogEntry[] {
  const logPath = options?.logPath ?? getErrorLogPath();

  if (!existsSync(logPath)) {
    return [];
  }

  try {
    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    let entries: ErrorLogEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ErrorLogEntry;
        entries.push(entry);
      } catch {
        // Skip invalid JSON lines
      }
    }

    // Filter by date if specified
    if (options?.since) {
      const sinceTime = options.since.getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceTime);
    }

    // Limit to last N if specified
    if (options?.last !== undefined && options.last > 0) {
      entries = entries.slice(-options.last);
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Options for clearing the error log
 */
export interface ClearErrorLogOptions {
  /** Custom log path */
  logPath?: string;
}

/**
 * Clear the error log file
 *
 * @param options - Clear options
 */
export function clearErrorLog(options?: ClearErrorLogOptions): void {
  const logPath = options?.logPath ?? getErrorLogPath();

  if (existsSync(logPath)) {
    unlinkSync(logPath);
  }
}

/**
 * Options for exporting the error log
 */
export interface ExportErrorLogOptions {
  /** Custom log path */
  logPath?: string;
}

/**
 * Export the error log as an array
 *
 * @param options - Export options
 * @returns Array of all error log entries
 */
export function exportErrorLog(options?: ExportErrorLogOptions): ErrorLogEntry[] {
  return readErrorLog({ logPath: options?.logPath });
}
