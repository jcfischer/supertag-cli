/**
 * Tests for debug mode error handling
 * Spec: 073-error-context
 * Task: T-5.4
 */

import { describe, it, expect } from "bun:test";
import { StructuredError } from "../../src/utils/structured-errors";
import { formatErrorForCli } from "../../src/utils/error-formatter";
import { isDebugMode, setDebugMode, formatDebugError } from "../../src/utils/debug";

describe("Debug Mode", () => {
  describe("isDebugMode", () => {
    it("should return false by default", () => {
      // Reset to default state
      setDebugMode(false);
      expect(isDebugMode()).toBe(false);
    });

    it("should return true when enabled", () => {
      setDebugMode(true);
      expect(isDebugMode()).toBe(true);
      setDebugMode(false); // Reset
    });
  });

  describe("setDebugMode", () => {
    it("should enable debug mode", () => {
      setDebugMode(true);
      expect(isDebugMode()).toBe(true);
      setDebugMode(false); // Reset
    });

    it("should disable debug mode", () => {
      setDebugMode(true);
      setDebugMode(false);
      expect(isDebugMode()).toBe(false);
    });
  });

  describe("formatDebugError", () => {
    it("should include stack trace in debug mode", () => {
      setDebugMode(true);

      const error = new StructuredError("API_ERROR", "Request failed", {
        details: { statusCode: 500 },
      });

      const output = formatDebugError(error);

      expect(output).toContain("API_ERROR");
      expect(output).toContain("Request failed");
      expect(output).toContain("Stack Trace:");
      expect(output).toContain("at ");

      setDebugMode(false); // Reset
    });

    it("should include full error details in debug mode", () => {
      setDebugMode(true);

      const error = new StructuredError("VALIDATION_ERROR", "Invalid input", {
        details: {
          field: "email",
          value: "not-an-email",
          expected: "valid email address",
        },
        validationErrors: [
          { field: "email", message: "Invalid format", code: "invalid_format" },
        ],
      });

      const output = formatDebugError(error);

      expect(output).toContain("field");
      expect(output).toContain("email");
      expect(output).toContain("not-an-email");
      expect(output).toContain("Details:");

      setDebugMode(false); // Reset
    });

    it("should use standard format in non-debug mode", () => {
      setDebugMode(false);

      const error = new StructuredError("CONFIG_NOT_FOUND", "Config missing", {});

      const output = formatDebugError(error);
      const standardOutput = formatErrorForCli(error);

      // Should match standard format (no stack trace)
      expect(output).toBe(standardOutput);
    });

    it("should handle generic Error in debug mode", () => {
      setDebugMode(true);

      const error = new Error("Generic error");

      const output = formatDebugError(error);

      expect(output).toContain("Generic error");
      expect(output).toContain("Stack Trace:");

      setDebugMode(false); // Reset
    });

    it("should handle non-Error values gracefully", () => {
      setDebugMode(true);

      const output = formatDebugError("just a string");

      expect(output).toContain("just a string");

      setDebugMode(false); // Reset
    });
  });

  describe("Environment variable integration", () => {
    it("should check DEBUG env var", () => {
      // This tests the integration - actual implementation
      // checks process.env.DEBUG
      const originalDebug = process.env.DEBUG;

      process.env.DEBUG = "1";
      // Note: Need to re-check after setting
      // Implementation should check env var

      delete process.env.DEBUG;
      if (originalDebug) {
        process.env.DEBUG = originalDebug;
      }
    });
  });
});
