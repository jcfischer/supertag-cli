/**
 * Tests for MCP server error handling
 * Spec: 073-error-context
 * Task: T-5.3
 */

import { describe, it, expect } from "bun:test";
import { StructuredError } from "../../src/utils/structured-errors";
import { formatErrorForMcp } from "../../src/utils/error-formatter";
import { handleMcpError, createMcpErrorContent } from "../../src/mcp/error-handler";
import type { McpErrorResponse } from "../../src/utils/error-formatter";

describe("MCP Error Handling", () => {
  describe("formatErrorForMcp", () => {
    it("should format StructuredError to MCP response", () => {
      const error = new StructuredError("WORKSPACE_NOT_FOUND", "Workspace 'books' not found", {
        details: { requestedWorkspace: "books", availableWorkspaces: ["main"] },
        suggestion: "Try one of: main",
        recovery: {
          canRetry: false,
          alternatives: ["main"],
        },
      });

      const result = formatErrorForMcp(error);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe("WORKSPACE_NOT_FOUND");
      expect(result.error.message).toBe("Workspace 'books' not found");
      expect(result.error.details?.requestedWorkspace).toBe("books");
    });

    it("should include suggestion in response", () => {
      const error = new StructuredError("TAG_NOT_FOUND", "Tag 'todo' not found", {
        suggestion: "Did you mean: todos, task, todo-item?",
      });

      const result = formatErrorForMcp(error);

      expect(result.error.suggestion).toBe("Did you mean: todos, task, todo-item?");
    });

    it("should include recovery info for AI agents", () => {
      const error = new StructuredError("DATABASE_NOT_FOUND", "Database missing", {
        recovery: {
          canRetry: false,
          suggestedCommand: "supertag sync -w main",
        },
      });

      const result = formatErrorForMcp(error);

      expect(result.error.recovery).toBeDefined();
      expect(result.error.recovery?.canRetry).toBe(false);
      expect(result.error.recovery?.suggestedCommand).toBe("supertag sync -w main");
    });

    it("should include alternatives in recovery", () => {
      const error = new StructuredError("WORKSPACE_NOT_FOUND", "Workspace not found", {
        recovery: {
          canRetry: false,
          alternatives: ["main", "books", "work"],
        },
      });

      const result = formatErrorForMcp(error);

      expect(result.error.recovery?.alternatives).toEqual(["main", "books", "work"]);
    });

    it("should include validation errors", () => {
      const error = new StructuredError("VALIDATION_ERROR", "Invalid input", {
        validationErrors: [
          { field: "workspace", message: "Required", code: "required" },
          { field: "query", message: "Too short", code: "min_length", expected: "3" },
        ],
      });

      const result = formatErrorForMcp(error);

      expect(result.error.validationErrors).toHaveLength(2);
      expect(result.error.validationErrors?.[0].field).toBe("workspace");
      expect(result.error.validationErrors?.[1].expected).toBe("3");
    });
  });

  describe("MCP error content format", () => {
    it("should serialize to valid JSON for MCP content", () => {
      const error = new StructuredError("API_ERROR", "API call failed", {
        details: { statusCode: 500 },
        suggestion: "Retry later",
      });

      const mcpResponse = formatErrorForMcp(error);
      const jsonString = JSON.stringify(mcpResponse);

      // Should be valid JSON
      const parsed = JSON.parse(jsonString);
      expect(parsed.error.code).toBe("API_ERROR");
      expect(parsed.error.message).toBe("API call failed");
    });

    it("should provide structured response for AI tool processing", () => {
      const error = new StructuredError("NODE_NOT_FOUND", "Node abc123 not found", {
        details: { nodeId: "abc123" },
        recovery: {
          canRetry: false,
          alternatives: ["Try tana_search to find the correct node ID"],
        },
      });

      const result = formatErrorForMcp(error);

      // AI agent can use this information to recover
      expect(result.error.code).toBe("NODE_NOT_FOUND");
      expect(result.error.details?.nodeId).toBe("abc123");
      expect(result.error.recovery?.alternatives?.[0]).toContain("tana_search");
    });
  });

  describe("handleMcpError", () => {
    it("should convert StructuredError to MCP content format", () => {
      const error = new StructuredError("WORKSPACE_NOT_FOUND", "Workspace not found", {
        suggestion: "Try 'main'",
        recovery: { canRetry: false, alternatives: ["main"] },
      });

      const content = handleMcpError(error);

      expect(content.isError).toBe(true);
      expect(content.content).toHaveLength(1);
      expect(content.content[0].type).toBe("text");

      const parsed = JSON.parse(content.content[0].text);
      expect(parsed.error.code).toBe("WORKSPACE_NOT_FOUND");
    });

    it("should handle generic Error", () => {
      const error = new Error("Something went wrong");

      const content = handleMcpError(error);

      expect(content.isError).toBe(true);
      const parsed = JSON.parse(content.content[0].text);
      expect(parsed.error.code).toBe("UNKNOWN_ERROR");
      expect(parsed.error.message).toBe("Something went wrong");
    });

    it("should handle unknown error types", () => {
      const content = handleMcpError("just a string");

      expect(content.isError).toBe(true);
      const parsed = JSON.parse(content.content[0].text);
      expect(parsed.error.code).toBe("UNKNOWN_ERROR");
    });
  });

  describe("createMcpErrorContent", () => {
    it("should create MCP-compatible content array", () => {
      const error = new StructuredError("API_ERROR", "Failed", {});

      const content = createMcpErrorContent(error);

      expect(Array.isArray(content)).toBe(true);
      expect(content[0].type).toBe("text");
    });

    it("should include recovery hints for AI agents", () => {
      const error = new StructuredError("DATABASE_NOT_FOUND", "DB missing", {
        recovery: {
          canRetry: false,
          suggestedCommand: "supertag sync",
          nextSteps: ["Run sync", "Check config"],
        },
      });

      const content = createMcpErrorContent(error);
      const parsed = JSON.parse(content[0].text);

      expect(parsed.error.recovery.suggestedCommand).toBe("supertag sync");
      expect(parsed.error.recovery.nextSteps).toEqual(["Run sync", "Check config"]);
    });
  });
});
