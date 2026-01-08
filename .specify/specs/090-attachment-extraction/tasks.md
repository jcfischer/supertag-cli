---
feature: "Attachment Extraction"
plan: "./plan.md"
status: "pending"
total_tasks: 16
completed: 0
---

# Tasks: Attachment Extraction

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Types & Discovery)

- [ ] **T-1.1** Create attachment types [T] [P]
  - File: `src/types/attachment.ts`
  - Test: `tests/unit/attachment-types.test.ts`
  - Description: Define `Attachment`, `DownloadResult`, `AttachmentOptions`, `ExtractionSummary` interfaces with Zod validation

- [ ] **T-1.2** Implement URL parsing [T] [P]
  - File: `src/services/attachment-discovery.ts`
  - Test: `tests/unit/attachment-discovery.test.ts`
  - Description: Create `parseNodeForUrl()` - regex to extract Firebase Storage URLs from node names

- [ ] **T-1.3** Implement filename extraction [T] (depends: T-1.2)
  - File: `src/services/attachment-discovery.ts`
  - Test: `tests/unit/attachment-discovery.test.ts`
  - Description: Create `extractFilename()` - decode URL-encoded filename and extension from Firebase URL path

### Group 2: Discovery Implementation

- [ ] **T-2.1** Implement database scanning [T] (depends: T-1.1, T-1.3)
  - File: `src/services/attachment-discovery.ts`
  - Test: `tests/unit/attachment-discovery.test.ts`
  - Description: Create `scanDatabase()` - query nodes table for Firebase URLs, join with tag_applications for filtering

- [ ] **T-2.2** Implement export file scanning [T] (depends: T-1.3)
  - File: `src/services/attachment-discovery.ts`
  - Test: `tests/unit/attachment-discovery.test.ts`
  - Description: Create `scanExport()` - parse JSON export file for attachment URLs as fallback/alternative

- [ ] **T-2.3** Add tag filtering to discovery [T] (depends: T-2.1)
  - File: `src/services/attachment-discovery.ts`
  - Test: `tests/unit/attachment-discovery.test.ts`
  - Description: Filter attachments by supertag on parent/self node, support multiple tags

### Group 3: Download Infrastructure

- [ ] **T-3.1** Create attachment downloader base [T] [P]
  - File: `src/services/attachment-downloader.ts`
  - Test: `tests/unit/attachment-downloader.test.ts`
  - Description: Create `AttachmentDownloader` class with auth token, basic `downloadFile()` with streaming

- [ ] **T-3.2** Add progress tracking [T] (depends: T-3.1)
  - File: `src/services/attachment-downloader.ts`
  - Test: `tests/unit/attachment-downloader.test.ts`
  - Description: Add `onProgress` callback support, calculate percentage from Content-Length

- [ ] **T-3.3** Implement retry with backoff [T] (depends: T-3.2)
  - File: `src/services/attachment-downloader.ts`
  - Test: `tests/unit/attachment-downloader.test.ts`
  - Description: Create `downloadWithRetry()` - exponential backoff, max 3 retries, handle 429/5xx errors

- [ ] **T-3.4** Add download validation [T] (depends: T-3.3)
  - File: `src/services/attachment-downloader.ts`
  - Test: `tests/unit/attachment-downloader.test.ts`
  - Description: Verify downloaded file size matches Content-Length, handle partial downloads

### Group 4: Service Layer

- [ ] **T-4.1** Create attachment service [T] (depends: T-2.3, T-3.4)
  - File: `src/services/attachment-service.ts`
  - Test: `tests/unit/attachment-service.test.ts`
  - Description: Create `AttachmentService` class, integrate discovery and downloader, implement `list()` method

- [ ] **T-4.2** Implement extract with concurrency [T] (depends: T-4.1)
  - File: `src/services/attachment-service.ts`
  - Test: `tests/unit/attachment-service.test.ts`
  - Description: Implement `extract()` - parallel downloads with configurable concurrency, aggregate results

- [ ] **T-4.3** Add organization options [T] (depends: T-4.2)
  - File: `src/services/attachment-service.ts`
  - Test: `tests/unit/attachment-service.test.ts`
  - Description: Implement `--organize-by` (flat/date/tag/node), create subdirectories, handle name conflicts

- [ ] **T-4.4** Implement single file get [T] (depends: T-4.1)
  - File: `src/services/attachment-service.ts`
  - Test: `tests/unit/attachment-service.test.ts`
  - Description: Implement `get(nodeId)` for single attachment download

### Group 5: CLI Commands

- [ ] **T-5.1** Create attachments CLI command group [T] (depends: T-4.3, T-4.4)
  - File: `src/commands/attachments.ts`
  - Test: `tests/e2e/attachments-cli.test.ts`
  - Description: Create `supertag attachments` with `list`, `extract`, `get` subcommands, all standard options

- [ ] **T-5.2** Wire command and update documentation (depends: T-5.1)
  - Files: `src/index.ts`, `README.md`, `CHANGELOG.md`, `SKILL.md`
  - Description: Register command in main CLI, update docs with examples, add to help text

