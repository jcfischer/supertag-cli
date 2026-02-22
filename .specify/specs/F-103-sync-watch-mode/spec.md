# Specification: F-103 Sync Watch Mode

## Context
> Identified as Tier 3 in the Tana Graph DB analysis.
> Extends the existing `supertag sync` command with continuous watching capabilities.
> Enables event-driven workflows triggered by changes in the Tana knowledge graph.

## Problem Statement

**Core Problem**: The current sync workflow is pull-based — users run `supertag sync` manually to update the local SQLite database from Tana. There's no way to detect changes in Tana in near-real-time and trigger automated responses (e.g., "when a new #research node is created, auto-generate a summary").

**Current State**:
- `supertag sync` does a one-shot pull from Tana JSON export or Local API delta-sync
- Delta-sync via Local API (`DeltaSyncService`) can detect changes since last sync
- No continuous watching / polling mode
- No event notification system for detected changes
- No hook mechanism to trigger actions on specific changes

**Impact if Unsolved**: All Tana-to-local workflows are manual and batch-oriented. Real-time automation (auto-summarize, auto-tag, auto-link) is impossible. The knowledge graph can't trigger AI workflows proactively.

## Users & Stakeholders

**Primary User**: Users wanting automated workflows triggered by Tana changes
- Expects: `supertag sync --watch` → continuous monitoring with event hooks
- Needs: configurable poll interval, event filtering, hook execution

**Secondary**:
- pai-seed integration (F-105) — watches for changes relevant to learning lifecycle
- AI agents monitoring for new content to process
- Dashboard/notification systems

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | `supertag sync --watch` starts continuous polling for changes via Local API | Must |
| FR-2 | `--interval <seconds>` sets the poll frequency (default: 30, min: 5) | Must |
| FR-3 | Detect new nodes created since last poll | Must |
| FR-4 | Detect modified nodes (name, fields, tags changed) since last poll | Must |
| FR-5 | Detect deleted/trashed nodes since last poll | Should |
| FR-6 | `--filter-tag <supertag>` limits watching to changes on nodes of a specific type | Should |
| FR-7 | `--on-change <command>` executes a shell command when changes are detected | Must |
| FR-8 | Change events passed to hooks as JSON via stdin or environment variables | Must |
| FR-9 | `--on-create <command>` / `--on-modify <command>` / `--on-delete <command>` for type-specific hooks | Should |
| FR-10 | Event log: all detected changes written to a local JSONL file | Should |
| FR-11 | `--dry-run` flag that detects changes but doesn't execute hooks | Should |
| FR-12 | Graceful shutdown on SIGINT/SIGTERM with final sync | Must |
| FR-13 | Status output: periodic summary of poll count, changes detected, hooks executed | Should |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Idle CPU usage < 1% between polls |
| NFR-2 | Memory usage does not grow over time (no unbounded event accumulation) |
| NFR-3 | Requires Tana Desktop running (Local API) — clear error message if unavailable |
| NFR-4 | Survives transient Local API disconnections (retry with backoff) |
| NFR-5 | Change detection is idempotent — same change detected once, not repeatedly |

## Architecture

### Watch Loop

```
supertag sync --watch --interval 30
  → Initial sync (full delta-sync)
  → Loop:
      → Wait interval seconds
      → Poll: query Local API for nodes edited since lastPollTimestamp
      → Diff: compare with local state to classify as create/modify/delete
      → Emit: send change events to configured hooks
      → Update: store lastPollTimestamp
      → Repeat until SIGINT
```

### Change Detection via Local API

```typescript
interface ChangeEvent {
  type: 'create' | 'modify' | 'delete';
  timestamp: string;           // ISO 8601
  node: {
    id: string;
    name: string;
    tags: string[];
    fields?: Record<string, string>;
  };
  changes?: {                  // For 'modify' type
    before?: Partial<NodeSummary>;
    after?: Partial<NodeSummary>;
  };
}
```

### Hook Execution

Hooks receive change events via stdin as JSON:

```bash
# Shell hook example
supertag sync --watch --on-create "jq '.name' | xargs -I{} echo 'New node: {}'"

# Complex hook with supertag-cli
supertag sync --watch \
  --filter-tag research \
  --on-create "supertag context \$(jq -r '.node.id') --max-tokens 2000 | claude -p 'Summarize this research'"
```

### Event Log Format

```jsonl
{"timestamp":"2026-02-22T10:15:30Z","type":"create","nodeId":"abc123","name":"New Meeting","tags":["meeting"]}
{"timestamp":"2026-02-22T10:15:30Z","type":"modify","nodeId":"def456","name":"Project X","changes":{"Status":{"before":"Active","after":"Completed"}}}
```

### Resilience

```
Poll fails (Local API down)
  → Log warning
  → Exponential backoff: 5s, 10s, 20s, 40s, 60s (cap)
  → Resume normal interval on successful poll
  → After 10 consecutive failures: exit with error (suggest --interval increase)
```

## Scope

### In Scope
- `--watch` flag on `supertag sync`
- Continuous polling via Local API `edited.last` queries
- Change classification (create/modify/delete)
- Hook execution via `--on-change`, `--on-create`, `--on-modify`
- Event logging to JSONL
- Tag filtering
- Graceful shutdown

### Explicitly Out of Scope
- WebSocket/push-based change notification (Tana doesn't support this)
- Two-way sync (changes in supertag-cli → Tana; that's already handled by write commands)
- Conflict resolution between local and remote
- GUI/TUI for watching changes
- Distributed/multi-machine watch coordination

### Designed For But Not Implemented
- Webhook endpoint (HTTP POST for each change event)
- Plugin system for hooks (JavaScript/TypeScript instead of shell commands)
- Change aggregation / debouncing (batch rapid changes into one event)
- Filter by field value changes (not just tag)

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Tana Desktop not running | Error: "Local API not available. Watch mode requires Tana Desktop." |
| Local API goes down during watch | Exponential backoff, resume on recovery |
| Hundreds of changes in one poll | Process all; no artificial limit on batch size |
| Hook command fails (non-zero exit) | Log error, continue watching (don't stop the loop) |
| Hook command hangs | Timeout after 30 seconds, kill, log warning |
| Rapid changes to same node | Each poll captures latest state; may coalesce rapid edits |
| SIGINT during hook execution | Wait for hook to finish (up to 10s), then shutdown |
| Clock skew between local and Tana | Use Tana's reported timestamps, not local clock |

## Success Criteria

- [ ] `supertag sync --watch` starts continuous monitoring and detects new nodes
- [ ] `--interval 10` polls every 10 seconds
- [ ] `--on-change 'echo $EVENT'` executes when a change is detected
- [ ] `--filter-tag meeting` only reports changes to #meeting nodes
- [ ] Changes are logged to a JSONL event file
- [ ] `--dry-run` detects changes without executing hooks
- [ ] Graceful shutdown on Ctrl+C with final sync
- [ ] Recovers from transient Local API disconnections

## Dependencies

- F-094 (Tana Local API Integration) — provides `LocalApiClient`
- Existing `DeltaSyncService` — change detection logic
- F-097 (Live Read Backend) — for node content resolution

---
*Spec created: 2026-02-22*
