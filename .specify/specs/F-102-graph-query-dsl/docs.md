# F-102: Graph Query DSL — Documentation

## Summary

F-102 adds a declarative graph query language (DSL) for traversing typed relationships in the Tana knowledge graph. Instead of chaining multiple CLI commands (`search` → `related` → `fields`), users and AI agents can express multi-hop graph queries in a single statement:

```
FIND meeting CONNECTED TO person VIA Attendees WHERE person.name ~ "Daniel" RETURN name, Date, person.name
```

The feature provides both a CLI command (`supertag gquery`) and an MCP tool (`tana_graph_query`).

## Architecture

The implementation follows a 4-stage pipeline:

```
Input (DSL string)
  → Tokenizer (tokenizer.ts)      — character stream → token stream
  → Parser (graph-parser.ts)       — token stream → GraphQueryAST
  → Planner (graph-planner.ts)     — AST → validated QueryPlan (checks tags/fields exist)
  → Executor (graph-executor.ts)   — QueryPlan → results via existing services
```

The executor does NOT write raw SQL. It orchestrates:
- **UnifiedQueryEngine** (Spec 063) for `FIND` steps (tag-based search with filters)
- **GraphTraversalService** (F-065) for `CONNECTED TO` traversal steps
- **FieldResolver** for field value extraction in `RETURN` projections

## DSL Grammar

```
graph_query  = FIND identifier where_clause? connected_clause* depth_clause? return_clause
where_clause = WHERE condition (AND condition)*
condition    = field operator value
connected    = CONNECTED TO identifier (VIA field)? (WHERE condition (AND condition)*)?
depth_clause = DEPTH number
return_clause = RETURN return_field (, return_field)*
return_field  = (identifier .)? field | aggregate_fn ( field ) AS identifier
field        = identifier | quoted_string
operator     = = | != | > | < | >= | <= | CONTAINS | LIKE | ~ (contains shorthand)
```

**Keywords** (case-insensitive): `FIND`, `WHERE`, `AND`, `OR`, `NOT`, `CONNECTED`, `TO`, `VIA`, `RETURN`, `DEPTH`, `LIMIT`, `CONTAINS`, `LIKE`, `AS`, `COUNT`, `SUM`, `AVG`, `IS`, `NULL`

## Files Changed

### New Files (8)

| File | Purpose |
|------|---------|
| `src/query/graph-types.ts` | Type definitions: `GraphQueryAST`, `QueryPlan`, `QueryStep`, `GraphQueryResult` |
| `src/query/graph-parser.ts` | Recursive descent parser: DSL string → `GraphQueryAST` |
| `src/query/graph-planner.ts` | Query planner: validates tag/field names against DB, builds `QueryPlan` |
| `src/query/graph-executor.ts` | Executor: runs `QueryPlan` via UnifiedQueryEngine + GraphTraversalService |
| `src/commands/gquery.ts` | CLI command: `supertag gquery` |
| `src/mcp/tools/graph-query.ts` | MCP tool implementation: `tana_graph_query` |
| `.specify/specs/F-102-graph-query-dsl/plan.md` | Technical plan |
| `.specify/specs/F-102-graph-query-dsl/tasks.md` | Task breakdown |

### Modified Files (7)

| File | Change |
|------|--------|
| `src/query/tokenizer.ts` | Added `graphTokenize()` function with extended keyword set (`CONNECTED`, `TO`, `VIA`, `RETURN`, `DEPTH`, `AS`, aggregates) and DOT token support for dot-notation |
| `src/index.ts` | Registered `gquery` command on the CLI |
| `src/mcp/index.ts` | Registered `tana_graph_query` tool (handler + schema) |
| `src/mcp/schemas.ts` | Added `graphQuerySchema` Zod schema with `query`, `workspace`, `limit`, `explain` parameters |
| `src/mcp/tool-registry.ts` | Added `tana_graph_query` to tool registry with description and JSON schema |
| `src/mcp/tool-mode.ts` | Added `tana_graph_query` to lite mode tool list |
| `tests/mcp-lite-mode.test.ts` | Updated expected tool count for lite mode |

## CLI Usage

### Basic: Find all nodes of a type

```bash
supertag gquery "FIND project RETURN name, Status"
```

### Filtered: With WHERE clause

```bash
supertag gquery 'FIND project WHERE Status = "Active" RETURN name, Status, "Due Date"'
```

### 1-hop traversal: CONNECTED TO

```bash
supertag gquery 'FIND meeting CONNECTED TO person VIA Attendees RETURN name, Date, person.name'
```

### Multi-hop traversal

```bash
supertag gquery 'FIND project CONNECTED TO person VIA "Team Members" CONNECTED TO meeting VIA Attendees RETURN meeting.name, meeting.Date'
```

### Explain mode (show plan without executing)

```bash
supertag gquery 'FIND meeting CONNECTED TO person RETURN name' --explain
```

### Output formats

```bash
supertag gquery "FIND person RETURN name" --format json
supertag gquery "FIND person RETURN name" --format csv
supertag gquery "FIND person RETURN name" --format table   # default
```

### Limit results

```bash
supertag gquery "FIND task RETURN name LIMIT 10"
# or via CLI flag:
supertag gquery "FIND task RETURN name" --limit 10
```

## MCP Tool Usage

Tool name: `tana_graph_query`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Graph query DSL string |
| `workspace` | string | No | Workspace alias (uses default if omitted) |
| `limit` | number | No | Max results, 1-1000 (default: 100). Overridden by `LIMIT` in query. |
| `explain` | boolean | No | Return execution plan instead of results (default: false) |

### Response Format

```json
{
  "workspace": "main",
  "query": "FIND person RETURN name",
  "results": {
    "rows": [{ "name": "Daniel Miessler" }, { "name": "Sarah Chen" }],
    "columns": ["name"],
    "count": 2,
    "hasMore": false,
    "queryTimeMs": 42.5
  }
}
```

On error:
```json
{
  "workspace": "main",
  "query": "FIND xyz RETURN name",
  "error": "Validation error: Supertag 'xyz' not found. Did you mean: ..."
}
```

## Error Handling

The system provides contextual error messages at each stage:

- **Parse errors** (`GraphParseError`): Syntax issues with position info and grammar reference
- **Plan errors** (`GraphPlanError`): Unknown tag/field names with fuzzy-matched suggestions
- **Execution errors**: Runtime failures during traversal

Example error output:
```
❌ Query validation error: Supertag 'meting' not found
   💡 Did you mean: meeting?
```

## Configuration

No new configuration files. The feature uses:
- Existing workspace configuration for database resolution
- Existing output format options (`--format`, `SUPERTAG_FORMAT` env var)

## Dependencies

- **F-065** (Graph Traversal Service) — `GraphTraversalService` for relationship walking
- **Spec 063** (Unified Query Language) — `UnifiedQueryEngine` for tag-based search, shared `WhereClause`/`WhereGroup` types
- **Field Resolver** — for extracting field values in RETURN projections

## Limitations (by design)

- No mutation queries (INSERT, UPDATE, DELETE)
- No subqueries / nested FIND
- No SQL compatibility (this is graph-first, not table-first)
- No user-defined functions
- No query optimization / caching
- Natural language → DSL translation designed for but not yet implemented
