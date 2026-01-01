/**
 * Tests for error registry
 * Spec: 073-error-context
 * Task: T-1.2
 */

import { describe, it, expect } from "bun:test";
import {
  ERROR_REGISTRY,
  getErrorMeta,
  getDefaultSuggestion,
  getDocUrl,
  isRetryable,
  type ErrorMeta,
} from "../../src/utils/error-registry";
import { ERROR_CODES, type ErrorCode } from "../../src/types/errors";

describe("Error Registry", () => {
  describe("ERROR_REGISTRY", () => {
    it("should have an entry for every error code", () => {
      for (const code of ERROR_CODES) {
        expect(ERROR_REGISTRY[code]).toBeDefined();
      }
    });

    it("should have valid category for every entry", () => {
      const validCategories = ["config", "input", "database", "network", "auth", "internal"];
      for (const code of ERROR_CODES) {
        expect(validCategories).toContain(ERROR_REGISTRY[code].category);
      }
    });

    it("should have retryable flag for every entry", () => {
      for (const code of ERROR_CODES) {
        expect(typeof ERROR_REGISTRY[code].retryable).toBe("boolean");
      }
    });
  });

  describe("Config error codes", () => {
    it("should have correct metadata for CONFIG_NOT_FOUND", () => {
      const meta = ERROR_REGISTRY.CONFIG_NOT_FOUND;
      expect(meta.category).toBe("config");
      expect(meta.retryable).toBe(false);
      expect(meta.defaultSuggestion).toBeDefined();
    });

    it("should have correct metadata for WORKSPACE_NOT_FOUND", () => {
      const meta = ERROR_REGISTRY.WORKSPACE_NOT_FOUND;
      expect(meta.category).toBe("config");
      expect(meta.retryable).toBe(false);
      expect(meta.docPath).toContain("workspace");
    });

    it("should have correct metadata for API_KEY_MISSING", () => {
      const meta = ERROR_REGISTRY.API_KEY_MISSING;
      expect(meta.category).toBe("config");
      expect(meta.retryable).toBe(false);
    });
  });

  describe("Input error codes", () => {
    it("should have correct metadata for TAG_NOT_FOUND", () => {
      const meta = ERROR_REGISTRY.TAG_NOT_FOUND;
      expect(meta.category).toBe("input");
      expect(meta.retryable).toBe(true); // Can retry with corrected tag
    });

    it("should have correct metadata for NODE_NOT_FOUND", () => {
      const meta = ERROR_REGISTRY.NODE_NOT_FOUND;
      expect(meta.category).toBe("input");
      expect(meta.retryable).toBe(false);
    });
  });

  describe("Database error codes", () => {
    it("should have correct metadata for DATABASE_NOT_FOUND", () => {
      const meta = ERROR_REGISTRY.DATABASE_NOT_FOUND;
      expect(meta.category).toBe("database");
      expect(meta.retryable).toBe(false);
      expect(meta.defaultSuggestion).toContain("sync");
    });

    it("should have correct metadata for DATABASE_LOCKED", () => {
      const meta = ERROR_REGISTRY.DATABASE_LOCKED;
      expect(meta.category).toBe("database");
      expect(meta.retryable).toBe(true); // Can retry after lock is released
    });
  });

  describe("Network error codes", () => {
    it("should have correct metadata for RATE_LIMITED", () => {
      const meta = ERROR_REGISTRY.RATE_LIMITED;
      expect(meta.category).toBe("network");
      expect(meta.retryable).toBe(true);
    });

    it("should have correct metadata for TIMEOUT", () => {
      const meta = ERROR_REGISTRY.TIMEOUT;
      expect(meta.category).toBe("network");
      expect(meta.retryable).toBe(true);
    });

    it("should have correct metadata for NETWORK_ERROR", () => {
      const meta = ERROR_REGISTRY.NETWORK_ERROR;
      expect(meta.category).toBe("network");
      expect(meta.retryable).toBe(true);
    });
  });

  describe("getErrorMeta", () => {
    it("should return metadata for valid error code", () => {
      const meta = getErrorMeta("CONFIG_NOT_FOUND");
      expect(meta).toBeDefined();
      expect(meta?.category).toBe("config");
    });

    it("should return undefined for invalid error code", () => {
      const meta = getErrorMeta("INVALID_CODE" as ErrorCode);
      expect(meta).toBeUndefined();
    });
  });

  describe("getDefaultSuggestion", () => {
    it("should return suggestion for code with default suggestion", () => {
      const suggestion = getDefaultSuggestion("DATABASE_NOT_FOUND");
      expect(suggestion).toBeDefined();
      expect(suggestion).toContain("sync");
    });

    it("should return undefined for code without default suggestion", () => {
      const suggestion = getDefaultSuggestion("INTERNAL_ERROR");
      expect(suggestion).toBeUndefined();
    });
  });

  describe("getDocUrl", () => {
    it("should return full URL for code with docPath", () => {
      const url = getDocUrl("WORKSPACE_NOT_FOUND");
      expect(url).toBeDefined();
      expect(url).toContain("supertag.dev");
    });

    it("should return undefined for code without docPath", () => {
      const url = getDocUrl("INTERNAL_ERROR");
      expect(url).toBeUndefined();
    });
  });

  describe("isRetryable", () => {
    it("should return true for retryable errors", () => {
      expect(isRetryable("RATE_LIMITED")).toBe(true);
      expect(isRetryable("TIMEOUT")).toBe(true);
      expect(isRetryable("DATABASE_LOCKED")).toBe(true);
    });

    it("should return false for non-retryable errors", () => {
      expect(isRetryable("CONFIG_NOT_FOUND")).toBe(false);
      expect(isRetryable("DATABASE_NOT_FOUND")).toBe(false);
      expect(isRetryable("AUTH_FAILED")).toBe(false);
    });

    it("should return false for unknown error code", () => {
      expect(isRetryable("UNKNOWN" as ErrorCode)).toBe(false);
    });
  });
});
