---
feature: "Unified Query Language"
plan: "./plan.md"
status: "complete"
total_tasks: 18
completed: 18
---

# Tasks: Unified Query Language

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation

- [x] **T-1.1** Define Query AST types [T] [P]
  - File: `src/query/types.ts`
  - Test: `tests/query-types.test.ts`
  - Description: Create TypeScript interfaces for QueryAST, WhereClause, QueryOperator, RelativeDate, and WhereGroup

- [x] **T-1.2** Create MCP input schema [T] [P]
  - File: `src/mcp/schemas.ts`
  - Test: `tests/query-schema.test.ts`
  - Description: Zod schemas for tana_query MCP tool input validation

- [x] **T-1.3** Implement date resolver [T] [P]
  - File: `src/query/date-resolver.ts`
  - Test: `tests/date-resolver.test.ts`
  - Description: Parse relative dates (today, 7d, 1w) to Unix timestamps

### Group 2: Query Parser

- [x] **T-2.1** Implement tokenizer [T] (depends: T-1.1)
  - File: `src/query/tokenizer.ts`
  - Test: `tests/query-tokenizer.test.ts`
  - Description: Tokenize CLI query strings into token stream (keywords, operators, literals)

- [x] **T-2.2** Implement parser core [T] (depends: T-2.1)
  - File: `src/query/parser.ts`
  - Test: `tests/query-parser.test.ts`
  - Description: Recursive descent parser for `find X where Y order by Z limit N`

- [x] **T-2.3** Add OR group parsing [T] (depends: T-2.2)
  - File: `src/query/parser.ts` (extend)
  - Test: `tests/query-parser.test.ts` (extend)
  - Description: Handle parenthesized OR groups: `(A or B)`

- [x] **T-2.4** Add parent path parsing [T] (depends: T-2.2)
  - File: `src/query/parser.ts` (extend)
  - Test: `tests/query-parser.test.ts` (extend)
  - Description: Parse `parent.tags`, `parent.name` field paths

### Group 3: Query Engine

- [x] **T-3.1** Create unified query engine structure [T] (depends: T-1.1, T-1.3)
  - File: `src/query/unified-query-engine.ts`
  - Test: `tests/unified-query-engine.test.ts`
  - Description: UnifiedQueryEngine class with constructor and execute method signature

- [x] **T-3.2** Implement query validation [T] (depends: T-3.1)
  - File: `src/query/unified-query-engine.ts` (extend)
  - Test: `tests/unified-query-engine.test.ts` (extend)
  - Description: Validate field names against schema, reject invalid operators

- [x] **T-3.3** Implement SQL generation [T] (depends: T-3.2)
  - File: `src/query/unified-query-engine.ts` (extend)
  - Test: `tests/unified-query-engine.test.ts` (extend)
  - Description: Build SQL from AST using query-builder utilities

- [x] **T-3.4** Add FTS query detection [T] (depends: T-3.3)
  - File: `src/query/unified-query-engine.ts` (extend)
  - Test: `tests/unified-query-engine.test.ts` (extend)
  - Description: Detect `name ~` patterns, switch to FTS5 execution path

- [x] **T-3.5** Add parent join handling [T] (depends: T-3.3)
  - File: `src/query/unified-query-engine.ts` (extend)
  - Test: `tests/unified-query-engine.test.ts` (extend)
  - Description: Generate JOINs for `parent.*` field paths

- [x] **T-3.6** Implement result projection [T] (depends: T-3.3)
  - File: `src/query/unified-query-engine.ts` (extend)
  - Test: `tests/unified-query-engine.test.ts` (extend)
  - Description: Apply `select` projection to query results

### Group 4: Integration

- [x] **T-4.1** Create CLI command [T] (depends: T-2.4, T-3.6)
  - File: `src/commands/query.ts`
  - Test: `tests/query-command.test.ts`
  - Description: `supertag query "..."` command with all output formats

- [x] **T-4.2** Create MCP tool [T] (depends: T-1.2, T-3.6)
  - File: `src/mcp/tools/query.ts`
  - Test: `tests/mcp-query.test.ts`
  - Description: `tana_query` MCP tool with structured input

- [x] **T-4.3** Register CLI command [T] (depends: T-4.1)
  - File: `src/index.ts`
  - Test: `tests/cli-integration.test.ts`
  - Description: Wire query command into main CLI

- [x] **T-4.4** Register MCP tool [T] (depends: T-4.2)
  - File: `src/mcp/index.ts`
  - Test: `tests/mcp-integration.test.ts`
  - Description: Register tana_query in MCP tool list

- [x] **T-4.5** Update documentation (depends: T-4.3, T-4.4)
  - Files: `SKILL.md`, `README.md`
  - Description: Document query syntax, examples, MCP usage

## Dependency Graph

