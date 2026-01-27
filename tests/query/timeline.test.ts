/**
 * Tests for Timeline Query Infrastructure
 * Spec: 066-timeline-queries
 */

import { describe, it, expect } from "bun:test";
import {
  getBucketKey,
  getBucketRange,
  generateBucketKeys,
  parsePeriodToMs,
  resolveTimelineRange,
  formatTimestamp,
  VALID_GRANULARITIES,
  type TimeGranularity,
} from "../../src/query/timeline";

describe("Timeline Query Infrastructure", () => {
  describe("parsePeriodToMs", () => {
    it("parses hours", () => {
      expect(parsePeriodToMs("1h")).toBe(60 * 60 * 1000);
      expect(parsePeriodToMs("24h")).toBe(24 * 60 * 60 * 1000);
    });

    it("parses days", () => {
      expect(parsePeriodToMs("1d")).toBe(24 * 60 * 60 * 1000);
      expect(parsePeriodToMs("7d")).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parsePeriodToMs("30d")).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it("parses weeks", () => {
      expect(parsePeriodToMs("1w")).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parsePeriodToMs("2w")).toBe(14 * 24 * 60 * 60 * 1000);
    });

    it("parses months (approximate)", () => {
      expect(parsePeriodToMs("1m")).toBe(30 * 24 * 60 * 60 * 1000);
      expect(parsePeriodToMs("3m")).toBe(90 * 24 * 60 * 60 * 1000);
    });

    it("parses years (approximate)", () => {
      expect(parsePeriodToMs("1y")).toBe(365 * 24 * 60 * 60 * 1000);
    });

    it("throws on invalid format", () => {
      expect(() => parsePeriodToMs("abc")).toThrow(/Invalid period format/);
      expect(() => parsePeriodToMs("7")).toThrow(/Invalid period format/);
      expect(() => parsePeriodToMs("d")).toThrow(/Invalid period format/);
      expect(() => parsePeriodToMs("")).toThrow(/Invalid period format/);
    });
  });

  describe("getBucketKey", () => {
    const testDate = new Date("2025-06-15T14:30:45Z").getTime();

    it("generates hour bucket key", () => {
      const key = getBucketKey(testDate, "hour");
      expect(key).toBe("2025-06-15T14:00:00");
    });

    it("generates day bucket key", () => {
      const key = getBucketKey(testDate, "day");
      expect(key).toBe("2025-06-15");
    });

    it("generates week bucket key (ISO format)", () => {
      const key = getBucketKey(testDate, "week");
      expect(key).toMatch(/^\d{4}-W\d{2}$/);
      expect(key).toBe("2025-W24");
    });

    it("generates month bucket key", () => {
      const key = getBucketKey(testDate, "month");
      expect(key).toBe("2025-06");
    });

    it("generates quarter bucket key", () => {
      const key = getBucketKey(testDate, "quarter");
      expect(key).toBe("2025-Q2");
    });

    it("generates year bucket key", () => {
      const key = getBucketKey(testDate, "year");
      expect(key).toBe("2025");
    });

    it("handles edge cases for quarters", () => {
      expect(getBucketKey(new Date("2025-01-15").getTime(), "quarter")).toBe("2025-Q1");
      expect(getBucketKey(new Date("2025-04-15").getTime(), "quarter")).toBe("2025-Q2");
      expect(getBucketKey(new Date("2025-07-15").getTime(), "quarter")).toBe("2025-Q3");
      expect(getBucketKey(new Date("2025-10-15").getTime(), "quarter")).toBe("2025-Q4");
    });
  });

  describe("getBucketRange", () => {
    it("returns hour range", () => {
      const range = getBucketRange("2025-06-15T14:00:00", "hour");
      expect(range.start).toBe("2025-06-15T14:00:00");
      expect(range.end).toBe("2025-06-15T14:59:59");
    });

    it("returns day range", () => {
      const range = getBucketRange("2025-06-15", "day");
      expect(range.start).toBe("2025-06-15");
      expect(range.end).toBe("2025-06-15");
    });

    it("returns week range", () => {
      const range = getBucketRange("2025-W24", "week");
      expect(range.start).toBe("2025-06-09"); // Monday of week 24
      expect(range.end).toBe("2025-06-15"); // Sunday of week 24
    });

    it("returns month range", () => {
      const range = getBucketRange("2025-06", "month");
      expect(range.start).toBe("2025-06-01");
      expect(range.end).toBe("2025-06-30");
    });

    it("returns quarter range", () => {
      const range = getBucketRange("2025-Q2", "quarter");
      expect(range.start).toBe("2025-04-01");
      expect(range.end).toBe("2025-06-30");
    });

    it("returns year range", () => {
      const range = getBucketRange("2025", "year");
      expect(range.start).toBe("2025-01-01");
      expect(range.end).toBe("2025-12-31");
    });

    it("handles February correctly", () => {
      // Non-leap year
      const range2025 = getBucketRange("2025-02", "month");
      expect(range2025.end).toBe("2025-02-28");

      // Leap year
      const range2024 = getBucketRange("2024-02", "month");
      expect(range2024.end).toBe("2024-02-29");
    });
  });

  describe("generateBucketKeys", () => {
    it("generates day keys for a week", () => {
      const from = new Date("2025-06-09T00:00:00Z").getTime();
      const to = new Date("2025-06-15T23:59:59Z").getTime();
      const keys = generateBucketKeys(from, to, "day");

      expect(keys).toEqual([
        "2025-06-09",
        "2025-06-10",
        "2025-06-11",
        "2025-06-12",
        "2025-06-13",
        "2025-06-14",
        "2025-06-15",
      ]);
    });

    it("generates week keys for a month", () => {
      const from = new Date("2025-06-01T00:00:00Z").getTime();
      const to = new Date("2025-06-30T23:59:59Z").getTime();
      const keys = generateBucketKeys(from, to, "week");

      expect(keys.length).toBeGreaterThanOrEqual(4);
      expect(keys.length).toBeLessThanOrEqual(6);
      keys.forEach((key) => {
        expect(key).toMatch(/^\d{4}-W\d{2}$/);
      });
    });

    it("generates month keys for a year", () => {
      const from = new Date("2025-01-01T00:00:00Z").getTime();
      const to = new Date("2025-12-31T23:59:59Z").getTime();
      const keys = generateBucketKeys(from, to, "month");

      expect(keys).toEqual([
        "2025-01",
        "2025-02",
        "2025-03",
        "2025-04",
        "2025-05",
        "2025-06",
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
      ]);
    });

    it("generates quarter keys for a year", () => {
      const from = new Date("2025-01-01T00:00:00Z").getTime();
      const to = new Date("2025-12-31T23:59:59Z").getTime();
      const keys = generateBucketKeys(from, to, "quarter");

      expect(keys).toEqual(["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]);
    });

    it("handles single bucket range", () => {
      const from = new Date("2025-06-15T10:00:00Z").getTime();
      const to = new Date("2025-06-15T18:00:00Z").getTime();
      const keys = generateBucketKeys(from, to, "day");

      expect(keys).toEqual(["2025-06-15"]);
    });
  });

  describe("resolveTimelineRange", () => {
    it("defaults to last 30 days", () => {
      const result = resolveTimelineRange({});
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

      // Allow 1 second tolerance for test execution time
      expect(result.toTs).toBeGreaterThanOrEqual(now - 1000);
      expect(result.toTs).toBeLessThanOrEqual(now + 1000);
      expect(result.fromTs).toBeGreaterThanOrEqual(thirtyDaysAgo - 1000);
      expect(result.fromTs).toBeLessThanOrEqual(thirtyDaysAgo + 1000);
      expect(result.warnings).toEqual([]);
    });

    it("swaps from/to if from is after to", () => {
      const result = resolveTimelineRange({
        from: "2025-06-30",
        to: "2025-06-01",
      });

      expect(result.fromTs).toBeLessThan(result.toTs);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("swapped");
    });

    it("clamps future dates to now", () => {
      const result = resolveTimelineRange({
        to: "2099-12-31",
      });

      const now = Date.now();
      expect(result.toTs).toBeLessThanOrEqual(now + 1000);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("future");
    });
  });

  describe("formatTimestamp", () => {
    it("formats valid timestamp", () => {
      const ts = new Date("2025-06-15T14:30:45Z").getTime();
      expect(formatTimestamp(ts)).toBe("2025-06-15T14:30:45.000Z");
    });

    it("returns undefined for null", () => {
      expect(formatTimestamp(null)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
      expect(formatTimestamp(undefined)).toBeUndefined();
    });
  });

  describe("VALID_GRANULARITIES", () => {
    it("contains all expected granularities", () => {
      expect(VALID_GRANULARITIES).toContain("hour");
      expect(VALID_GRANULARITIES).toContain("day");
      expect(VALID_GRANULARITIES).toContain("week");
      expect(VALID_GRANULARITIES).toContain("month");
      expect(VALID_GRANULARITIES).toContain("quarter");
      expect(VALID_GRANULARITIES).toContain("year");
      expect(VALID_GRANULARITIES.length).toBe(6);
    });
  });
});
