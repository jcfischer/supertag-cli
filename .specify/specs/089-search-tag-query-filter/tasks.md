---
feature: "Search Tag Query Filter"
plan: "./plan.md"
status: "pending"
total_tasks: 8
completed: 0
---

# Tasks: Search Tag Query Filter

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Query Engine Foundation

- [ ] **T-1.1** Add nameContains test for findNodesByTag [T]
  - File: `tests/unit/search-tag-query.test.ts` (NEW)
  - Test: Write failing test for `findNodesByTag({ nameContains: 'velo' })`
  - Description: Create test file with test data (nodes with tag "topic": Velo, Bikepacking, Running). Test that nameContains filters case-insensitively.

- [ ] **T-1.2** Implement nameContains in findNodesByTag [T] (depends: T-1.1)
  - File: `src/query/tana-query-engine.ts`
  - Test: T-1.1 should pass
  - Description: Add `nameContains?: string` to options. Add SQL: `AND LOWER(n.name) LIKE '%' || LOWER(?) || '%'`

- [ ] **T-1.3** Add regression test for findNodesByTag without nameContains [T] (depends: T-1.2)
  - File: `tests/unit/search-tag-query.test.ts`
  - Test: Verify all nodes returned when nameContains not provided
  - Description: Ensure existing behavior preserved - no filter when param omitted

### Group 2: CLI Layer

- [ ] **T-2.1** Add test for handleTaggedSearch with query [T] (depends: T-1.2)
  - File: `tests/unit/search-tag-query.test.ts`
  - Test: Mock engine and verify query is passed as nameContains
  - Description: Write failing test that handleTaggedSearch passes query to engine

- [ ] **T-2.2** Modify handleTaggedSearch to accept query [T] (depends: T-2.1)
  - File: `src/commands/search.ts`
  - Test: T-2.1 should pass
  - Description: Add `query?: string` parameter, pass to `findNodesByTag` as `nameContains`

- [ ] **T-2.3** Update search command call site [T] (depends: T-2.2)
  - File: `src/commands/search.ts` (line 162)
  - Test: Integration test for CLI
  - Description: Change `handleTaggedSearch(options.tag!, options, dbPath)` to include query

### Group 3: MCP Integration

- [ ] **T-3.1** Update taggedSchema with query parameter [T] [P] (depends: T-1.2)
  - File: `src/mcp/schemas.ts`
  - Test: Schema validation test
  - Description: Add `query: z.string().optional()` to taggedSchema

- [ ] **T-3.2** Update tagged() MCP tool to use query [T] (depends: T-3.1, T-1.2)
  - File: `src/mcp/tools/tagged.ts`
  - Test: MCP tool test
  - Description: Pass `input.query` to `findNodesByTag` as `nameContains`

### Group 4: E2E Verification

- [ ] **T-4.1** E2E test for CLI search with query + tag [T] (depends: T-2.3)
  - File: `tests/e2e/search-tag-query.e2e.test.ts` (NEW)
  - Test: `bun run src/index.ts search "Velo" --tag topic --format json`
  - Description: Verify CLI returns only matching nodes

## Dependency Graph

```
T-1.1 ──> T-1.2 ──> T-1.3
            │
            ├──> T-2.1 ──> T-2.2 ──> T-2.3 ──> T-4.1
            │
            └──> T-3.1 ──> T-3.2
```

## Execution Order

1. **Sequential:** T-1.1 (foundation test)
2. **Sequential:** T-1.2 (implement nameContains)
3. **Parallel batch 1:** T-1.3, T-2.1, T-3.1 (all depend only on T-1.2)
4. **Sequential:** T-2.2 (after T-2.1)
5. **Parallel batch 2:** T-2.3, T-3.2 (T-2.3 after T-2.2, T-3.2 after T-3.1)
6. **Sequential:** T-4.1 (E2E after T-2.3)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | completed | 2026-01-07 | 2026-01-07 | 7 tests for nameContains |
| T-1.2 | completed | 2026-01-07 | 2026-01-07 | SQL LIKE filter |
| T-1.3 | completed | 2026-01-07 | 2026-01-07 | Included in T-1.1 tests |
| T-2.1 | completed | 2026-01-07 | 2026-01-07 | Verified via CLI testing |
| T-2.2 | completed | 2026-01-07 | 2026-01-07 | Added query param |
| T-2.3 | completed | 2026-01-07 | 2026-01-07 | Updated call site + fallback |
| T-3.1 | completed | 2026-01-07 | 2026-01-07 | Added query to schema |
| T-3.2 | completed | 2026-01-07 | 2026-01-07 | Pass query to engine |
| T-4.1 | pending | - | - | E2E verification |

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

## Post-Implementation Verification

**Before marking feature complete, verify:**

### Functional Verification
- [ ] All unit tests pass (`bun run test`)
- [ ] All E2E tests pass
- [ ] `supertag search "Bikepacking" --tag topic` returns only matching nodes
- [ ] `supertag search --tag topic` returns all nodes (regression)
- [ ] MCP `tana_tagged { tagname: "topic", query: "Velo" }` works

### Failure Verification (Doctorow Gate)
- [ ] **Empty results:** Search with non-matching query shows empty result, not error
- [ ] **Invalid tag:** Still shows "tag not found" error
- [ ] **Case handling:** Both "velo" and "VELO" match "Velo"

### Maintainability Verification
- [ ] **No orphan code:** All new code is reachable and tested
- [ ] **CHANGELOG updated:** Added entry for the fix

### Sign-off
- [ ] All verification items checked
- [ ] Tests: `bun run test` passes
- [ ] TypeCheck: `bun run typecheck` passes
- Date completed: ___
