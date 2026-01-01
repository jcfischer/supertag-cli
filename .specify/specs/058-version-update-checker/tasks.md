---
feature: "Version Update Checker"
plan: "./plan.md"
status: "completed"
total_tasks: 14
completed: 14
---

# Tasks: Version Update Checker

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation

- [x] **T-1.1** Add update types to types.ts [T] [P]
  - File: `src/types.ts`
  - Test: `tests/update-service.test.ts` (type validation)
  - Description: Add GitHubRelease, GitHubAsset, UpdateCache, UpdateConfig, Platform, UpdateCheckResult, InstallResult types

- [x] **T-1.2** Implement version comparison utility [T] [P]
  - File: `src/services/update.ts`
  - Test: `tests/update-service.test.ts`
  - Description: Implement `compareVersions(a, b)` for semver comparison. Handle edge cases: pre-release, build metadata, missing components

- [x] **T-1.3** Implement platform detection [T] [P]
  - File: `src/services/update.ts`
  - Test: `tests/update-service.test.ts`
  - Description: Implement `detectPlatform()` using process.arch and process.platform. Map to Platform type

- [x] **T-1.4** Implement cache utilities [T] [P]
  - File: `src/services/update.ts`
  - Test: `tests/update-service.test.ts`
  - Description: Implement `getCache()`, `setCache()`, `isCacheStale()`. Use ~/.cache/supertag/update-cache.json

### Group 2: Core Features

- [x] **T-2.1** Implement GitHub API integration [T] (depends: T-1.1)
  - File: `src/services/update.ts`
  - Test: `tests/update-service.test.ts`
  - Description: Implement `fetchLatestRelease()` to call GitHub Releases API with proper headers and error handling

- [x] **T-2.2** Implement checkForUpdate [T] (depends: T-1.2, T-1.3, T-1.4, T-2.1)
  - File: `src/services/update.ts`
  - Test: `tests/update-service.test.ts`
  - Description: Main check function with cache logic, version comparison, and UpdateCheckResult generation

- [x] **T-2.3** Implement downloadUpdate [T] (depends: T-1.3)
  - File: `src/services/update.ts`
  - Test: `tests/update-service.test.ts`
  - Description: Streaming download with progress callback, file size verification

- [x] **T-2.4** Create update CLI commands [T] (depends: T-2.2, T-2.3)
  - File: `src/commands/update.ts`
  - Test: `tests/update-commands.test.ts`
  - Description: Implement `supertag update check` and `supertag update download` subcommands

### Group 3: Self-Update

- [x] **T-3.1** Implement installUpdate [T] (depends: T-2.3)
  - File: `src/services/update.ts`
  - Test: `tests/update-service.test.ts`
  - Description: Unzip, backup current binary, replace with new version. Handle permissions and rollback on failure

- [x] **T-3.2** Add install command to CLI [T] (depends: T-3.1, T-2.4)
  - File: `src/commands/update.ts`
  - Test: `tests/update-commands.test.ts`
  - Description: Implement `supertag update install` with confirmation, backup info, success/failure output

### Group 4: Integration

- [x] **T-4.1** Implement passive notification logic [T] (depends: T-2.2)
  - File: `src/services/update.ts`
  - Test: `tests/update-service.test.ts`
  - Description: Implement `shouldShowNotification()` and `markNotificationShown()`. Check cache age, notification frequency

- [x] **T-4.2** Add passive check hook to main CLI [T] (depends: T-4.1)
  - File: `src/index.ts`
  - Test: `tests/update-commands.test.ts`
  - Description: Non-blocking async check on CLI startup. Show one-line notification if update available

- [x] **T-4.3** Add updateCheck config option (depends: T-4.2)
  - File: `src/config/manager.ts`, `src/types.ts`
  - Test: `tests/update-commands.test.ts`
  - Description: Add `updateCheck: 'enabled' | 'disabled' | 'manual'` to TanaConfig. Wire into passive check

- [x] **T-4.4** Wire update command into main CLI (depends: T-3.2)
  - File: `src/index.ts`
  - Test: `tests/update-commands.test.ts`
  - Description: Register update command with subcommands in Commander.js setup

## Dependency Graph

```
T-1.1 ─────────────────┬──> T-2.1 ──┐
                       │            │
T-1.2 ──┬──────────────┼────────────┼──> T-2.2 ──┬──> T-4.1 ──> T-4.2 ──> T-4.3
        │              │            │            │
T-1.3 ──┼──> T-2.3 ────┼────────────┘            │
        │              │                         │
T-1.4 ──┘              │                         │
                       │                         │
                       └───> T-2.4 ──────────────┼──> T-3.2 ──> T-4.4
                                                 │
                       T-3.1 ────────────────────┘
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2, T-1.3, T-1.4 (Foundation)
2. **Parallel batch 2:** T-2.1, T-2.3 (after T-1.x complete)
3. **Sequential:** T-2.2 (after T-2.1 and all T-1.x)
4. **Sequential:** T-2.4 (after T-2.2, T-2.3)
5. **Parallel batch 3:** T-3.1, T-4.1 (after T-2.x)
6. **Sequential:** T-3.2 (after T-3.1, T-2.4)
7. **Sequential:** T-4.2 (after T-4.1)
8. **Sequential:** T-4.3 (after T-4.2)
9. **Sequential:** T-4.4 (after T-3.2)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | ✅ done | 2026-01-01 | 2026-01-01 | Types in src/services/update.ts |
| T-1.2 | ✅ done | 2026-01-01 | 2026-01-01 | Version comparison |
| T-1.3 | ✅ done | 2026-01-01 | 2026-01-01 | Platform detection |
| T-1.4 | ✅ done | 2026-01-01 | 2026-01-01 | Cache utilities |
| T-2.1 | ✅ done | 2026-01-01 | 2026-01-01 | GitHub API |
| T-2.2 | ✅ done | 2026-01-01 | 2026-01-01 | Check for update |
| T-2.3 | ✅ done | 2026-01-01 | 2026-01-01 | Download update |
| T-2.4 | ✅ done | 2026-01-01 | 2026-01-01 | CLI commands wired into index.ts |
| T-3.1 | ✅ done | 2026-01-01 | 2026-01-01 | Install update function |
| T-3.2 | ✅ done | 2026-01-01 | 2026-01-01 | Install CLI command |
| T-4.1 | ✅ done | 2026-01-01 | 2026-01-01 | Notification logic |
| T-4.2 | ✅ done | 2026-01-01 | 2026-01-01 | Passive check hook integrated |
| T-4.3 | ✅ done | 2026-01-01 | 2026-01-01 | Config option: updateCheck enabled/disabled/manual |
| T-4.4 | ✅ done | 2026-01-01 | 2026-01-01 | Update command wired (was done in T-2.4) |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Blockers & Issues

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Notes

- **No external dependencies** - Using native Bun fetch for HTTP
- **Cache location:** `~/.cache/supertag/update-cache.json`
- **Rate limiting:** GitHub allows 60 requests/hour unauthenticated; cache aggressively (24h)
- **Self-update risk:** Always backup before replace; implement rollback on failure
