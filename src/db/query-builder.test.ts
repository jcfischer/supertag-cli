/**
 * Query Builder Utilities - Tests
 *
 * TDD tests for SQL query builder utilities
 * Spec: 055-query-builder-utilities
 */

import { describe, it, expect } from "bun:test";
import {
  buildPagination,
  buildWhereClause,
  buildOrderBy,
  buildSelectQuery,
  type PaginationOptions,
  type SortOptions,
  type FilterCondition,
  type BuiltQuery,
} from "./query-builder";

// =============================================================================
// T-1.1: Types and Module Structure
// =============================================================================

describe("Query Builder Types", () => {
  it("should export PaginationOptions interface", () => {
    const options: PaginationOptions = { limit: 10, offset: 20 };
    expect(options.limit).toBe(10);
    expect(options.offset).toBe(20);
  });

  it("should export SortOptions interface", () => {
    const options: SortOptions = { sort: "created", direction: "DESC" };
    expect(options.sort).toBe("created");
    expect(options.direction).toBe("DESC");
  });

  it("should export FilterCondition interface", () => {
    const condition: FilterCondition = {
      column: "name",
      operator: "=",
      value: "test",
    };
    expect(condition.column).toBe("name");
    expect(condition.operator).toBe("=");
    expect(condition.value).toBe("test");
  });

  it("should export BuiltQuery interface", () => {
    const query: BuiltQuery = { sql: "SELECT * FROM nodes", params: [] };
    expect(query.sql).toBe("SELECT * FROM nodes");
    expect(query.params).toEqual([]);
  });

  it("should export all builder functions", () => {
    expect(typeof buildPagination).toBe("function");
    expect(typeof buildWhereClause).toBe("function");
    expect(typeof buildOrderBy).toBe("function");
    expect(typeof buildSelectQuery).toBe("function");
  });
});

// =============================================================================
// T-1.2: buildPagination()
// =============================================================================

describe("buildPagination", () => {
  it("should build LIMIT clause only", () => {
    const { sql, params } = buildPagination({ limit: 10 });
    expect(sql).toBe("LIMIT ?");
    expect(params).toEqual([10]);
  });

  it("should build LIMIT and OFFSET", () => {
    const { sql, params } = buildPagination({ limit: 10, offset: 20 });
    expect(sql).toBe("LIMIT ? OFFSET ?");
    expect(params).toEqual([10, 20]);
  });

  it("should return empty for no options", () => {
    const { sql, params } = buildPagination({});
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("should return empty for undefined options", () => {
    const { sql, params } = buildPagination({ limit: undefined, offset: undefined });
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("should ignore zero limit", () => {
    const { sql, params } = buildPagination({ limit: 0 });
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("should ignore negative limit", () => {
    const { sql, params } = buildPagination({ limit: -5 });
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("should ignore zero offset when limit is set", () => {
    const { sql, params } = buildPagination({ limit: 10, offset: 0 });
    expect(sql).toBe("LIMIT ?");
    expect(params).toEqual([10]);
  });

  it("should ignore negative offset", () => {
    const { sql, params } = buildPagination({ limit: 10, offset: -5 });
    expect(sql).toBe("LIMIT ?");
    expect(params).toEqual([10]);
  });

  it("should ignore offset without limit", () => {
    // OFFSET without LIMIT is invalid SQL in most databases
    const { sql, params } = buildPagination({ offset: 20 });
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });
});

// =============================================================================
// T-2.1: buildWhereClause() - basic operators
// =============================================================================

describe("buildWhereClause - basic operators", () => {
  it("should build single = condition", () => {
    const { sql, params } = buildWhereClause([
      { column: "name", operator: "=", value: "test" },
    ]);
    expect(sql).toBe("WHERE name = ?");
    expect(params).toEqual(["test"]);
  });

  it("should build single != condition", () => {
    const { sql, params } = buildWhereClause([
      { column: "status", operator: "!=", value: "deleted" },
    ]);
    expect(sql).toBe("WHERE status != ?");
    expect(params).toEqual(["deleted"]);
  });

  it("should build > condition", () => {
    const { sql, params } = buildWhereClause([
      { column: "created", operator: ">", value: 1000 },
    ]);
    expect(sql).toBe("WHERE created > ?");
    expect(params).toEqual([1000]);
  });

  it("should build < condition", () => {
    const { sql, params } = buildWhereClause([
      { column: "age", operator: "<", value: 30 },
    ]);
    expect(sql).toBe("WHERE age < ?");
    expect(params).toEqual([30]);
  });

  it("should build >= condition", () => {
    const { sql, params } = buildWhereClause([
      { column: "score", operator: ">=", value: 80 },
    ]);
    expect(sql).toBe("WHERE score >= ?");
    expect(params).toEqual([80]);
  });

  it("should build <= condition", () => {
    const { sql, params } = buildWhereClause([
      { column: "priority", operator: "<=", value: 5 },
    ]);
    expect(sql).toBe("WHERE priority <= ?");
    expect(params).toEqual([5]);
  });

  it("should build multiple conditions with AND", () => {
    const { sql, params } = buildWhereClause([
      { column: "tag", operator: "=", value: "todo" },
      { column: "status", operator: "!=", value: "done" },
    ]);
    expect(sql).toBe("WHERE tag = ? AND status != ?");
    expect(params).toEqual(["todo", "done"]);
  });

  it("should return empty for no conditions", () => {
    const { sql, params } = buildWhereClause([]);
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });
});

// =============================================================================
// T-2.2: buildWhereClause() - special operators
// =============================================================================

describe("buildWhereClause - special operators", () => {
  it("should handle LIKE operator", () => {
    const { sql, params } = buildWhereClause([
      { column: "name", operator: "LIKE", value: "%search%" },
    ]);
    expect(sql).toBe("WHERE name LIKE ?");
    expect(params).toEqual(["%search%"]);
  });

  it("should handle IS NULL operator", () => {
    const { sql, params } = buildWhereClause([
      { column: "deleted_at", operator: "IS NULL" },
    ]);
    expect(sql).toBe("WHERE deleted_at IS NULL");
    expect(params).toEqual([]);
  });

  it("should handle IS NOT NULL operator", () => {
    const { sql, params } = buildWhereClause([
      { column: "updated", operator: "IS NOT NULL" },
    ]);
    expect(sql).toBe("WHERE updated IS NOT NULL");
    expect(params).toEqual([]);
  });

  it("should handle IN operator with array", () => {
    const { sql, params } = buildWhereClause([
      { column: "status", operator: "IN", value: ["open", "pending", "review"] },
    ]);
    expect(sql).toBe("WHERE status IN (?, ?, ?)");
    expect(params).toEqual(["open", "pending", "review"]);
  });

  it("should handle IN operator with single value", () => {
    const { sql, params } = buildWhereClause([
      { column: "id", operator: "IN", value: ["abc123"] },
    ]);
    expect(sql).toBe("WHERE id IN (?)");
    expect(params).toEqual(["abc123"]);
  });

  it("should ignore IN operator with empty array", () => {
    const { sql, params } = buildWhereClause([
      { column: "id", operator: "IN", value: [] },
    ]);
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("should combine special and basic operators", () => {
    const { sql, params } = buildWhereClause([
      { column: "name", operator: "LIKE", value: "%test%" },
      { column: "deleted_at", operator: "IS NULL" },
      { column: "created", operator: ">", value: 1000 },
    ]);
    expect(sql).toBe("WHERE name LIKE ? AND deleted_at IS NULL AND created > ?");
    expect(params).toEqual(["%test%", 1000]);
  });

  it("should handle IN with numeric values", () => {
    const { sql, params } = buildWhereClause([
      { column: "priority", operator: "IN", value: [1, 2, 3] },
    ]);
    expect(sql).toBe("WHERE priority IN (?, ?, ?)");
    expect(params).toEqual([1, 2, 3]);
  });
});

// =============================================================================
// T-2.3: buildOrderBy()
// =============================================================================

describe("buildOrderBy", () => {
  it("should build ORDER BY with valid column DESC", () => {
    const { sql, params } = buildOrderBy(
      { sort: "created", direction: "DESC" },
      ["created", "name", "updated"]
    );
    expect(sql).toBe("ORDER BY created DESC");
    expect(params).toEqual([]);
  });

  it("should build ORDER BY with valid column ASC", () => {
    const { sql, params } = buildOrderBy(
      { sort: "name", direction: "ASC" },
      ["created", "name"]
    );
    expect(sql).toBe("ORDER BY name ASC");
    expect(params).toEqual([]);
  });

  it("should default to ASC when direction not specified", () => {
    const { sql, params } = buildOrderBy({ sort: "name" }, ["name"]);
    expect(sql).toBe("ORDER BY name ASC");
    expect(params).toEqual([]);
  });

  it("should return empty when no sort specified", () => {
    const { sql, params } = buildOrderBy({}, ["name", "created"]);
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("should return empty when sort is undefined", () => {
    const { sql, params } = buildOrderBy({ sort: undefined }, ["name"]);
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("should throw on invalid column", () => {
    expect(() =>
      buildOrderBy({ sort: "password" }, ["name", "created"])
    ).toThrow("Invalid sort column: password");
  });

  it("should throw with helpful message listing allowed columns", () => {
    expect(() =>
      buildOrderBy({ sort: "evil_column" }, ["name", "created", "updated"])
    ).toThrow("Allowed: name, created, updated");
  });

  it("should allow any column when allowedColumns is empty", () => {
    // Empty allowedColumns = no validation (opt-out)
    const { sql, params } = buildOrderBy({ sort: "any_column" }, []);
    expect(sql).toBe("ORDER BY any_column ASC");
    expect(params).toEqual([]);
  });
});

// =============================================================================
// T-3.1: buildSelectQuery()
// =============================================================================

describe("buildSelectQuery", () => {
  it("should build simple SELECT *", () => {
    const { sql, params } = buildSelectQuery("nodes", "*", {});
    expect(sql).toBe("SELECT * FROM nodes");
    expect(params).toEqual([]);
  });

  it("should build SELECT with specific columns", () => {
    const { sql, params } = buildSelectQuery("nodes", ["id", "name", "created"], {});
    expect(sql).toBe("SELECT id, name, created FROM nodes");
    expect(params).toEqual([]);
  });

  it("should build SELECT with WHERE clause", () => {
    const { sql, params } = buildSelectQuery("nodes", "*", {
      filters: [{ column: "tag", operator: "=", value: "todo" }],
    });
    expect(sql).toBe("SELECT * FROM nodes WHERE tag = ?");
    expect(params).toEqual(["todo"]);
  });

  it("should build SELECT with ORDER BY", () => {
    const { sql, params } = buildSelectQuery("nodes", "*", {
      sort: "created",
      direction: "DESC",
      sortableColumns: ["created", "name"],
    });
    expect(sql).toBe("SELECT * FROM nodes ORDER BY created DESC");
    expect(params).toEqual([]);
  });

  it("should build SELECT with LIMIT", () => {
    const { sql, params } = buildSelectQuery("nodes", "*", {
      limit: 10,
    });
    expect(sql).toBe("SELECT * FROM nodes LIMIT ?");
    expect(params).toEqual([10]);
  });

  it("should build SELECT with LIMIT and OFFSET", () => {
    const { sql, params } = buildSelectQuery("nodes", "*", {
      limit: 10,
      offset: 20,
    });
    expect(sql).toBe("SELECT * FROM nodes LIMIT ? OFFSET ?");
    expect(params).toEqual([10, 20]);
  });

  it("should build SELECT with all clauses", () => {
    const { sql, params } = buildSelectQuery("nodes", ["id", "name"], {
      filters: [
        { column: "tag", operator: "=", value: "todo" },
        { column: "status", operator: "!=", value: "done" },
      ],
      sort: "created",
      direction: "DESC",
      sortableColumns: ["created", "name"],
      limit: 10,
      offset: 5,
    });
    expect(sql).toBe(
      "SELECT id, name FROM nodes WHERE tag = ? AND status != ? ORDER BY created DESC LIMIT ? OFFSET ?"
    );
    expect(params).toEqual(["todo", "done", 10, 5]);
  });

  it("should skip ORDER BY when sort column not in sortableColumns", () => {
    expect(() =>
      buildSelectQuery("nodes", "*", {
        sort: "password",
        sortableColumns: ["created", "name"],
      })
    ).toThrow("Invalid sort column: password");
  });

  it("should allow any sort column when sortableColumns not provided", () => {
    const { sql, params } = buildSelectQuery("nodes", "*", {
      sort: "any_column",
    });
    expect(sql).toBe("SELECT * FROM nodes ORDER BY any_column ASC");
    expect(params).toEqual([]);
  });

  it("should handle empty filters array", () => {
    const { sql, params } = buildSelectQuery("nodes", "*", {
      filters: [],
      limit: 10,
    });
    expect(sql).toBe("SELECT * FROM nodes LIMIT ?");
    expect(params).toEqual([10]);
  });
});

// =============================================================================
// T-3.2: Integration tests
// =============================================================================

describe("Query Builder Integration", () => {
  it("should be importable from db/index", async () => {
    const { buildPagination, buildWhereClause, buildOrderBy, buildSelectQuery } =
      await import("./index");
    expect(typeof buildPagination).toBe("function");
    expect(typeof buildWhereClause).toBe("function");
    expect(typeof buildOrderBy).toBe("function");
    expect(typeof buildSelectQuery).toBe("function");
  });

  it("should export types correctly", async () => {
    // TypeScript will fail compilation if types aren't exported
    const { buildPagination } = await import("./index");
    const result: { sql: string; params: unknown[] } = buildPagination({ limit: 5 });
    expect(result.sql).toBe("LIMIT ?");
  });

  it("should build complex query matching real-world use case", () => {
    // Simulating a query like findNodesByTag with date filters
    const { sql, params } = buildSelectQuery("nodes", ["id", "name", "created"], {
      filters: [
        { column: "ta.tag_name", operator: "=", value: "todo" },
        { column: "n.created", operator: ">", value: 1704067200000 },
        { column: "n.deleted_at", operator: "IS NULL" },
      ],
      sort: "n.created",
      direction: "DESC",
      sortableColumns: ["n.created", "n.name", "n.updated"],
      limit: 50,
      offset: 0,
    });

    expect(sql).toBe(
      "SELECT id, name, created FROM nodes WHERE ta.tag_name = ? AND n.created > ? AND n.deleted_at IS NULL ORDER BY n.created DESC LIMIT ?"
    );
    expect(params).toEqual(["todo", 1704067200000, 50]);
  });

  it("should handle table aliases in column names", () => {
    const { sql, params } = buildWhereClause([
      { column: "n.name", operator: "LIKE", value: "%test%" },
      { column: "ta.tag_id", operator: "IN", value: ["abc", "def", "ghi"] },
    ]);
    expect(sql).toBe("WHERE n.name LIKE ? AND ta.tag_id IN (?, ?, ?)");
    expect(params).toEqual(["%test%", "abc", "def", "ghi"]);
  });

  it("should produce SQL safe for execution", () => {
    // Verify no SQL injection possible through values
    const maliciousValue = "'; DROP TABLE nodes; --";
    const { sql, params } = buildWhereClause([
      { column: "name", operator: "=", value: maliciousValue },
    ]);
    // Value should be in params, not interpolated in SQL
    expect(sql).toBe("WHERE name = ?");
    expect(params).toEqual([maliciousValue]);
    expect(sql).not.toContain("DROP TABLE");
  });
});
