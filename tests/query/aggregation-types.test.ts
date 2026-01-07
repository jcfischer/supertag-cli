/**
 * Tests for Aggregation Query Types
 * Spec 064: Aggregation Queries
 */

import { describe, it, expect } from "bun:test";
import type {
  AggregateAST,
  GroupBySpec,
  AggregateFunction,
  AggregateResult,
  TimePeriod,
} from "../../src/query/types";
import {
  isTimePeriod,
  isGroupByField,
  isGroupByTime,
} from "../../src/query/types";

describe("Aggregation Types", () => {
  describe("TimePeriod", () => {
    it("should validate valid time periods", () => {
      expect(isTimePeriod("day")).toBe(true);
      expect(isTimePeriod("week")).toBe(true);
      expect(isTimePeriod("month")).toBe(true);
      expect(isTimePeriod("quarter")).toBe(true);
      expect(isTimePeriod("year")).toBe(true);
    });

    it("should reject invalid time periods", () => {
      expect(isTimePeriod("hour")).toBe(false);
      expect(isTimePeriod("minute")).toBe(false);
      expect(isTimePeriod("invalid")).toBe(false);
      expect(isTimePeriod("")).toBe(false);
    });
  });

  describe("GroupBySpec", () => {
    it("should identify field-based grouping", () => {
      const fieldSpec: GroupBySpec = { field: "Status" };
      expect(isGroupByField(fieldSpec)).toBe(true);
      expect(isGroupByTime(fieldSpec)).toBe(false);
    });

    it("should identify time-based grouping", () => {
      const timeSpec: GroupBySpec = { period: "month", dateField: "created" };
      expect(isGroupByTime(timeSpec)).toBe(true);
      expect(isGroupByField(timeSpec)).toBe(false);
    });

    it("should support field grouping with time period", () => {
      // Field grouping that happens to be a date field
      const spec: GroupBySpec = { field: "DueDate", period: "month" };
      expect(isGroupByField(spec)).toBe(true);
      expect(spec.period).toBe("month");
    });
  });

  describe("AggregateFunction", () => {
    it("should support count function", () => {
      const fn: AggregateFunction = { fn: "count" };
      expect(fn.fn).toBe("count");
      expect(fn.field).toBeUndefined();
    });

    it("should support sum function with field", () => {
      const fn: AggregateFunction = { fn: "sum", field: "Amount" };
      expect(fn.fn).toBe("sum");
      expect(fn.field).toBe("Amount");
    });

    it("should support alias for results", () => {
      const fn: AggregateFunction = { fn: "avg", field: "Score", alias: "average_score" };
      expect(fn.alias).toBe("average_score");
    });
  });

  describe("AggregateAST", () => {
    it("should extend QueryAST with aggregation fields", () => {
      const ast: AggregateAST = {
        find: "task",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
      };

      expect(ast.find).toBe("task");
      expect(ast.groupBy).toHaveLength(1);
      expect(ast.aggregate).toHaveLength(1);
    });

    it("should support optional showPercent and top", () => {
      const ast: AggregateAST = {
        find: "task",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        showPercent: true,
        top: 10,
      };

      expect(ast.showPercent).toBe(true);
      expect(ast.top).toBe(10);
    });

    it("should support multiple group-by fields", () => {
      const ast: AggregateAST = {
        find: "task",
        groupBy: [
          { field: "Status" },
          { field: "Priority" },
        ],
        aggregate: [{ fn: "count" }],
      };

      expect(ast.groupBy).toHaveLength(2);
    });

    it("should support time-based grouping", () => {
      const ast: AggregateAST = {
        find: "meeting",
        groupBy: [{ period: "month", dateField: "created" }],
        aggregate: [{ fn: "count" }],
      };

      expect(ast.groupBy[0].period).toBe("month");
      expect(ast.groupBy[0].dateField).toBe("created");
    });
  });

  describe("AggregateResult", () => {
    it("should have required fields", () => {
      const result: AggregateResult = {
        total: 100,
        groupCount: 5,
        groups: {
          "Done": 50,
          "In Progress": 30,
          "Open": 20,
        },
      };

      expect(result.total).toBe(100);
      expect(result.groupCount).toBe(5);
      expect(result.groups["Done"]).toBe(50);
    });

    it("should support nested groups for two-level grouping", () => {
      const result: AggregateResult = {
        total: 100,
        groupCount: 3,
        groups: {
          "Done": { "High": 10, "Medium": 25, "Low": 15 },
          "In Progress": { "High": 5, "Medium": 15, "Low": 10 },
          "Open": { "High": 2, "Medium": 10, "Low": 8 },
        },
      };

      expect((result.groups["Done"] as Record<string, number>)["High"]).toBe(10);
    });

    it("should support optional percentages", () => {
      const result: AggregateResult = {
        total: 100,
        groupCount: 3,
        groups: { "Done": 50, "In Progress": 30, "Open": 20 },
        percentages: { "Done": 50, "In Progress": 30, "Open": 20 },
      };

      expect(result.percentages?.["Done"]).toBe(50);
    });

    it("should support optional warning", () => {
      const result: AggregateResult = {
        total: 1000,
        groupCount: 100,
        groups: {},
        warning: "Results capped at 100 groups",
      };

      expect(result.warning).toBe("Results capped at 100 groups");
    });
  });
});
