/**
 * StructuredError Class
 * Spec: 073-error-context
 * Task: T-2.1
 *
 * Extends TanaError with structured data for consistent error handling
 * across CLI and MCP interfaces. Maintains backward compatibility while
 * adding rich context for error recovery.
 */

import { TanaError } from "./errors";
import { getDefaultSuggestion, getDocUrl, isRetryable } from "./error-registry";
import type {
  ErrorCode,
  StructuredErrorData,
  RecoveryInfo,
  ValidationErrorItem,
} from "../types/errors";

// =============================================================================
// StructuredError Options
// =============================================================================

/**
 * Options for creating a StructuredError
 */
export interface StructuredErrorOptions {
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
  /** Field-level validation errors */
  validationErrors?: ValidationErrorItem[];
  /** Original error that caused this one */
  cause?: Error;
}

// =============================================================================
// StructuredError Class
// =============================================================================

/**
 * Structured error with full context for consistent error handling.
 * Extends TanaError for backward compatibility.
 */
export class StructuredError extends TanaError {
  /** Error code for programmatic handling */
  public readonly code: ErrorCode;

  /** Additional context details */
  public readonly details?: Record<string, unknown>;

  /** Actionable suggestion for fixing the error */
  public readonly suggestion?: string;

  /** Example of correct usage */
  public readonly example?: string;

  /** URL to relevant documentation */
  public readonly docUrl?: string;

  /** Recovery hints for AI agents */
  public readonly recovery?: RecoveryInfo;

  /** Field-level validation errors */
  public readonly validationErrors?: ValidationErrorItem[];

  /** Original error that caused this one */
  public readonly cause?: Error;

  constructor(code: ErrorCode, message: string, options?: StructuredErrorOptions) {
    super(message);
    this.name = "StructuredError";
    this.code = code;
    this.details = options?.details;
    this.suggestion = options?.suggestion;
    this.example = options?.example;
    this.docUrl = options?.docUrl;
    this.recovery = options?.recovery;
    this.validationErrors = options?.validationErrors;
    this.cause = options?.cause;

    // Capture stack trace, excluding this constructor
    Error.captureStackTrace(this, StructuredError);
  }

  /**
   * Convert to structured data format for serialization
   */
  toStructuredData(): StructuredErrorData {
    const data: StructuredErrorData = {
      code: this.code,
      message: this.message,
    };

    if (this.details !== undefined) {
      data.details = this.details;
    }
    if (this.suggestion !== undefined) {
      data.suggestion = this.suggestion;
    }
    if (this.example !== undefined) {
      data.example = this.example;
    }
    if (this.docUrl !== undefined) {
      data.docUrl = this.docUrl;
    }
    if (this.recovery !== undefined) {
      data.recovery = this.recovery;
    }
    if (this.validationErrors !== undefined) {
      data.validationErrors = this.validationErrors;
    }

    return data;
  }

  /**
   * Convert to JSON (for serialization)
   */
  toJSON(): StructuredErrorData {
    return this.toStructuredData();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a structured error with auto-populated defaults from registry
 *
 * @param code - Error code
 * @param message - Human-readable message
 * @param options - Optional structured error options
 * @returns StructuredError with enriched context
 */
export function createStructuredError(
  code: ErrorCode,
  message: string,
  options?: StructuredErrorOptions
): StructuredError {
  // Auto-populate from registry if not provided
  const suggestion = options?.suggestion ?? getDefaultSuggestion(code);
  const docUrl = options?.docUrl ?? getDocUrl(code);
  const retryable = isRetryable(code);

  // Merge recovery info with registry defaults
  let recovery = options?.recovery;
  if (retryable && !recovery) {
    recovery = { retryable: true };
  } else if (retryable && recovery) {
    recovery = { ...recovery, retryable: true };
  }

  return new StructuredError(code, message, {
    ...options,
    suggestion,
    docUrl,
    recovery,
  });
}

/**
 * Enrich an existing error with structured data
 *
 * @param error - Original error to enrich
 * @param code - Error code to assign
 * @param options - Optional additional context
 * @returns StructuredError wrapping the original
 */
export function enrichError(
  error: Error,
  code: ErrorCode,
  options?: Omit<StructuredErrorOptions, "cause">
): StructuredError {
  return createStructuredError(code, error.message, {
    ...options,
    cause: error,
  });
}
