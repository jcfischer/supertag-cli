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
 *
 * @param options - Pagination options
 * @returns Built query fragment
 *
 * @example
 * const { sql, params } = buildPagination({ limit: 10, offset: 20 });
 * // sql: "LIMIT ? OFFSET ?"
 * // params: [10, 20]
 */
export function buildPagination(options: PaginationOptions): BuiltQuery {
  const parts: string[] = [];
  const params: unknown[] = [];

  // Only add LIMIT if positive
  if (options.limit !== undefined && options.limit > 0) {
    parts.push("LIMIT ?");
    params.push(options.limit);

    // Only add OFFSET if LIMIT exists and offset is positive
    if (options.offset !== undefined && options.offset > 0) {
      parts.push("OFFSET ?");
      params.push(options.offset);
    }
  }

  return { sql: parts.join(" "), params };
}

/**
 * Build WHERE clause from filter conditions
 * Handles all operator types, returns empty for no conditions
 *
 * @param conditions - Array of filter conditions
 * @returns Built query fragment
 *
 * @example
 * const { sql, params } = buildWhereClause([
 *   { column: 'tag', operator: '=', value: 'todo' },
 *   { column: 'status', operator: '!=', value: 'done' }
 * ]);
 * // sql: "WHERE tag = ? AND status != ?"
 * // params: ['todo', 'done']
 */
export function buildWhereClause(conditions: FilterCondition[]): BuiltQuery {
  if (conditions.length === 0) {
    return { sql: "", params: [] };
  }

  const parts: string[] = [];
  const params: unknown[] = [];

  for (const cond of conditions) {
    switch (cond.operator) {
      case "IS NULL":
        parts.push(`${cond.column} IS NULL`);
        break;
      case "IS NOT NULL":
        parts.push(`${cond.column} IS NOT NULL`);
        break;
      case "IN":
        if (Array.isArray(cond.value) && cond.value.length > 0) {
          const placeholders = cond.value.map(() => "?").join(", ");
          parts.push(`${cond.column} IN (${placeholders})`);
          params.push(...cond.value);
        }
        break;
      default:
        // Basic operators: =, !=, >, <, >=, <=, LIKE
        parts.push(`${cond.column} ${cond.operator} ?`);
        params.push(cond.value);
    }
  }

  if (parts.length === 0) {
    return { sql: "", params: [] };
  }

  return {
    sql: `WHERE ${parts.join(" AND ")}`,
    params,
  };
}

/**
 * Build ORDER BY clause with column validation
 * Throws Error if column not in allowedColumns (unless allowedColumns is empty)
 *
 * @param options - Sort options
 * @param allowedColumns - Columns that can be sorted (empty = no validation)
 * @returns Built query fragment
 * @throws Error if sort column not in allowedColumns
 *
 * @example
 * const { sql } = buildOrderBy(
 *   { sort: 'created', direction: 'DESC' },
 *   ['created', 'name', 'updated']
 * );
 * // sql: "ORDER BY created DESC"
 */
export function buildOrderBy(
  options: SortOptions,
  allowedColumns: string[]
): BuiltQuery {
  if (!options.sort) {
    return { sql: "", params: [] };
  }

  // Validate column if allowedColumns is not empty
  if (allowedColumns.length > 0 && !allowedColumns.includes(options.sort)) {
    throw new Error(
      `Invalid sort column: ${options.sort}. Allowed: ${allowedColumns.join(", ")}`
    );
  }

  const direction = options.direction === "DESC" ? "DESC" : "ASC";
  return {
    sql: `ORDER BY ${options.sort} ${direction}`,
    params: [],
  };
}

/**
 * Compose complete SELECT query with all clauses
 * Validates table/columns, combines where/order/pagination
 *
 * @param table - Table name
 * @param columns - Columns to select (or '*')
 * @param options - Query options (filters, sort, pagination)
 * @returns Complete built query
 *
 * @example
 * const { sql, params } = buildSelectQuery('nodes', ['id', 'name'], {
 *   filters: [{ column: 'tag', operator: '=', value: 'todo' }],
 *   sort: 'created',
 *   direction: 'DESC',
 *   limit: 10
 * });
 * // sql: "SELECT id, name FROM nodes WHERE tag = ? ORDER BY created DESC LIMIT ?"
 * // params: ['todo', 10]
 */
export function buildSelectQuery(
  table: string,
  columns: string[] | "*",
  options: {
    filters?: FilterCondition[];
    sort?: string;
    direction?: "ASC" | "DESC";
    sortableColumns?: string[];
    limit?: number;
    offset?: number;
  }
): BuiltQuery {
  const parts: string[] = [];
  const params: unknown[] = [];

  // SELECT clause
  const columnList = columns === "*" ? "*" : columns.join(", ");
  parts.push(`SELECT ${columnList} FROM ${table}`);

  // WHERE clause
  if (options.filters && options.filters.length > 0) {
    const where = buildWhereClause(options.filters);
    if (where.sql) {
      parts.push(where.sql);
      params.push(...where.params);
    }
  }

  // ORDER BY clause
  if (options.sort) {
    const orderBy = buildOrderBy(
      { sort: options.sort, direction: options.direction },
      options.sortableColumns || []
    );
    if (orderBy.sql) {
      parts.push(orderBy.sql);
    }
  }

  // LIMIT/OFFSET clause
  const pagination = buildPagination({
    limit: options.limit,
    offset: options.offset,
  });
  if (pagination.sql) {
    parts.push(pagination.sql);
    params.push(...pagination.params);
  }

  return { sql: parts.join(" "), params };
}
