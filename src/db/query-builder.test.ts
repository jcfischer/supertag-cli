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
