---
feature: "Query Builder Utilities"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Query Builder Utilities

## Architecture Overview

Pure utility module providing type-safe SQL clause builders. No dependencies on existing modules - designed for gradual adoption across codebase.

```
┌─────────────────────────────────────────────────────────────┐
│                    Consuming Code                           │
│  (search.ts, query-engine.ts, field-query.ts, mcp tools)    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              src/db/query-builder.ts                        │
├─────────────────────────────────────────────────────────────┤
│  buildPagination()   - LIMIT/OFFSET with params             │
│  buildWhereClause()  - Conditions with params               │
│  buildOrderBy()      - Column validation + direction        │
│  buildSelectQuery()  - Complete query composition           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    BuiltQuery { sql, params }
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, type safety critical |
| Runtime | Bun | PAI standard |
| Testing | bun:test | Comprehensive unit tests |
| Database | SQLite (existing) | No new dependencies |

## Constitutional Compliance

- [x] **CLI-First:** N/A - internal utility module, no CLI interface
- [x] **Library-First:** Pure functions, no side effects, fully reusable
- [x] **Test-First:** TDD with comprehensive unit tests before implementation
- [x] **Deterministic:** Pure functions, same input = same output
- [x] **Code Before Prompts:** Pure TypeScript, no AI/prompts involved

## Data Model

### Entities

```typescript
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
  direction?: 'ASC' | 'DESC';
}

/**
 * Filter condition for WHERE clauses
 * Supports: =, !=, LIKE, IN, IS NULL, IS NOT NULL, >, <, >=, <=
 */
export interface FilterCondition {
  column: string;
  operator: '=' | '!=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL' | '>' | '<' | '>=' | '<=';
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
```

### Database Schema

No schema changes required. Module works with existing SQLite queries.

## API Contracts

### Internal APIs

```typescript
/**
 * Build LIMIT/OFFSET clause with parameter binding
 * Validates positive values, ignores zero/negative
 */
function buildPagination(options: PaginationOptions): BuiltQuery

/**
 * Build WHERE clause from filter conditions
 * Handles all operator types, returns empty for no conditions
 */
function buildWhereClause(conditions: FilterCondition[]): BuiltQuery

/**
 * Build ORDER BY clause with column validation
 * Throws Error if column not in allowedColumns
 */
function buildOrderBy(options: SortOptions, allowedColumns: string[]): BuiltQuery

/**
 * Compose complete SELECT query with all clauses
 * Validates table/columns, combines where/order/pagination
 */
function buildSelectQuery(
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
): BuiltQuery
```

## Implementation Strategy

### Phase 1: Foundation (T-1.1 through T-1.3)

Core types and pagination builder with comprehensive tests.

- [x] TypeScript interfaces (PaginationOptions, SortOptions, FilterCondition, BuiltQuery)
- [x] buildPagination() function
- [x] Unit tests for pagination (happy path, edge cases, zero/negative values)

### Phase 2: Core Builders (T-1.4 through T-1.6)

WHERE and ORDER BY builders.

- [x] buildWhereClause() function with all operators
- [x] buildOrderBy() function with column validation
- [x] Unit tests for both functions

### Phase 3: Integration (T-1.7 through T-1.8)

Composite builder and export configuration.

- [x] buildSelectQuery() function combining all builders
- [x] Export from src/db/index.ts
- [x] Integration tests

### Phase 4: Migration (Optional, Post-Approval)

Gradual adoption across codebase. Not part of initial spec.

- [ ] Migrate search.ts
- [ ] Migrate tana-query-engine.ts
- [ ] Migrate MCP tools

## File Structure

```
src/
├── db/
│   ├── query-builder.ts        # [New] Core builder utilities
│   └── index.ts                # [Modified] Add exports
│
tests/
└── query-builder.test.ts       # [New] Comprehensive unit tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance overhead | Low | Low | Pure functions, minimal overhead |
| Migration breaks existing code | Medium | Low | New module, no forced migration |
| SQL injection in edge cases | High | Low | Comprehensive test coverage, always parameterized |
| Column validation too strict | Medium | Medium | Allow empty allowedColumns for opt-out |

## Dependencies

### External

- None (pure TypeScript, no external packages)

### Internal

- None (standalone module)
- Consumers: search.ts, tana-query-engine.ts, field-query.ts, MCP tools (optional)

## Migration/Deployment

- [x] Database migrations needed? **No**
- [x] Environment variables? **No**
- [x] Breaking changes? **No** - additive change, existing code unaffected

## Estimated Complexity

- **New files:** 2 (query-builder.ts, query-builder.test.ts)
- **Modified files:** 1 (src/db/index.ts for exports)
- **Test files:** 1 (comprehensive tests inline)
- **Estimated tasks:** 8

## Next Steps

After approval, run `/speckit.tasks` to generate implementation checklist.
