---
id: "055"
feature: "Query Builder Utilities"
status: "completed"
created: "2025-12-30"
completed: "2025-12-31"
priority: "medium"
---

# Specification: Query Builder Utilities

**Priority**: Medium (~180 LOC saved, improved SQL consistency)

## Overview

This specification defines shared query builder utilities to reduce SQL construction duplication across commands and services. Common query patterns (pagination, filtering, sorting) will be centralized in reusable builder functions.

## Problem Statement

### Current State: Duplicated SQL Construction

SQL query building is scattered across multiple files with similar patterns:

```typescript
// Pattern 1: Pagination (repeated ~10 times)
const limitClause = options.limit ? `LIMIT ${options.limit}` : '';
const offsetClause = options.offset ? `OFFSET ${options.offset}` : '';
const query = `SELECT * FROM nodes ${limitClause} ${offsetClause}`;

// Pattern 2: Conditional WHERE clauses (repeated ~15 times)
const conditions: string[] = [];
if (options.tag) conditions.push(`tag = '${options.tag}'`);
if (options.type) conditions.push(`type = '${options.type}'`);
const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

// Pattern 3: ORDER BY handling (repeated ~8 times)
const sortColumn = options.sort || 'created';
const sortDirection = options.desc ? 'DESC' : 'ASC';
const orderClause = `ORDER BY ${sortColumn} ${sortDirection}`;
```

### Duplication Statistics

- **~180 lines** of duplicated SQL building
- **~33 instances** of similar patterns
- **No parameterization** in some cases (SQL injection risk)
- **Inconsistent NULL handling** across queries

### Issues

1. **SQL injection risk** - String interpolation without parameterization
2. **Inconsistent pagination** - Different limit/offset handling
3. **Duplicated WHERE building** - Same condition logic repeated
4. **Hard to maintain** - Bug fixes must be applied in multiple places

## Proposed Solution

### New Module: `src/db/query-builder.ts`

Reusable, type-safe query building utilities:

1. `buildPagination()` - Safe LIMIT/OFFSET clause
2. `buildWhereClause()` - Conditional WHERE with parameters
3. `buildOrderBy()` - Sort column validation and direction
4. `buildSelectQuery()` - Combine all clauses safely

## Interface Design

### Core Types

```typescript
/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Sort options
 */
export interface SortOptions {
  sort?: string;
  direction?: 'ASC' | 'DESC';
}

/**
 * Filter condition
 */
export interface FilterCondition {
  column: string;
  operator: '=' | '!=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL' | '>' | '<' | '>=' | '<=';
  value?: unknown;
}

/**
 * Query builder result with parameterized SQL
 */
export interface BuiltQuery {
  sql: string;
  params: unknown[];
}
```

### buildPagination()

```typescript
/**
 * Build pagination clause with parameter binding
 *
 * @param options - Pagination options
 * @returns Built query fragment
 *
 * @example
 * const { sql, params } = buildPagination({ limit: 10, offset: 20 });
 * // sql: "LIMIT ? OFFSET ?"
 * // params: [10, 20]
 *
 * @example
 * const { sql, params } = buildPagination({ limit: 10 });
 * // sql: "LIMIT ?"
 * // params: [10]
 *
 * @example
 * const { sql, params } = buildPagination({});
 * // sql: ""
 * // params: []
 */
export function buildPagination(options: PaginationOptions): BuiltQuery;
```

### buildWhereClause()

```typescript
/**
 * Build WHERE clause from filter conditions
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
 *
 * @example
 * const { sql, params } = buildWhereClause([
 *   { column: 'name', operator: 'LIKE', value: '%search%' },
 *   { column: 'deleted_at', operator: 'IS NULL' }
 * ]);
 * // sql: "WHERE name LIKE ? AND deleted_at IS NULL"
 * // params: ['%search%']
 */
export function buildWhereClause(conditions: FilterCondition[]): BuiltQuery;
```

### buildOrderBy()

```typescript
/**
 * Build ORDER BY clause with column validation
 *
 * @param options - Sort options
 * @param allowedColumns - Columns that can be sorted
 * @returns Built query fragment
 * @throws Error if sort column not in allowedColumns
 *
 * @example
 * const { sql } = buildOrderBy(
 *   { sort: 'created', direction: 'DESC' },
 *   ['created', 'name', 'updated']
 * );
 * // sql: "ORDER BY created DESC"
 *
 * @example
 * // Throws if invalid column
 * buildOrderBy({ sort: 'password' }, ['name', 'created']);
 * // Error: Invalid sort column: password
 */
export function buildOrderBy(
  options: SortOptions,
  allowedColumns: string[]
): BuiltQuery;
```

### buildSelectQuery()

```typescript
/**
 * Build a complete SELECT query with all clauses
 *
 * @param table - Table name
 * @param columns - Columns to select (or '*')
 * @param options - Query options
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
  columns: string[] | '*',
  options: {
    filters?: FilterCondition[];
    sort?: string;
    direction?: 'ASC' | 'DESC';
    sortableColumns?: string[];
    limit?: number;
    offset?: number;
  }
): BuiltQuery;
```

## Implementation Details

### buildPagination Implementation

```typescript
export function buildPagination(options: PaginationOptions): BuiltQuery {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (options.limit !== undefined && options.limit > 0) {
    parts.push('LIMIT ?');
    params.push(options.limit);
  }

  if (options.offset !== undefined && options.offset > 0) {
    parts.push('OFFSET ?');
    params.push(options.offset);
  }

  return { sql: parts.join(' '), params };
}
```

### buildWhereClause Implementation

```typescript
export function buildWhereClause(conditions: FilterCondition[]): BuiltQuery {
  if (conditions.length === 0) {
    return { sql: '', params: [] };
  }

  const parts: string[] = [];
  const params: unknown[] = [];

  for (const cond of conditions) {
    switch (cond.operator) {
      case 'IS NULL':
        parts.push(`${cond.column} IS NULL`);
        break;
      case 'IS NOT NULL':
        parts.push(`${cond.column} IS NOT NULL`);
        break;
      case 'IN':
        if (Array.isArray(cond.value) && cond.value.length > 0) {
          const placeholders = cond.value.map(() => '?').join(', ');
          parts.push(`${cond.column} IN (${placeholders})`);
          params.push(...cond.value);
        }
        break;
      default:
        parts.push(`${cond.column} ${cond.operator} ?`);
        params.push(cond.value);
    }
  }

  return {
    sql: `WHERE ${parts.join(' AND ')}`,
    params,
  };
}
```

### buildOrderBy Implementation

```typescript
export function buildOrderBy(
  options: SortOptions,
  allowedColumns: string[]
): BuiltQuery {
  if (!options.sort) {
    return { sql: '', params: [] };
  }

  // Validate column to prevent SQL injection
  if (!allowedColumns.includes(options.sort)) {
    throw new Error(
      `Invalid sort column: ${options.sort}. Allowed: ${allowedColumns.join(', ')}`
    );
  }

  const direction = options.direction === 'DESC' ? 'DESC' : 'ASC';
  return {
    sql: `ORDER BY ${options.sort} ${direction}`,
    params: [],
  };
}
```

## Migration Targets

### Files to Update

| File | Current Pattern | New Pattern |
|------|-----------------|-------------|
| `src/commands/search.ts` | Manual string building | `buildSelectQuery()` |
| `src/commands/nodes.ts` | Manual string building | `buildSelectQuery()` |
| `src/commands/tags.ts` | Manual WHERE building | `buildWhereClause()` |
| `src/db/query-engine.ts` | Complex query building | Use builder utilities |
| `src/mcp/tools/query.ts` | Manual pagination | `buildPagination()` |
| `src/mcp/tools/search.ts` | Manual LIMIT/OFFSET | `buildPagination()` |

### Before/After Example

**Before** (in query-engine.ts):
```typescript
getNodesByTag(tag: string, options: { limit?: number; sort?: string }) {
  const conditions: string[] = [];
  conditions.push(`t.name = '${tag}'`);  // SQL injection risk!

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const sortCol = options.sort || 'created';
  const orderClause = `ORDER BY ${sortCol} DESC`;
  const limitClause = options.limit ? `LIMIT ${options.limit}` : '';

  const query = `
    SELECT n.* FROM nodes n
    JOIN tag_applications ta ON n.id = ta.node_id
    JOIN tags t ON ta.tag_id = t.id
    ${whereClause}
    ${orderClause}
    ${limitClause}
  `;

  return this.db.query(query).all();
}
```

