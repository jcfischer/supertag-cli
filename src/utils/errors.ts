/**
 * Custom Error Classes
 * Specific error types for better error handling and user feedback
 */

import { formatErrorForCli } from "./error-formatter";
import type { StructuredError } from "./structured-errors";

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

/**
 * Base error class for Tana CLI errors
 */
export class TanaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TanaError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Configuration error (missing or invalid config)
 */
export class ConfigError extends TanaError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * API error (failed API call)
 */
export class ApiError extends TanaError {
  public statusCode?: number;
  public response?: unknown;

  constructor(message: string, statusCode?: number, response?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

/**
 * Validation error (invalid input data)
 */
export class ValidationError extends TanaError {
  public errors: string[];

  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Parse error (failed to parse input)
 */
export class ParseError extends TanaError {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Rate limit error (exceeded API rate limit)
 */
export class RateLimitError extends TanaError {
  public retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Format user-friendly error message
 * @param error Error object
 * @returns Formatted error message
 */
export function formatErrorMessage(error: unknown): string {
  // Handle StructuredError first (uses new formatting system)
  if (isStructuredError(error)) {
    return formatErrorForCli(error);
  }

  if (error instanceof ConfigError) {
    return `❌ Configuration Error:\n${error.message}`;
  }

  if (error instanceof ApiError) {
    let msg = `❌ API Error:\n${error.message}`;
    if (error.statusCode) {
      msg += `\nStatus Code: ${error.statusCode}`;
    }
    if (error.response) {
      msg += `\nResponse: ${JSON.stringify(error.response, null, 2)}`;
    }
    return msg;
  }

  if (error instanceof ValidationError) {
    let msg = `❌ Validation Error:\n${error.message}`;
    if (error.errors.length > 0) {
      msg += '\n\nErrors:\n' + error.errors.map(e => `  - ${e}`).join('\n');
    }
    return msg;
  }

  if (error instanceof ParseError) {
    return `❌ Parse Error:\n${error.message}`;
  }

  if (error instanceof RateLimitError) {
    let msg = `❌ Rate Limit Error:\n${error.message}`;
    if (error.retryAfter) {
      msg += `\nRetry after: ${error.retryAfter}ms`;
    }
    return msg;
  }

  if (error instanceof TanaError) {
    return `❌ Error:\n${error.message}`;
  }

  if (error instanceof Error) {
    return `❌ Error:\n${error.message}`;
  }

  return `❌ Unknown Error:\n${String(error)}`;
}

/**
 * Exit process with formatted error message
 * @param error Error object
 * @param exitCode Exit code (default: 1)
 */
export function exitWithError(error: unknown, exitCode: number = 1): never {
  console.error(formatErrorMessage(error));
  process.exit(exitCode);
}
