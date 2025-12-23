---
feature: "Input API Consolidation"
plan: "./plan.md"
status: "completed"
total_tasks: 14
completed: 14
---

# Tasks: Input API Consolidation

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Types + Test Setup)

- [ ] **T-1.1** Add shared types to types.ts [T]
  - File: `src/types.ts`
  - Test: `src/services/node-builder.test.ts` (type tests)
  - Description: Add `ChildNodeInput`, `CreateNodeInput`, `CreateNodeResult` interfaces

- [ ] **T-1.2** Create test file with failing tests [T]
  - File: `src/services/node-builder.test.ts`
  - Description: Write 12 failing tests covering all 4 functions (RED state)
  - Tests cover: validateSupertags, buildChildNodes, buildNodePayload, createNode

### Group 2: Core Implementation (Shared Module)

- [ ] **T-2.1** Implement validateSupertags() [T] (depends: T-1.2)
  - File: `src/services/node-builder.ts`
  - Test: Tests 1-3 in node-builder.test.ts
  - Description: Parse comma-separated tags, validate against registry, return schemas or throw with suggestions

- [ ] **T-2.2** Implement buildChildNodes() [T] (depends: T-1.2)
  - File: `src/services/node-builder.ts`
  - Test: Tests 4-7 in node-builder.test.ts
  - Description: Convert ChildNodeInput[] to TanaApiNode[] (plain text, URL, reference)

- [ ] **T-2.3** Implement buildNodePayload() [T] (depends: T-2.1, T-2.2)
  - File: `src/services/node-builder.ts`
  - Test: Tests 8-10 in node-builder.test.ts
  - Description: Build complete TanaApiNode using registry.buildNodePayload + append children

- [ ] **T-2.4** Implement createNode() [T] (depends: T-2.3)
  - File: `src/services/node-builder.ts`
  - Test: Tests 11-12 in node-builder.test.ts
  - Description: Orchestrate validation, building, and API posting with dry-run support

- [ ] **T-2.5** Verify all new tests pass [T] (depends: T-2.4)
  - Test: `bun test src/services/node-builder.test.ts`
  - Description: Ensure GREEN state - all 12 tests pass

### Group 3: Integration (Refactor Consumers)

- [ ] **T-3.1** Refactor CLI create command [T] (depends: T-2.5)
  - File: `src/commands/create.ts`
  - Test: Existing MCP create tests + full suite
  - Description: Replace duplicated logic with calls to shared module, keep CLI-specific I/O

- [ ] **T-3.2** Refactor MCP create tool [T] (depends: T-2.5)
  - File: `src/mcp/tools/create.ts`
  - Test: `src/mcp/tools/__tests__/create.test.ts`
  - Description: Replace duplicated logic with calls to shared module, keep MCP-specific result handling

- [ ] **T-3.3** Verify existing tests pass [T] (depends: T-3.1, T-3.2)
  - Test: `bun test`
  - Description: Run full test suite, ensure no regressions

- [ ] **T-3.4** Remove dead code [P] (depends: T-3.3)
  - Files: `src/commands/create.ts`, `src/mcp/tools/create.ts`
  - Description: Delete now-unused helper functions from both files

### Group 4: Cleanup & Documentation

- [ ] **T-4.1** Add JSDoc to exported functions [P] (depends: T-3.3)
  - File: `src/services/node-builder.ts`
  - Description: Document all exported functions with usage examples

- [ ] **T-4.2** Verify test coverage >90% [T] (depends: T-3.4)
  - Test: `bun test --coverage`
  - Description: Ensure shared module has adequate test coverage

- [ ] **T-4.3** Final full test suite (depends: T-4.1, T-4.2)
  - Test: `bun test`
  - Description: Final verification all tests pass

## Dependency Graph

```
T-1.1 ──────────────────────────────────────────────────────────────┐
                                                                    │
T-1.2 ──┬──> T-2.1 ──┬──> T-2.3 ──> T-2.4 ──> T-2.5 ──┬──> T-3.1 ──┼──> T-3.3 ──> T-3.4 ──┬──> T-4.2 ──┐
        │            │                                │            │                      │           │
        └──> T-2.2 ──┘                                └──> T-3.2 ──┘                      └──> T-4.1   │
                                                                                                      │
                                                                                                      └──> T-4.3
```

## Execution Order

**Batch 1 (Parallel):**
- T-1.1: Add shared types
- T-1.2: Write failing tests

**Batch 2 (Parallel after T-1.2):**
- T-2.1: Implement validateSupertags
- T-2.2: Implement buildChildNodes

**Batch 3 (Sequential):**
- T-2.3: Implement buildNodePayload (depends on T-2.1, T-2.2)

**Batch 4 (Sequential):**
- T-2.4: Implement createNode (depends on T-2.3)

**Batch 5 (Sequential):**
- T-2.5: Verify new tests pass (GREEN state)

**Batch 6 (Parallel after T-2.5):**
- T-3.1: Refactor CLI
- T-3.2: Refactor MCP

**Batch 7 (Sequential):**
- T-3.3: Verify existing tests pass

**Batch 8 (Parallel after T-3.3):**
- T-3.4: Remove dead code
- T-4.1: Add JSDoc

**Batch 9 (Sequential):**
- T-4.2: Verify coverage

**Batch 10 (Final):**
- T-4.3: Final test suite

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | completed | 2025-12-22 | 2025-12-22 | Types for shared module |
| T-1.2 | completed | 2025-12-22 | 2025-12-22 | 12 failing tests (TDD RED) |
| T-2.1 | completed | 2025-12-22 | 2025-12-22 | validateSupertags() |
| T-2.2 | completed | 2025-12-22 | 2025-12-22 | buildChildNodes() |
| T-2.3 | completed | 2025-12-22 | 2025-12-22 | buildNodePayload() |
| T-2.4 | completed | 2025-12-22 | 2025-12-22 | createNode() |
| T-2.5 | completed | 2025-12-22 | 2025-12-22 | GREEN state verification |
| T-3.1 | completed | 2025-12-22 | 2025-12-22 | CLI refactor |
| T-3.2 | completed | 2025-12-22 | 2025-12-22 | MCP refactor |
| T-3.3 | completed | 2025-12-22 | 2025-12-22 | Regression test |
| T-3.4 | completed | 2025-12-22 | 2025-12-22 | Dead code removal |
| T-4.1 | completed | 2025-12-22 | 2025-12-22 | JSDoc documentation |
| T-4.2 | completed | 2025-12-22 | 2025-12-22 | Coverage verification (88.89% funcs) |
| T-4.3 | completed | 2025-12-22 | 2025-12-22 | Final verification (382 tests pass) |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Critical Path

The longest dependency chain is:

```
T-1.2 → T-2.1 → T-2.3 → T-2.4 → T-2.5 → T-3.1 → T-3.3 → T-3.4 → T-4.2 → T-4.3
```

**10 tasks in critical path** (other tasks can run in parallel batches)

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |
