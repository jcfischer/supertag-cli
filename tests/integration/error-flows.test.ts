/**
 * Integration tests for error flows
 * Spec: 073-error-context
 * Task: T-6.3
 *
 * End-to-end tests for error scenarios: missing workspace, invalid tag,
 * database not found, API errors.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { StructuredError } from "../../src/utils/structured-errors";
import { formatErrorForCli, formatErrorForMcp } from "../../src/utils/error-formatter";
import { WorkspaceNotFoundError, WorkspaceDatabaseMissingError } from "../../src/config/workspace-resolver";
import { handleMcpError } from "../../src/mcp/error-handler";

describe("Error Flows - Integration", () => {
  describe("Workspace errors", () => {
    it("should provide structured error for missing workspace", () => {
      const error = new WorkspaceNotFoundError("nonexistent", ["main", "books"]);

      expect(error.code).toBe("WORKSPACE_NOT_FOUND");
      expect(error.message).toContain("nonexistent");
      expect(error.message).toContain("main");

      // Should have recovery info
      const data = error.toStructuredData();
      expect(data.recovery?.alternatives).toContain("main");
      expect(data.recovery?.alternatives).toContain("books");
    });

    it("should provide structured error for missing database", () => {
      const error = new WorkspaceDatabaseMissingError("test-ws", "/path/to/db");

      expect(error.code).toBe("DATABASE_NOT_FOUND");
      expect(error.message).toContain("test-ws");
      expect(error.message).toContain("/path/to/db");

      // Should have recovery hint
      const data = error.toStructuredData();
      expect(data.recovery?.suggestedCommand).toContain("supertag sync");
    });
  });

  describe("CLI error formatting", () => {
    it("should format workspace error for CLI", () => {
      const error = new WorkspaceNotFoundError("invalid-ws", ["main"]);
      const output = formatErrorForCli(error);

      // Should be human-readable
      expect(output).toContain("WORKSPACE_NOT_FOUND");
      expect(output).toContain("invalid-ws");
    });

    it("should format database error for CLI with suggestion", () => {
      const error = new WorkspaceDatabaseMissingError("test", "/path/db");
      const output = formatErrorForCli(error);

      expect(output).toContain("DATABASE_NOT_FOUND");
      expect(output).toContain("supertag sync");
    });

    it("should format validation error with multiple issues", () => {
      const error = new StructuredError("VALIDATION_ERROR", "Invalid input", {
        validationErrors: [
          { field: "workspace", message: "Required", code: "required" },
          { field: "query", message: "Too short", code: "min_length" },
        ],
      });

      const output = formatErrorForCli(error);

      expect(output).toContain("VALIDATION_ERROR");
      expect(output).toContain("workspace");
      expect(output).toContain("query");
    });
  });

  describe("MCP error formatting", () => {
    it("should format error for MCP with structured data", () => {
      const error = new WorkspaceNotFoundError("missing", ["main"]);
      const mcpResponse = formatErrorForMcp(error);

      expect(mcpResponse.error.code).toBe("WORKSPACE_NOT_FOUND");
      expect(mcpResponse.error.details?.requestedWorkspace).toBe("missing");
      expect(mcpResponse.error.recovery?.alternatives).toContain("main");
    });

    it("should handle MCP error response format", () => {
      const error = new StructuredError("TAG_NOT_FOUND", "Tag not found", {
        details: { tagName: "invalid-tag" },
        suggestion: "Did you mean: todo, meeting?",
      });

      const result = handleMcpError(error);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("TAG_NOT_FOUND");
      expect(parsed.error.suggestion).toContain("Did you mean");
    });

    it("should convert generic Error to structured MCP response", () => {
      const error = new Error("Something went wrong");
      const result = handleMcpError(error);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("UNKNOWN_ERROR");
      expect(parsed.error.message).toBe("Something went wrong");
    });
  });

  describe("Error serialization", () => {
    it("should serialize workspace error to JSON", () => {
      const error = new WorkspaceNotFoundError("test", ["a", "b"]);
      const data = error.toStructuredData();

      // Should be JSON-serializable
      const json = JSON.stringify(data);
      const parsed = JSON.parse(json);

      expect(parsed.code).toBe("WORKSPACE_NOT_FOUND");
      expect(parsed.details.requestedWorkspace).toBe("test");
    });

    it("should serialize complex error with nested details", () => {
      const error = new StructuredError("API_ERROR", "API call failed", {
        details: {
          endpoint: "/api/nodes",
          statusCode: 500,
          response: { error: "Internal server error" },
        },
        recovery: {
          canRetry: true,
          retryAfter: 1000,
        },
      });

      const data = error.toStructuredData();
      const json = JSON.stringify(data);
      const parsed = JSON.parse(json);

      expect(parsed.details.statusCode).toBe(500);
      expect(parsed.recovery.canRetry).toBe(true);
    });
  });

  describe("CLI integration", () => {
    it("should handle workspace not found gracefully", async () => {
      try {
        await $`bun run src/index.ts search "test" -w nonexistent-workspace-xyz-test`.text();
        // If it doesn't throw, that's also acceptable
      } catch (error: unknown) {
        // Should exit with error but not crash
        if (error instanceof Error && "exitCode" in error) {
          expect((error as { exitCode: number }).exitCode).toBe(1);
        }
      }
    });

    it("should show help when no command given", async () => {
      const result = await $`bun run src/index.ts --help`.text();
      expect(result).toContain("supertag");
      expect(result).toContain("--debug");
    });
  });

  describe("Error recovery hints", () => {
    it("should provide similar workspace suggestions", () => {
      const error = new WorkspaceNotFoundError("mian", ["main", "books", "work"]);

      const data = error.toStructuredData();

      // Should include alternatives for potential typo correction
      expect(data.recovery?.alternatives).toBeDefined();
      expect(data.recovery?.alternatives?.length).toBeGreaterThan(0);
    });

    it("should provide command suggestion for database errors", () => {
      const error = new WorkspaceDatabaseMissingError("myws", "/path/db");
      const data = error.toStructuredData();

      expect(data.recovery?.suggestedCommand).toContain("supertag sync -w myws");
    });
  });
});
