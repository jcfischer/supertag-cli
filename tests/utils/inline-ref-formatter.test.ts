/**
 * Tests for Inline Reference Formatter
 * F-001: Fix Inline Reference Truncation
 *
 * Tests the formatInlineRefs utility that handles multiple inline references
 * in field values without truncating to just the first one.
 */

import { describe, it, expect } from "bun:test";
import {
  formatInlineRefs,
  type FormatInlineRefOptions,
} from "../../src/utils/inline-ref-formatter";

describe("formatInlineRefs", () => {
  describe("null/undefined handling", () => {
    it("should return empty string for null input", () => {
      expect(formatInlineRefs(null)).toBe("");
    });

    it("should return empty string for undefined input", () => {
      expect(formatInlineRefs(undefined)).toBe("");
    });

    it("should return fallback for null input when fallback provided", () => {
      expect(formatInlineRefs(null, { fallback: "N/A" })).toBe("N/A");
    });

    it("should return fallback for undefined input when fallback provided", () => {
      expect(formatInlineRefs(undefined, { fallback: "default" })).toBe(
        "default"
      );
    });
  });

  describe("plain text (no references)", () => {
    it("should return plain text unchanged", () => {
      expect(formatInlineRefs("Plain text")).toBe("Plain text");
    });

    it("should return empty string unchanged", () => {
      expect(formatInlineRefs("")).toBe("");
    });

    it("should handle text with special characters", () => {
      expect(formatInlineRefs("Hello, world! @#$%")).toBe("Hello, world! @#$%");
    });
  });

  describe("single node reference", () => {
    it("should format single node reference in bracket mode", () => {
      const input =
        'Hello <span data-inlineref-node="id1">John</span>';
      expect(formatInlineRefs(input)).toBe("Hello [[id1]]");
    });

    it("should format single node reference in display mode", () => {
      const input =
        'Hello <span data-inlineref-node="id1">John</span>';
      expect(formatInlineRefs(input, { nodeRefFormat: "display" })).toBe(
        "Hello John"
      );
    });

    it("should handle node reference at start of string", () => {
      const input = '<span data-inlineref-node="id1">John</span> said hello';
      expect(formatInlineRefs(input)).toBe("[[id1]] said hello");
    });

    it("should handle node reference at end of string", () => {
      const input = 'Hello <span data-inlineref-node="id1">John</span>';
      expect(formatInlineRefs(input)).toBe("Hello [[id1]]");
    });

    it("should handle reference only (no surrounding text)", () => {
      const input = '<span data-inlineref-node="id1">X</span>';
      expect(formatInlineRefs(input)).toBe("[[id1]]");
    });
  });

  describe("multiple node references (the main bug fix)", () => {
    it("should format multiple node references with text between", () => {
      const input =
        'With <span data-inlineref-node="id1">A</span> and <span data-inlineref-node="id2">B</span>';
      expect(formatInlineRefs(input)).toBe("With [[id1]] and [[id2]]");
    });

    it("should format adjacent references (no text between)", () => {
      const input =
        '<span data-inlineref-node="id1">A</span><span data-inlineref-node="id2">B</span>';
      expect(formatInlineRefs(input)).toBe("[[id1]][[id2]]");
    });

    it("should format three or more references", () => {
      const input =
        '<span data-inlineref-node="a">A</span>, <span data-inlineref-node="b">B</span>, <span data-inlineref-node="c">C</span>';
      expect(formatInlineRefs(input)).toBe("[[a]], [[b]], [[c]]");
    });

    it("should preserve all surrounding text with multiple references", () => {
      const input =
        'Reviewed by <span data-inlineref-node="id1">Alice</span>, approved by <span data-inlineref-node="id2">Bob</span>, filed by <span data-inlineref-node="id3">Carol</span>';
      expect(formatInlineRefs(input)).toBe(
        "Reviewed by [[id1]], approved by [[id2]], filed by [[id3]]"
      );
    });

    it("should handle multiple references in display mode", () => {
      const input =
        'With <span data-inlineref-node="id1">Alice</span> and <span data-inlineref-node="id2">Bob</span>';
      expect(formatInlineRefs(input, { nodeRefFormat: "display" })).toBe(
        "With Alice and Bob"
      );
    });
  });

  describe("empty display text", () => {
    it("should handle empty display text in bracket mode", () => {
      const input = '<span data-inlineref-node="id1"></span>';
      expect(formatInlineRefs(input)).toBe("[[id1]]");
    });

    it("should use node ID as fallback in display mode when display text is empty", () => {
      const input = '<span data-inlineref-node="id1"></span>';
      expect(formatInlineRefs(input, { nodeRefFormat: "display" })).toBe("id1");
    });

    it("should handle multiple empty display text references", () => {
      const input =
        '<span data-inlineref-node="id1"></span> and <span data-inlineref-node="id2"></span>';
      expect(formatInlineRefs(input)).toBe("[[id1]] and [[id2]]");
    });
  });

  describe("date references", () => {
    it("should extract date from dateTimeString", () => {
      const input =
        'Due: <span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-14&quot;}">Jan 14</span>';
      expect(formatInlineRefs(input)).toBe("Due: 2026-01-14");
    });

    it("should handle date reference only", () => {
      const input =
        '<span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-14&quot;}">Jan 14</span>';
      expect(formatInlineRefs(input)).toBe("2026-01-14");
    });

    it("should handle multiple date references", () => {
      const input =
        'From <span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-01&quot;}">Jan 1</span> to <span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-31&quot;}">Jan 31</span>';
      expect(formatInlineRefs(input)).toBe("From 2026-01-01 to 2026-01-31");
    });
  });

  describe("mixed node and date references", () => {
    it("should handle mixed node and date references", () => {
      const input =
        '<span data-inlineref-node="id1">Alice</span> by <span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-01&quot;}">Jan 1</span>';
      expect(formatInlineRefs(input)).toBe("[[id1]] by 2026-01-01");
    });

    it("should handle date before node reference", () => {
      const input =
        'On <span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-15&quot;}">Jan 15</span> with <span data-inlineref-node="id1">Bob</span>';
      expect(formatInlineRefs(input)).toBe("On 2026-01-15 with [[id1]]");
    });
  });

  describe("HTML entity handling", () => {
    it("should decode &quot; entities in date JSON", () => {
      const input =
        '<span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-14&quot;}">date</span>';
      expect(formatInlineRefs(input)).toBe("2026-01-14");
    });

    it("should handle &amp; entities", () => {
      // This tests that HTML entities are properly decoded
      const input =
        '<span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-14&quot;&amp;&quot;extra&quot;:&quot;value&quot;}">date</span>';
      expect(formatInlineRefs(input)).toBe("2026-01-14");
    });
  });

  describe("edge cases", () => {
    it("should handle node ID with special characters", () => {
      const input =
        '<span data-inlineref-node="node_123-abc">Text</span>';
      expect(formatInlineRefs(input)).toBe("[[node_123-abc]]");
    });

    it("should handle very long node IDs", () => {
      const longId = "a".repeat(100);
      const input = `<span data-inlineref-node="${longId}">Text</span>`;
      expect(formatInlineRefs(input)).toBe(`[[${longId}]]`);
    });

    it("should handle whitespace in span attributes", () => {
      const input =
        '<span  data-inlineref-node="id1"  >Text</span>';
      expect(formatInlineRefs(input)).toBe("[[id1]]");
    });

    it("should handle extra attributes on span", () => {
      const input =
        '<span class="ref" data-inlineref-node="id1" style="color:blue">Text</span>';
      expect(formatInlineRefs(input)).toBe("[[id1]]");
    });

    it("should not match partial attribute names", () => {
      const input = '<span data-inlineref-node-extra="id1">Text</span>';
      // This should NOT match because the attribute name doesn't match exactly
      expect(formatInlineRefs(input)).toBe(
        '<span data-inlineref-node-extra="id1">Text</span>'
      );
    });

    it("should handle newlines in surrounding text", () => {
      const input =
        'Line 1\n<span data-inlineref-node="id1">Ref</span>\nLine 2';
      expect(formatInlineRefs(input)).toBe("Line 1\n[[id1]]\nLine 2");
    });
  });

  describe("real-world scenarios from GitHub issue #26", () => {
    it("should handle abstract field with multiple references", () => {
      const input =
        'This document describes the relationship between <span data-inlineref-node="abc123">Topic A</span>, <span data-inlineref-node="def456">Topic B</span>, and <span data-inlineref-node="ghi789">Topic C</span> with detailed analysis of their interactions...';
      expect(formatInlineRefs(input)).toBe(
        "This document describes the relationship between [[abc123]], [[def456]], and [[ghi789]] with detailed analysis of their interactions..."
      );
    });

    it("should handle attendees field scenario", () => {
      const input =
        'Meeting with <span data-inlineref-node="abc123">John</span> and <span data-inlineref-node="def456">Jane</span> today';
      expect(formatInlineRefs(input)).toBe(
        "Meeting with [[abc123]] and [[def456]] today"
      );
    });
  });
});
