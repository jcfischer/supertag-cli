---
feature: "Universal Format Options"
plan: "./plan.md"
status: "pending"
total_tasks: 18
completed: 0
---

# Tasks: Universal Format Options

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Types & Infrastructure)

- [ ] **T-1.1** Define OutputFormat type and update FormatterOptions [T] [P]
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/output-formatter.test.ts`
  - Description: Add `OutputFormat` union type with 6 formats. Update `FormatterOptions` to use `format` instead of `mode`. Add `FormatInfo` metadata type.

- [ ] **T-1.2** Create resolveOutputFormat() with TTY detection [T] [P]
  - File: `src/utils/output-options.ts`
  - Test: `tests/output-options.test.ts`
  - Description: New function that resolves format from: --format flag > --json/--pretty legacy > SUPERTAG_FORMAT env > config file > TTY detection default.

- [ ] **T-1.3** Rename PrettyFormatter to TableFormatter [T]
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/output-formatter.test.ts`
  - Description: Internal refactor - rename class and update references. Maintains backward compatibility via factory.

### Group 2: New Formatter Implementations

- [ ] **T-2.1** Implement CsvFormatter [T] [P] (depends: T-1.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/csv-formatter.test.ts`
  - Description: RFC 4180 compliant CSV output. Header row by default, proper quoting for commas/quotes/newlines. `--no-header` support.

- [ ] **T-2.2** Implement IdsFormatter [T] [P] (depends: T-1.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/ids-formatter.test.ts`
  - Description: Outputs only node IDs, one per line, no decoration. Extracts ID field from table/record data. Perfect for xargs piping.

- [ ] **T-2.3** Implement MinimalFormatter [T] [P] (depends: T-1.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/minimal-formatter.test.ts`
  - Description: JSON output with projection to only id, name, tags fields. Simplifies script consumption.

- [ ] **T-2.4** Implement JsonlFormatter [T] [P] (depends: T-1.1)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/jsonl-formatter.test.ts`
  - Description: JSON Lines format - one complete JSON object per line (no array wrapper). Stream-friendly for large results.

- [ ] **T-2.5** Update createFormatter() factory [T] (depends: T-1.3, T-2.1, T-2.2, T-2.3, T-2.4)
  - File: `src/utils/output-formatter.ts`
  - Test: `tests/output-formatter.test.ts`
  - Description: Update factory to instantiate all 6 formatters. Handle mode->format backward compatibility.

### Group 3: CLI Integration

- [ ] **T-3.1** Add --format option to addStandardOptions() [T] (depends: T-1.2)
  - File: `src/commands/helpers.ts`
  - Test: `tests/helpers.test.ts`
  - Description: Add `-f, --format <type>` option. Keep --json/--pretty as deprecated aliases. Add --no-header option.

- [ ] **T-3.2** Add SUPERTAG_FORMAT to config schema (depends: T-1.2)
  - File: `src/config/config-schema.ts`
  - Description: Add `format` field to output config schema. Support both env var and config file.

### Group 4: Command Migration

Each command needs updating to use new format system. These are parallelizable.

- [ ] **T-4.1** Migrate search command [T] [P] (depends: T-2.5, T-3.1)
  - File: `src/commands/search.ts`
  - Test: `tests/commands/search.test.ts`
  - Description: Replace json/pretty checks with resolveOutputFormat(). Use createFormatter() with new options.

- [ ] **T-4.2** Migrate nodes command [T] [P] (depends: T-2.5, T-3.1)
  - File: `src/commands/nodes.ts`
  - Test: `tests/commands/nodes.test.ts`
  - Description: Update show, recent, children, path, tree, ancestors subcommands to use new format system.

- [ ] **T-4.3** Migrate tags command [T] [P] (depends: T-2.5, T-3.1)
  - File: `src/commands/tags.ts`
  - Test: `tests/commands/tags.test.ts`
  - Description: Update list, show, search subcommands to use new format system.

- [ ] **T-4.4** Migrate fields command [T] [P] (depends: T-2.5, T-3.1)
  - File: `src/commands/fields.ts`
  - Test: `tests/commands/fields.test.ts`
  - Description: Update query, values subcommands to use new format system.

- [ ] **T-4.5** Migrate transcript command [T] [P] (depends: T-2.5, T-3.1)
  - File: `src/commands/transcript.ts`
  - Test: `tests/commands/transcript.test.ts`
  - Description: Update list, show, search subcommands to use new format system.

- [ ] **T-4.6** Migrate stats and embed commands [T] [P] (depends: T-2.5, T-3.1)
  - File: `src/commands/stats.ts`, `src/commands/embed.ts`
  - Test: `tests/commands/stats.test.ts`
  - Description: Update stats and embed search to use new format system.

### Group 5: Documentation & Integration Testing

- [ ] **T-5.1** End-to-end format integration tests [T] (depends: T-4.1)
  - File: `tests/format-integration.test.ts`
  - Description: Test shell pipeline patterns: `--format ids | xargs`, CSV import validation, JSONL streaming with jq.

- [ ] **T-5.2** Update documentation (depends: T-5.1)
  - Files: `README.md`, `SKILL.md`, `CHANGELOG.md`
  - Description: Document all 6 formats with examples. Add migration guide from --json/--pretty to --format.

## Dependency Graph

```
                   ┌─────────────────────────────────────────────────────┐
                   │              GROUP 1: Foundation                     │
                   │                                                      │
                   │  T-1.1 ───────┬──────────────────────────────────┐  │
                   │  (types) [P]  │                                  │  │
                   │               │                                  │  │
                   │  T-1.2 ───────┼───────────────────────> T-3.1   │  │
                   │  (resolve)[P] │                         (--format)  │
                   │               │                            │     │  │
                   │  T-1.3 ───────┤                            │     │  │
                   │  (rename)     │                            │     │  │
                   └───────────────┼────────────────────────────┼─────┘  │
                                   │                            │
                   ┌───────────────▼────────────────────────────┼───────┐
                   │        GROUP 2: Formatters                  │       │
                   │                                             │       │
                   │  T-2.1 (csv)   [P] ─┐                       │       │
                   │  T-2.2 (ids)   [P] ─┼──> T-2.5             │       │
                   │  T-2.3 (minimal)[P] ─┤    (factory)        │       │
                   │  T-2.4 (jsonl) [P] ─┘       │               │       │
                   │                             │               │       │
                   └─────────────────────────────┼───────────────┼───────┘
                                                 │               │
                   ┌─────────────────────────────▼───────────────▼───────┐
                   │           GROUP 3 + 4: CLI Integration               │
                   │                                                      │
                   │  T-3.2 (config) ───────────────────────────────┐    │
                   │                                                │    │
                   │  After T-2.5 + T-3.1:                          │    │
                   │    T-4.1 (search)   [P] ─┐                     │    │
                   │    T-4.2 (nodes)    [P] ─┤                     │    │
                   │    T-4.3 (tags)     [P] ─┼──> T-5.1 (e2e)     │    │
                   │    T-4.4 (fields)   [P] ─┤                     │    │
                   │    T-4.5 (transcript)[P] ─┤                     │    │
                   │    T-4.6 (stats)    [P] ─┘                     │    │
                   │                                                │    │
                   └────────────────────────────────────────────────┼────┘
                                                                    │
                   ┌────────────────────────────────────────────────▼────┐
                   │              GROUP 5: Documentation                  │
                   │                                                      │
                   │  T-5.1 ───────> T-5.2 (docs)                        │
                   │                                                      │
                   └──────────────────────────────────────────────────────┘
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2 (types and resolve function)
2. **Sequential:** T-1.3 (rename PrettyFormatter - depends on types)
3. **Parallel batch 2:** T-2.1, T-2.2, T-2.3, T-2.4 (all 4 new formatters)
4. **Sequential:** T-2.5 (update factory - needs all formatters)
5. **Parallel batch 3:** T-3.1, T-3.2 (CLI options and config)
6. **Parallel batch 4:** T-4.1, T-4.2, T-4.3, T-4.4, T-4.5, T-4.6 (all commands)
7. **Sequential:** T-5.1 (integration tests - needs at least one command)
8. **Sequential:** T-5.2 (documentation - after all features work)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Types & FormatterOptions |
| T-1.2 | pending | - | - | resolveOutputFormat() |
| T-1.3 | pending | - | - | Rename PrettyFormatter |
| T-2.1 | pending | - | - | CsvFormatter |
| T-2.2 | pending | - | - | IdsFormatter |
| T-2.3 | pending | - | - | MinimalFormatter |
| T-2.4 | pending | - | - | JsonlFormatter |
| T-2.5 | pending | - | - | Update factory |
| T-3.1 | pending | - | - | --format CLI option |
| T-3.2 | pending | - | - | Config schema |
| T-4.1 | pending | - | - | search command |
| T-4.2 | pending | - | - | nodes command |
| T-4.3 | pending | - | - | tags command |
| T-4.4 | pending | - | - | fields command |
| T-4.5 | pending | - | - | transcript command |
| T-4.6 | pending | - | - | stats + embed |
| T-5.1 | pending | - | - | E2E tests |
| T-5.2 | pending | - | - | Documentation |

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
| - | - | - |
