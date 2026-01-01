/**
 * Tests for StructuredError class
 * Spec: 073-error-context
 * Task: T-2.1
 */

import { describe, it, expect } from "bun:test";
import {
  StructuredError,
  createStructuredError,
  enrichError,
} from "../../src/utils/structured-errors";
import { TanaError } from "../../src/utils/errors";
import type { ErrorCode, RecoveryInfo } from "../../src/types/errors";

describe("StructuredError", () => {
  describe("constructor", () => {
    it("should create error with code and message", () => {
      const error = new StructuredError("CONFIG_NOT_FOUND", "Config file not found");
      expect(error.code).toBe("CONFIG_NOT_FOUND");
      expect(error.message).toBe("Config file not found");
      expect(error.name).toBe("StructuredError");
    });

    it("should extend TanaError for backward compatibility", () => {
      const error = new StructuredError("API_ERROR", "API failed");
      expect(error).toBeInstanceOf(TanaError);
      expect(error).toBeInstanceOf(Error);
    });

    it("should accept optional details", () => {
      const error = new StructuredError("WORKSPACE_NOT_FOUND", "Workspace not found", {
        details: { workspace: "books", available: ["main", "work"] },
      });
      expect(error.details).toEqual({ workspace: "books", available: ["main", "work"] });
    });

    it("should accept optional suggestion", () => {
      const error = new StructuredError("TAG_NOT_FOUND", "Tag not found", {
        suggestion: "Did you mean: meeting?",
      });
      expect(error.suggestion).toBe("Did you mean: meeting?");
    });

    it("should accept optional example", () => {
      const error = new StructuredError("INVALID_FORMAT", "Invalid date format", {
        example: "Use format: 2025-12-31",
      });
      expect(error.example).toBe("Use format: 2025-12-31");
    });

    it("should accept optional docUrl", () => {
      const error = new StructuredError("DATABASE_NOT_FOUND", "Database not found", {
        docUrl: "https://supertag.dev/docs/sync",
      });
      expect(error.docUrl).toBe("https://supertag.dev/docs/sync");
    });

    it("should accept optional recovery info", () => {
      const recovery: RecoveryInfo = {
        retryable: true,
        retryAfter: 30,
        retryStrategy: "exponential",
        maxRetries: 3,
      };
      const error = new StructuredError("RATE_LIMITED", "Rate limited", { recovery });
      expect(error.recovery).toEqual(recovery);
    });

    it("should accept optional cause", () => {
      const cause = new Error("Original error");
      const error = new StructuredError("INTERNAL_ERROR", "Something went wrong", { cause });
      expect(error.cause).toBe(cause);
    });

    it("should capture stack trace", () => {
      const error = new StructuredError("API_ERROR", "Failed");
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("StructuredError");
    });
  });

  describe("toStructuredData", () => {
    it("should return minimal structured data", () => {
      const error = new StructuredError("CONFIG_NOT_FOUND", "Config missing");
      const data = error.toStructuredData();

      expect(data.code).toBe("CONFIG_NOT_FOUND");
      expect(data.message).toBe("Config missing");
      expect(data.details).toBeUndefined();
      expect(data.suggestion).toBeUndefined();
    });

    it("should return full structured data with all fields", () => {
      const error = new StructuredError("TAG_NOT_FOUND", "Tag 'meetting' not found", {
        details: { tag: "meetting", similar: ["meeting", "meetings"] },
        suggestion: "Did you mean: meeting?",
        example: "tana_tagged({ tag: 'meeting' })",
        docUrl: "https://supertag.dev/docs/tags",
        recovery: { retryable: true, retryWith: { tag: "meeting" } },
      });

      const data = error.toStructuredData();
      expect(data.code).toBe("TAG_NOT_FOUND");
      expect(data.message).toBe("Tag 'meetting' not found");
      expect(data.details).toEqual({ tag: "meetting", similar: ["meeting", "meetings"] });
      expect(data.suggestion).toBe("Did you mean: meeting?");
      expect(data.example).toBe("tana_tagged({ tag: 'meeting' })");
      expect(data.docUrl).toBe("https://supertag.dev/docs/tags");
      expect(data.recovery?.retryable).toBe(true);
      expect(data.recovery?.retryWith).toEqual({ tag: "meeting" });
    });
  });

  describe("toJSON", () => {
    it("should serialize to JSON correctly", () => {
      const error = new StructuredError("API_ERROR", "API failed", {
        details: { endpoint: "/api/test" },
      });
      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(parsed.code).toBe("API_ERROR");
      expect(parsed.message).toBe("API failed");
      expect(parsed.details).toEqual({ endpoint: "/api/test" });
    });
  });
});

describe("createStructuredError", () => {
  it("should create error with code and message", () => {
    const error = createStructuredError("DATABASE_NOT_FOUND", "Database missing");
    expect(error).toBeInstanceOf(StructuredError);
    expect(error.code).toBe("DATABASE_NOT_FOUND");
    expect(error.message).toBe("Database missing");
  });

  it("should auto-populate suggestion from registry", () => {
    const error = createStructuredError("DATABASE_NOT_FOUND", "Database not found");
    expect(error.suggestion).toContain("sync");
  });

  it("should auto-populate docUrl from registry", () => {
    const error = createStructuredError("WORKSPACE_NOT_FOUND", "Workspace not found");
    expect(error.docUrl).toContain("supertag.dev");
  });

  it("should auto-populate retryable from registry", () => {
    const error = createStructuredError("RATE_LIMITED", "Too many requests");
    expect(error.recovery?.retryable).toBe(true);
  });

  it("should allow overriding auto-populated values", () => {
    const error = createStructuredError("DATABASE_NOT_FOUND", "Custom message", {
      suggestion: "Custom suggestion",
    });
    expect(error.suggestion).toBe("Custom suggestion");
  });

  it("should merge recovery info with registry defaults", () => {
    const error = createStructuredError("RATE_LIMITED", "Rate limited", {
      recovery: { retryable: true, retryAfter: 60 },
    });
    expect(error.recovery?.retryable).toBe(true);
    expect(error.recovery?.retryAfter).toBe(60);
  });

  it("should accept cause option", () => {
    const cause = new Error("Original");
    const error = createStructuredError("INTERNAL_ERROR", "Wrapper", { cause });
    expect(error.cause).toBe(cause);
  });
});

describe("enrichError", () => {
  it("should enrich a plain Error with structured data", () => {
    const original = new Error("Something failed");
    const enriched = enrichError(original, "INTERNAL_ERROR");

    expect(enriched).toBeInstanceOf(StructuredError);
    expect(enriched.code).toBe("INTERNAL_ERROR");
    expect(enriched.message).toBe("Something failed");
    expect(enriched.cause).toBe(original);
  });

  it("should preserve original error message", () => {
    const original = new TypeError("Invalid type");
    const enriched = enrichError(original, "INVALID_PARAMETER");

    expect(enriched.message).toBe("Invalid type");
  });

  it("should add details to enriched error", () => {
    const original = new Error("Not found");
    const enriched = enrichError(original, "NODE_NOT_FOUND", {
      details: { nodeId: "abc123" },
    });

    expect(enriched.details).toEqual({ nodeId: "abc123" });
  });

  it("should add recovery info to enriched error", () => {
    const original = new Error("Locked");
    const enriched = enrichError(original, "DATABASE_LOCKED", {
      recovery: { retryable: true, retryAfter: 5 },
    });

    expect(enriched.recovery?.retryable).toBe(true);
    expect(enriched.recovery?.retryAfter).toBe(5);
  });

  it("should handle TanaError subclasses", () => {
    const original = new TanaError("Tana error");
    const enriched = enrichError(original, "API_ERROR");

    expect(enriched).toBeInstanceOf(StructuredError);
    expect(enriched.code).toBe("API_ERROR");
    expect(enriched.cause).toBe(original);
  });

  it("should auto-populate from registry for enriched errors", () => {
    const original = new Error("Rate limit");
    const enriched = enrichError(original, "RATE_LIMITED");

    expect(enriched.recovery?.retryable).toBe(true);
  });
});
