/**
 * Tests for suggestion generator
 * Spec: 073-error-context
 * Task: T-2.2
 */

import { describe, it, expect } from "bun:test";
import {
  generateSuggestion,
  findSimilarValues,
  formatSimilarValuesSuggestion,
} from "../../src/utils/suggestion-generator";
import type { ErrorCode } from "../../src/types/errors";

describe("Suggestion Generator", () => {
  describe("findSimilarValues", () => {
    it("should find similar values using Levenshtein distance", () => {
      const candidates = ["meeting", "meetings", "task", "project"];
      const similar = findSimilarValues("meetting", candidates);

      expect(similar).toContain("meeting");
      expect(similar).toContain("meetings");
    });

    it("should return empty array for no matches", () => {
      const candidates = ["apple", "banana", "cherry"];
      const similar = findSimilarValues("xyz123", candidates);

      expect(similar).toEqual([]);
    });

    it("should respect maxResults option", () => {
      const candidates = ["test1", "test2", "test3", "test4", "test5"];
      const similar = findSimilarValues("test", candidates, { maxResults: 2 });

      expect(similar.length).toBeLessThanOrEqual(2);
    });

    it("should respect threshold option", () => {
      const candidates = ["meeting", "task", "x"];
      // With low threshold, should only match very similar
      const similar = findSimilarValues("meetting", candidates, { threshold: 0.8 });

      expect(similar).toContain("meeting");
      expect(similar).not.toContain("task");
    });

    it("should be case insensitive", () => {
      const candidates = ["Meeting", "TASK", "Project"];
      const similar = findSimilarValues("meeting", candidates);

      expect(similar).toContain("Meeting");
    });

    it("should sort by similarity (best match first)", () => {
      const candidates = ["meetings", "meeting", "meet"];
      const similar = findSimilarValues("meeting", candidates);

      // Exact or closest match should be first
      expect(similar[0]).toBe("meeting");
    });

    it("should include exact matches", () => {
      const candidates = ["meeting", "task", "project"];
      const similar = findSimilarValues("meeting", candidates);

      expect(similar).toContain("meeting");
    });

    it("should handle empty input", () => {
      const candidates = ["meeting", "task"];
      const similar = findSimilarValues("", candidates);

      expect(similar).toEqual([]);
    });

    it("should handle empty candidates", () => {
      const similar = findSimilarValues("meeting", []);

      expect(similar).toEqual([]);
    });
  });

  describe("formatSimilarValuesSuggestion", () => {
    it("should format single suggestion", () => {
      const suggestion = formatSimilarValuesSuggestion(["meeting"]);
      expect(suggestion).toBe("Did you mean: meeting?");
    });

    it("should format multiple suggestions", () => {
      const suggestion = formatSimilarValuesSuggestion(["meeting", "meetings"]);
      expect(suggestion).toBe("Did you mean: meeting, meetings?");
    });

    it("should return undefined for empty array", () => {
      const suggestion = formatSimilarValuesSuggestion([]);
      expect(suggestion).toBeUndefined();
    });

    it("should limit displayed suggestions", () => {
      const many = ["a", "b", "c", "d", "e", "f"];
      const suggestion = formatSimilarValuesSuggestion(many, 3);
      expect(suggestion).toBe("Did you mean: a, b, c?");
    });
  });

  describe("generateSuggestion", () => {
    it("should return default suggestion for code without context", () => {
      const suggestion = generateSuggestion("CONFIG_NOT_FOUND");
      expect(suggestion).toContain("supertag config");
    });

    it("should include similar tags for TAG_NOT_FOUND", () => {
      const suggestion = generateSuggestion("TAG_NOT_FOUND", {
        tag: "meetting",
        availableTags: ["meeting", "meetings", "task"],
      });
      expect(suggestion).toContain("Did you mean");
      expect(suggestion).toContain("meeting");
    });

    it("should include available workspaces for WORKSPACE_NOT_FOUND", () => {
      const suggestion = generateSuggestion("WORKSPACE_NOT_FOUND", {
        workspace: "boks",
        availableWorkspaces: ["books", "main", "work"],
      });
      expect(suggestion).toContain("Did you mean");
      expect(suggestion).toContain("books");
    });

    it("should suggest sync for DATABASE_NOT_FOUND", () => {
      const suggestion = generateSuggestion("DATABASE_NOT_FOUND");
      expect(suggestion).toContain("sync");
    });

    it("should include retry info for RATE_LIMITED", () => {
      const suggestion = generateSuggestion("RATE_LIMITED", {
        retryAfter: 30,
      });
      expect(suggestion).toContain("30");
    });

    it("should include field path for validation errors", () => {
      const suggestion = generateSuggestion("INVALID_FORMAT", {
        field: "fields.Due",
        expected: "YYYY-MM-DD",
      });
      expect(suggestion).toContain("Due");
      expect(suggestion).toContain("YYYY-MM-DD");
    });

    it("should handle NODE_NOT_FOUND with similar nodes", () => {
      const suggestion = generateSuggestion("NODE_NOT_FOUND", {
        query: "projct",
        similarNodes: ["project", "projects"],
      });
      expect(suggestion).toContain("Did you mean");
      expect(suggestion).toContain("project");
    });

    it("should return undefined for unknown code without details", () => {
      const suggestion = generateSuggestion("INTERNAL_ERROR" as ErrorCode);
      // INTERNAL_ERROR has no default suggestion in registry
      expect(suggestion).toBeUndefined();
    });

    it("should combine default suggestion with context-specific hint", () => {
      const suggestion = generateSuggestion("WORKSPACE_NOT_FOUND", {
        workspace: "boks",
        availableWorkspaces: ["books"],
      });
      // Should have both the fuzzy match and the default suggestion
      expect(suggestion).toContain("books");
    });
  });
});
