/**
 * Enrichment Truncator Tests (F-104 T-3.1)
 *
 * Tests for token estimation and enriched text truncation.
 */

import { describe, it, expect } from "bun:test";
import {
  estimateTokenCount,
  truncateEnrichedText,
} from "../../src/embeddings/enrichment-truncator";

describe("Enrichment Truncator (F-104)", () => {
  describe("estimateTokenCount", () => {
    it("estimates ~1 token per 4 chars", () => {
      expect(estimateTokenCount("abcd")).toBe(1);
      expect(estimateTokenCount("abcdefgh")).toBe(2);
    });

    it("rounds up for partial tokens", () => {
      expect(estimateTokenCount("abc")).toBe(1);
      expect(estimateTokenCount("abcde")).toBe(2);
    });

    it("handles empty string", () => {
      expect(estimateTokenCount("")).toBe(0);
    });
  });

  describe("truncateEnrichedText", () => {
    it("returns text unchanged when under limit", () => {
      const text = "[Type: #meeting] [Date: 2026-02-20] Weekly sync";
      const result = truncateEnrichedText(text, 512);
      expect(result).toBe(text);
    });

    it("preserves type prefix when truncating", () => {
      // Create text that's way over 512 tokens (2048 chars)
      const longName = "A".repeat(2100);
      const text = `[Type: #meeting] [Date: 2026-02-20] ${longName}`;
      const result = truncateEnrichedText(text, 512);

      expect(result).toMatch(/^\[Type: #meeting\]/);
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(512);
    });

    it("removes fields before truncating node name", () => {
      // 512 tokens = 2048 chars
      const longName = "A".repeat(1800);
      const text = `[Type: #meeting] [Date: 2026-02-20] [Attendees: Daniel, Sarah] ${longName}`;
      const result = truncateEnrichedText(text, 512);

      // Should still have type prefix
      expect(result).toMatch(/^\[Type: #meeting\]/);
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(512);
    });

    it("handles text without enrichment format", () => {
      const longText = "B".repeat(3000);
      const result = truncateEnrichedText(longText, 512);

      expect(result.length).toBeLessThanOrEqual(2048); // 512 * 4
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(512);
    });

    it("handles very short maxTokens", () => {
      const text = "[Type: #meeting] Weekly sync";
      const result = truncateEnrichedText(text, 10);
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(10);
    });

    it("keeps all content when it fits exactly", () => {
      // 50 chars = 13 tokens (rounded up)
      const text = "[Type: #m] Hello world this is a test of fitting";
      const tokens = estimateTokenCount(text);
      const result = truncateEnrichedText(text, tokens);
      expect(result).toBe(text);
    });
  });
});
