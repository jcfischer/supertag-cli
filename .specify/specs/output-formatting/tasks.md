---
feature: "output-formatting"
plan: "./plan.md"
status: "completed"
total_tasks: 14
completed: 14
---

# Tasks: Output Formatting

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation

- [x] **T-1.1** Create format utility module (Unix output) [T]
  - File: `src/utils/format.ts`
  - Test: `tests/utils/format.test.ts`
  - Description: Core formatting functions for Unix-style output
    - `OutputOptions` interface
    - `tsv()` - tab-separated value output
    - `record()` - YAML-like key:value records for `--show`
    - `formatDateISO()` - ISO 8601 dates (default)
    - `formatDateHuman()` - localized dates (Dec 17, 2025)
    - `formatDateRelative()` - relative times (e.g., "2 hours ago")
    - `formatNumber()` - raw or with separators
    - `formatPercentage()` - decimal (0.568) or percent (56.8%)

- [x] **T-1.2** Register global CLI flags + config support [T] (depends: T-1.1)
  - Files: `src/cli.ts`, `src/config.ts`
  - Test: `tests/cli-flags.test.ts`
  - Description: Add global output flags and config schema
    - `--pretty` / `--no-pretty` flags
    - `--iso-dates` flag (default, no-op)
    - `--human-dates` flag (localized dates)
    - `--verbose` flag (technical details)
    - Config schema: `output.pretty`, `output.humanDates`
    - Merge logic: CLI flags > Config file > Built-in defaults

- [x] **T-1.3** Create pretty-mode utilities [T] (depends: T-1.1)
  - File: `src/utils/format.ts`
  - Test: `tests/utils/format.test.ts`
  - Description: Human-friendly formatting functions
    - `EMOJI` constants object
    - `padLeft()` / `padRight()` - string padding
    - `divider()` - box-drawing line generator
    - `header()` - section header with emoji
    - `table()` - aligned table with headers
    - `field()` - indented field display
    - `tip()` - helpful suggestion

### Group 2: Core Commands

- [x] **T-2.1** Update `tags top` command [T] (depends: T-1.2, T-1.3)
  - File: `src/commands/tags.ts`
  - Test: `tests/commands/tags.test.ts`
  - Description: Dual-mode output for tags command
    - Default: `meeting\t2245` (TSV)
    - Pretty: Ranked table with emoji header, formatted counts

- [x] **T-2.2** Update `search` command (FTS) [T] (depends: T-2.1)
  - File: `src/commands/search.ts`
  - Test: `tests/commands/search.test.ts`
  - Description: Dual-mode output for full-text search
    - Default: `id\tname\tcontext` (TSV)
    - Pretty: Result table with match count and timing

- [x] **T-2.3** Update `search --semantic` output [T] (depends: T-2.2)
  - File: `src/commands/search.ts`
  - Test: `tests/commands/search.test.ts`
  - Description: Dual-mode output for semantic search
    - Default: `0.568\tid\tname\ttag` (TSV with score)
    - Pretty: Score column, aligned table

- [x] **T-2.4** Update `search --tag --show` output [T] (depends: T-2.3)
  - Files: `src/commands/search.ts`, `src/commands/show.ts`
  - Test: `tests/commands/show.test.ts`
  - Description: YAML-like record format for detailed view
    - Default: `---\nid: X\nname: Y\ntags: Z\ncreated: 2025-12-17`
    - Pretty: Card-style with box-drawing separators

- [x] **T-2.5** Update `stats` command [T] [P] (depends: T-1.2, T-1.3)
  - File: `src/commands/stats.ts`
  - Test: `tests/commands/stats.test.ts`
  - Description: Dual-mode output for workspace statistics
    - Default: `nodes\t1346720` (TSV key-value)
    - Pretty: Grouped sections with visual hierarchy

- [x] **T-2.6** Update `workspace list` command [T] [P] (depends: T-1.2, T-1.3)
  - File: `src/commands/workspace.ts`
  - Test: `tests/commands/workspace.test.ts`
  - Description: Dual-mode output for workspace listing
    - Default: `alias\tid\tstatus\tnodes\tdefault?` (TSV)
    - Pretty: Table with asterisk for default workspace

### Group 3: Secondary Commands

- [x] **T-3.1** Update `server status` command [T] (depends: T-2.6)
  - File: `src/commands/server.ts`
  - Test: `tests/commands/server.test.ts`
  - Description: Dual-mode output for server status
    - Default: `stopped` or `running\t3100\t12345\t9240` (TSV)
    - Pretty: Status icons, endpoint list, helpful commands

- [ ] **T-3.2** Update `embed config --show` command [T] (depends: T-3.1)
  - File: `src/commands/embed.ts`
  - Test: `tests/commands/embed.test.ts`
  - Description: Dual-mode output for embedding config
    - Default: `model\tbge-m3` (TSV key-value)
    - Pretty: 🧠 emoji, connection status check

- [ ] **T-3.3** Update `nodes show` command [T] (depends: T-3.2)
  - File: `src/commands/show.ts`
  - Test: `tests/commands/show.test.ts`
  - Description: Consistent with `search --show` format

### Group 4: Polish

- [ ] **T-4.1** Add --verbose flag behavior [T] (depends: T-3.3)
  - Files: `src/commands/search.ts`, `src/commands/tags.ts`, others
  - Test: `tests/commands/verbose.test.ts`
  - Description: Additional detail when verbose flag is set
    - `--verbose` in search: shows IDs, ranks, timing
    - `--verbose` in tags: shows tag IDs
    - Update help text for all affected commands

- [ ] **T-4.2** Add tips (--pretty only) (depends: T-4.1)
  - Files: Multiple command files
  - Description: Contextual hints in pretty mode
    - Show tips only when `--pretty` and not `--show`
    - Example: "Use --show for full node content"
    - No test required (UX enhancement)

## Dependency Graph

```
                    ┌─────────────────────────────────────────────────────┐
                    │                                                     │
T-1.1 ──> T-1.2 ────┼──> T-2.1 ──> T-2.2 ──> T-2.3 ──> T-2.4             │
    │               │                                     │               │
    └──> T-1.3 ─────┤                                     │               │
                    │                                     ▼               │
                    ├──> T-2.5 [P]                    (merges)            │
                    │                                     │               │
                    └──> T-2.6 [P] ───────────────────────┴──> T-3.1 ──> T-3.2 ──> T-3.3 ──> T-4.1 ──> T-4.2
```

**Simplified view:**
```
T-1.1 ──┬──> T-1.2 ──┬──> T-2.1 ──> T-2.2 ──> T-2.3 ──> T-2.4 ─┐
        │            │                                          │
        └──> T-1.3 ──┼──> T-2.5 [P]                             ├──> T-3.1 ──> T-3.2 ──> T-3.3 ──> T-4.1 ──> T-4.2
                     │                                          │
                     └──> T-2.6 [P] ────────────────────────────┘
```

## Execution Order

1. **Sequential:** T-1.1 (format utilities - Unix)
2. **Parallel batch 1:** T-1.2 (CLI flags), T-1.3 (pretty utilities) — after T-1.1
3. **Sequential:** T-2.1 (tags top) — after batch 1
4. **Sequential:** T-2.2 (search FTS) — after T-2.1
5. **Sequential:** T-2.3 (search semantic) — after T-2.2
6. **Parallel batch 2:** T-2.4 (search show), T-2.5 (stats), T-2.6 (workspace) — after T-2.3
7. **Sequential:** T-3.1 (server status) — after batch 2
8. **Sequential:** T-3.2 (embed config) — after T-3.1
9. **Sequential:** T-3.3 (nodes show) — after T-3.2
10. **Sequential:** T-4.1 (verbose flag) — after T-3.3
11. **Sequential:** T-4.2 (tips) — after T-4.1

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | completed | 2025-12-23 | 2025-12-23 | 37 tests passing |
| T-1.2 | completed | 2025-12-23 | 2025-12-23 | 13 tests passing |
| T-1.3 | completed | 2025-12-23 | 2025-12-23 | 29 tests passing |
| T-2.1 | completed | 2025-12-23 | 2025-12-23 | 17 tests passing |
| T-2.2 | completed | 2025-12-23 | 2025-12-23 | 16 tests passing |
| T-2.3 | completed | 2025-12-23 | 2025-12-23 | semantic TSV output |
| T-2.4 | completed | 2025-12-23 | 2025-12-23 | tag search TSV output |
| T-2.5 | completed | 2025-12-23 | 2025-12-23 | stats TSV output |
| T-2.6 | completed | 2025-12-23 | 2025-12-23 | workspace TSV output |
| T-3.1 | completed | 2025-12-23 | 2025-12-23 | server TSV output |
| T-3.2 | completed | 2025-12-23 | 2025-12-23 | embed config TSV output |
| T-3.3 | completed | 2025-12-23 | 2025-12-23 | nodes show/refs/recent TSV output |
| T-4.1 | completed | 2025-12-23 | 2025-12-23 | --verbose flag for search and tags |
| T-4.2 | completed | 2025-12-23 | 2025-12-23 | tips for search and tags |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Verification Checklist (Per Task)

- [ ] `bun test` passes
- [ ] Default output is TSV, pipe-friendly
- [ ] `--pretty` output has emojis and formatting
- [ ] `--json` output unchanged
- [ ] `--human-dates` shows localized dates
- [ ] Help text updated if flags added

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Breaking Changes Notice

This is a **breaking change** for users parsing current output:

| Before | After |
|--------|-------|
| Parse emoji-prefixed output | Use default TSV or `--json` |
| Rely on current format | Add `--pretty` for old behavior |
| Parse dates as `12/17/2025` | Dates now ISO `2025-12-17` |
