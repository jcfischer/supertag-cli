# Implementation Tasks: F-106 Embedding Maintenance & Diagnostics

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | getDiskSize method |
| T-1.2 | ☐ | Enhanced stats display |
| T-2.1 | ☐ | Stale cleanup logic |
| T-2.2 | ☐ | Integrate stale cleanup into maintain |
| T-3.1 | ☐ | Dry-run mode |
| T-3.2 | ☐ | Before/after metrics |
| T-4.1 | ☐ | CLI flag additions |

---

## Group 1: Enhanced Diagnostics (Phase 1)

### T-1.1: Add getDiskSize method [T] [P with T-4.1]
- **File:** src/embeddings/tana-embedding-service.ts
- **Test:** tests/embed-diagnostics.test.ts
- **Dependencies:** none
- **Description:** Add `getDiskSize()` method to TanaEmbeddingService that walks the `.lance` directory recursively and sums file sizes. Returns `{ bytes: number; formatted: string }` with human-readable format (e.g., "33.2 GB").

### T-1.2: Enhance stats display [T]
- **File:** src/commands/embed.ts (stats action)
- **Test:** tests/embed-stats.test.ts
- **Dependencies:** T-1.1
- **Description:** Update `embed stats` command to display disk size (from T-1.1), fragment count (from directory listing), and existing diagnostics. Format: "Disk Size: 33.2 GB", "Fragments: 29,275".

---

## Group 2: Stale Embedding Cleanup (Phase 2)

### T-2.1: Implement stale ID computation [T]
- **File:** src/embeddings/tana-embedding-service.ts
- **Test:** tests/embed-maintain.test.ts
- **Dependencies:** none
- **Description:** Add method to compute stale embedding IDs by comparing `getEmbeddedIds()` from LanceDB against valid node IDs from SQLite (`SELECT id FROM nodes WHERE name IS NOT NULL`). Returns Set of stale IDs.

### T-2.2: Integrate stale cleanup into maintain pipeline [T]
- **File:** src/commands/embed.ts (maintain action)
- **Test:** tests/embed-maintain.test.ts
- **Dependencies:** T-2.1
- **Description:** Add stale cleanup step to maintain action: get valid node IDs from SQLite, call `embeddingService.cleanup(validNodeIds)` to remove orphaned embeddings. Report count of removed embeddings.

---

## Group 3: Dry-Run Mode & Metrics (Phases 3+4)

### T-3.1: Add dry-run mode [T]
- **File:** src/commands/embed.ts (maintain action)
- **Test:** tests/embed-maintain.test.ts
- **Dependencies:** T-2.2
- **Description:** Add `--dry-run` CLI option to maintain command. Gate all mutating operations (compaction, cleanup, index rebuild) behind `!dryRun` check. Report what would be done without executing.

### T-3.2: Add before/after metrics display [T]
- **File:** src/commands/embed.ts (maintain action)
- **Test:** tests/embed-maintain.test.ts
- **Dependencies:** T-1.1, T-3.1
- **Description:** Capture diagnostics (rows, disk size, fragments, stale count) before maintenance operations. Display delta after completion showing: rows removed, disk space saved, fragments merged.

---

## Group 4: CLI Flag Additions (Phase 5)

### T-4.1: Add --stale CLI flag [T] [P with T-1.1]
- **File:** src/commands/embed.ts (maintain command definition)
- **Test:** tests/embed-maintain.test.ts
- **Dependencies:** none
- **Description:** Add `--stale` flag to `embed maintain` command for running stale embedding cleanup only. Keep existing `--skip-compact`, `--skip-index`, `--skip-cleanup` flags. Default behavior runs all operations including stale cleanup.

---

## Execution Order

1. **Parallel batch 1:** T-1.1, T-4.1 (no dependencies, can run together)
2. **Sequential:** T-1.2 (depends on T-1.1)
3. **Parallel batch 2:** T-2.1 (no deps on diagnostics)
4. **Sequential:** T-2.2 → T-3.1 → T-3.2 (chain dependency)

## Estimated Effort

| Task | Estimate |
|------|----------|
| T-1.1 | ~20 min |
| T-1.2 | ~15 min |
| T-2.1 | ~25 min |
| T-2.2 | ~20 min |
| T-3.1 | ~20 min |
| T-3.2 | ~20 min |
| T-4.1 | ~10 min |
| **Total** | **~2.5 hours** |

## Test File Summary

| Test File | Covers |
|-----------|--------|
| tests/embed-diagnostics.test.ts | T-1.1 (getDiskSize method) |
| tests/embed-stats.test.ts | T-1.2 (enhanced stats display) |
| tests/embed-maintain.test.ts | T-2.1, T-2.2, T-3.1, T-3.2, T-4.1 (maintain operations) |
