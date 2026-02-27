# F-107 Verification Report: F-103 Sync Watch Mode

## Test Results

```
bun test tests/watch/

 70 pass
 0 fail
 161 expect() calls
Ran 70 tests across 6 files. [434.00ms]
```

All 70 watch-module tests pass across 6 test files:
- `snapshot.test.ts` — Snapshot query logic
- `differ.test.ts` — Pre/post snapshot diffing
- `event-log.test.ts` — JSONL event logging
- `hook-runner.test.ts` — Shell hook execution with timeout
- `watch-service.test.ts` — Orchestrator poll loop, backoff, hooks, dry-run
- `cli-integration.test.ts` — Interval clamping, option parsing

## Implementation Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/watch/types.ts` | 82 | ChangeEvent, NodeSnapshot, WatchState, WatchOptions, HookResult |
| `src/watch/snapshot.ts` | 61 | `takeSnapshot()` — SQLite snapshot with optional tag filter |
| `src/watch/differ.ts` | 106 | `diffSnapshots()` — create/modify/delete detection |
| `src/watch/event-log.ts` | 37 | `EventLogger` — append-only JSONL writer |
| `src/watch/hook-runner.ts` | 114 | `HookRunner` — shell exec with timeout, stdin piping, env vars |
| `src/watch/watch-service.ts` | 257 | `WatchService` — poll loop orchestrator |
| `src/watch/status-reporter.ts` | 96 | `StatusReporter` — periodic status output, startup banner |
| `src/commands/sync.ts` | +100 | `sync watch` subcommand (lines 639-736) |

## Functional Requirements Verification

| FR | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| FR-1 | `supertag sync --watch` starts continuous polling via Local API | **PASS** | Implemented as `sync watch` subcommand (sync.ts:644). `WatchService.start()` runs poll loop calling `DeltaSyncService.sync()` per cycle. Local API health check on startup (sync.ts:691-702). |
| FR-2 | `--interval <seconds>` sets poll frequency (default: 30, min: 5) | **PASS** | Option defined at sync.ts:647 with default "30". Clamping logic at sync.ts:669-675 clamps values below 5. 7 tests in cli-integration.test.ts verify clamping. |
| FR-3 | Detect new nodes created since last poll | **PASS** | `diffSnapshots()` in differ.ts:26-38 detects IDs present in `after` but not `before` as `'create'` events. Test `watch-service.test.ts:110-158` verifies end-to-end create detection. |
| FR-4 | Detect modified nodes (name, fields, tags changed) | **PASS** | differ.ts:42-78 detects modifications by comparing `name`, `updatedAt`, and `tags` arrays. Produces `changes.name` and `changes.tags` diff objects. Tests in differ.test.ts cover name change, tag add/remove, updatedAt change. |
| FR-5 | Detect deleted/trashed nodes | **PASS** | differ.ts:81-94 detects IDs in `before` but not `after` as `'delete'` events. Tests confirm delete detection. |
| FR-6 | `--filter-tag <supertag>` limits watching to specific type | **PASS** | Option at sync.ts:648. `takeSnapshot()` accepts `filterTag` parameter using INNER JOIN (snapshot.ts:32-39). Test `watch-service.test.ts:362-406` verifies only matching tagged nodes appear in events. |
| FR-7 | `--on-change <command>` executes shell command on changes | **PASS** | Option at sync.ts:649. `HookRunner.execute()` spawns `sh -c <command>`. `WatchService.dispatchHooks()` calls onChangeCmd with all events. Test at watch-service.test.ts:209-240 verifies. |
| FR-8 | Change events passed to hooks as JSON via stdin or env vars | **PASS** | hook-runner.ts:48 serializes events as JSON, pipes to stdin (line 59). Sets `SUPERTAG_WATCH_EVENT_COUNT` and `SUPERTAG_WATCH_EVENT_TYPE` env vars (lines 43-46). Tests in hook-runner.test.ts verify stdin and env vars. |
| FR-9 | `--on-create` / `--on-modify` / `--on-delete` type-specific hooks | **PASS** | Options at sync.ts:650-652. `dispatchHooks()` filters events by type before calling each hook (watch-service.ts:210-229). Test at watch-service.test.ts:242-274 verifies create-only filtering. |
| FR-10 | Event log: changes written to local JSONL file | **PASS** | `EventLogger.append()` writes one JSON line per event via `appendFileSync` (event-log.ts:27-28). Default path: `~/.local/share/supertag/workspaces/{alias}/watch-events.jsonl`. Custom path via `--event-log` (sync.ts:653). Tests in event-log.test.ts verify format. |
| FR-11 | `--dry-run` detects changes but doesn't execute hooks | **PASS** | Option at sync.ts:654 (default: false). watch-service.ts:179-183 skips `eventLogger.append()` and `dispatchHooks()` when dryRun is true, prints "(dry-run) Would dispatch N event(s)". Tests at watch-service.test.ts:160-205 and :276-307 both verify. |
| FR-12 | Graceful shutdown on SIGINT/SIGTERM with final sync | **PASS** | Signal handlers registered at watch-service.ts:90-95. `stop()` sets `running = false`, runs final delta-sync with 15s timeout (lines 138-145), logs "Stopped." Test output shows "[supertag watch] Running final delta-sync... [supertag watch] Stopped." |
| FR-13 | Status output: periodic summary of poll count, changes, hooks | **PASS** | `StatusReporter` prints banner on startup (options summary, Ctrl+C instruction) and periodic reports: `Poll #N | +M changes | H hooks run | F failed | running HH:MM:SS` (status-reporter.ts:37-46). Default interval: 5 minutes. |

## Non-Functional Requirements Verification

| NFR | Requirement | Status | Evidence |
|-----|-------------|--------|----------|
| NFR-1 | Idle CPU < 1% between polls | **PASS** | Watch loop uses `setTimeout` sleep (watch-service.ts:103), not busy-waiting. No CPU consumed between polls. |
| NFR-2 | Memory does not grow over time | **PASS** | Snapshot maps are created per cycle and discarded (local variables in `runPollCycle`). EventLogger uses `appendFileSync` (no in-memory accumulation). |
| NFR-3 | Clear error if Tana Desktop unavailable | **PASS** | sync.ts:694 prints "Local API not available. Watch mode requires Tana Desktop." on health check failure. |
| NFR-4 | Survives transient disconnections with backoff | **PASS** | `getBackoffMs()` implements exponential backoff: 5s, 10s, 20s, 40s, 60s cap. Tests verify sequence (watch-service.test.ts:19-25). Consecutive failures reset on success (test at line 333-359). |
| NFR-5 | Change detection is idempotent | **PASS** | Snapshot diffing compares pre/post state around each sync. Same node won't appear as changed unless its `name`, `updatedAt`, or `tags` actually differ between snapshots. |

## Architecture Verification

- **Subcommand pattern**: `sync watch` (not `sync --watch`) — cleaner separation confirmed at sync.ts:644.
- **Pre/post snapshot diffing**: No modifications to `DeltaSyncService` — watch wraps around it. Confirmed by reading watch-service.ts:158-168.
- **Sequential hook execution**: Hooks run sequentially via `for...of` loop (watch-service.ts:232-250).
- **JSONL event log**: Append-only via `appendFileSync`, no SQLite for events.
- **No new dependencies**: All code uses existing packages (bun:sqlite, node:fs, Bun.spawn).

## Edge Cases Verified

| Scenario | Status | Evidence |
|----------|--------|---------|
| Hook command fails (non-zero exit) | **PASS** | HookRunner captures exitCode, never throws (hook-runner.ts:97-103). WatchService logs error and continues (watch-service.ts:236-250). |
| Hook command timeout | **PASS** | 30s timeout → SIGTERM → 5s grace → SIGKILL (hook-runner.ts:64-78). `timedOut: true` in result. |
| Consecutive failures exceed max | **PASS** | watch-service.ts:109-119 exits with error code 1 and message after maxConsecutiveFailures. |
| Empty change set | **PASS** | EventLogger.append() no-ops on empty array (event-log.ts:25). Hooks not dispatched for empty filtered arrays (watch-service.ts:212-228). |

## Final Verdict

**PASS**

All 13 functional requirements and 5 non-functional requirements are implemented and verified. The implementation follows the planned architecture (pre/post snapshot diffing, sequential hooks, JSONL logging, exponential backoff). 70 tests pass across 6 test files with 161 assertions. The code is clean, well-structured, and introduces no new dependencies.
