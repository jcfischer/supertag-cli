/**
 * Tests for Query AST Types
 * Spec 063: Unified Query Language
 *
 * TDD: RED phase - write tests first
 */

import { describe, it, expect } from "bun:test";
import type {
  QueryAST,
  WhereClause,
  WhereGroup,
  QueryOperator,
  QueryValue,
  RelativeDate,
} from "../src/query/types";
import {
  isWhereGroup,
  isWhereClause,
  isRelativeDate,
} from "../src/query/types";

describe("Query AST Types", () => {
  describe("QueryAST", () => {
    it("should represent a basic query with find only", () => {
      const query: QueryAST = {
        find: "task",
      };
      expect(query.find).toBe("task");
      expect(query.where).toBeUndefined();
    });

    it("should represent a query with all options", () => {
      const query: QueryAST = {
        find: "meeting",
        where: [
          { field: "Status", operator: "=", value: "Done" },
        ],
        select: ["name", "created", "fields.Status"],
        orderBy: { field: "created", desc: true },
        limit: 20,
        offset: 10,
      };
      expect(query.find).toBe("meeting");
      expect(query.where).toHaveLength(1);
      expect(query.select).toContain("name");
      expect(query.orderBy?.desc).toBe(true);
      expect(query.limit).toBe(20);
      expect(query.offset).toBe(10);
    });

    it("should support wildcard find", () => {
      const query: QueryAST = {
        find: "*",
        where: [{ field: "name", operator: "~", value: "project" }],
      };
      expect(query.find).toBe("*");
    });
  });

  describe("WhereClause", () => {
    it("should represent equality condition", () => {
      const clause: WhereClause = {
        field: "Status",
        operator: "=",
        value: "Done",
      };
      expect(clause.field).toBe("Status");
      expect(clause.operator).toBe("=");
      expect(clause.value).toBe("Done");
    });

    it("should represent contains condition", () => {
      const clause: WhereClause = {
        field: "Attendees",
        operator: "~",
        value: "John",
      };
      expect(clause.operator).toBe("~");
    });

    it("should represent negated condition", () => {
      const clause: WhereClause = {
        field: "Status",
        operator: "=",
        value: "Done",
        negated: true,
      };
      expect(clause.negated).toBe(true);
    });

    it("should represent exists condition", () => {
      const clause: WhereClause = {
        field: "Due",
        operator: "exists",
        value: true,
      };
      expect(clause.operator).toBe("exists");
    });

    it("should support parent path fields", () => {
      const clause: WhereClause = {
        field: "parent.tags",
        operator: "~",
        value: "project",
      };
      expect(clause.field).toBe("parent.tags");
    });
  });

  describe("WhereGroup", () => {
    it("should represent AND group", () => {
      const group: WhereGroup = {
        type: "and",
        clauses: [
          { field: "Status", operator: "=", value: "Done" },
          { field: "Priority", operator: ">", value: 2 },
        ],
      };
      expect(group.type).toBe("and");
      expect(group.clauses).toHaveLength(2);
    });

    it("should represent OR group", () => {
      const group: WhereGroup = {
        type: "or",
        clauses: [
          { field: "Status", operator: "=", value: "Done" },
          { field: "Status", operator: "=", value: "Active" },
        ],
      };
      expect(group.type).toBe("or");
    });

    it("should support nested groups", () => {
      const group: WhereGroup = {
        type: "and",
        clauses: [
          { field: "created", operator: ">", value: "7d" },
          {
            type: "or",
            clauses: [
              { field: "Status", operator: "=", value: "Done" },
              { field: "Status", operator: "=", value: "Active" },
            ],
          },
        ],
      };
      expect(group.clauses).toHaveLength(2);
      expect((group.clauses[1] as WhereGroup).type).toBe("or");
    });
  });

  describe("QueryOperator", () => {
    it("should include all comparison operators", () => {
      const operators: QueryOperator[] = [
        "=", "!=", ">", "<", ">=", "<=", "~", "contains", "exists",
      ];
      expect(operators).toHaveLength(9);
    });
  });

  describe("QueryValue", () => {
    it("should support string values", () => {
      const value: QueryValue = "Done";
      expect(value).toBe("Done");
    });

    it("should support numeric values", () => {
      const value: QueryValue = 42;
      expect(value).toBe(42);
    });

    it("should support relative date strings", () => {
      const value: QueryValue = "7d";
      expect(value).toBe("7d");
    });

    it("should support array values for IN operator", () => {
      const value: QueryValue = ["a", "b", "c"];
      expect(value).toHaveLength(3);
    });

    it("should support boolean for exists", () => {
      const value: QueryValue = true;
      expect(value).toBe(true);
    });
  });

  describe("RelativeDate", () => {
    it("should support today/yesterday keywords", () => {
      const today: RelativeDate = "today";
      const yesterday: RelativeDate = "yesterday";
      expect(today).toBe("today");
      expect(yesterday).toBe("yesterday");
    });

    it("should support days notation", () => {
      const days: RelativeDate = "7d";
      expect(days).toBe("7d");
    });

    it("should support weeks notation", () => {
      const weeks: RelativeDate = "2w";
      expect(weeks).toBe("2w");
    });

    it("should support months notation", () => {
      const months: RelativeDate = "3m";
      expect(months).toBe("3m");
    });

    it("should support years notation", () => {
      const years: RelativeDate = "1y";
      expect(years).toBe("1y");
    });
  });

  describe("Type Guards", () => {
    it("isWhereGroup should identify WhereGroup", () => {
      const group: WhereGroup = {
        type: "and",
        clauses: [{ field: "Status", operator: "=", value: "Done" }],
      };
      expect(isWhereGroup(group)).toBe(true);
    });

    it("isWhereGroup should reject WhereClause", () => {
      const clause: WhereClause = {
        field: "Status",
        operator: "=",
        value: "Done",
      };
      expect(isWhereGroup(clause)).toBe(false);
    });

    it("isWhereClause should identify WhereClause", () => {
      const clause: WhereClause = {
        field: "Status",
        operator: "=",
        value: "Done",
      };
      expect(isWhereClause(clause)).toBe(true);
    });

    it("isWhereClause should reject WhereGroup", () => {
      const group: WhereGroup = {
        type: "or",
        clauses: [],
      };
      expect(isWhereClause(group)).toBe(false);
    });

    it("isRelativeDate should identify today/yesterday", () => {
      expect(isRelativeDate("today")).toBe(true);
      expect(isRelativeDate("yesterday")).toBe(true);
    });

    it("isRelativeDate should identify duration notation", () => {
      expect(isRelativeDate("7d")).toBe(true);
      expect(isRelativeDate("2w")).toBe(true);
      expect(isRelativeDate("3m")).toBe(true);
      expect(isRelativeDate("1y")).toBe(true);
    });

    it("isRelativeDate should reject invalid values", () => {
      expect(isRelativeDate("Done")).toBe(false);
      expect(isRelativeDate("2025-01-01")).toBe(false);
      expect(isRelativeDate("")).toBe(false);
    });
  });
});
