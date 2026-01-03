---
feature: "Unified Query Language"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Unified Query Language

## Architecture Overview

A unified query system that combines tag filtering, field filtering, date ranges, and FTS search into a single expressive query. Separates concerns into three layers: parsing, planning, and execution.

```
                              CLI                          MCP
                               │                            │
                               ▼                            ▼
                    ┌──────────────────────┐     ┌──────────────────────┐
                    │  Query String Parser │     │  Structured Input    │
                    │  "find task where.." │     │  { find, where, ... }│
                    └──────────┬───────────┘     └──────────┬───────────┘
                               │                            │
                               ▼                            ▼
                    ┌────────────────────────────────────────────────────┐
                    │                  Query AST                          │
                    │  { find, where: [...], select, orderBy, limit }    │
                    └──────────────────────┬─────────────────────────────┘
                                           │
                                           ▼
                    ┌────────────────────────────────────────────────────┐
                    │                Query Planner                        │
                    │  - Validates fields against schema                  │
                    │  - Resolves relative dates (today, 7d)             │
                    │  - Determines execution strategy (FTS vs SQL)       │
                    └──────────────────────┬─────────────────────────────┘
                                           │
                                           ▼
                    ┌────────────────────────────────────────────────────┐
                    │               Query Executor                        │
                    │  - Builds SQL with parameters                       │
                    │  - Executes against SQLite                          │
                    │  - Applies projection (select)                      │
                    └──────────────────────┬─────────────────────────────┘
                                           │
                                           ▼
                    ┌────────────────────────────────────────────────────┐
                    │               Query Result                          │
                    │  { results: [...], count, hasMore }                │
                    └────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Parser | Hand-written recursive descent | Simple grammar, no external deps |
| Database | SQLite (bun:sqlite) | Existing indexed data |
| Query Builder | Existing `query-builder.ts` | Reuse for SQL generation |
| Validation | Zod | Consistent with MCP schemas |

## Constitutional Compliance

- [x] **CLI-First:** `supertag query "find task where..."` command with full syntax support
- [x] **Library-First:** `UnifiedQueryEngine` class as reusable module for MCP and CLI
- [x] **Test-First:** Parser tests, planner tests, executor tests with ~50+ cases
- [x] **Deterministic:** All query execution is SQL-based, no AI/LLM involvement
- [x] **Code Before Prompts:** Query parsing and execution entirely in TypeScript

## Data Model

### Query AST (Abstract Syntax Tree)

```typescript
/** Parsed query representation */
interface QueryAST {
  find: string | "*";                    // Supertag name or wildcard
  where: WhereClause[];                  // Filter conditions
  select?: string[];                     // Field projection
  orderBy?: { field: string; desc: boolean };
  limit?: number;
  offset?: number;
}

/** Single filter condition */
interface WhereClause {
  field: string;                         // "Status", "created", "parent.tags"
  operator: QueryOperator;
  value: QueryValue;
  negated?: boolean;                     // "not Status = Done"
}

/** Supported comparison operators */
type QueryOperator =
  | "="  | "!="
  | ">"  | "<"  | ">=" | "<="
  | "~"  | "contains"
  | "exists";

/** Value types in queries */
type QueryValue =
  | string                               // Literal: "Done", "John"
  | number                               // Numeric: 5, 100
  | RelativeDate                         // today, 7d, 1w
  | QueryValue[];                        // IN operator: ["a", "b"]

/** Relative date values */
type RelativeDate =
  | "today" | "yesterday"
  | `${number}d` | `${number}w` | `${number}m` | `${number}y`;

/** Logical grouping for OR support */
interface WhereGroup {
  type: "and" | "or";
  clauses: (WhereClause | WhereGroup)[];
}
```

### No Database Schema Changes

This feature queries existing tables:
- `nodes` - Node data
- `supertags` / `tag_applications` - Tag filtering
- `field_values` - Field value filtering
- `nodes_fts` - Full-text search

## API Contracts

### Internal APIs

```typescript
/** Parse CLI query string to AST */
function parseQueryString(query: string): QueryAST;

/** Parse MCP structured input to AST */
function parseStructuredQuery(input: StructuredQueryInput): QueryAST;

/** Validate AST against database schema */
function validateQuery(ast: QueryAST, schema: SchemaInfo): ValidationResult;

