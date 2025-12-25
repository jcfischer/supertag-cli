---
feature: "Transcript Filtering and Commands"
plan: "./plan.md"
status: "pending"
total_tasks: 12
completed: 0
---

# Tasks: Transcript Filtering and Commands

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Content Filter Changes)

- [ ] **T-1.1** Exclude transcripts from SYSTEM_DOC_TYPES [T]
  - File: `src/embeddings/content-filter.ts`
  - Test: `tests/embeddings/content-filter-transcripts.test.ts`
  - Description: Move `transcript` and `transcriptLine` from CONTENT_DOC_TYPES to SYSTEM_DOC_TYPES so they're excluded by default

- [ ] **T-1.2** Add includeTranscripts option to ContentFilterOptions [T]
  - File: `src/embeddings/content-filter.ts`
  - Test: `tests/embeddings/content-filter-transcripts.test.ts`
  - Description: Add `includeTranscripts?: boolean` option and update `buildContentFilterQuery()` to conditionally include transcript types when flag is true

### Group 2: Core Data Access Layer

- [ ] **T-2.1** Create transcript types [T] [P]
  - File: `src/db/transcript.ts`
  - Test: `tests/db/transcript.test.ts`
  - Description: Define TranscriptSummary, TranscriptLine, TranscriptSearchResult interfaces and isTranscriptNode() helper

- [ ] **T-2.2** Implement getTranscriptForMeeting() [T] [P] (depends: T-2.1)
  - File: `src/db/transcript.ts`
  - Test: `tests/db/transcript.test.ts`
  - Description: Resolve SYS_A199 metanode link from meeting to transcript

- [ ] **T-2.3** Implement getTranscriptLines() [T] [P] (depends: T-2.1)
  - File: `src/db/transcript.ts`
  - Test: `tests/db/transcript.test.ts`
  - Description: Get transcript lines with SYS_A252-254 metadata (speaker, timing), preserving order

- [ ] **T-2.4** Implement getMeetingsWithTranscripts() [T] (depends: T-2.2)
  - File: `src/db/transcript.ts`
  - Test: `tests/db/transcript.test.ts`
  - Description: List all meetings that have SYS_A199 transcript links, with line counts

- [ ] **T-2.5** Implement searchTranscripts() [T] (depends: T-2.1)
  - File: `src/db/transcript.ts`
  - Test: `tests/db/transcript.test.ts`
  - Description: FTS search within transcriptLine nodes only, return with meeting context

### Group 3: CLI Commands

- [ ] **T-3.1** Create transcript list command [T] (depends: T-2.4)
  - File: `src/commands/transcript.ts`
  - Test: `tests/commands/transcript.test.ts`
  - Description: `supertag transcript list` with --limit, --json options

- [ ] **T-3.2** Create transcript show command [T] (depends: T-2.2, T-2.3)
  - File: `src/commands/transcript.ts`
  - Test: `tests/commands/transcript.test.ts`
  - Description: `supertag transcript show <meeting-id>` with formatted output and --json

- [ ] **T-3.3** Create transcript search command [T] (depends: T-2.5)
  - File: `src/commands/transcript.ts`
  - Test: `tests/commands/transcript.test.ts`
  - Description: `supertag transcript search <query>` with --limit, --json options

### Group 4: Integration

- [ ] **T-4.1** Wire transcript command into main CLI [T] (depends: T-3.1, T-3.2, T-3.3)
  - File: `src/index.ts`
  - Test: `tests/commands/transcript.test.ts`
  - Description: Register transcript command group in main CLI

- [ ] **T-4.2** Add --include-transcripts to search and embed commands [T] (depends: T-1.2)
  - Files: `src/commands/search.ts`, `src/commands/embed.ts`
  - Test: `tests/commands/search-transcripts.test.ts`
  - Description: Add flag to both search (FTS + semantic) and embed generate commands

## Dependency Graph

```
Group 1 (Foundation):
T-1.1 ──> T-1.2 ────────────────────────────────> T-4.2

Group 2 (Data Access):
T-2.1 ──┬──> T-2.2 ──> T-2.4 ──> T-3.1 ──┐
        │         └────────────> T-3.2 ──┼──> T-4.1
        ├──> T-2.3 ──────────────────────┘
        └──> T-2.5 ──────────────> T-3.3 ──┘
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-2.1
2. **Sequential:** T-1.2 (after T-1.1)
3. **Parallel batch 2:** T-2.2, T-2.3, T-2.5 (after T-2.1)
4. **Sequential:** T-2.4 (after T-2.2)
5. **Parallel batch 3:** T-3.1, T-3.2, T-3.3 (after their deps)
6. **Sequential:** T-4.1 (after all Group 3)
7. **Sequential:** T-4.2 (after T-1.2, can run parallel with Group 3/4)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Exclude transcripts by default |
| T-1.2 | pending | - | - | Add includeTranscripts option |
| T-2.1 | pending | - | - | Types and isTranscriptNode |
| T-2.2 | pending | - | - | getTranscriptForMeeting |
| T-2.3 | pending | - | - | getTranscriptLines |
| T-2.4 | pending | - | - | getMeetingsWithTranscripts |
| T-2.5 | pending | - | - | searchTranscripts |
| T-3.1 | pending | - | - | transcript list command |
| T-3.2 | pending | - | - | transcript show command |
| T-3.3 | pending | - | - | transcript search command |
| T-4.1 | pending | - | - | Wire into main CLI |
| T-4.2 | pending | - | - | --include-transcripts flag |

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

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |
