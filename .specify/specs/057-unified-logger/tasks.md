---
feature: "Unified Logger"
plan: "./plan.md"
status: "completed"
total_tasks: 8
completed: 8
---

# Tasks: Unified Logger

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group

## Task Groups

### Group 1: Foundation

- [x] **T-1.1** Define TypeScript types and interfaces [T] [P]
  - File: `src/utils/logger.ts`
  - Test: `tests/logger.test.ts`
  - Description: Create LogLevel type, LoggerConfig interface, and Logger interface

- [x] **T-1.2** Implement level filtering [T] [P]
  - File: `src/utils/logger.ts`
  - Test: `tests/logger.test.ts`
  - Description: Implement shouldLog() logic with level priority (debug < info < warn < error)

- [x] **T-1.3** Implement pretty mode formatter [T] [P]
  - File: `src/utils/logger.ts`
  - Test: `tests/logger.test.ts`
  - Description: Format with emoji icons (🔍 debug, ℹ️ info, ⚠️ warn, ❌ error)

- [x] **T-1.4** Implement unix mode formatter [T] [P]
  - File: `src/utils/logger.ts`
  - Test: `tests/logger.test.ts`
  - Description: Format as `[LEVEL]\tmessage\tkey=value` (TSV style)

- [x] **T-1.5** Implement json mode formatter [T] [P]
  - File: `src/utils/logger.ts`
  - Test: `tests/logger.test.ts`
  - Description: Format as `{"level":"info","message":"...","data":{...}}`

### Group 2: Core Implementation

- [x] **T-2.1** Implement LoggerImpl class [T] (depends: T-1.1, T-1.2, T-1.3, T-1.4, T-1.5)
  - File: `src/utils/logger.ts`
  - Test: `tests/logger.test.ts`
  - Description: Complete logger class with createLogger() factory, stream injection, and all log methods

- [x] **T-2.2** Implement global logger pattern [T] (depends: T-2.1)
  - File: `src/utils/logger.ts`
  - Test: `tests/logger.test.ts`
  - Description: Add configureGlobalLogger(), getGlobalLogger(), hasGlobalLogger(), and child() method

### Group 3: Integration

- [x] **T-3.1** Wire into CLI entry points (depends: T-2.2)
  - Files: `src/index.ts`
  - Test: Manual verification
  - Description: Call configureGlobalLogger() at CLI startup with resolved output mode

## Dependency Graph

```
T-1.1 ──┬
T-1.2 ──┼──> T-2.1 ──> T-2.2 ──> T-3.1
T-1.3 ──┤
T-1.4 ──┤
T-1.5 ──┘
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2, T-1.3, T-1.4, T-1.5 (all foundation tasks)
2. **Sequential:** T-2.1 (after batch 1 complete)
3. **Sequential:** T-2.2 (after T-2.1)
4. **Sequential:** T-3.1 (after T-2.2)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | completed | 2026-01-01 | 2026-01-01 | Types and interfaces |
| T-1.2 | completed | 2026-01-01 | 2026-01-01 | Level filtering |
| T-1.3 | completed | 2026-01-01 | 2026-01-01 | Pretty formatter |
| T-1.4 | completed | 2026-01-01 | 2026-01-01 | Unix formatter |
| T-1.5 | completed | 2026-01-01 | 2026-01-01 | JSON formatter |
| T-2.1 | completed | 2026-01-01 | 2026-01-01 | LoggerImpl class |
| T-2.2 | completed | 2026-01-01 | 2026-01-01 | Global logger |
| T-3.1 | completed | 2026-01-01 | 2026-01-01 | CLI integration |

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
| T-3.1 | tana-export.ts uses external KAI logger | Skipped - tana-export is separate tool with its own logger |
