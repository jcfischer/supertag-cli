---
feature: "Query Builder Utilities"
plan: "./plan.md"
status: "completed"
total_tasks: 7
completed: 7
---

# Tasks: Query Builder Utilities

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation

- [x] **T-1.1** Create TypeScript types and module structure [T]
  - File: `src/db/query-builder.ts`
  - Test: `src/db/query-builder.test.ts`
  - Description: Create interfaces (PaginationOptions, SortOptions, FilterCondition, BuiltQuery) and empty function stubs

- [x] **T-1.2** Implement buildPagination() [T] (depends: T-1.1)
  - File: `src/db/query-builder.ts`
  - Test: `src/db/query-builder.test.ts`
  - Description: LIMIT/OFFSET clause builder with parameter binding. Handle edge cases (zero, negative, undefined).

### Group 2: Core Builders

- [x] **T-2.1** Implement buildWhereClause() - basic operators [T] [P] (depends: T-1.2)
  - File: `src/db/query-builder.ts`
  - Test: `src/db/query-builder.test.ts`
  - Description: Handle =, !=, >, <, >=, <= operators with parameterized values

- [x] **T-2.2** Implement buildWhereClause() - special operators [T] (depends: T-2.1)
  - File: `src/db/query-builder.ts`
  - Test: `src/db/query-builder.test.ts`
  - Description: Handle LIKE, IN, IS NULL, IS NOT NULL operators. Empty array handling.

- [x] **T-2.3** Implement buildOrderBy() [T] [P] (depends: T-1.2)
  - File: `src/db/query-builder.ts`
  - Test: `src/db/query-builder.test.ts`
  - Description: Column validation against whitelist, direction handling, empty sort case

### Group 3: Integration

- [x] **T-3.1** Implement buildSelectQuery() [T] (depends: T-2.2, T-2.3)
  - File: `src/db/query-builder.ts`
  - Test: `src/db/query-builder.test.ts`
  - Description: Compose all builders into complete SELECT query. Handle all combinations.

- [x] **T-3.2** Export and integration test [T] (depends: T-3.1)
  - Files: `src/db/index.ts`, `src/db/query-builder.ts`
  - Test: `src/db/query-builder.test.ts`
  - Description: Export from db module, verify imports work, add integration tests

## Dependency Graph

```
T-1.1 ──> T-1.2 ──┬──> T-2.1 ──> T-2.2 ──┬──> T-3.1 ──> T-3.2
                  │                       │
                  └──> T-2.3 ────────────┘
```

## Execution Order

1. **Sequential:** T-1.1 (foundation types)
2. **Sequential:** T-1.2 (pagination builder)
3. **Parallel batch:** T-2.1, T-2.3 (WHERE basic + ORDER BY)
4. **Sequential:** T-2.2 (WHERE special operators, after T-2.1)
5. **Sequential:** T-3.1 (composite builder, after T-2.2 + T-2.3)
6. **Sequential:** T-3.2 (exports and integration)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | completed | 2025-12-31 | 2025-12-31 | Types and module structure |
| T-1.2 | completed | 2025-12-31 | 2025-12-31 | buildPagination() |
| T-2.1 | completed | 2025-12-31 | 2025-12-31 | buildWhereClause() basic ops |
| T-2.2 | completed | 2025-12-31 | 2025-12-31 | buildWhereClause() special ops |
| T-2.3 | completed | 2025-12-31 | 2025-12-31 | buildOrderBy() |
| T-3.1 | completed | 2025-12-31 | 2025-12-31 | buildSelectQuery() |
| T-3.2 | completed | 2025-12-31 | 2025-12-31 | Export and integration |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test --randomize`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Test Coverage Requirements

Each builder function needs tests for:
- **Happy path:** Valid inputs produce correct SQL
- **Empty/undefined:** Graceful handling of missing options
- **Edge cases:** Zero, negative, empty arrays
- **Security:** Parameterization verified (no string interpolation)

## Blockers & Issues

No blockers encountered during implementation.

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Implementation Summary

All 7 tasks completed with TDD workflow:
- 53 tests written and passing
- 108 expect() assertions
- Full test suite passes (1327 pass, 1 pre-existing failure unrelated)
- 6 commits on feature branch