```
              ┌─────────────────────────────────────────────────────────────┐
              │                         GROUP 1                              │
              │         T-1.1 ────┬────────────────────────────┐            │
              │         T-1.2 ────┼──────────────────────────┐ │            │
              │         T-1.3 ────┼────────────────────────┐ │ │            │
              └───────────────────┼────────────────────────┼─┼─┼────────────┘
                                  │                        │ │ │
              ┌───────────────────┼────────────────────────┼─┼─┼────────────┐
              │                   │       GROUP 2          │ │ │            │
              │                   ▼                        │ │ │            │
              │              T-2.1 ──> T-2.2 ──┬──> T-2.3  │ │ │            │
              │                            │  └──> T-2.4  │ │ │            │
              └────────────────────────────┼──────────────┼─┼─┼────────────┘
                                           │              │ │ │
              ┌────────────────────────────┼──────────────┼─┼─┼────────────┐
              │                            │   GROUP 3    │ │ │            │
              │                            │              ▼ │ │            │
              │                            │           T-3.1◄┘ │            │
              │                            │              │    │            │
              │                            │              ▼    │            │
              │                            │           T-3.2   │            │
              │                            │              │    │            │
              │                            │              ▼    │            │
              │                            │   ┌───────T-3.3───┬───────┐   │
              │                            │   ▼        │      ▼       ▼   │
              │                            │ T-3.4    T-3.5         T-3.6  │
              └────────────────────────────┼───┼────────┼────────────┼─────┘
                                           │   │        │            │
              ┌────────────────────────────┼───┼────────┼────────────┼─────┐
              │                            │   │        │   GROUP 4  │     │
              │                            ▼   ▼        ▼            ▼     │
              │                        T-4.1◄──────────┘      T-4.2◄──┘    │
              │                            │                     │         │
              │                            ▼                     ▼         │
              │                        T-4.3                  T-4.4        │
              │                            └──────┬──────────────┘         │
              │                                   ▼                        │
              │                               T-4.5                        │
              └────────────────────────────────────────────────────────────┘
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2, T-1.3
2. **Sequential:** T-2.1 (after T-1.1)
3. **Sequential:** T-2.2 (after T-2.1)
4. **Parallel batch 2:** T-2.3, T-2.4, T-3.1 (after T-2.2, T-1.1, T-1.3)
5. **Sequential:** T-3.2 (after T-3.1)
6. **Sequential:** T-3.3 (after T-3.2)
7. **Parallel batch 3:** T-3.4, T-3.5, T-3.6 (after T-3.3)
8. **Parallel batch 4:** T-4.1, T-4.2 (after T-2.4+T-3.6, T-1.2+T-3.6)
9. **Parallel batch 5:** T-4.3, T-4.4 (after T-4.1, T-4.2)
10. **Sequential:** T-4.5 (after T-4.3, T-4.4)

**Critical Path:** T-1.1 → T-2.1 → T-2.2 → T-2.4 → T-3.1 → T-3.2 → T-3.3 → T-3.6 → T-4.1 → T-4.3 → T-4.5 (11 tasks)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | complete | 2026-01-02 | 2026-01-02 | Query AST types |
| T-1.2 | complete | 2026-01-02 | 2026-01-02 | MCP input schema |
| T-1.3 | complete | 2026-01-02 | 2026-01-02 | Date resolver |
| T-2.1 | complete | 2026-01-02 | 2026-01-02 | Tokenizer |
| T-2.2 | complete | 2026-01-02 | 2026-01-02 | Parser core |
| T-2.3 | complete | 2026-01-02 | 2026-01-02 | OR groups |
| T-2.4 | complete | 2026-01-02 | 2026-01-02 | Parent paths |
| T-3.1 | complete | 2026-01-02 | 2026-01-02 | Engine structure |
| T-3.2 | complete | 2026-01-02 | 2026-01-02 | Validation |
| T-3.3 | complete | 2026-01-02 | 2026-01-02 | SQL generation |
| T-3.4 | complete | 2026-01-02 | 2026-01-02 | FTS detection |
| T-3.5 | complete | 2026-01-02 | 2026-01-02 | Parent joins |
| T-3.6 | complete | 2026-01-02 | 2026-01-02 | Projection |
| T-4.1 | complete | 2026-01-02 | 2026-01-02 | CLI command |
| T-4.2 | complete | 2026-01-02 | 2026-01-02 | MCP tool |
| T-4.3 | complete | 2026-01-02 | 2026-01-02 | CLI registration |
| T-4.4 | complete | 2026-01-02 | 2026-01-02 | MCP registration |
| T-4.5 | complete | 2026-01-02 | 2026-01-02 | Documentation |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun run test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Blockers & Issues

| Task | Issue | Resolution |
|------|-------|------------|
| T-2.1 | Tokenizer splitting "7d" into two tokens | Fixed by adding relative date detection |
| T-2.1 | Tokenizer splitting "2025-12-01" into parts | Fixed by detecting ISO date patterns |
| T-4.1 | Duplicate --format flag conflict | Removed manual --format option, using addStandardOptions |
