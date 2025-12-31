/**
 * Query Builder Utilities
 *
 * Type-safe SQL clause builders with parameterized queries.
 * Prevents SQL injection through consistent parameter binding.
 *
 * Spec: 055-query-builder-utilities
 */

/**
 * Pagination options for LIMIT/OFFSET clauses
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Sort options for ORDER BY clauses
 */
export interface SortOptions {
  sort?: string;
  direction?: "ASC" | "DESC";
}

/**
 * Filter condition for WHERE clauses
 * Supports: =, !=, LIKE, IN, IS NULL, IS NOT NULL, >, <, >=, <=
 */
export interface FilterCondition {
  column: string;
  operator:
    | "="
    | "!="
    | "LIKE"
    | "IN"
    | "IS NULL"
    | "IS NOT NULL"
    | ">"
    | "<"
    | ">="
    | "<=";
  value?: unknown;
}

/**
 * Query builder result with parameterized SQL
 * Always returns { sql, params } tuple for safe execution
 */
export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * Build LIMIT/OFFSET clause with parameter binding
 * Validates positive values, ignores zero/negative
 */
export function buildPagination(_options: PaginationOptions): BuiltQuery {
  // Stub - to be implemented in T-1.2
  return { sql: "", params: [] };
}

/**
 * Build WHERE clause from filter conditions
 * Handles all operator types, returns empty for no conditions
 */
export function buildWhereClause(_conditions: FilterCondition[]): BuiltQuery {
  // Stub - to be implemented in T-2.1
  return { sql: "", params: [] };
}

/**
 * Build ORDER BY clause with column validation
 * Throws Error if column not in allowedColumns
 */
export function buildOrderBy(
  _options: SortOptions,
  _allowedColumns: string[]
): BuiltQuery {
  // Stub - to be implemented in T-2.3
  return { sql: "", params: [] };
}

/**
 * Compose complete SELECT query with all clauses
 * Validates table/columns, combines where/order/pagination
 */
export function buildSelectQuery(
  _table: string,
  _columns: string[] | "*",
  _options: {
    filters?: FilterCondition[];
    sort?: string;
    direction?: "ASC" | "DESC";
    sortableColumns?: string[];
    limit?: number;
    offset?: number;
  }
): BuiltQuery {
  // Stub - to be implemented in T-3.1
  return { sql: "", params: [] };
}
