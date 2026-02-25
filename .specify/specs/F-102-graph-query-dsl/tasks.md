# Implementation Tasks: F-102 Graph Query DSL

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Graph query types |
| T-1.2 | ☐ | Tokenizer keyword extension |
| T-2.1 | ☐ | Recursive descent parser |
| T-2.2 | ☐ | Parser error messages |
| T-3.1 | ☐ | Query planner + validator |
| T-3.2 | ☐ | Explain formatter |
| T-4.1 | ☐ | Graph query executor |
| T-4.2 | ☐ | Cycle detection + large set handling |
| T-5.1 | ☐ | CLI gquery command |
| T-6.1 | ☐ | MCP tana_graph_query tool |

## Group 1: Foundation — Types & Tokenizer

### T-1.1: Define graph query type system [T]
- **File:** `src/query/graph-types.ts`
- **Test:** `tests/query/graph-types.test.ts`
- **Dependencies:** none
- **Description:**
  - Define `GraphQueryAST` interface with `find`, `where`, `connected`, `depth`, `return`, `limit` fields
  - Define `ConnectedClause` interface with `toTag`, `viaField`, `where` fields
  - Define `ProjectionField` interface with `typeAlias`, `fieldName`, `alias`, `aggregateFn` fields
  - Define `QueryPlan` and `QueryStep` discriminated union types (`find_by_tag`, `traverse`, `filter`, `project`)
  - Define `GraphQueryResult` interface with `rows`, `columns`, `count`, `hasMore`, `executionPlan`, `queryTimeMs`
  - Reuse `WhereClause`, `WhereGroup`, `QueryOperator` from `src/query/types.ts` — import, don't duplicate
  - Tests: type validation, construction of each AST variant, edge cases (empty connected array, no where clause)

### T-1.2: Extend tokenizer with graph DSL keywords [T] [P with T-1.1]
- **File:** `src/query/tokenizer.ts` (EDIT)
- **Test:** `tests/query/graph-tokenizer.test.ts`
- **Dependencies:** none
- **Description:**
  - Add keywords to `KEYWORDS` map: `FIND`, `CONNECTED`, `TO`, `VIA`, `RETURN`, `DEPTH`, `CONTAINS`, `LIKE`, `AS`, `COUNT`, `SUM`, `AVG`
  - Add `TokenType.DOT` token type for dot-notation field access (e.g., `person.name`)
  - Verify existing keywords (`WHERE`, `AND`, `OR`, operators) still tokenize correctly — regression tests
  - Handle keyword conflict: new keywords must not break existing Spec 063 tokenizer usage. If the tokenizer is shared, guard with a mode flag or ensure Spec 063 parser ignores unknown keywords gracefully
  - Tests: tokenize `FIND project WHERE Status = "Active" RETURN name`, tokenize dot notation `person.name`, tokenize `CONNECTED TO meeting VIA Attendees`, tokenize quoted field names `"Due Date"`, verify existing Spec 063 queries still tokenize identically

## Group 2: Parser

### T-2.1: Implement recursive descent graph parser [T]
- **File:** `src/query/graph-parser.ts`
- **Test:** `tests/query/graph-parser.test.ts`
- **Dependencies:** T-1.1, T-1.2
- **Description:**
  - Implement `GraphParser` class with recursive descent methods: `parse()`, `parseFind()`, `parseWhere()`, `parseConnected()`, `parseDepth()`, `parseReturn()`, `parseProjectionField()`
  - Export `parseGraphQuery(input: string): GraphQueryAST` convenience function
  - Export `GraphParseError` error class extending `Error` with position info (line, column, token)
  - Grammar implementation per plan:
    - `FIND <identifier>` — required, exactly one
    - `WHERE <condition> (AND <condition>)*` — optional, on FIND type
    - `CONNECTED TO <identifier> [VIA <field>] [WHERE ...]` — zero or more, ordered chain
    - `DEPTH <number>` — optional, default 1
    - `RETURN <projection> (, <projection>)*` — required
  - Support quoted field names for fields with spaces: `WHERE "Due Date" > "2025-01-01"`
  - Support dot notation in RETURN: `person.name` → `{ typeAlias: "person", fieldName: "name" }`
  - Support aggregate functions: `COUNT(meeting) AS meeting_count`
  - Support `RETURN *` for all fields
  - Tests: parse simple query (FIND + RETURN), parse with WHERE, parse with CONNECTED TO, parse with VIA, parse multi-hop (2 CONNECTED TO clauses), parse DEPTH, parse aggregates, parse dot notation, parse quoted fields, parse RETURN *, reject missing RETURN, reject missing FIND, reject unknown operators

### T-2.2: Parser error messages with suggestions [T] [P with T-2.1 once T-1.1+T-1.2 done]
- **File:** `src/query/graph-parser.ts` (part of T-2.1, but can be developed in parallel as error handling layer)
- **Test:** `tests/query/graph-parser.test.ts` (error case section)
- **Dependencies:** T-1.1, T-1.2
- **Description:**
  - `GraphParseError` includes: message, position (offset, line, column), expected token, got token
  - Error messages include query syntax reference block (as shown in plan)
  - Example error: `'Expected RETURN clause at position 42. Found end of input.'`
  - Include example query in error output to guide users
  - Tests: error on empty input, error on missing RETURN, error on invalid operator, error on unclosed quote, error position accuracy

## Group 3: Planner & Validator

### T-3.1: Implement query planner with tag/field validation [T]
- **File:** `src/query/graph-planner.ts`
- **Test:** `tests/query/graph-planner.test.ts`
- **Dependencies:** T-1.1, T-2.1
- **Description:**
  - Implement `GraphQueryPlanner` class that takes a `Database` instance
  - `plan(ast: GraphQueryAST): Promise<QueryPlan>` — validates then builds plan
  - Tag validation: query `tag_definitions` table to check FIND and CONNECTED TO tag names exist. On failure, suggest similar tag names using Levenshtein distance or prefix match
  - Field validation: for WHERE and VIA clauses, verify field names exist on the referenced tag. On failure, list available fields
  - Case-insensitive matching for tag and field names
  - Build `QueryPlan` from validated AST:
    - Step 1: `find_by_tag` for primary FIND clause with WHERE filters
    - Steps 2..N: `traverse` for each CONNECTED TO clause
    - Optional `filter` steps for WHERE clauses on CONNECTED types
    - Final `project` step for RETURN clause
  - Track `typeAlias → resultSet` mapping for dot-notation resolution
  - Tests: plan simple FIND query, plan with WHERE, plan with CONNECTED TO chain (verify step order), validate unknown tag (error with suggestion), validate unknown field (error with available fields), case-insensitive matching, multi-hop plan generation

### T-3.2: Explain formatter [T] [P with T-3.1 once types exist]
- **File:** `src/query/graph-planner.ts` (method on `GraphQueryPlanner`)
- **Test:** `tests/query/graph-planner.test.ts` (explain section)
- **Dependencies:** T-1.1
- **Description:**
  - `formatExplain(plan: QueryPlan): string` — human-readable execution plan
  - Output format:
    ```
    Execution Plan:
      Step 1: Find nodes tagged #project (with 1 filter)
      Step 2: Traverse from R0 → #person via "Team Members"
      Step 3: Filter R1 (1 condition)
      Step 4: Project: name, person.name, person.email
    Estimated hops: 1
    ```
  - Tests: format single-step plan, format multi-hop plan, format plan with filters, format plan with aggregates

## Group 4: Executor

### T-4.1: Implement graph query executor [T]
- **File:** `src/query/graph-executor.ts`
- **Test:** `tests/query/graph-executor.test.ts`
- **Dependencies:** T-1.1, T-3.1
- **Description:**
  - Implement `GraphQueryExecutor` class with `UnifiedQueryEngine` and `GraphTraversalService` dependencies
  - `execute(plan: QueryPlan, ast: GraphQueryAST, limit?: number): Promise<GraphQueryResult>` method
  - For `find_by_tag` steps: build a `QueryAST` compatible with `UnifiedQueryEngine` — convert tag name to tagged search with WHERE filters
  - For `traverse` steps: iterate over `fromSet` nodes, call `GraphTraversalService.traverse()` for each, filter by `toTag` type and optional `viaField`
  - For `filter` steps: apply WHERE conditions to result set in memory (field value comparison)
  - For `project` steps: extract requested fields from final result set, handle dot-notation by resolving `typeAlias` to the correct result set
  - Build `GraphQueryResult` with `rows`, `columns`, `count`, `hasMore`, `queryTimeMs`
  - Tests: execute simple FIND (mock UnifiedQueryEngine), execute FIND + CONNECTED TO (mock both services), execute multi-hop, execute with WHERE filter, execute with projection including dot notation, execute with aggregation (COUNT), verify queryTimeMs is populated, verify hasMore when limit exceeded

### T-4.2: Cycle detection and large intermediate set handling [T]
- **File:** `src/query/graph-executor.ts` (enhancement to T-4.1)
- **Test:** `tests/query/graph-executor.test.ts` (cycle + limit section)
- **Dependencies:** T-4.1
- **Description:**
  - Cycle detection: maintain `visitedIds: Set<string>` across all traversal steps. Skip nodes already visited. Break cycles without error.
  - Large intermediate set warning: if any result set exceeds `limit * 10` (default 1000) after a step, log a warning to stderr and truncate to that threshold. Set `hasMore: true` on result.
  - Suggestion in warning: "Consider adding a WHERE clause to narrow the initial FIND results"
  - Tests: create circular mock data (A→B→A), verify no infinite loop, verify visited nodes skipped, verify warning emitted for large sets, verify truncation respects threshold, verify hasMore flag

