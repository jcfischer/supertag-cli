/**
 * Tests for AggregationService
 * Spec 064: Aggregation Queries
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { AggregationService } from "../../src/services/aggregation-service";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";

describe("AggregationService", () => {
  describe("constructor", () => {
    it("should instantiate with a database path", () => {
      const service = new AggregationService("/tmp/test.db");
      expect(service).toBeInstanceOf(AggregationService);
    });
  });

  describe("parseGroupBy", () => {
    let service: AggregationService;

    beforeAll(() => {
      service = new AggregationService("/tmp/test.db");
    });

    it("should parse field name as string", () => {
      const result = service.parseGroupBy("Status");
      expect(result).toEqual([{ field: "Status" }]);
    });

    it("should parse time period keywords", () => {
      expect(service.parseGroupBy("day")).toEqual([{ period: "day" }]);
      expect(service.parseGroupBy("week")).toEqual([{ period: "week" }]);
      expect(service.parseGroupBy("month")).toEqual([{ period: "month" }]);
      expect(service.parseGroupBy("quarter")).toEqual([{ period: "quarter" }]);
      expect(service.parseGroupBy("year")).toEqual([{ period: "year" }]);
    });

    it("should parse comma-separated fields", () => {
      const result = service.parseGroupBy("Status,Priority");
      expect(result).toEqual([
        { field: "Status" },
        { field: "Priority" },
      ]);
    });

    it("should parse mixed field and time period", () => {
      const result = service.parseGroupBy("Status,month");
      expect(result).toEqual([
        { field: "Status" },
        { period: "month" },
      ]);
    });

    it("should handle whitespace in comma-separated input", () => {
      const result = service.parseGroupBy("Status, Priority");
      expect(result).toEqual([
        { field: "Status" },
        { field: "Priority" },
      ]);
    });

    it("should return empty array for empty string", () => {
      const result = service.parseGroupBy("");
      expect(result).toEqual([]);
    });
  });

  describe("formatTimePeriod", () => {
    let service: AggregationService;

    beforeAll(() => {
      service = new AggregationService("/tmp/test.db");
    });

    it("should return strftime for day", () => {
      const result = service.formatTimePeriod("day", "created");
      expect(result).toBe("strftime('%Y-%m-%d', created/1000, 'unixepoch')");
    });

    it("should return strftime for week (ISO week)", () => {
      const result = service.formatTimePeriod("week", "created");
      expect(result).toBe("strftime('%Y-W%W', created/1000, 'unixepoch')");
    });

    it("should return strftime for month", () => {
      const result = service.formatTimePeriod("month", "created");
      expect(result).toBe("strftime('%Y-%m', created/1000, 'unixepoch')");
    });

    it("should return strftime for quarter", () => {
      const result = service.formatTimePeriod("quarter", "created");
      // Quarter requires calculation: YYYY-Q1, YYYY-Q2, etc.
      expect(result).toContain("strftime");
      expect(result).toContain("created");
    });

    it("should return strftime for year", () => {
      const result = service.formatTimePeriod("year", "created");
      expect(result).toBe("strftime('%Y', created/1000, 'unixepoch')");
    });

    it("should use updated field when specified", () => {
      const result = service.formatTimePeriod("month", "updated");
      expect(result).toBe("strftime('%Y-%m', updated/1000, 'unixepoch')");
    });
  });
});
