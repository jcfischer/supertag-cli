/**
 * Error Registry with Metadata
 * Spec: 073-error-context
 * Task: T-1.2
 *
 * Maps error codes to metadata including category, suggestions, documentation paths,
 * and retryable flags for consistent error handling across CLI and MCP.
 */

import { type ErrorCode, ERROR_CODES } from "../types/errors";

// =============================================================================
// Error Metadata Types
// =============================================================================

/**
 * Error category for grouping and classification
 */
export type ErrorCategory = "config" | "input" | "database" | "network" | "auth" | "internal";

/**
 * Metadata for each error code
 */
export interface ErrorMeta {
  /** Error category for grouping */
  category: ErrorCategory;
  /** Default suggestion for fixing this error */
  defaultSuggestion?: string;
  /** Path to documentation (relative to base URL) */
  docPath?: string;
  /** Whether the operation can be retried */
  retryable: boolean;
}

// =============================================================================
// Error Registry
// =============================================================================

/**
 * Registry mapping all error codes to their metadata
 */
export const ERROR_REGISTRY: Record<ErrorCode, ErrorMeta> = {
  // Config errors
  CONFIG_NOT_FOUND: {
    category: "config",
    defaultSuggestion: 'Run "supertag config" to create configuration.',
    docPath: "/docs/configuration",
    retryable: false,
  },
  CONFIG_INVALID: {
    category: "config",
    defaultSuggestion: "Check the configuration file syntax and required fields.",
    docPath: "/docs/configuration",
    retryable: false,
  },
  WORKSPACE_NOT_FOUND: {
    category: "config",
    defaultSuggestion: 'Use one of the available workspaces, or create a new one with: supertag workspace add <name>',
    docPath: "/docs/workspaces",
    retryable: false,
  },
  API_KEY_MISSING: {
    category: "config",
    defaultSuggestion: 'Set API key via "supertag config set apiKey <key>".',
    docPath: "/docs/configuration",
    retryable: false,
  },

  // Input errors
  INVALID_PARAMETER: {
    category: "input",
    defaultSuggestion: "Check the parameter value and type.",
    retryable: false,
  },
  MISSING_REQUIRED: {
    category: "input",
    defaultSuggestion: "Provide the required parameter.",
    retryable: false,
  },
  INVALID_FORMAT: {
    category: "input",
    defaultSuggestion: "Use the expected format for this value.",
    retryable: false,
  },
  NODE_NOT_FOUND: {
    category: "input",
    defaultSuggestion: 'Search for the node with "supertag search <query>".',
    docPath: "/docs/search",
    retryable: false,
  },
  TAG_NOT_FOUND: {
    category: "input",
    defaultSuggestion: 'Check available tags with "supertag tags".',
    docPath: "/docs/tags",
    retryable: true, // Can retry with corrected tag name
  },

  // Database errors
  DATABASE_NOT_FOUND: {
    category: "database",
    defaultSuggestion: 'Run "supertag sync" to create the database.',
    docPath: "/docs/sync",
    retryable: false,
  },
  DATABASE_CORRUPT: {
    category: "database",
    defaultSuggestion: 'Delete the database and run "supertag sync" to rebuild.',
    docPath: "/docs/sync",
    retryable: false,
  },
  DATABASE_LOCKED: {
    category: "database",
    defaultSuggestion: "Wait for other processes to finish and retry.",
    retryable: true, // Can retry after lock is released
  },
  SYNC_REQUIRED: {
    category: "database",
    defaultSuggestion: 'Run "supertag sync --force" to update the database.',
    docPath: "/docs/sync",
    retryable: false,
  },

  // Network errors
  API_ERROR: {
    category: "network",
    defaultSuggestion: "Check the API response for details.",
    retryable: false,
  },
  RATE_LIMITED: {
    category: "network",
    defaultSuggestion: "Wait and retry after the specified time.",
    retryable: true,
  },
  TIMEOUT: {
    category: "network",
    defaultSuggestion: "Check your network connection and retry.",
    retryable: true,
  },
  NETWORK_ERROR: {
    category: "network",
    defaultSuggestion: "Check your network connection and retry.",
    retryable: true,
  },

  // Auth errors
  AUTH_FAILED: {
    category: "auth",
    defaultSuggestion: "Check your API key and credentials.",
    docPath: "/docs/authentication",
    retryable: false,
  },
  PERMISSION_DENIED: {
    category: "auth",
    defaultSuggestion: "Check your permissions for this operation.",
    retryable: false,
  },

  // Internal errors
  INTERNAL_ERROR: {
    category: "internal",
    retryable: false,
  },
  VALIDATION_ERRORS: {
    category: "internal",
    defaultSuggestion: "Fix all listed validation errors.",
    retryable: false,
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/** Base URL for documentation links */
const DOC_BASE_URL = "https://supertag.dev";

/**
 * Get metadata for an error code
 * @param code - The error code to look up
 * @returns Error metadata or undefined if code not found
 */
export function getErrorMeta(code: ErrorCode): ErrorMeta | undefined {
  return ERROR_REGISTRY[code];
}

/**
 * Get the default suggestion for an error code
 * @param code - The error code to look up
 * @returns Default suggestion string or undefined
 */
export function getDefaultSuggestion(code: ErrorCode): string | undefined {
  return ERROR_REGISTRY[code]?.defaultSuggestion;
}

/**
 * Get the full documentation URL for an error code
 * @param code - The error code to look up
 * @returns Full documentation URL or undefined if no doc path
 */
export function getDocUrl(code: ErrorCode): string | undefined {
  const meta = ERROR_REGISTRY[code];
  if (meta?.docPath) {
    return `${DOC_BASE_URL}${meta.docPath}`;
  }
  return undefined;
}

/**
 * Check if an error is retryable
 * @param code - The error code to check
 * @returns true if the error is retryable, false otherwise
 */
export function isRetryable(code: ErrorCode): boolean {
  return ERROR_REGISTRY[code]?.retryable ?? false;
}
