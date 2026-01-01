/**
 * Error Type Definitions
 * Spec: 073-error-context
 * Task: T-1.1
 *
 * Defines standardized error codes, structured error data, and recovery information
 * for consistent error handling across CLI and MCP.
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * All standardized error codes organized by category
 */
export const ERROR_CODES = [
  // Config errors
  "CONFIG_NOT_FOUND",
  "CONFIG_INVALID",
  "WORKSPACE_NOT_FOUND",
  "API_KEY_MISSING",
  // Input errors
  "INVALID_PARAMETER",
  "MISSING_REQUIRED",
  "INVALID_FORMAT",
  "NODE_NOT_FOUND",
  "TAG_NOT_FOUND",
  // Database errors
  "DATABASE_NOT_FOUND",
  "DATABASE_CORRUPT",
  "DATABASE_LOCKED",
  "SYNC_REQUIRED",
  // Network errors
  "API_ERROR",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_ERROR",
  // Auth errors
  "AUTH_FAILED",
  "PERMISSION_DENIED",
  // Internal errors
  "INTERNAL_ERROR",
  "VALIDATION_ERRORS",
] as const;

/**
 * Error code type derived from the constant array
 */
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Check if a string is a valid error code
 */
export function isValidErrorCode(code: string): code is ErrorCode {
  return ERROR_CODES.includes(code as ErrorCode);
}

// =============================================================================
// Error Categories
// =============================================================================

/**
 * Error categories for grouping and classification
 */
export const ERROR_CATEGORIES = [
  "config",
  "input",
  "database",
  "network",
  "auth",
  "internal",
] as const;

/**
 * Error category type
 */
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

// =============================================================================
// Recovery Information
// =============================================================================

/**
 * Recovery hints for AI agents and programmatic error handling
 */
export interface RecoveryInfo {
  /** Whether the operation can be retried */
  retryable: boolean;
  /** Seconds to wait before retrying (for rate limits, etc.) */
  retryAfter?: number;
  /** Retry strategy: immediate or exponential backoff */
  retryStrategy?: "immediate" | "exponential";
  /** Maximum number of retries */
  maxRetries?: number;
  /** Alternative action to try instead */
  alternativeAction?: string;
  /** Parameters for the alternative action */
  alternativeParams?: Record<string, unknown>;
  /** Suggested parameters for retry */
  retryWith?: Record<string, unknown>;
}

// =============================================================================
// Validation Errors
// =============================================================================

/**
 * Individual validation error for a specific field
 */
export interface ValidationErrorItem {
  /** Field path (e.g., "name", "fields.Due") */
  field: string;
  /** Error code for this field */
  code: string;
  /** Human-readable error message */
  message: string;
  /** The invalid value that was provided */
  value?: unknown;
  /** Description of expected format/type */
  expected?: string;
  /** Suggestion for fixing the error */
  suggestion?: string;
}

// =============================================================================
// Structured Error Data
// =============================================================================

/**
 * Complete structured error data for consistent error responses
 */
export interface StructuredErrorData {
  /** Error code for programmatic handling */
  code: ErrorCode;
  /** Human-readable error message */
  message: string;
  /** Additional context details */
  details?: Record<string, unknown>;
  /** Actionable suggestion for fixing the error */
  suggestion?: string;
  /** Example of correct usage */
  example?: string;
  /** URL to relevant documentation */
  docUrl?: string;
  /** Recovery hints for AI agents */
  recovery?: RecoveryInfo;
  /** Field-level validation errors (for VALIDATION_ERRORS code) */
  validationErrors?: ValidationErrorItem[];
}

// =============================================================================
// Error Log Entry
// =============================================================================

/**
 * Error log entry for persistent logging
 */
export interface ErrorLogEntry {
  /** ISO timestamp of when the error occurred */
  timestamp: string;
  /** Error code */
  code: ErrorCode;
  /** Error message */
  message: string;
  /** Command that triggered the error */
  command?: string;
  /** Workspace context */
  workspace?: string;
  /** Additional details */
  details?: Record<string, unknown>;
  /** Stack trace (only in debug mode) */
  stack?: string;
}
