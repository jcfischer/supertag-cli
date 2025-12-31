---
feature: "Batch Workspace Processor"
plan: "./plan.md"
status: "complete"
total_tasks: 10
completed: 10
---

# Tasks: Batch Workspace Processor

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation

- [x] **T-1.1** Define TypeScript interfaces [T]
  - File: `src/config/batch-processor.ts`
  - Test: `tests/batch-processor.test.ts`
  - Description: Create BatchOptions, WorkspaceResult<T>, BatchResult<T>, ProgressCallback types. Import ResolvedWorkspace from workspace-resolver.

- [x] **T-1.2** Implement resolveWorkspaceList() [T]
  - File: `src/config/batch-processor.ts`
  - Test: `tests/batch-processor.test.ts`
  - Description: Convert BatchOptions to array of workspace aliases. Handle --all, --workspaces list, single workspace, and default cases.

- [x] **T-1.3** Implement isBatchMode() [T] [P]
  - File: `src/config/batch-processor.ts`
  - Test: `tests/batch-processor.test.ts`
  - Description: Detect if options indicate multi-workspace operation. Returns true for all=true or workspaces.length > 1.

### Group 2: Core Implementation

- [x] **T-2.1** Implement processWorkspaces() sequential [T] (depends: T-1.1, T-1.2)
  - File: `src/config/batch-processor.ts`
  - Test: `tests/batch-processor.test.ts`
  - Description: Core processing function with sequential execution. Iterate workspaces, call operation, collect results, handle errors with stop-on-error default.

- [x] **T-2.2** Add parallel execution support [T] (depends: T-2.1)
  - File: `src/config/batch-processor.ts`
  - Test: `tests/batch-processor.test.ts`
  - Description: Add parallel option with chunked Promise.all execution. Respect concurrency limit (default 4).

- [x] **T-2.3** Implement createProgressLogger() [T] [P]
  - File: `src/config/batch-processor.ts`
  - Test: `tests/batch-processor.test.ts`
  - Description: Factory function returning ProgressCallback. Support 'pretty' mode (icons) and 'unix' mode (tab-separated).

- [x] **T-2.4** Re-export from config/index.ts (depends: T-2.1)
  - File: `src/config/index.ts`
  - Test: N/A (export only)
  - Description: Add exports for processWorkspaces, resolveWorkspaceList, isBatchMode, createProgressLogger, and batch types.

### Group 3: Integration

- [x] **T-3.1** Migrate sync command [T] (depends: T-2.4)
  - File: `src/commands/sync.ts`
  - Test: `tests/batch-integration.test.ts`
  - Description: Replace manual batch loops in index, status, cleanup actions with processWorkspaces(). Preserve existing --all behavior.

- [x] **T-3.2** Migrate embed command [T] [P] (depends: T-2.4)
  - File: `src/commands/embed.ts`
  - Test: `tests/batch-integration.test.ts`
  - Description: Replace --all-workspaces loop with processWorkspaces(). Keep existing progress reporting via callback.

- [x] **T-3.3** Migrate tana-export CLI [T] [P] (depends: T-2.4)
  - File: `src/cli/tana-export.ts`
  - Test: `tests/batch-integration.test.ts`
  - Description: Replace --all loop with processWorkspaces(). Maintain exit codes (1 if any failures).

## Dependency Graph

```
          ┌─────────┐
          │  T-1.1  │  Types
          └────┬────┘
               │
          ┌────▼────┐     ┌─────────┐
          │  T-1.2  │     │  T-1.3  │  [P]
          └────┬────┘     └────┬────┘
               │               │
               └───────┬───────┘
                       │
                  ┌────▼────┐
                  │  T-2.1  │  processWorkspaces (sequential)
                  └────┬────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
     ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
     │  T-2.2  │  │  T-2.3  │  │  T-2.4  │  [P]
     └─────────┘  └─────────┘  └────┬────┘
                                    │
               ┌────────────────────┼────────────────────┐
               │                    │                    │
          ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
          │  T-3.1  │          │  T-3.2  │          │  T-3.3  │  [P]
          │  sync   │          │  embed  │          │ export  │
          └─────────┘          └─────────┘          └─────────┘
```

## Execution Order

1. **Sequential:** T-1.1 (types must exist first)
2. **Parallel batch 1:** T-1.2, T-1.3
3. **Sequential:** T-2.1 (core function, depends on T-1.x)
4. **Parallel batch 2:** T-2.2, T-2.3, T-2.4
5. **Parallel batch 3:** T-3.1, T-3.2, T-3.3 (command migrations)

**Critical Path:** T-1.1 → T-1.2 → T-2.1 → T-2.4 → T-3.1 (5 sequential steps)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | complete | 2025-12-31 | 2025-12-31 | Types and interfaces |
| T-1.2 | complete | 2025-12-31 | 2025-12-31 | Workspace list resolution |
| T-1.3 | complete | 2025-12-31 | 2025-12-31 | Batch mode detection |
| T-2.1 | complete | 2025-12-31 | 2025-12-31 | Core sequential processing |
| T-2.2 | complete | 2025-12-31 | 2025-12-31 | Parallel execution |
| T-2.3 | complete | 2025-12-31 | 2025-12-31 | Progress logger factory |
| T-2.4 | complete | 2025-12-31 | 2025-12-31 | Config re-exports |
| T-3.1 | complete | 2025-12-31 | 2025-12-31 | sync command migration |
| T-3.2 | complete | 2025-12-31 | 2025-12-31 | embed command migration |
| T-3.3 | complete | 2025-12-31 | 2025-12-31 | tana-export migration |

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

### Unit Tests (batch-processor.test.ts)

```typescript
describe('resolveWorkspaceList', () => {
  // T-1.2: All cases from spec
  - should return all workspaces when all=true
  - should return explicit workspaces array
  - should return single workspace
  - should default to main workspace
});

describe('isBatchMode', () => {
  // T-1.3: Edge cases
  - should return true for all=true
  - should return true for multiple workspaces
  - should return false for single workspace
  - should return false for workspaces=[single]
});

describe('processWorkspaces', () => {
  // T-2.1: Sequential processing
  - should process single workspace
  - should process all workspaces
  - should stop on error by default
  - should continue on error when configured
  - should call progress callback
  - should track duration per workspace

  // T-2.2: Parallel processing
  - should support parallel execution
  - should respect concurrency limit
});

describe('createProgressLogger', () => {
  // T-2.3: Output formatting
  - should return pretty formatter with icons
  - should return unix formatter with TSV
});
```

### Integration Tests (batch-integration.test.ts)

```typescript
describe('sync command --all', () => {
  - should use processWorkspaces internally
  - should maintain existing exit code behavior
});

describe('embed command --all-workspaces', () => {
  - should process all workspaces
  - should report progress correctly
});

describe('tana-export --all', () => {
  - should export all enabled workspaces
  - should exit 1 if any workspace fails
});
```

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Notes

- Integration tasks (T-3.x) are parallelizable but may share test fixtures
- Stats command --all support deferred to separate enhancement (not in scope)
- Consider adding --workspaces "main,books" comma-separated syntax in future
