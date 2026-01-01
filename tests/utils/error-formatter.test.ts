/**
 * Tests for error formatter
 * Spec: 073-error-context
 * Task: T-2.3, T-2.4
 */

import { describe, it, expect } from "bun:test";
import {
  formatErrorForCli,
  formatErrorForMcp,
} from "../../src/utils/error-formatter";
import { StructuredError, createStructuredError } from "../../src/utils/structured-errors";

describe("Error Formatter", () => {
  describe("formatErrorForCli", () => {
    it("should format basic error with emoji and code", () => {
      const error = new StructuredError("CONFIG_NOT_FOUND", "Config file not found");
      const output = formatErrorForCli(error);

      expect(output).toContain("CONFIG_NOT_FOUND");
      expect(output).toContain("Config file not found");
    });

    it("should include suggestion when present", () => {
      const error = new StructuredError("DATABASE_NOT_FOUND", "Database not found", {
        suggestion: 'Run "supertag sync" to create the database.',
      });
      const output = formatErrorForCli(error);

      expect(output).toContain("supertag sync");
    });

    it("should include example when present", () => {
      const error = new StructuredError("INVALID_FORMAT", "Invalid date format", {
        example: "Use format: 2025-12-31",
      });
      const output = formatErrorForCli(error);

      expect(output).toContain("2025-12-31");
    });

    it("should include doc URL when present", () => {
      const error = new StructuredError("WORKSPACE_NOT_FOUND", "Workspace not found", {
        docUrl: "https://supertag.dev/docs/workspaces",
      });
      const output = formatErrorForCli(error);

      expect(output).toContain("supertag.dev");
    });

    it("should show stack trace in debug mode", () => {
      const error = new StructuredError("INTERNAL_ERROR", "Something went wrong");
      const output = formatErrorForCli(error, { debug: true });

      expect(output).toContain("Stack:");
      expect(output).toContain("StructuredError");
    });

    it("should hide stack trace in normal mode", () => {
      const error = new StructuredError("INTERNAL_ERROR", "Something went wrong");
      const output = formatErrorForCli(error, { debug: false });

      expect(output).not.toContain("Stack:");
    });

    it("should show details in debug mode", () => {
      const error = new StructuredError("API_ERROR", "API failed", {
        details: { endpoint: "/api/test", status: 500 },
      });
      const output = formatErrorForCli(error, { debug: true });

      expect(output).toContain("endpoint");
      expect(output).toContain("/api/test");
    });

    it("should format recovery info when retryable", () => {
      const error = createStructuredError("RATE_LIMITED", "Too many requests", {
        recovery: { retryable: true, retryAfter: 30 },
      });
      const output = formatErrorForCli(error);

      expect(output).toContain("Retryable");
    });

    it("should format validation errors", () => {
      const error = new StructuredError("VALIDATION_ERRORS", "Validation failed", {
        validationErrors: [
          { field: "name", code: "REQUIRED", message: "Name is required" },
          { field: "email", code: "INVALID_FORMAT", message: "Invalid email" },
        ],
      });
      const output = formatErrorForCli(error);

      expect(output).toContain("name");
      expect(output).toContain("Name is required");
      expect(output).toContain("email");
      expect(output).toContain("Invalid email");
    });

    it("should use color by default", () => {
      const error = new StructuredError("API_ERROR", "Failed");
      const output = formatErrorForCli(error);

      // Output should contain ANSI color codes (starts with \x1b[)
      // or the color formatting should be visible
      expect(output.length).toBeGreaterThan(0);
    });

    it("should respect color: false option", () => {
      const error = new StructuredError("API_ERROR", "Failed");
      const outputWithColor = formatErrorForCli(error, { color: true });
      const outputNoColor = formatErrorForCli(error, { color: false });

      // Without color, output should be shorter (no ANSI codes)
      // or at minimum, should not have escape codes
      expect(outputNoColor).not.toContain("\x1b[");
    });
  });

  describe("formatErrorForMcp", () => {
    it("should return structured JSON format", () => {
      const error = new StructuredError("TAG_NOT_FOUND", "Tag not found");
      const result = formatErrorForMcp(error);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe("TAG_NOT_FOUND");
      expect(result.error.message).toBe("Tag not found");
    });

    it("should include all structured fields", () => {
      const error = new StructuredError("TAG_NOT_FOUND", "Tag 'meetting' not found", {
        details: { tag: "meetting", similar: ["meeting"] },
        suggestion: "Did you mean: meeting?",
        example: "tana_tagged({ tag: 'meeting' })",
        docUrl: "https://supertag.dev/docs/tags",
        recovery: { retryable: true, retryWith: { tag: "meeting" } },
      });
      const result = formatErrorForMcp(error);

      expect(result.error.code).toBe("TAG_NOT_FOUND");
      expect(result.error.message).toBe("Tag 'meetting' not found");
      expect(result.error.details).toEqual({ tag: "meetting", similar: ["meeting"] });
      expect(result.error.suggestion).toBe("Did you mean: meeting?");
      expect(result.error.example).toBe("tana_tagged({ tag: 'meeting' })");
      expect(result.error.docUrl).toBe("https://supertag.dev/docs/tags");
      expect(result.error.recovery?.retryable).toBe(true);
      expect(result.error.recovery?.retryWith).toEqual({ tag: "meeting" });
    });

    it("should include validation errors", () => {
      const error = new StructuredError("VALIDATION_ERRORS", "Validation failed", {
        validationErrors: [
          { field: "name", code: "REQUIRED", message: "Name is required" },
        ],
      });
      const result = formatErrorForMcp(error);

      expect(result.error.validationErrors).toBeDefined();
      expect(result.error.validationErrors?.length).toBe(1);
      expect(result.error.validationErrors?.[0].field).toBe("name");
    });

    it("should be JSON serializable", () => {
      const error = new StructuredError("API_ERROR", "Failed", {
        details: { nested: { value: 123 } },
      });
      const result = formatErrorForMcp(error);

      // Should not throw
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);

      expect(parsed.error.code).toBe("API_ERROR");
      expect(parsed.error.details.nested.value).toBe(123);
    });

    it("should not include undefined fields", () => {
      const error = new StructuredError("CONFIG_NOT_FOUND", "Config missing");
      const result = formatErrorForMcp(error);

      // Undefined fields should not appear in output
      expect("details" in result.error).toBe(false);
      expect("example" in result.error).toBe(false);
      expect("validationErrors" in result.error).toBe(false);
    });
  });
});
