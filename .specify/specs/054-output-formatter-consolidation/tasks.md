---
feature: "Output Formatter Consolidation"
plan: "./plan.md"
status: "pending"
total_tasks: 17
completed: 0
---

# Tasks: Output Formatter Consolidation

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Core Module)

- [ ] **T-1.1** Define OutputFormatter interface and types [T]
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/utils/output-formatter.test.ts`
  - Description: Create OutputFormatter interface, OutputMode type, FormatterOptions interface. No implementation yet - just the contract.

- [ ] **T-1.2** Implement UnixFormatter [T] (depends: T-1.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/utils/output-formatter.test.ts`
  - Description: TSV output for table, YAML-like records, skip headers/tips/dividers, stderr for errors. Uses stream capture for testability.

- [ ] **T-1.3** Implement PrettyFormatter [T] (depends: T-1.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/utils/output-formatter.test.ts`
  - Description: Formatted table with headers, emoji headers via EMOJI constant, tips with emoji, aligned records, divider character.

- [ ] **T-1.4** Implement JsonFormatter [T] (depends: T-1.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/utils/output-formatter.test.ts`
  - Description: Buffer records, output JSON array on finalize(). Single object when one value(), empty array for no data. Skip headers/tips/dividers.

- [ ] **T-1.5** Implement createFormatter factory [T] (depends: T-1.2, T-1.3, T-1.4)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/utils/output-formatter.test.ts`
  - Description: Factory function that returns appropriate formatter based on mode. Passes through humanDates, verbose, stream options.

- [ ] **T-1.6** Implement resolveOutputMode helper [T] (depends: T-1.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/utils/output-formatter.test.ts`
  - Description: Resolve mode from CLI options. Precedence: --json > --pretty > config > unix default. Integrates with existing output-options.ts.

### Group 2: Command Migration

- [ ] **T-2.1** Migrate stats.ts [T] (depends: T-1.5, T-1.6)
  - File: `src/commands/stats.ts`
  - Test: existing tests + output verification
  - Description: Replace if/else output switching with formatter. Simplest command - proof of concept. Verify db/embed/filter stats all work.

- [ ] **T-2.2** Migrate tags.ts - top subcommand [T] (depends: T-1.5, T-1.6)
  - File: `src/commands/tags.ts`
  - Test: existing tests + output verification
  - Description: Replace `tags top` output with formatter.table(). Verify TSV/pretty/JSON all produce correct output.

- [ ] **T-2.3** Migrate tags.ts - list subcommand [T] (depends: T-2.2)
  - File: `src/commands/tags.ts`
  - Test: existing tests + output verification
  - Description: Replace `tags list` output with formatter. Reuses patterns from T-2.2.

- [ ] **T-2.4** Migrate search.ts - FTS search [T] (depends: T-1.5, T-1.6)
  - File: `src/commands/search.ts`
  - Test: existing tests + output verification
  - Description: Replace handleFtsSearch output with formatter. This is the most complex - has ancestor resolution, tags, rank.

- [ ] **T-2.5** Migrate search.ts - semantic search [T] [P] (depends: T-2.4)
  - File: `src/commands/search.ts`
  - Test: existing tests + output verification
  - Description: Replace handleSemanticSearch output with formatter. Similar pattern to FTS but with similarity scores.

- [ ] **T-2.6** Migrate search.ts - tagged search [T] [P] (depends: T-2.4)
  - File: `src/commands/search.ts`
  - Test: existing tests + output verification
  - Description: Replace handleTaggedSearch output with formatter. Simpler than FTS - just id/name/created.

- [ ] **T-2.7** Migrate nodes.ts [T] [P] (depends: T-1.5, T-1.6)
  - File: `src/commands/nodes.ts`
  - Test: existing tests + output verification
  - Description: Replace node output switching with formatter.

- [ ] **T-2.8** Migrate fields.ts [T] [P] (depends: T-1.5, T-1.6)
  - File: `src/commands/fields.ts`
  - Test: existing tests + output verification
  - Description: Replace field list output with formatter.

### Group 3: Cleanup & Integration

- [ ] **T-3.1** Migrate remaining commands [T] (depends: T-2.1 through T-2.8)
  - Files: `src/commands/embed.ts`, `src/commands/workspace.ts`, `src/commands/server.ts`
  - Test: existing tests + output verification
  - Description: Migrate stats output from embed.ts, workspace status, server status. Lower priority - less frequently used output paths.

- [ ] **T-3.2** Add typed result formatters (optional helpers) [T] (depends: T-3.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/utils/output-formatter.test.ts`
  - Description: Add formatSearchResults(), formatStats() helper functions for common patterns. Optional but reduces boilerplate.

- [ ] **T-3.3** Final cleanup and documentation (depends: T-3.1)
  - Files: `src/commands/helpers.ts`, `CHANGELOG.md`
  - Description: Remove any remaining duplicated output logic. Add examples to JSDoc comments. Update CHANGELOG.

## Dependency Graph

```
                      T-1.1 (Interface)
                     /   |   \
                    /    |    \
                   /     |     \
              T-1.2   T-1.3   T-1.4    T-1.6
              (Unix)  (Pretty) (JSON)  (resolveMode)
                   \     |     /          |
                    \    |    /           |
                     \   |   /            |
                      T-1.5 (createFormatter)
                         |
        ┌────────────────┼────────────────────────────┐
        |                |                |           |
     T-2.1            T-2.2            T-2.4       T-2.7, T-2.8
    (stats)        (tags top)        (search)      (nodes, fields)
        |                |                |
        |             T-2.3          ┌────┴────┐
        |          (tags list)    T-2.5     T-2.6
        |                |       (semantic) (tagged)
        └────────────────┴────────────┴────────┘
                         |
                      T-3.1 (remaining commands)
                         |
                      T-3.2 (typed helpers)
                         |
                      T-3.3 (cleanup/docs)
```

## Execution Order

1. **Sequential:** T-1.1 (interface definition - all others depend on this)

2. **Parallel batch 1:** T-1.2, T-1.3, T-1.4, T-1.6
   - All formatter implementations can be built in parallel
   - resolveOutputMode is independent of formatter implementations

3. **Sequential:** T-1.5 (factory needs all formatters complete)

4. **Parallel batch 2:** T-2.1, T-2.2, T-2.4, T-2.7, T-2.8
   - Command migrations can proceed independently
   - Each command is isolated

5. **Parallel batch 3:** T-2.3 (after T-2.2), T-2.5, T-2.6 (after T-2.4)
   - Subcommand migrations within same file

6. **Sequential:** T-3.1 (remaining commands)
7. **Sequential:** T-3.2 (typed helpers - optional)
8. **Sequential:** T-3.3 (cleanup/docs)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Interface + types only |
| T-1.2 | pending | - | - | UnixFormatter |
| T-1.3 | pending | - | - | PrettyFormatter |
| T-1.4 | pending | - | - | JsonFormatter |
| T-1.5 | pending | - | - | createFormatter factory |
| T-1.6 | pending | - | - | resolveOutputMode |
| T-2.1 | pending | - | - | stats.ts migration |
| T-2.2 | pending | - | - | tags top migration |
| T-2.3 | pending | - | - | tags list migration |
| T-2.4 | pending | - | - | search FTS migration |
| T-2.5 | pending | - | - | search semantic migration |
| T-2.6 | pending | - | - | search tagged migration |
| T-2.7 | pending | - | - | nodes.ts migration |
| T-2.8 | pending | - | - | fields.ts migration |
| T-3.1 | pending | - | - | embed/workspace/server |
| T-3.2 | pending | - | - | typed helpers (optional) |
| T-3.3 | pending | - | - | cleanup + docs |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test --randomize`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Validation Checklist

For each migrated command, verify:

- [ ] `supertag <cmd>` produces TSV output (pipe to `cut -f1` works)
- [ ] `supertag <cmd> --pretty` produces formatted output with emojis
- [ ] `supertag <cmd> --json` produces valid JSON (pipe to `jq` works)
- [ ] Existing tests pass
- [ ] No visual regressions in terminal output

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Scope Notes

**In scope:**
- Output formatting for list/table/stats output
- All three modes: unix (TSV), pretty, json

**Out of scope (per spec):**
- ANSI color codes (future enhancement)
- Interactive output (spinners, progress bars)
- Paging/pagination
- File output (formatters write to streams, caller controls destination)
