# Technical Plan: F-103 Sync Watch Mode

## Architecture Overview

```
┌──────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  CLI Command     │     │  WatchService    │     │  LocalApiClient   │
│  sync watch      │────>│  (orchestrator)  │────>│  (HTTP client)    │
│  --interval 30   │     │                  │     │  health() /       │
│  --on-change cmd │     │  poll loop       │     │  searchNodes()    │
│  --filter-tag X  │     │  change detect   │     └───────────────────┘
└──────────────────┘     │  hook dispatch   │               │
                         │  event logging   │               v
                         └────────┬─────────┘     ┌───────────────────┐
                                  │               │  Tana Desktop     │
                    ┌─────────────┼──────┐        │  Local API        │
                    │             │      │        │  :8262            │
                    v             v      v        └───────────────────┘
            ┌────────────┐ ┌──────────┐ ┌──────────────┐
            │ HookRunner │ │ EventLog │ │ DeltaSync    │
            │ (shell     │ │ (JSONL   │ │ Service      │
            │  executor) │ │  writer) │ │ (merge +     │
            └────────────┘ └──────────┘ │  watermark)  │
                                        └──────┬───────┘
                                               v
                                        ┌──────────────┐
                                        │  SQLite DB   │
                                        │  nodes,      │
                                        │  sync_meta   │
                                        └──────────────┘
```

### Data Flow Per Poll Cycle

```
1. Wait --interval seconds
2. Snapshot: read current nodes from SQLite (by tag filter if set)
3. DeltaSyncService.sync() → merges remote changes into SQLite
4. Diff: compare pre-sync snapshot with post-sync state → ChangeEvent[]
5. Filter: apply --filter-tag if specified
6. Log: append events to JSONL file
7. Dispatch: execute hooks (--on-change, --on-create, --on-modify, --on-delete)
8. Update: store poll metadata
9. Report: periodic status summary
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard; fast startup, native SQLite |
| CLI | Commander.js | Project pattern; `sync.command("watch")` subcommand |
| HTTP | LocalApiClient | Already handles retries, auth, Zod validation |
| Database | SQLite (bun:sqlite) | Existing workspace DB; snapshot-based diffing |
| Shell execution | Bun.spawn / `child_process` | Hook execution with timeout + stdin piping |
| Event log | JSONL via `appendFileSync` | Append-only, no accumulation in memory |
| Signal handling | `process.on('SIGINT')` | Graceful shutdown pattern |

**No new dependencies required.** Everything builds on existing infrastructure.

## Data Model

### ChangeEvent (core type)

```typescript
// src/watch/types.ts

export type ChangeType = 'create' | 'modify' | 'delete';

export interface ChangeEvent {
  type: ChangeType;
  timestamp: string;           // ISO 8601
  pollCycle: number;           // Monotonic cycle counter
  node: {
    id: string;
    name: string;
    tags: string[];            // Supertag names
  };
  changes?: {                  // Only for 'modify' type
    name?: { before: string; after: string };
    tags?: { added: string[]; removed: string[] };
  };
}
```

### NodeSnapshot (for diffing)

```typescript
// src/watch/types.ts

export interface NodeSnapshot {
  id: string;
  name: string;
  tags: string[];              // From tag_applications table
  updatedAt: number;           // updated column (ms timestamp)
}
```

### WatchState (runtime state)

```typescript
// src/watch/types.ts

export interface WatchState {
  pollCount: number;
  changesDetected: number;
  hooksExecuted: number;
  hooksFailed: number;
  startedAt: string;           // ISO 8601
  lastPollAt: string | null;
  consecutiveFailures: number;
}
```

### WatchOptions (CLI-derived config)

```typescript
// src/watch/types.ts

export interface WatchOptions {
  workspace: string;
  interval: number;            // Seconds (default: 30, min: 5)
  filterTag?: string;          // Supertag name filter
  onChangeCmd?: string;        // Shell command for any change
  onCreateCmd?: string;        // Shell command for creates only
  onModifyCmd?: string;        // Shell command for modifies only
  onDeleteCmd?: string;        // Shell command for deletes only
  eventLogPath?: string;       // Custom JSONL path (default: auto)
  dryRun: boolean;             // Detect changes but don't execute hooks
  maxConsecutiveFailures: number; // Default: 10
}
```

## Change Detection Strategy

### Approach: Pre/Post Snapshot Diffing

Rather than modifying `DeltaSyncService` internals, we take snapshots around existing sync:

```
1. PRE-SNAPSHOT: Query SQLite for all nodes (filtered by tag if --filter-tag)
   → Map<nodeId, NodeSnapshot>

2. SYNC: Run DeltaSyncService.sync() — this merges changes into SQLite

3. POST-SNAPSHOT: Query SQLite again for the same set
   → Map<nodeId, NodeSnapshot>

4. DIFF:
   - In POST but not PRE → 'create'
   - In both but name/tags/updatedAt changed → 'modify'
   - In PRE but not POST → 'delete' (trashed)
```

**Why this approach:**
- `DeltaSyncService` already handles the hard work (pagination, merge, watermark)
- No modifications to `DeltaSyncService` needed
- Snapshot diffing is simple, testable, and decoupled
- Tag filtering is trivial on the snapshot query

### Snapshot Query

```sql
-- All nodes (no tag filter)
SELECT n.id, n.name, n.updated,
  GROUP_CONCAT(ta.tag_name, ',') as tags
FROM nodes n
LEFT JOIN tag_applications ta ON n.id = ta.node_id
GROUP BY n.id

-- With tag filter
SELECT n.id, n.name, n.updated,
  GROUP_CONCAT(ta.tag_name, ',') as tags
FROM nodes n
JOIN tag_applications ta ON n.id = ta.node_id
WHERE ta.tag_name = ?
GROUP BY n.id
```

## Hook Execution Model

### HookRunner

```typescript
// src/watch/hook-runner.ts

export interface HookResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stderr?: string;
}

export class HookRunner {
  private readonly timeoutMs: number;  // Default: 30_000

  async execute(command: string, events: ChangeEvent[]): Promise<HookResult>;
}
```

**Execution details:**
- Spawns shell command via `Bun.spawn(['sh', '-c', command])`
- Pipes JSON array of `ChangeEvent[]` to stdin
- Sets `SUPERTAG_WATCH_EVENT_COUNT` environment variable
- Sets `SUPERTAG_WATCH_EVENT_TYPE` for single-type hooks (create/modify/delete)
- Timeout: 30 seconds, then SIGTERM → wait 5s → SIGKILL
- Returns structured result; never throws (errors are captured)

### Hook Dispatch Logic

```
for each batch of ChangeEvents from a poll cycle:
  1. if --on-change: execute with ALL events
  2. if --on-create: execute with events.filter(e => e.type === 'create')
  3. if --on-modify: execute with events.filter(e => e.type === 'modify')
  4. if --on-delete: execute with events.filter(e => e.type === 'delete')
  (skip execution if filtered array is empty)
```

Hooks execute sequentially within a cycle (not parallel) to avoid resource contention.

## Event Log

### Location

Default: `~/.local/share/supertag/workspaces/{alias}/watch-events.jsonl`

Override: `--event-log <path>`

### Format

One JSON object per line, one line per event:

```jsonl
{"timestamp":"2026-02-22T10:15:30Z","type":"create","pollCycle":42,"node":{"id":"abc123","name":"New Meeting","tags":["meeting"]}}
{"timestamp":"2026-02-22T10:15:30Z","type":"modify","pollCycle":42,"node":{"id":"def456","name":"Project X","tags":["project"]},"changes":{"tags":{"added":["completed"],"removed":[]}}}
```

### Rotation

No rotation in V1. File grows append-only. Users can truncate manually or via `logrotate`. Event log writing is optional and can be disabled by setting `--event-log /dev/null`.

## Resilience & Backoff

```typescript
// Exponential backoff on consecutive failures
function getBackoffMs(failures: number): number {
  const base = 5_000;  // 5 seconds
  const max = 60_000;  // 60 seconds cap
  return Math.min(base * Math.pow(2, failures - 1), max);
}

// Backoff sequence: 5s, 10s, 20s, 40s, 60s, 60s, ...
```

**Behavior:**
- On successful poll: reset `consecutiveFailures` to 0, resume normal interval
- On failed poll: increment `consecutiveFailures`, use backoff delay instead of interval
- After `maxConsecutiveFailures` (default 10): exit with error code 1 and message
- On health check failure: log once ("Tana Desktop unreachable"), continue backoff

## Graceful Shutdown

```
SIGINT / SIGTERM received:
  1. Set running = false (stop scheduling next poll)
  2. If hook currently executing: wait up to 10 seconds for completion
  3. Run one final delta-sync (best-effort, 15s timeout)
  4. Log final status summary
  5. Close database
  6. Exit 0
```

## Implementation Phases

### Phase 1: Types & Snapshot Diffing (Foundation)

Create the type definitions and the core diffing logic that compares pre/post sync snapshots.

**Files:**
- `src/watch/types.ts` — ChangeEvent, NodeSnapshot, WatchState, WatchOptions
- `src/watch/snapshot.ts` — `takeSnapshot(db, filterTag?)` → `Map<string, NodeSnapshot>`
- `src/watch/differ.ts` — `diffSnapshots(before, after)` → `ChangeEvent[]`
- `tests/watch/snapshot.test.ts` — Snapshot query tests
- `tests/watch/differ.test.ts` — Diff logic tests (create/modify/delete detection)

### Phase 2: Event Log & Hook Runner

Build the side-effect infrastructure: writing events to JSONL and executing shell hooks.

**Files:**
- `src/watch/event-log.ts` — `EventLogger` class (append JSONL, path resolution)
- `src/watch/hook-runner.ts` — `HookRunner` class (spawn, timeout, stdin piping)
- `tests/watch/event-log.test.ts` — Log writing tests
- `tests/watch/hook-runner.test.ts` — Hook execution tests (success, failure, timeout)

### Phase 3: WatchService (Orchestrator)

The main watch loop that ties everything together: poll, diff, log, dispatch, status.

**Files:**
- `src/watch/watch-service.ts` — `WatchService` class with start/stop/status
- `tests/watch/watch-service.test.ts` — Integration tests with mocked DeltaSyncService

### Phase 4: CLI Integration

Wire the WatchService into the `sync` command group.

**Files:**
- `src/commands/sync.ts` — Add `sync.command("watch")` with all options
- `tests/watch/cli-integration.test.ts` — CLI flag parsing and validation tests

### Phase 5: Status Output & Polish

Periodic status reporting, documentation updates, and edge case hardening.

**Files:**
- `src/watch/status-reporter.ts` — Periodic console status output
- Updates to existing files for error messages and help text

## File Structure

```
src/
├── watch/
│   ├── types.ts              # ChangeEvent, NodeSnapshot, WatchState, WatchOptions
│   ├── snapshot.ts           # SQLite snapshot queries
│   ├── differ.ts             # Pre/post snapshot diffing → ChangeEvent[]
│   ├── event-log.ts          # JSONL event logger
│   ├── hook-runner.ts        # Shell command executor with timeout
│   ├── watch-service.ts      # Main orchestrator (poll loop)
│   └── status-reporter.ts    # Periodic status summary output
├── commands/
│   └── sync.ts               # Modified: add "watch" subcommand
tests/
├── watch/
│   ├── snapshot.test.ts
│   ├── differ.test.ts
│   ├── event-log.test.ts
│   ├── hook-runner.test.ts
│   ├── watch-service.test.ts
│   └── cli-integration.test.ts
```

## CLI Interface

```
supertag sync watch [options]

