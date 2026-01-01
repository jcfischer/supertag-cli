/**
 * Tests for error type definitions
 * Spec: 073-error-context
 * Task: T-1.1
 */

import { describe, it, expect } from "bun:test";
import {
  ERROR_CODES,
  ERROR_CATEGORIES,
  isValidErrorCode,
  type ErrorCode,
  type ErrorCategory,
  type StructuredErrorData,
  type RecoveryInfo,
  type ValidationErrorItem,
  type ErrorLogEntry,
} from "../../src/types/errors";

describe("Error Type Definitions", () => {
  describe("ERROR_CODES constant", () => {
    it("should export ERROR_CODES array with all error codes", () => {
      expect(ERROR_CODES).toBeDefined();
      expect(Array.isArray(ERROR_CODES)).toBe(true);
      expect(ERROR_CODES.length).toBeGreaterThanOrEqual(21);
    });

    it("should include all config error codes", () => {
      expect(ERROR_CODES).toContain("CONFIG_NOT_FOUND");
      expect(ERROR_CODES).toContain("CONFIG_INVALID");
      expect(ERROR_CODES).toContain("WORKSPACE_NOT_FOUND");
      expect(ERROR_CODES).toContain("API_KEY_MISSING");
    });

    it("should include all input error codes", () => {
      expect(ERROR_CODES).toContain("INVALID_PARAMETER");
      expect(ERROR_CODES).toContain("MISSING_REQUIRED");
      expect(ERROR_CODES).toContain("INVALID_FORMAT");
      expect(ERROR_CODES).toContain("NODE_NOT_FOUND");
      expect(ERROR_CODES).toContain("TAG_NOT_FOUND");
    });

    it("should include all database error codes", () => {
      expect(ERROR_CODES).toContain("DATABASE_NOT_FOUND");
      expect(ERROR_CODES).toContain("DATABASE_CORRUPT");
      expect(ERROR_CODES).toContain("DATABASE_LOCKED");
      expect(ERROR_CODES).toContain("SYNC_REQUIRED");
    });

    it("should include all network error codes", () => {
      expect(ERROR_CODES).toContain("API_ERROR");
      expect(ERROR_CODES).toContain("RATE_LIMITED");
      expect(ERROR_CODES).toContain("TIMEOUT");
      expect(ERROR_CODES).toContain("NETWORK_ERROR");
    });

    it("should include all auth error codes", () => {
      expect(ERROR_CODES).toContain("AUTH_FAILED");
      expect(ERROR_CODES).toContain("PERMISSION_DENIED");
    });

    it("should include internal error codes", () => {
      expect(ERROR_CODES).toContain("INTERNAL_ERROR");
      expect(ERROR_CODES).toContain("VALIDATION_ERRORS");
    });
  });

  describe("ERROR_CATEGORIES constant", () => {
    it("should export ERROR_CATEGORIES array", () => {
      expect(ERROR_CATEGORIES).toBeDefined();
      expect(Array.isArray(ERROR_CATEGORIES)).toBe(true);
    });

    it("should have all category types", () => {
      expect(ERROR_CATEGORIES).toContain("config");
      expect(ERROR_CATEGORIES).toContain("input");
      expect(ERROR_CATEGORIES).toContain("database");
      expect(ERROR_CATEGORIES).toContain("network");
      expect(ERROR_CATEGORIES).toContain("auth");
      expect(ERROR_CATEGORIES).toContain("internal");
      expect(ERROR_CATEGORIES).toHaveLength(6);
    });
  });

  describe("isValidErrorCode", () => {
    it("should return true for valid error codes", () => {
      expect(isValidErrorCode("CONFIG_NOT_FOUND")).toBe(true);
      expect(isValidErrorCode("API_ERROR")).toBe(true);
      expect(isValidErrorCode("INTERNAL_ERROR")).toBe(true);
    });

    it("should return false for invalid error codes", () => {
      expect(isValidErrorCode("NOT_A_VALID_CODE")).toBe(false);
      expect(isValidErrorCode("")).toBe(false);
      expect(isValidErrorCode("config_not_found")).toBe(false);
    });
  });

  describe("StructuredErrorData", () => {
    it("should accept minimal error data", () => {
      const error: StructuredErrorData = {
        code: "CONFIG_NOT_FOUND",
        message: "Config file not found",
      };
      expect(error.code).toBe("CONFIG_NOT_FOUND");
      expect(error.message).toBe("Config file not found");
    });

    it("should accept full error data with all optional fields", () => {
      const error: StructuredErrorData = {
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace 'books' not found",
        details: {
          workspace: "books",
          availableWorkspaces: ["main", "work"],
        },
        suggestion: "Use one of the available workspaces",
        example: 'supertag search --workspace main',
        docUrl: "https://supertag.dev/docs/workspaces",
        recovery: {
          retryable: true,
          retryWith: { workspace: "main" },
        },
        validationErrors: [],
      };
      expect(error.details?.workspace).toBe("books");
      expect(error.recovery?.retryable).toBe(true);
    });
  });

  describe("RecoveryInfo", () => {
    it("should accept retryable recovery info", () => {
      const recovery: RecoveryInfo = {
        retryable: true,
        retryAfter: 30,
        retryStrategy: "exponential",
        maxRetries: 3,
      };
      expect(recovery.retryable).toBe(true);
      expect(recovery.retryAfter).toBe(30);
    });

    it("should accept non-retryable recovery with alternative", () => {
      const recovery: RecoveryInfo = {
        retryable: false,
        alternativeAction: "search",
        alternativeParams: { query: "abc123" },
      };
      expect(recovery.retryable).toBe(false);
      expect(recovery.alternativeAction).toBe("search");
    });

    it("should accept recovery with retryWith parameters", () => {
      const recovery: RecoveryInfo = {
        retryable: true,
        retryWith: { tag: "meeting" },
      };
      expect(recovery.retryWith?.tag).toBe("meeting");
    });
  });

  describe("ValidationErrorItem", () => {
    it("should accept minimal validation error", () => {
      const error: ValidationErrorItem = {
        field: "name",
        code: "REQUIRED",
        message: "Name is required",
      };
      expect(error.field).toBe("name");
      expect(error.code).toBe("REQUIRED");
    });

    it("should accept full validation error with all fields", () => {
      const error: ValidationErrorItem = {
        field: "fields.Due",
        code: "INVALID_FORMAT",
        message: "Invalid date format",
        value: "not-a-date",
        expected: "YYYY-MM-DD",
        suggestion: "Use format: 2025-12-31",
      };
      expect(error.value).toBe("not-a-date");
      expect(error.expected).toBe("YYYY-MM-DD");
    });
  });

  describe("ErrorLogEntry", () => {
    it("should accept minimal log entry", () => {
      const entry: ErrorLogEntry = {
        timestamp: "2026-01-01T12:00:00Z",
        code: "API_ERROR",
        message: "API request failed",
      };
      expect(entry.timestamp).toBe("2026-01-01T12:00:00Z");
      expect(entry.code).toBe("API_ERROR");
    });

    it("should accept full log entry with all fields", () => {
      const entry: ErrorLogEntry = {
        timestamp: "2026-01-01T12:00:00Z",
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found",
        command: "supertag search project --workspace books",
        workspace: "books",
        details: { availableWorkspaces: ["main"] },
        stack: "Error: Workspace not found\n    at ...",
      };
      expect(entry.command).toBe("supertag search project --workspace books");
      expect(entry.workspace).toBe("books");
      expect(entry.stack).toContain("Error:");
    });
  });
});