**After**:
```typescript
getNodesByTag(tag: string, options: { limit?: number; sort?: string }) {
  const { sql: whereClause, params: whereParams } = buildWhereClause([
    { column: 't.name', operator: '=', value: tag }
  ]);

  const { sql: orderClause } = buildOrderBy(
    { sort: options.sort || 'created', direction: 'DESC' },
    ['created', 'name', 'updated']
  );

  const { sql: limitClause, params: limitParams } = buildPagination({
    limit: options.limit
  });

  const query = `
    SELECT n.* FROM nodes n
    JOIN tag_applications ta ON n.id = ta.node_id
    JOIN tags t ON ta.tag_id = t.id
    ${whereClause}
    ${orderClause}
    ${limitClause}
  `;

  return this.db.query(query).all(...whereParams, ...limitParams);
}
```

## Testing Strategy

### Unit Tests

```typescript
describe('buildPagination', () => {
  it('should build LIMIT clause', () => {
    const { sql, params } = buildPagination({ limit: 10 });
    expect(sql).toBe('LIMIT ?');
    expect(params).toEqual([10]);
  });

  it('should build LIMIT and OFFSET', () => {
    const { sql, params } = buildPagination({ limit: 10, offset: 20 });
    expect(sql).toBe('LIMIT ? OFFSET ?');
    expect(params).toEqual([10, 20]);
  });

  it('should return empty for no options', () => {
    const { sql, params } = buildPagination({});
    expect(sql).toBe('');
    expect(params).toEqual([]);
  });

  it('should ignore zero/negative values', () => {
    const { sql, params } = buildPagination({ limit: 0, offset: -5 });
    expect(sql).toBe('');
    expect(params).toEqual([]);
  });
});

describe('buildWhereClause', () => {
  it('should build single condition', () => {
    const { sql, params } = buildWhereClause([
      { column: 'tag', operator: '=', value: 'todo' }
    ]);
    expect(sql).toBe('WHERE tag = ?');
    expect(params).toEqual(['todo']);
  });

  it('should build multiple conditions with AND', () => {
    const { sql, params } = buildWhereClause([
      { column: 'tag', operator: '=', value: 'todo' },
      { column: 'status', operator: '!=', value: 'done' }
    ]);
    expect(sql).toBe('WHERE tag = ? AND status != ?');
    expect(params).toEqual(['todo', 'done']);
  });

  it('should handle IS NULL', () => {
    const { sql, params } = buildWhereClause([
      { column: 'deleted_at', operator: 'IS NULL' }
    ]);
    expect(sql).toBe('WHERE deleted_at IS NULL');
    expect(params).toEqual([]);
  });

  it('should handle IN operator', () => {
    const { sql, params } = buildWhereClause([
      { column: 'status', operator: 'IN', value: ['open', 'pending', 'review'] }
    ]);
    expect(sql).toBe('WHERE status IN (?, ?, ?)');
    expect(params).toEqual(['open', 'pending', 'review']);
  });

  it('should return empty for no conditions', () => {
    const { sql, params } = buildWhereClause([]);
    expect(sql).toBe('');
    expect(params).toEqual([]);
  });
});

describe('buildOrderBy', () => {
  it('should build ORDER BY with valid column', () => {
    const { sql } = buildOrderBy(
      { sort: 'created', direction: 'DESC' },
      ['created', 'name']
    );
    expect(sql).toBe('ORDER BY created DESC');
  });

  it('should default to ASC', () => {
    const { sql } = buildOrderBy({ sort: 'name' }, ['name']);
    expect(sql).toBe('ORDER BY name ASC');
  });

  it('should throw on invalid column', () => {
    expect(() => buildOrderBy(
      { sort: 'password' },
      ['name', 'created']
    )).toThrow('Invalid sort column: password');
  });

  it('should return empty when no sort', () => {
    const { sql } = buildOrderBy({}, ['name']);
    expect(sql).toBe('');
  });
});
```

## Success Criteria

1. **No SQL injection** - All user input parameterized
2. **Consistent pagination** - Same LIMIT/OFFSET behavior everywhere
3. **Type safety** - Full TypeScript coverage
4. **Validated sorting** - Column whitelist prevents injection
5. **~180 lines saved** - Reduced duplication
6. **Easy to use** - Simple API for common patterns

## Out of Scope

- Complex JOIN building (handled manually for clarity)
- Subquery construction
- UPDATE/INSERT/DELETE builders (different patterns)
- Full ORM functionality (keep it simple)

## Dependencies

- None (standalone module)

## Related Specs

- **Database Resource Management** - Works together for complete DB handling
- **Unified Workspace Resolver** - Provides context for queries