/** Resolve relative dates to timestamps */
function resolveDates(ast: QueryAST): QueryAST;

/** Execute query and return results */
function executeQuery(ast: QueryAST, dbPath: string): Promise<QueryResult>;
```

### MCP Tool Schema

```typescript
interface TanaQueryInput {
  find: string;                          // Required: supertag or "*"
  where?: Record<string, WhereCondition>;// Optional: field filters
  select?: string[];                     // Optional: projection
  orderBy?: string;                      // Optional: "-created"
  limit?: number;                        // Optional: max 1000
  offset?: number;                       // Optional: pagination
  workspace?: string;                    // Optional: workspace alias
}

type WhereCondition =
  | string                               // Shorthand: { "Status": "Done" }
  | { eq?: string; contains?: string; after?: string; before?: string; exists?: boolean };
```

## Implementation Strategy

### Phase 1: Foundation (Core Infrastructure)

Build the query parser and AST structure.

- [ ] Define TypeScript types for QueryAST in `src/query/types.ts`
- [ ] Create Zod schemas for MCP input validation in `src/mcp/schemas/query.ts`
- [ ] Implement recursive descent parser for CLI syntax in `src/query/parser.ts`
- [ ] Add date resolution utilities in `src/query/date-resolver.ts`
- [ ] Write parser tests (~30 test cases)

### Phase 2: Query Engine (Core Features)

Build the query planner and executor.

- [ ] Create `UnifiedQueryEngine` class in `src/query/unified-query-engine.ts`
- [ ] Implement query validation against schema
- [ ] Build SQL generation from AST (extend existing query-builder)
- [ ] Handle FTS5 queries when `name ~` pattern detected
- [ ] Handle parent.* field paths with JOIN
- [ ] Implement result projection (select)
- [ ] Write engine tests (~20 test cases)

### Phase 3: Integration

Wire into CLI and MCP.

- [ ] Add `supertag query` command in `src/commands/query.ts`
- [ ] Add `tana_query` MCP tool in `src/mcp/tools/query.ts`
- [ ] Support all output formats (table, json, csv, ids, jsonl, minimal)
- [ ] Add helpful error messages with syntax hints
- [ ] Integration tests with real database

## File Structure

```
src/
├── query/
│   ├── types.ts                    # [New] Query AST types
│   ├── parser.ts                   # [New] CLI query string parser
│   ├── date-resolver.ts            # [New] Relative date handling
│   ├── unified-query-engine.ts     # [New] Main query engine
│   └── tana-query-engine.ts        # [Modified] Reuse existing helpers
├── mcp/
│   ├── schemas/
│   │   └── query.ts                # [New] MCP input schema
│   └── tools/
│       └── query.ts                # [New] tana_query tool
├── commands/
│   └── query.ts                    # [New] CLI command
└── db/
    └── query-builder.ts            # [Modified] Add WHERE group support

tests/
├── query-parser.test.ts            # [New] Parser tests
├── query-engine.test.ts            # [New] Engine tests
├── query-integration.test.ts       # [New] E2E tests
└── date-resolver.test.ts           # [New] Date tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Parser complexity with OR groups | Med | Med | Start simple, add OR in v2 if needed |
| SQL injection via field names | High | Low | Whitelist field names against schema |
| Performance with parent joins | Med | Med | Optimize with indexed parent_id |
| FTS5 index missing | Low | Low | Auto-create on first query (existing pattern) |
| Complex nested where clauses | Med | Low | Limit nesting depth to 2 levels |

## Dependencies

### External

None - uses only existing dependencies.

### Internal

- `src/db/query-builder.ts` - SQL construction utilities
- `src/query/tana-query-engine.ts` - Database access patterns
- `src/config/workspace-resolver.ts` - Workspace context
- `src/utils/select-projection.ts` - Result projection
- `src/utils/output-formatter.ts` - Output formatting
- `src/mcp/schemas.ts` - Existing schema patterns

## Migration/Deployment

- [ ] **Database migrations:** None required
- [ ] **Environment variables:** None required
- [ ] **Breaking changes:** None - new command/tool, existing tools unchanged
- [ ] **Documentation:** Update SKILL.md with query examples

## Estimated Complexity

- **New files:** ~8
- **Modified files:** ~3
- **Test files:** ~4
- **Estimated tasks:** ~25-30
