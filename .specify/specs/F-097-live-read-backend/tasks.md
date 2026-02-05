---
feature: "F-097 Live Read Backend"
plan: "./plan.md"
status: "pending"
total_tasks: 14
completed: 0
---

# Tasks: F-097 Live Read Backend

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Interface & Canonical Types

- [ ] **T-1.1** Define TanaReadBackend interface and canonical types [T]
  - File: `src/api/read-backend.ts`
  - Test: `tests/read-backend.test.ts`
  - Description: Create `TanaReadBackend` interface with `search()`, `readNode()`, `getChildren()`, `listTags()`, `isLive()`, `close()` methods. Define canonical types: `ReadSearchResult`, `ReadNodeContent`, `ReadTagInfo`, `PaginatedResult<T>`, `SearchOptions`, `ReadBackendType`. Type-level tests verifying interface compliance.

### Group 2: Backend Implementations

- [ ] **T-2.1** Implement LocalApiReadBackend [T] (depends: T-1.1)
  - File: `src/api/local-api-read-backend.ts`
  - Test: `tests/local-api-read-backend.test.ts`
  - Description: Implement `TanaReadBackend` using `LocalApiClient`. `search()` calls `client.searchNodes({ textContains: query })` and normalizes `SearchResultNode[]` → `ReadSearchResult[]` (extract tag names from `{id,name}` array, map breadcrumb, omit rank). `readNode()` calls `client.readNode(id, depth)` and normalizes `ReadNodeResponse` → `ReadNodeContent`. `getChildren()` normalizes `GetChildrenResponse`. `listTags()` normalizes `TagInfo[]`. `isLive()` returns `true`. `close()` is no-op. Tests use mocked `LocalApiClient`.

- [ ] **T-2.2** Implement SqliteReadBackend [T] (depends: T-1.1)
  - File: `src/api/sqlite-read-backend.ts`
  - Test: `tests/sqlite-read-backend.test.ts`
  - Description: Implement `TanaReadBackend` wrapping existing `TanaQueryEngine` and `getNodeContents`/`getNodeContentsWithDepth`. `search()` calls `engine.searchNodes()` + `engine.getNodeTags()`, normalizes rows → `ReadSearchResult[]`. `readNode()` uses `getNodeContents(db, id)` or `getNodeContentsWithDepth(db, id, 0, depth)` and formats to `ReadNodeContent` with markdown. `getChildren()` queries `parent_id` and paginates. `listTags()` queries `supertag_metadata`. `isLive()` returns `false`. `close()` closes DB. Tests use existing test fixtures/database.

- [ ] **T-2.3** Implement read backend resolver [T] (depends: T-2.1, T-2.2)
  - File: `src/api/read-backend-resolver.ts`
  - Test: `tests/read-backend-resolver.test.ts`
  - Description: Create `resolveReadBackend(options?)` with resolution: (1) `--offline` → SqliteReadBackend, (2) cached backend → return cache, (3) Local API configured + healthy → LocalApiReadBackend, (4) fallback → SqliteReadBackend. **Never throws** — always returns a usable backend. Session cache like write resolver. `clearReadBackendCache()` for testing. Reuses `ConfigManager.getLocalApiConfig()` and `LocalApiClient.health()`. Tests mock config and health check.

### Group 3: CLI Command Refactoring

- [ ] **T-3.1** Add --offline flag to standard CLI options [T] (depends: T-2.3)
  - File: `src/commands/helpers.ts`
  - Test: `tests/cli-offline-flag.test.ts`
  - Description: Add `--offline` option to `addStandardOptions()`. When set, forces SQLite read backend regardless of Local API availability. Passed through to `resolveReadBackend({ offline: true })`. Test that flag is parsed correctly and propagated.

- [ ] **T-3.2** Refactor search command FTS path [T] (depends: T-3.1)
  - File: `src/commands/search.ts`
  - Test: `tests/search-read-backend.test.ts`
  - Description: In `handleFtsSearch()`, replace `withQueryEngine` + `engine.searchNodes()` with `resolveReadBackend()` + `readBackend.search()`. Keep all existing formatting/output logic. When Local API is used, `breadcrumb` replaces ancestor resolution. When SQLite (offline or fallback), existing `findMeaningfulAncestor()` logic preserved. Semantic search path (`handleSemanticSearch`) untouched — stays on SQLite. Test both backends produce valid output through the command.

