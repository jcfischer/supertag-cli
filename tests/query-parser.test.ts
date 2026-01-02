/**
 * Tests for Query Parser
 * Spec 063: Unified Query Language
 *
 * TDD: RED phase - write tests first
 */

import { describe, it, expect } from "bun:test";
import { parseQuery, ParseError } from "../src/query/parser";
import type { QueryAST, WhereClause } from "../src/query/types";

describe("Query Parser", () => {
  describe("Basic Find", () => {
    it("should parse 'find task'", () => {
      const ast = parseQuery("find task");
      expect(ast.find).toBe("task");
      expect(ast.where).toBeUndefined();
    });

    it("should parse 'find meeting'", () => {
      const ast = parseQuery("find meeting");
      expect(ast.find).toBe("meeting");
    });

    it("should parse 'find *' for all nodes", () => {
      const ast = parseQuery("find *");
      expect(ast.find).toBe("*");
    });

    it("should be case-insensitive for 'find' keyword", () => {
      const ast = parseQuery("FIND task");
      expect(ast.find).toBe("task");
    });
  });

  describe("Where Clauses", () => {
    it("should parse simple equality", () => {
      const ast = parseQuery("find task where Status = Done");
      expect(ast.where).toHaveLength(1);
      const clause = ast.where![0] as WhereClause;
      expect(clause.field).toBe("Status");
      expect(clause.operator).toBe("=");
      expect(clause.value).toBe("Done");
    });

    it("should parse inequality", () => {
      const ast = parseQuery("find task where Status != Done");
      const clause = ast.where![0] as WhereClause;
      expect(clause.operator).toBe("!=");
    });

    it("should parse greater than", () => {
      const ast = parseQuery("find task where Priority > 2");
      const clause = ast.where![0] as WhereClause;
      expect(clause.operator).toBe(">");
      expect(clause.value).toBe(2);
    });

    it("should parse less than", () => {
      const ast = parseQuery("find task where Score < 100");
      const clause = ast.where![0] as WhereClause;
      expect(clause.operator).toBe("<");
      expect(clause.value).toBe(100);
    });

    it("should parse greater than or equal", () => {
      const ast = parseQuery("find task where Priority >= 3");
      const clause = ast.where![0] as WhereClause;
      expect(clause.operator).toBe(">=");
    });

    it("should parse less than or equal", () => {
      const ast = parseQuery("find task where Priority <= 5");
      const clause = ast.where![0] as WhereClause;
      expect(clause.operator).toBe("<=");
    });

    it("should parse contains operator", () => {
      const ast = parseQuery("find meeting where Attendees ~ John");
      const clause = ast.where![0] as WhereClause;
      expect(clause.operator).toBe("~");
      expect(clause.value).toBe("John");
    });

    it("should parse exists operator", () => {
      const ast = parseQuery("find task where Due exists");
      const clause = ast.where![0] as WhereClause;
      expect(clause.operator).toBe("exists");
      expect(clause.value).toBe(true);
    });

    it("should parse quoted string values", () => {
      const ast = parseQuery('find task where Name = "Q4 Planning"');
      const clause = ast.where![0] as WhereClause;
      expect(clause.value).toBe("Q4 Planning");
    });

    it("should parse multiple AND conditions", () => {
      const ast = parseQuery("find task where Status = Done and Priority > 2");
      expect(ast.where).toHaveLength(2);
    });

    it("should parse negated condition", () => {
      const ast = parseQuery("find task where not Status = Done");
      const clause = ast.where![0] as WhereClause;
      expect(clause.negated).toBe(true);
    });
  });

  describe("Order By", () => {
    it("should parse ascending order", () => {
      const ast = parseQuery("find task order by created");
      expect(ast.orderBy).toEqual({ field: "created", desc: false });
    });

    it("should parse descending order with minus prefix", () => {
      const ast = parseQuery("find task order by -created");
      expect(ast.orderBy).toEqual({ field: "created", desc: true });
    });

    it("should parse order by with field path", () => {
      const ast = parseQuery("find task order by fields.Priority");
      expect(ast.orderBy?.field).toBe("fields.Priority");
    });
  });

  describe("Limit and Offset", () => {
    it("should parse limit", () => {
      const ast = parseQuery("find task limit 20");
      expect(ast.limit).toBe(20);
    });

    it("should parse offset", () => {
      const ast = parseQuery("find task offset 40");
      expect(ast.offset).toBe(40);
    });

    it("should parse both limit and offset", () => {
      const ast = parseQuery("find task limit 20 offset 40");
      expect(ast.limit).toBe(20);
      expect(ast.offset).toBe(40);
    });
  });

  describe("Select", () => {
    it("should parse select with single field", () => {
      const ast = parseQuery("find task select name");
      expect(ast.select).toEqual(["name"]);
    });

    it("should parse select with multiple fields (comma-separated in quotes)", () => {
      // Note: For simplicity, select takes a single identifier or a quoted comma list
      const ast = parseQuery('find task select "name, created, Status"');
      expect(ast.select).toContain("name");
    });
  });

  describe("Complex Queries", () => {
    it("should parse full query with all clauses", () => {
      const ast = parseQuery(
        "find meeting where Attendees ~ John and created > 2025-01-01 order by -created limit 20"
      );
      expect(ast.find).toBe("meeting");
      expect(ast.where).toHaveLength(2);
      expect(ast.orderBy?.desc).toBe(true);
      expect(ast.limit).toBe(20);
    });

    it("should parse query with date values", () => {
      const ast = parseQuery("find task where created > 7d");
      const clause = ast.where![0] as WhereClause;
      expect(clause.value).toBe("7d");
    });

    it("should parse query with ISO date", () => {
      const ast = parseQuery("find task where created > 2025-12-01");
      const clause = ast.where![0] as WhereClause;
      expect(clause.value).toBe("2025-12-01");
    });
  });

  describe("Error Handling", () => {
    it("should throw on missing find keyword", () => {
      expect(() => parseQuery("task")).toThrow(ParseError);
    });

    it("should throw on missing find target", () => {
      expect(() => parseQuery("find")).toThrow(ParseError);
    });

    it("should throw on incomplete where clause", () => {
      expect(() => parseQuery("find task where")).toThrow(ParseError);
    });

    it("should throw on missing operator in where", () => {
      expect(() => parseQuery("find task where Status Done")).toThrow(ParseError);
    });

    it("should throw on missing value after operator", () => {
      expect(() => parseQuery("find task where Status =")).toThrow(ParseError);
    });

    it("should throw on invalid order by", () => {
      expect(() => parseQuery("find task order")).toThrow(ParseError);
    });
  });
});
