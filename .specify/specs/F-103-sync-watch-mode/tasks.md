# Implementation Tasks: F-103 Sync Watch Mode

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ✅ | Types & interfaces |
| T-1.2 | ✅ | Snapshot queries |
| T-1.3 | ✅ | Snapshot diffing |
| T-2.1 | ✅ | Event logger |
| T-2.2 | ✅ | Hook runner |
| T-3.1 | ✅ | WatchService orchestrator |
| T-4.1 | ✅ | CLI integration |
| T-5.1 | ✅ | Status reporter |

---

## Group 1: Foundation — Types & Snapshot Diffing

### T-1.1: Create type definitions [T]
- **File:** `src/watch/types.ts`
- **Test:** none (types only, validated by TypeScript compiler)
- **Dependencies:** none
- **Description:** Define all TypeScript interfaces for the watch module:
  - `ChangeType` (`'create' | 'modify' | 'delete'`)
  - `ChangeEvent` — with `type`, `timestamp`, `pollCycle`, `node` (id, name, tags), optional `changes` (name/tags before/after)
  - `NodeSnapshot` — `id`, `name`, `tags: string[]`, `updatedAt: number`
  - `WatchState` — `pollCount`, `changesDetected`, `hooksExecuted`, `hooksFailed`, `startedAt`, `lastPollAt`, `consecutiveFailures`
  - `WatchOptions` — `workspace`, `interval`, `filterTag?`, `onChangeCmd?`, `onCreateCmd?`, `onModifyCmd?`, `onDeleteCmd?`, `eventLogPath?`, `dryRun`, `maxConsecutiveFailures`
  - `HookResult` — `command`, `exitCode`, `timedOut`, `durationMs`, `stderr?`

### T-1.2: Implement snapshot queries [T]
- **File:** `src/watch/snapshot.ts`
- **Test:** `tests/watch/snapshot.test.ts`
- **Dependencies:** T-1.1
- **Description:** Implement `takeSnapshot(db: Database, filterTag?: string): Map<string, NodeSnapshot>` using raw SQL.
  - Without `filterTag`: LEFT JOIN `tag_applications`, GROUP_CONCAT tag names per node
  - With `filterTag`: INNER JOIN `tag_applications` WHERE `tag_name = ?`, GROUP_CONCAT tags
  - Returns `Map<nodeId, NodeSnapshot>` with `tags` parsed from comma-separated string
  - Tests: empty DB, nodes without tags, nodes with single tag, nodes with multiple tags, tag filter matching and non-matching nodes

### T-1.3: Implement snapshot differ [T] [P with T-2.1, T-2.2]
- **File:** `src/watch/differ.ts`
- **Test:** `tests/watch/differ.test.ts`
- **Dependencies:** T-1.1
- **Description:** Implement `diffSnapshots(before: Map<string, NodeSnapshot>, after: Map<string, NodeSnapshot>, pollCycle: number): ChangeEvent[]`:
  - `create`: ID in `after` but not `before`
  - `modify`: ID in both, but `name` or `updatedAt` or `tags` differ — include `changes.name` / `changes.tags` diffs
  - `delete`: ID in `before` but not `after`
  - Use `new Date().toISOString()` for `timestamp`
  - Tests: empty before+after, create only, modify by name, modify by tags (added/removed), delete, mixed batch, no changes returns empty array

---

## Group 2: Side-Effect Infrastructure

### T-2.1: Implement event logger [T] [P with T-1.3, T-2.2]
- **File:** `src/watch/event-log.ts`
- **Test:** `tests/watch/event-log.test.ts`
- **Dependencies:** T-1.1
- **Description:** Implement `EventLogger` class:
  - Constructor: `(logPath: string)`
  - `append(events: ChangeEvent[]): void` — appends one JSON line per event using `appendFileSync`; silently no-ops on empty array
  - `defaultLogPath(workspaceAlias: string): string` — resolves to `~/.local/share/supertag/workspaces/{alias}/watch-events.jsonl`
  - Tests: writes valid JSONL (one line per event), appends to existing file, empty array writes nothing, path resolution

### T-2.2: Implement hook runner [T] [P with T-1.3, T-2.1]
- **File:** `src/watch/hook-runner.ts`
- **Test:** `tests/watch/hook-runner.test.ts`
- **Dependencies:** T-1.1
- **Description:** Implement `HookRunner` class:
  - Constructor: `({ timeoutMs?: number })` (default 30_000)
  - `execute(command: string, events: ChangeEvent[]): Promise<HookResult>` — spawns `sh -c <command>`, pipes `JSON.stringify(events)` to stdin, sets `SUPERTAG_WATCH_EVENT_COUNT` and `SUPERTAG_WATCH_EVENT_TYPE` env vars
  - On timeout: SIGTERM → wait 5s → SIGKILL; sets `timedOut: true`
  - Never throws — all errors captured in `HookResult`
  - Tests: successful command (exit 0), failing command (non-zero exit), timeout triggers kill, stdin receives valid JSON, env vars set correctly

---

## Group 3: WatchService Orchestrator

### T-3.1: Implement WatchService [T]
- **File:** `src/watch/watch-service.ts`
- **Test:** `tests/watch/watch-service.test.ts`
- **Dependencies:** T-1.2, T-1.3, T-2.1, T-2.2
- **Description:** Implement `WatchService` class as the main poll loop orchestrator:
  - Constructor: `(options: WatchOptions, deps: { deltaSyncService, db, localApiClient, eventLogger?, hookRunner? })`
  - `start(): Promise<void>` — runs poll loop until `stop()` called; registers `SIGINT`/`SIGTERM` handlers for graceful shutdown
  - `stop(): Promise<void>` — sets `running = false`, waits for in-flight hook (up to 10s), runs one final delta-sync (15s timeout), logs final status
  - Per poll cycle:
    1. `takeSnapshot(db, filterTag)` → `before`
    2. `DeltaSyncService.sync()` with error catching
    3. `takeSnapshot(db, filterTag)` → `after`
    4. `diffSnapshots(before, after, pollCount)`
    5. If not dry-run: `eventLogger.append(events)` and dispatch hooks
    6. Increment `pollCount`, `changesDetected`, update `lastPollAt`
  - Backoff: on sync failure, use `getBackoffMs(consecutiveFailures)` (5s, 10s, 20s, 40s, 60s cap); exit after `maxConsecutiveFailures`
  - Hook dispatch: `onChangeCmd` with all events, `onCreateCmd`/`onModifyCmd`/`onDeleteCmd` with filtered events (skip if empty)
  - `getStatus(): WatchState` — returns current state snapshot
  - Tests: mock DeltaSyncService and LocalApiClient; test poll cycles detected creates/modifies/deletes; test backoff on sync failure; test graceful shutdown; test dry-run skips hooks; test filter-tag applied to snapshots

---

## Group 4: CLI Integration

### T-4.1: Add `sync watch` subcommand [T]
- **File:** `src/commands/sync.ts` (modify existing)
- **Test:** `tests/watch/cli-integration.test.ts`
- **Dependencies:** T-3.1
- **Description:** Add `sync.command("watch")` subcommand to the existing `sync` command group:
  - Options: `-w/--workspace <alias>`, `-i/--interval <seconds>` (default: 30, min: 5 validation), `-t/--filter-tag <tag>`, `--on-change <command>`, `--on-create <command>`, `--on-modify <command>`, `--on-delete <command>`, `--event-log <path>`, `--dry-run`, `--max-failures <n>` (default: 10)
  - Action handler: resolve workspace via `resolveWorkspaceContext()`, verify Local API available via `LocalApiClient.health()` (clear error if unavailable: "Local API not available. Watch mode requires Tana Desktop."), instantiate `WatchService`, call `start()`
  - Interval validation: if `< 5`, print warning and clamp to 5
  - Tests: interval clamping, workspace resolution error, dry-run flag passthrough, missing Local API error message

---

## Group 5: Status Reporter & Polish

### T-5.1: Implement status reporter [T] [P with T-4.1]
- **File:** `src/watch/status-reporter.ts`
- **Test:** (inline in `watch-service.test.ts` — verify status output format)
- **Dependencies:** T-1.1
- **Description:** Implement `StatusReporter` class for periodic console status output:
  - Constructor: `(intervalMs: number)` — default every 5 poll cycles or 5 minutes, whichever comes first
  - `report(state: WatchState): void` — prints concise summary to stderr:
    ```
    [supertag watch] Poll #42 | +3 changes (2 creates, 1 modify) | 5 hooks run | 0 failed | running 00:12:34
    ```
  - `start(getState: () => WatchState): void` / `stop(): void` — manages setInterval
  - Startup banner: print options summary on first start (workspace, interval, tag filter if set, hook commands if set)
  - Tests: output format matches expected pattern, running time formatting (HH:MM:SS), no output when no changes since last report

---

## Execution Order

```
T-1.1 (no deps)
  ├── T-1.2 (requires T-1.1)
  ├── T-1.3 (requires T-1.1) ──────────────────────┐
  ├── T-2.1 (requires T-1.1) [parallel with T-1.3]  │
  └── T-2.2 (requires T-1.1) [parallel with T-1.3]  │
                                                      │
T-3.1 (requires T-1.2, T-1.3, T-2.1, T-2.2) ←───────┘
  ├── T-4.1 (requires T-3.1)
  └── T-5.1 (requires T-1.1, parallel with T-4.1)
```

Minimum critical path: **T-1.1 → T-1.2 → T-3.1 → T-4.1** (T-1.3, T-2.1, T-2.2 in parallel with each other after T-1.1)

---

## Test Coverage Requirements

Each test file should cover:

| File | Key Scenarios |
|------|--------------|
| `snapshot.test.ts` | Empty DB, no tags, single/multi tags, tag filter |
| `differ.test.ts` | Create, modify (name/tags), delete, mixed, no-op |
| `event-log.test.ts` | JSONL format, append behavior, empty no-op, path resolution |
| `hook-runner.test.ts` | Success, failure, timeout, stdin JSON, env vars |
| `watch-service.test.ts` | Poll cycle, backoff, graceful shutdown, dry-run, hook dispatch |
| `cli-integration.test.ts` | Interval clamping, Local API error, flag passthrough |