## Dependency Graph

```
T-1.1 (types) ----+
                  |
T-1.2 (url) --> T-1.3 (filename) --> T-2.1 (db scan) --> T-2.3 (tag filter) --+
                  |                                                            |
                  +---> T-2.2 (export scan)                                    |
                                                                               v
T-3.1 (downloader) --> T-3.2 (progress) --> T-3.3 (retry) --> T-3.4 (validate) --> T-4.1 (service)
                                                                                       |
                                                                     +-----------------+----------------+
                                                                     v                                  v
                                                              T-4.2 (extract)                    T-4.4 (get)
                                                                     |
                                                                     v
                                                              T-4.3 (organize)
                                                                     |
                                                                     v
                                                              T-5.1 (CLI)
                                                                     |
                                                                     v
                                                              T-5.2 (docs)
```

**Simplified view:**
```
Foundation:   T-1.1 ─┬─> T-2.1 ─> T-2.3 ─────────────────────────────────────┐
              T-1.2 ─┴─> T-1.3 ─┬─> T-2.2                                    │
                                │                                             v
Download:     T-3.1 ─> T-3.2 ─> T-3.3 ─> T-3.4 ─────────────────> T-4.1 ─┬─> T-4.2 ─> T-4.3 ─┐
                                                                         │                    │
                                                                         └─> T-4.4 ──────────┼─> T-5.1 ─> T-5.2
```

## Execution Order

1. **Parallel batch 1:** T-1.1 (types), T-1.2 (URL parsing), T-3.1 (downloader base)
2. **Sequential:** T-1.3 (filename extraction) - after T-1.2
3. **Parallel batch 2:** T-2.1 (db scan), T-2.2 (export scan), T-3.2 (progress) - after deps
4. **Sequential:** T-2.3 (tag filter), T-3.3 (retry)
5. **Sequential:** T-3.4 (validate)
6. **Sequential:** T-4.1 (service base) - after T-2.3 and T-3.4
7. **Parallel batch 3:** T-4.2 (extract), T-4.4 (get)
8. **Sequential:** T-4.3 (organize) - after T-4.2
9. **Sequential:** T-5.1 (CLI) - after T-4.3 and T-4.4
10. **Sequential:** T-5.2 (docs) - after T-5.1

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Types with Zod |
| T-1.2 | pending | - | - | URL regex |
| T-1.3 | pending | - | - | Filename decode |
| T-2.1 | pending | - | - | Database query |
| T-2.2 | pending | - | - | Export parsing |
| T-2.3 | pending | - | - | Tag filtering |
| T-3.1 | pending | - | - | Downloader base |
| T-3.2 | pending | - | - | Progress tracking |
| T-3.3 | pending | - | - | Retry logic |
| T-3.4 | pending | - | - | Download validation |
| T-4.1 | pending | - | - | Service base |
| T-4.2 | pending | - | - | Extract with concurrency |
| T-4.3 | pending | - | - | Organization options |
| T-4.4 | pending | - | - | Single file get |
| T-5.1 | pending | - | - | CLI commands |
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

## Critical Path

The longest dependency chain determines minimum time:

```
T-1.2 -> T-1.3 -> T-2.1 -> T-2.3 -> T-4.1 -> T-4.2 -> T-4.3 -> T-5.1 -> T-5.2
```

OR

```
T-3.1 -> T-3.2 -> T-3.3 -> T-3.4 -> T-4.1 -> T-4.2 -> T-4.3 -> T-5.1 -> T-5.2
```

**Critical path:** 9 tasks
**Parallel opportunities:** 3 batches can reduce wall-clock time

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Post-Implementation Verification

**Before marking feature complete, verify:**

### Functional Verification
- [ ] All unit tests pass (`bun run test`)
- [ ] All integration tests pass
- [ ] Feature works as specified in acceptance criteria:
  - [ ] `supertag attachments list` shows all attachments
  - [ ] `supertag attachments extract` downloads files
  - [ ] `--tag` filtering works correctly
  - [ ] `--organize-by` creates correct subdirectories
  - [ ] `--skip-existing` skips already downloaded files
  - [ ] Progress displayed during downloads
  - [ ] `get` command downloads single attachment

### Failure Verification (Doctorow Gate)
- [ ] **Auth expired:** Returns 401, prompts re-auth message
- [ ] **File not found:** Returns structured error, continues with others
- [ ] **Network error:** Retries 3x with backoff
- [ ] **Disk full:** Stops with clear error message
- [ ] **Invalid URL:** Skipped with warning in verbose mode

### Maintainability Verification
- [ ] **Documentation:** README, SKILL.md, CHANGELOG updated
- [ ] **No orphan code:** All new code reachable and tested
- [ ] **Consistent patterns:** Follows existing CLI command patterns

### Sign-off
- [ ] All verification items checked
- [ ] Debt score: 3 (moderate complexity)
- Date completed: ___