- [ ] **T-3.3** Refactor search command tagged path [T] (depends: T-3.1)
  - File: `src/commands/search.ts`
  - Test: `tests/search-tagged-read-backend.test.ts`
  - Description: In `handleTaggedSearch()`, when Local API available, use `readBackend.search()` with `{ hasType: tagId }` query instead of SQLite tag lookup. When SQLite, preserve existing `findNodesByTag()` behavior. Field filtering (`--field`) stays on SQLite for now (complex query logic). Test tag search produces consistent results from both backends.

- [ ] **T-3.4** Refactor nodes show command [T] (depends: T-3.1)
  - File: `src/commands/nodes.ts`
  - Test: `tests/nodes-show-read-backend.test.ts`
  - Description: In `nodes show` action, replace direct `getNodeContents(db, id)` / `getNodeContentsWithDepth()` with `readBackend.readNode(id, depth)`. Use `ReadNodeContent.markdown` for display. Keep all existing `--format` options working. `nodes refs` and other subcommands stay on SQLite (graph queries not in Local API). Test show output is valid from both backends.

- [ ] **T-3.5** Refactor tags list command [T] (depends: T-3.1)
  - File: `src/commands/tags.ts`
  - Test: `tests/tags-list-read-backend.test.ts`
  - Description: In `tags list` action, replace direct SQLite `supertag_metadata` query with `readBackend.listTags()`. Keep `tags top`, `tags show`, `tags fields`, `tags inheritance` on SQLite (complex analytics). Test tag list output matches format expectations from both backends.

- [ ] **T-3.6** Refactor nodes recent command [T] (depends: T-3.1)
  - File: `src/commands/nodes.ts`
  - Test: `tests/nodes-recent-read-backend.test.ts`
  - Description: In `nodes recent` action, when Local API available, use `readBackend.search()` with `{ edited: { last: days } }` query. When SQLite, use existing `recentlyUpdated()`. Normalize results to same output format. Test recent output from both backends.

### Group 4: MCP Tool Refactoring

- [ ] **T-4.1** Refactor tana_search MCP tool [T] (depends: T-2.3)
  - File: `src/mcp/tools/search.ts`
  - Test: `tests/mcp-search-read-backend.test.ts`
  - Description: Replace `new TanaQueryEngine(dbPath)` + `engine.searchNodes()` with `resolveReadBackend()` + `readBackend.search()`. When Local API, ancestor info comes from `breadcrumb`. When SQLite, existing `findMeaningfulAncestor()` preserved. Keep all existing fields in response (`workspace`, `query`, `results`, `count`). Test MCP tool returns valid results from both backends.

- [ ] **T-4.2** Refactor tana_node MCP tool [T] (depends: T-2.3)
  - File: `src/mcp/tools/node.ts`
  - Test: `tests/mcp-node-read-backend.test.ts`
  - Description: Replace direct SQLite `getNodeContentsBasic()` / `getNodeContentsWithDepth()` with `readBackend.readNode(id, depth)`. Return `ReadNodeContent.markdown` as the node content. Keep existing response structure. Test MCP tool returns valid node content from both backends.

### Group 5: Integration & Verification

- [ ] **T-5.1** Integration test: full read path with both backends [T] (depends: T-3.2, T-3.4, T-4.1)
  - File: `tests/read-backend-integration.test.ts`
  - Description: End-to-end test verifying: (1) SqliteReadBackend produces identical output to current behavior (regression test), (2) `--offline` flag forces SQLite even when Local API config exists, (3) Semantic search always uses SQLite regardless of backend, (4) All `--format` options work with both backends (table, json, csv, ids, minimal, jsonl). Uses test fixtures, no live Tana needed.

- [ ] **T-5.2** Update documentation (depends: T-5.1)
  - Files: `CLAUDE.md`, `README.md`, `CHANGELOG.md`
  - Description: Document `--offline` flag. Document that reads prefer Local API when available. Update architecture description in CLAUDE.md to reflect read backend. Add to CHANGELOG under [Unreleased]. No SKILL.md or public docs update needed until release.

## Dependency Graph

