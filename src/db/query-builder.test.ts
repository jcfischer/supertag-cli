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
