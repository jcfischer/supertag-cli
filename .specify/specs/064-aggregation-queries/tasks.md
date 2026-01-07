---
feature: "Aggregation Queries"
plan: "./plan.md"
status: "pending"
total_tasks: 14
completed: 0
---

# Tasks: Aggregation Queries

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Types)

- [ ] **T-1.1** Add aggregation types to query/types.ts [T] [P]
  - File: `src/query/types.ts`
  - Test: `tests/query/aggregation-types.test.ts`
  - Description: Add AggregateAST, GroupBySpec, AggregateFunction, AggregateResult types
  - Acceptance: Types compile, test validates structure

- [ ] **T-1.2** Add MCP schema for tana_aggregate [P]
  - File: `src/mcp/schemas.ts`
  - Description: Add Zod schema for tana_aggregate input validation
  - Acceptance: Schema validates valid/invalid inputs

### Group 2: Core Service

- [ ] **T-2.1** Create AggregationService skeleton [T] (depends: T-1.1)
  - File: `src/services/aggregation-service.ts`
  - Test: `tests/services/aggregation-service.test.ts`
  - Description: Create class with constructor accepting Database
  - Acceptance: Service instantiates, basic test passes

- [ ] **T-2.2** Implement parseGroupBy [T] (depends: T-2.1)
  - File: `src/services/aggregation-service.ts`
  - Test: `tests/services/aggregation-service.test.ts`
  - Description: Parse "Status,month" -> GroupBySpec[]
  - Acceptance: Parses field names, time periods (day/week/month/quarter/year)

- [ ] **T-2.3** Implement formatTimePeriod [T] (depends: T-2.1)
  - File: `src/services/aggregation-service.ts`
  - Test: `tests/services/aggregation-service.test.ts`
  - Description: Generate SQLite strftime expressions for time grouping
  - Acceptance: Returns correct strftime for each period type

- [ ] **T-2.4** Implement single-field aggregation [T] (depends: T-2.2, T-2.3)
  - File: `src/services/aggregation-service.ts`
  - Test: `tests/services/aggregation-service.test.ts`
  - Description: GROUP BY single field with COUNT(*)
  - Acceptance: Returns { "Done": 10, "Open": 5 } structure

- [ ] **T-2.5** Implement two-field nested aggregation [T] (depends: T-2.4)
  - File: `src/services/aggregation-service.ts`
  - Test: `tests/services/aggregation-service.test.ts`
  - Description: GROUP BY two fields with nested result structure
  - Acceptance: Returns { "Done": { "High": 5, "Low": 5 }, ... }

- [ ] **T-2.6** Implement showPercent and top options [T] (depends: T-2.4)
  - File: `src/services/aggregation-service.ts`
  - Test: `tests/services/aggregation-service.test.ts`
  - Description: Calculate percentages, limit to top N groups
  - Acceptance: Percentages sum to ~100%, top N returns sorted subset

### Group 3: CLI Command

- [ ] **T-3.1** Create aggregate CLI command [T] (depends: T-2.5, T-2.6)
  - File: `src/commands/aggregate.ts`
  - Test: `tests/commands/aggregate.test.ts`
  - Description: supertag aggregate --tag --group-by --where --format
  - Acceptance: Command parses args, calls service, formats output

- [ ] **T-3.2** Register CLI command in index.ts (depends: T-3.1)
  - File: `src/index.ts`
  - Description: Add aggregate command to main CLI program
  - Acceptance: `supertag aggregate --help` works

### Group 4: MCP Tool

- [ ] **T-4.1** Create tana_aggregate MCP tool [T] (depends: T-2.5, T-2.6, T-1.2)
  - File: `src/mcp/tools/aggregate.ts`
  - Test: `tests/mcp/aggregate.test.ts`
  - Description: MCP tool that wraps AggregationService
  - Acceptance: Tool returns grouped results via MCP protocol

- [ ] **T-4.2** Register MCP tool (depends: T-4.1)
  - Files: `src/mcp/tool-registry.ts`, `src/mcp/index.ts`
  - Description: Register tana_aggregate in MCP server
  - Acceptance: Tool appears in tana_capabilities, callable via MCP

### Group 5: Documentation

- [ ] **T-5.1** Update tana_capabilities (depends: T-4.2)
  - File: `src/mcp/tools/capabilities.ts`
  - Description: Add tana_aggregate to capabilities list
  - Acceptance: Shows in capabilities output with description

- [ ] **T-5.2** Update documentation (depends: T-3.2, T-4.2)
  - Files: `CHANGELOG.md`, `README.md`
  - Description: Document aggregate command and MCP tool
  - Acceptance: Usage examples in docs

## Dependency Graph

```
T-1.1 ──┬──> T-2.1 ──> T-2.2 ──┬──> T-2.4 ──┬──> T-2.5 ──┬──> T-3.1 ──> T-3.2 ──┐
        │            │         │            │            │                      │
        │            └──> T-2.3┘            └──> T-2.6 ──┤                      ├──> T-5.2
        │                                                │                      │
T-1.2 ──┴────────────────────────────────────────────────┴──> T-4.1 ──> T-4.2 ──┤
                                                                                │
                                                                       T-5.1 <──┘
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2
2. **Sequential:** T-2.1 (after T-1.1)
3. **Parallel batch 2:** T-2.2, T-2.3 (after T-2.1)
4. **Sequential:** T-2.4 (after T-2.2, T-2.3)
5. **Parallel batch 3:** T-2.5, T-2.6 (after T-2.4)
6. **Parallel batch 4:** T-3.1, T-4.1 (after T-2.5, T-2.6)
7. **Parallel batch 5:** T-3.2, T-4.2 (after their respective deps)
8. **Sequential:** T-5.1 (after T-4.2)
9. **Sequential:** T-5.2 (after T-3.2, T-4.2)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Types foundation |
| T-1.2 | pending | - | - | MCP schema |
| T-2.1 | pending | - | - | Service skeleton |
| T-2.2 | pending | - | - | Parse group-by |
| T-2.3 | pending | - | - | Time formatting |
| T-2.4 | pending | - | - | Single-field GROUP BY |
| T-2.5 | pending | - | - | Two-field nesting |
| T-2.6 | pending | - | - | Percent & top-N |
| T-3.1 | pending | - | - | CLI command |
| T-3.2 | pending | - | - | CLI registration |
| T-4.1 | pending | - | - | MCP tool |
| T-4.2 | pending | - | - | MCP registration |
| T-5.1 | pending | - | - | Capabilities |
| T-5.2 | pending | - | - | Documentation |

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

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |
