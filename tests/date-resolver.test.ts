/**
 * Tests for Date Resolver
 * Spec 063: Unified Query Language
 *
 * TDD: RED phase - write tests first
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  resolveRelativeDate,
  isRelativeDateValue,
  parseDateValue,
  parseComparisonDate,
  isValidDateValue,
} from "../src/query/date-resolver";

describe("Date Resolver", () => {
  // Mock current time for deterministic tests
  const FIXED_NOW = new Date("2026-01-02T12:00:00Z").getTime();
  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    originalDateNow = Date.now;
    Date.now = () => FIXED_NOW;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  describe("isRelativeDateValue", () => {
    it("should identify 'today'", () => {
      expect(isRelativeDateValue("today")).toBe(true);
    });

    it("should identify 'yesterday'", () => {
      expect(isRelativeDateValue("yesterday")).toBe(true);
    });

    it("should identify day notation (7d)", () => {
      expect(isRelativeDateValue("7d")).toBe(true);
      expect(isRelativeDateValue("1d")).toBe(true);
      expect(isRelativeDateValue("30d")).toBe(true);
    });

    it("should identify week notation (2w)", () => {
      expect(isRelativeDateValue("2w")).toBe(true);
      expect(isRelativeDateValue("1w")).toBe(true);
    });

    it("should identify month notation (3m)", () => {
      expect(isRelativeDateValue("3m")).toBe(true);
      expect(isRelativeDateValue("12m")).toBe(true);
    });

    it("should identify year notation (1y)", () => {
      expect(isRelativeDateValue("1y")).toBe(true);
      expect(isRelativeDateValue("2y")).toBe(true);
    });

    it("should reject ISO dates", () => {
      expect(isRelativeDateValue("2025-01-01")).toBe(false);
      expect(isRelativeDateValue("2025-12-25T10:00:00Z")).toBe(false);
    });

    it("should reject invalid strings", () => {
      expect(isRelativeDateValue("")).toBe(false);
      expect(isRelativeDateValue("abc")).toBe(false);
      expect(isRelativeDateValue("d7")).toBe(false);
      expect(isRelativeDateValue("-7d")).toBe(false);
    });
  });

  describe("resolveRelativeDate", () => {
    it("should resolve 'today' to start of today", () => {
      const result = resolveRelativeDate("today");
      const expected = new Date("2026-01-02T00:00:00Z").getTime();
      // Allow for timezone differences - check it's within the day
      expect(result).toBeGreaterThanOrEqual(expected - 24 * 60 * 60 * 1000);
      expect(result).toBeLessThanOrEqual(expected + 24 * 60 * 60 * 1000);
    });

    it("should resolve 'yesterday' to start of yesterday", () => {
      const result = resolveRelativeDate("yesterday");
      const expected = new Date("2026-01-01T00:00:00Z").getTime();
      expect(result).toBeGreaterThanOrEqual(expected - 24 * 60 * 60 * 1000);
      expect(result).toBeLessThanOrEqual(expected + 24 * 60 * 60 * 1000);
    });

    it("should resolve '7d' to 7 days ago", () => {
      const result = resolveRelativeDate("7d");
      const sevenDaysAgo = FIXED_NOW - 7 * 24 * 60 * 60 * 1000;
      // Should be approximately 7 days ago
      expect(Math.abs(result - sevenDaysAgo)).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("should resolve '2w' to 14 days ago", () => {
      const result = resolveRelativeDate("2w");
      const twoWeeksAgo = FIXED_NOW - 14 * 24 * 60 * 60 * 1000;
      expect(Math.abs(result - twoWeeksAgo)).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("should resolve '1m' to approximately 30 days ago", () => {
      const result = resolveRelativeDate("1m");
      const oneMonthAgo = FIXED_NOW - 30 * 24 * 60 * 60 * 1000;
      // Allow some flexibility for month calculation
      expect(Math.abs(result - oneMonthAgo)).toBeLessThan(5 * 24 * 60 * 60 * 1000);
    });

    it("should resolve '1y' to approximately 365 days ago", () => {
      const result = resolveRelativeDate("1y");
      const oneYearAgo = FIXED_NOW - 365 * 24 * 60 * 60 * 1000;
      // Allow some flexibility for year calculation
      expect(Math.abs(result - oneYearAgo)).toBeLessThan(5 * 24 * 60 * 60 * 1000);
    });

    it("should throw for invalid relative date", () => {
      expect(() => resolveRelativeDate("invalid")).toThrow();
    });
  });

  describe("parseDateValue", () => {
    it("should parse relative dates", () => {
      const result = parseDateValue("7d");
      expect(typeof result).toBe("number");
    });

    it("should parse ISO date strings", () => {
      const result = parseDateValue("2025-01-15");
      const expected = new Date("2025-01-15").getTime();
      expect(result).toBe(expected);
    });

    it("should parse ISO datetime strings", () => {
      const result = parseDateValue("2025-06-15T14:30:00Z");
      const expected = new Date("2025-06-15T14:30:00Z").getTime();
      expect(result).toBe(expected);
    });

    it("should return timestamps as-is", () => {
      const timestamp = 1704153600000;
      const result = parseDateValue(timestamp);
      expect(result).toBe(timestamp);
    });

    it("should throw for invalid date string", () => {
      expect(() => parseDateValue("not-a-date")).toThrow();
    });
  });

  describe("Edge cases", () => {
    it("should handle '0d' as now", () => {
      const result = resolveRelativeDate("0d");
      // 0 days ago should be approximately now (within a day)
      expect(Math.abs(result - FIXED_NOW)).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("should handle large values like '365d'", () => {
      const result = resolveRelativeDate("365d");
      const expected = FIXED_NOW - 365 * 24 * 60 * 60 * 1000;
      expect(Math.abs(result - expected)).toBeLessThan(24 * 60 * 60 * 1000);
    });
  });

  describe("parseComparisonDate", () => {
    it("should parse >7d", () => {
      const result = parseComparisonDate(">7d");
      expect(result).toEqual({ operator: ">", value: "7d" });
    });

    it("should parse <7d", () => {
      const result = parseComparisonDate("<7d");
      expect(result).toEqual({ operator: "<", value: "7d" });
    });

    it("should parse >=7d", () => {
      const result = parseComparisonDate(">=7d");
      expect(result).toEqual({ operator: ">=", value: "7d" });
    });

    it("should parse <=7d", () => {
      const result = parseComparisonDate("<=7d");
      expect(result).toEqual({ operator: "<=", value: "7d" });
    });

    it("should parse >today", () => {
      const result = parseComparisonDate(">today");
      expect(result).toEqual({ operator: ">", value: "today" });
    });

    it("should parse <yesterday", () => {
      const result = parseComparisonDate("<yesterday");
      expect(result).toEqual({ operator: "<", value: "yesterday" });
    });

    it("should parse >=1w", () => {
      const result = parseComparisonDate(">=1w");
      expect(result).toEqual({ operator: ">=", value: "1w" });
    });

    it("should parse <=3m", () => {
      const result = parseComparisonDate("<=3m");
      expect(result).toEqual({ operator: "<=", value: "3m" });
    });

    it("should parse >2025-01-15 (ISO date)", () => {
      const result = parseComparisonDate(">2025-01-15");
      expect(result).toEqual({ operator: ">", value: "2025-01-15" });
    });

    it("should parse <2025-01-15T14:30:00Z (ISO datetime)", () => {
      const result = parseComparisonDate("<2025-01-15T14:30:00Z");
      expect(result).toEqual({ operator: "<", value: "2025-01-15T14:30:00Z" });
    });

    it("should return null for plain values without operator", () => {
      expect(parseComparisonDate("7d")).toBeNull();
      expect(parseComparisonDate("today")).toBeNull();
      expect(parseComparisonDate("2025-01-15")).toBeNull();
    });

    it("should return null for invalid date after operator", () => {
      expect(parseComparisonDate(">invalid")).toBeNull();
      expect(parseComparisonDate("<not-a-date")).toBeNull();
      expect(parseComparisonDate(">=abc")).toBeNull();
    });

    it("should return null for empty value after operator", () => {
      expect(parseComparisonDate(">")).toBeNull();
      expect(parseComparisonDate("<")).toBeNull();
      expect(parseComparisonDate(">=")).toBeNull();
      expect(parseComparisonDate("<=")).toBeNull();
    });

    it("should return null for non-date strings", () => {
      expect(parseComparisonDate("hello")).toBeNull();
      expect(parseComparisonDate("Done")).toBeNull();
      expect(parseComparisonDate("In Progress")).toBeNull();
    });
  });

  describe("isValidDateValue", () => {
    it("should accept relative dates", () => {
      expect(isValidDateValue("7d")).toBe(true);
      expect(isValidDateValue("today")).toBe(true);
      expect(isValidDateValue("yesterday")).toBe(true);
      expect(isValidDateValue("2w")).toBe(true);
      expect(isValidDateValue("3m")).toBe(true);
      expect(isValidDateValue("1y")).toBe(true);
    });

    it("should accept ISO dates", () => {
      expect(isValidDateValue("2025-01-15")).toBe(true);
      expect(isValidDateValue("2025-01-15T14:30:00Z")).toBe(true);
    });

    it("should reject invalid strings", () => {
      expect(isValidDateValue("invalid")).toBe(false);
      expect(isValidDateValue("not-a-date")).toBe(false);
      expect(isValidDateValue("abc")).toBe(false);
    });
  });
});