```
T-1.1 ──┬──> T-2.1 ──┐
         │            ├──> T-2.3 ──┬──> T-3.1 ──┬──> T-3.2 ──┐
         └──> T-2.2 ──┘            │             ├──> T-3.3    │
                                   │             ├──> T-3.4 ───┤
                                   │             ├──> T-3.5    │
                                   │             └──> T-3.6    │
                                   ├──> T-4.1 ─────────────────┼──> T-5.1 ──> T-5.2
                                   └──> T-4.2 ─────────────────┘
```

## Execution Order

1. **T-1.1** — Interface and types (foundation)
2. **Parallel batch:** T-2.1, T-2.2 (both backends, independent)
3. **T-2.3** — Resolver (depends on both backends)
4. **T-3.1** — `--offline` flag (small, enables all command refactors)
5. **Parallel batch:** T-3.2, T-3.3, T-3.4, T-3.5, T-3.6, T-4.1, T-4.2 (all independent command/MCP refactors)
6. **T-5.1** — Integration test (verifies everything)
7. **T-5.2** — Documentation

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | |
| T-2.1 | pending | - | - | |
| T-2.2 | pending | - | - | |
| T-2.3 | pending | - | - | |
| T-3.1 | pending | - | - | |
| T-3.2 | pending | - | - | |
| T-3.3 | pending | - | - | |
| T-3.4 | pending | - | - | |
| T-3.5 | pending | - | - | |
| T-3.6 | pending | - | - | |
| T-4.1 | pending | - | - | |
| T-4.2 | pending | - | - | |
| T-5.1 | pending | - | - | |
| T-5.2 | pending | - | - | |

## TDD Enforcement (MANDATORY)

**CRITICAL:** Every task marked [T] MUST follow the RED-GREEN-BLUE cycle. This is not optional.

### The TDD Cycle

For each task marked [T]:

1. **RED:** Write failing test FIRST
   - The test must fail before implementation
   - Run `bun run test` to verify it fails
   - If the test passes without implementation, the test is wrong

2. **GREEN:** Write MINIMAL implementation to pass
   - Only write enough code to make the test pass
   - Do not add extra features or "nice to haves"
   - Run `bun run test` to verify it passes

3. **BLUE:** Refactor while keeping tests green
   - Clean up code, remove duplication
   - Run `bun run test` after each change
   - Tests must stay green throughout

4. **VERIFY:** Run full test suite (`bun run test`)
   - ALL tests must pass, not just the new one
   - Check for regressions

### Test Coverage Requirements

- **Minimum ratio:** 0.3 (test files / source files)
- **Every source file** should have a corresponding test file
- **specflow complete** will REJECT features with insufficient coverage

### DO NOT Proceed Until:

- [ ] Test written BEFORE implementation (RED phase completed)
- [ ] Current task's tests pass (GREEN phase completed)
- [ ] Full test suite passes (no regressions)
- [ ] Test file ratio meets minimum (0.3)

### Common TDD Violations (AVOID)

- Writing implementation first, then tests (this is not TDD)
- Writing tests that pass immediately (test is meaningless)
- Skipping tests for "simple" code (all code needs tests)
- Moving to next task before current tests pass

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Post-Implementation Verification

**Before marking feature complete, verify:**

### Functional Verification
- [ ] All unit tests pass (`bun run test`)
- [ ] All integration tests pass (`bun run test:full`)
- [ ] `supertag search "query"` returns live results when Tana Desktop running
- [ ] `supertag nodes show <id>` returns live content from Tana
- [ ] `supertag search "query" --offline` uses SQLite
- [ ] `supertag search "query" --semantic` stays on SQLite
- [ ] All `--format` options produce correct output with both backends

### Failure Verification (Doctorow Gate)
- [ ] **Failure test:** Tana Desktop not running → SQLite fallback works silently
- [ ] **Assumption test:** Local API returns different data shape → Zod catches, falls back
- [ ] **Rollback test:** `--offline` flag restores pre-F-097 behavior exactly
- [ ] **Error messages:** SQLite missing produces actionable "run supertag sync" message

### Maintainability Verification
- [ ] **Documentation test:** CLAUDE.md explains read backend architecture
- [ ] **Debt recorded:** Added entry to project debt-ledger.md
- [ ] **No orphan code:** All new code is reachable and tested

### Sign-off
- [ ] All verification items checked
- [ ] Debt score calculated and recorded
- Date completed: ___
