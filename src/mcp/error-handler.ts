/**
 * MCP Error Handler
 * Spec: 073-error-context
 * Task: T-5.3
 *
 * Converts errors to MCP-compatible content format with structured data
 * for AI agents to understand and potentially recover from errors.
 */

import { StructuredError } from "../utils/structured-errors";
import { formatErrorForMcp } from "../utils/error-formatter";
import type { McpErrorResponse } from "../utils/error-formatter";

// =============================================================================
// Types
// =============================================================================

/**
 * MCP content item (text content with type)
 */
export interface McpContentItem {
  type: "text";
  text: string;
}

/**
 * MCP tool result with error flag
 * Uses index signature for compatibility with MCP SDK
 */
export interface McpToolResult {
  isError: boolean;
  content: McpContentItem[];
  [key: string]: unknown;
}

// =============================================================================
// Type Guard
// =============================================================================

/**
 * Type guard for StructuredError (avoids circular import issues)
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
// Error Conversion Functions
// =============================================================================

/**
 * Convert any error to a StructuredError if it isn't already
 */
function toStructuredError(error: unknown): StructuredError {
  if (isStructuredError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new StructuredError("UNKNOWN_ERROR", error.message, {
      details: {
        originalName: error.name,
      },
    });
  }

  return new StructuredError("UNKNOWN_ERROR", String(error), {});
}

/**
 * Create MCP-compatible content array from a StructuredError
 *
 * @param error - The structured error to format
 * @returns Array of MCP content items
 */
export function createMcpErrorContent(error: StructuredError): McpContentItem[] {
  const mcpResponse = formatErrorForMcp(error);

  return [
    {
      type: "text",
      text: JSON.stringify(mcpResponse, null, 2),
    },
  ];
}

/**
 * Handle an error for MCP tool execution
 *
 * Converts any error to a structured MCP response that AI agents
 * can parse and potentially recover from.
 *
 * @param error - The error to handle
 * @returns MCP tool result with isError flag and structured content
 *
 * @example
 * ```typescript
 * try {
 *   const result = await someOperation();
 *   return { content: [{ type: 'text', text: JSON.stringify(result) }] };
 * } catch (error) {
 *   return handleMcpError(error);
 * }
 * ```
 */
export function handleMcpError(error: unknown): McpToolResult {
  const structuredError = toStructuredError(error);
  const content = createMcpErrorContent(structuredError);

  return {
    isError: true,
    content,
  };
}

/**
 * Create an MCP error response for a specific error code
 *
 * Useful for creating errors directly in MCP tool implementations.
 *
 * @param code - Error code
 * @param message - Error message
 * @param options - Additional error options
 * @returns MCP tool result with error content
 */
export function createMcpError(
  code: StructuredError["code"],
  message: string,
  options?: {
    details?: Record<string, unknown>;
    suggestion?: string;
    recovery?: StructuredError["recovery"];
  }
): McpToolResult {
  const error = new StructuredError(code, message, options);
  return handleMcpError(error);
}