## Group 5: CLI Integration

### T-5.1: Implement `supertag gquery` CLI command [T]
- **File:** `src/commands/gquery.ts`
- **Test:** `tests/commands/gquery.test.ts`
- **Dependencies:** T-2.1, T-3.1, T-4.1
- **Description:**
  - Create `createGQueryCommand()` returning a Commander.js `Command`
  - Command: `supertag gquery <query>` with the DSL string as positional argument
  - Options:
    - `--explain` — show execution plan without running (calls `planner.formatExplain()`)
    - `--format <type>` — output format: table|json|csv|markdown (default: table). Use existing `createFormatter` / output format infrastructure
    - `--limit <n>` — max results (default: 100)
    - `--depth <n>` — override traversal depth
    - Add standard options via `addStandardOptions(cmd)` for `--workspace`, `--offline`, etc.
  - Wire into `src/index.ts`: `program.addCommand(createGQueryCommand())`
  - Parse error display: catch `GraphParseError`, format with syntax reference block (as shown in plan)
  - Validation error display: catch planner errors (unknown tag/field), format with suggestions
  - Tests: help output, parse error formatting, explain mode output, json/csv/table format output (mock executor), workspace option forwarding, limit option forwarding

## Group 6: MCP Integration

### T-6.1: Implement `tana_graph_query` MCP tool [T]
- **File:** `src/mcp/tools/graph-query.ts`
- **Test:** `src/mcp/tools/__tests__/graph-query.test.ts`
- **Dependencies:** T-2.1, T-3.1, T-4.1
- **Description:**
  - Create tool handler function `handleGraphQuery(input, workspace): Promise<MCPToolResult>`
  - Input schema (Zod in `src/mcp/schemas.ts`): `dsl` (string, required), `explain` (boolean, optional), `format` (enum json|markdown|csv, optional, default json), `limit` (number, optional, default 100), `workspace` (string, optional)
  - Register in `src/mcp/tool-registry.ts` as `tana_graph_query`
  - Tool description should clearly distinguish from `tana_query` (flat index): "Execute graph traversal queries using the Graph Query DSL. For multi-hop relationship traversal. Use tana_query for flat index searches."
  - Error handling: use `handleMcpError()` from `src/mcp/error-handler.ts` for parse/validation/execution errors
  - When `explain: true`, return formatted execution plan text
  - When `explain: false`, return JSON result with rows, columns, count, hasMore
  - Tests: successful query execution (mock services), explain mode, parse error returns isError, validation error returns isError with suggestions, format option forwarding, default workspace resolution

## Execution Order

```
Phase 1 (parallel):
  T-1.1 (types — no deps)
  T-1.2 (tokenizer — no deps)

Phase 2 (after Phase 1):
  T-2.1 (parser — needs T-1.1, T-1.2)
  T-2.2 (error messages — needs T-1.1, T-1.2, parallel with T-2.1)

Phase 3 (after Phase 2):
  T-3.1 (planner — needs T-1.1, T-2.1)
  T-3.2 (explain — needs T-1.1, parallel with T-3.1)

Phase 4 (after Phase 3):
  T-4.1 (executor — needs T-1.1, T-3.1)
  T-4.2 (cycle detection — needs T-4.1)

Phase 5 (after Phase 4, parallel):
  T-5.1 (CLI — needs T-2.1, T-3.1, T-4.1)
  T-6.1 (MCP — needs T-2.1, T-3.1, T-4.1)
```

## Key Implementation Notes

1. **Reuse WhereClause types** — Import `WhereClause`, `WhereGroup`, `QueryOperator` from `src/query/types.ts`. Do not duplicate condition parsing logic.
2. **Tokenizer keyword safety** — New keywords (FIND, CONNECTED, etc.) must not break Spec 063's existing parser. Test regression explicitly.
3. **Executor orchestrates, doesn't query SQL** — `GraphQueryExecutor` calls `UnifiedQueryEngine` and `GraphTraversalService`. No direct SQLite queries.
4. **RETURN is required** — Parser must reject queries without a RETURN clause. Support `RETURN *` as wildcard.
5. **Case-insensitive tag/field matching** — Planner normalizes names before lookup.
6. **Cycle detection is per-execution** — `Set<string>` of visited node IDs, reset per query.
7. **Output formatting** — Reuse existing `createFormatter` / output format infrastructure from Spec 060.
