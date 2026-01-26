/**
 * Tests for Search Filter Functions
 */

import { describe, it, expect } from "bun:test";
import {
  filterByTag,
  isReferenceSyntax,
  type EnrichedSearchResult,
} from "../src/embeddings/search-filter";

describe("Search Filter", () => {
  describe("filterByTag", () => {
    const mockResults: EnrichedSearchResult[] = [
      { nodeId: "1", name: "Project Alpha", tags: ["project"], distance: 0.1, similarity: 0.9 },
      { nodeId: "2", name: "Meeting Notes", tags: ["meeting", "note"], distance: 0.2, similarity: 0.8 },
      { nodeId: "3", name: "Project Beta", tags: ["project", "important"], distance: 0.3, similarity: 0.7 },
      { nodeId: "4", name: "Random Note", tags: ["note"], distance: 0.4, similarity: 0.6 },
      { nodeId: "5", name: "Untagged Item", tags: undefined, distance: 0.5, similarity: 0.5 },
    ];

    it("should filter to only nodes with the specified tag", () => {
      const results = filterByTag(mockResults, "project");
      expect(results).toHaveLength(2);
      expect(results.map(r => r.nodeId)).toEqual(["1", "3"]);
    });

    it("should be case-insensitive", () => {
      const results = filterByTag(mockResults, "PROJECT");
      expect(results).toHaveLength(2);
      expect(results.map(r => r.nodeId)).toEqual(["1", "3"]);
    });

    it("should handle nodes with multiple tags", () => {
      const results = filterByTag(mockResults, "note");
      expect(results).toHaveLength(2);
      expect(results.map(r => r.nodeId)).toEqual(["2", "4"]);
    });

    it("should return empty array when no nodes match", () => {
      const results = filterByTag(mockResults, "nonexistent");
      expect(results).toHaveLength(0);
    });

    it("should exclude nodes with undefined tags", () => {
      const results = filterByTag(mockResults, "project");
      expect(results.find(r => r.nodeId === "5")).toBeUndefined();
    });

    it("should preserve similarity order", () => {
      const results = filterByTag(mockResults, "project");
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    });
  });

  describe("isReferenceSyntax", () => {
    it("should detect reference syntax", () => {
      expect(isReferenceSyntax("[[Some Reference]]")).toBe(true);
      expect(isReferenceSyntax("Text with [[reference]] inside")).toBe(true);
    });

    it("should not flag normal text", () => {
      expect(isReferenceSyntax("Normal text")).toBe(false);
      expect(isReferenceSyntax("Text with [single brackets]")).toBe(false);
    });
  });
});