Options:
  -w, --workspace <alias>     Workspace alias (default: "main")
  -i, --interval <seconds>    Poll interval in seconds (default: 30, min: 5)
  -t, --filter-tag <tag>      Only watch changes on nodes with this supertag
  --on-change <command>        Execute command on any change
  --on-create <command>        Execute command on new nodes
  --on-modify <command>        Execute command on modified nodes
  --on-delete <command>        Execute command on deleted/trashed nodes
  --event-log <path>           Custom event log path (JSONL)
  --dry-run                    Detect changes without executing hooks
  --max-failures <n>           Exit after N consecutive poll failures (default: 10)
  --db-path <path>             Database path override
```

### Example Usage

```bash
# Basic watch with default 30s interval
supertag sync watch

# Fast polling with hook
supertag sync watch --interval 10 --on-change 'echo "Changes detected"'

# Watch meetings only, log to custom path
supertag sync watch --filter-tag meeting --event-log ~/logs/tana-meetings.jsonl

# Dry run to test change detection
supertag sync watch --dry-run --interval 5

# Complex hook: auto-summarize new research nodes
supertag sync watch \
  --filter-tag research \
  --on-create 'jq -r ".[].node.id" | while read id; do
    supertag nodes show "$id" | claude -p "Summarize this research"
  done'
```

## Dependencies

### Internal (existing code)

| Component | Location | Usage |
|-----------|----------|-------|
| LocalApiClient | `src/api/local-api-client.ts` | Health checks, API availability |
| DeltaSyncService | `src/services/delta-sync.ts` | Core sync + watermark management |
| ConfigManager | `src/config/manager.ts` | Local API config (token, endpoint) |
| resolveWorkspaceContext | `src/config/workspace-resolver.ts` | Workspace DB path resolution |
| ensureDeltaSyncSchema | `src/db/delta-sync-schema.ts` | Schema migration |
| runDeltaSync helper | `src/commands/sync.ts` | Reuse existing sync initialization |

### External (no new packages)

- `bun:sqlite` — Snapshot queries
- `node:child_process` / `Bun.spawn` — Hook execution
- `node:fs` — JSONL append
- `node:path` — Path resolution

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| DeltaSyncService returns no granular change info | High | Low | Pre/post snapshot diffing is independent of sync internals |
| Large databases make snapshot queries slow | Medium | Medium | Tag filter narrows scope; snapshot only reads id, name, updated, tags |
| Hook command hangs indefinitely | Medium | Medium | 30s timeout with SIGTERM → SIGKILL escalation |
| Memory growth from snapshot maps | Low | Low | Maps are created per cycle and GC'd; no accumulation |
| Clock skew causes duplicate change detection | Low | Low | Use `updatedAt` from DB (Tana-reported), not local clock |
| Rapid node edits coalesced into single modify | Low | High | Acceptable: spec explicitly states "may coalesce rapid edits" |
| SQLite lock contention during snapshot + sync | Medium | Low | Bun SQLite uses WAL mode; reads don't block writes |
| SIGINT during database write | Low | Low | SQLite transactions are atomic; WAL journal provides recovery |

## Key Design Decisions

1. **Subcommand vs flag**: `sync watch` (subcommand) rather than `sync --watch` (flag). Cleaner separation since watch mode has its own options that don't apply to one-shot sync.

2. **Snapshot diffing over DeltaSync modification**: Wrapping around DeltaSyncService rather than modifying it preserves the existing, tested sync logic and keeps watch concerns separate.

3. **Sequential hook execution**: Hooks run one at a time within a poll cycle. Parallel execution would be an optimization for later but risks resource exhaustion and complicates error handling.

4. **JSONL over SQLite for event log**: Events are write-once, read-externally data. JSONL is simpler, greppable, and doesn't need schema management.

5. **No MCP tool in V1**: Watch mode is a long-running CLI process. MCP tools are request/response. A future `tana_watch_status` tool could query the event log, but that's out of scope.

---

*Plan created: 2026-02-27*

[PHASE COMPLETE: PLAN]
