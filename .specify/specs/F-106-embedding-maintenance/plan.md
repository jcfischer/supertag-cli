# Technical Plan: F-106 Embedding Maintenance & Diagnostics

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CLI Entry Point                                 │
│  supertag embed maintain [options]    supertag embed stats               │
└─────────────────────────┬──────────────────────┬─────────────────────────┘
                          │                      │
                          ▼                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     TanaEmbeddingService (thin wrapper)                   │
│  - maintain(options)     - getDiagnostics()     - cleanup(keepIds)       │
│  - getEmbeddedIds()      - getStats()                                   │
└─────────────────────────┬────────────────────────────────────────────────┘
                          │ delegates to
                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     resona EmbeddingService (already implemented)         │
│                                                                          │
│  getDiagnostics()  → totalRows, version, index health, dbPath           │
│  maintain()        → compaction + index rebuild + version cleanup         │
│  cleanup(keepIds)  → delete embeddings not in keepIds list               │
│  getEmbeddedIds()  → list all stored IDs                                │
└──────────────────────────────────────────────────────────────────────────┘

NEW: Stale Cleanup Pipeline (cross-references SQLite + LanceDB)
┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ LanceDB:    │    │ SQLite:     │    │ Compute      │    │ LanceDB:    │
│ getEmbedded │───▶│ get valid   │───▶│ stale =      │───▶│ cleanup()   │
│ Ids()       │    │ node IDs    │    │ embedded -   │    │ (keepIds)   │
│             │    │             │    │ valid        │    │             │
└─────────────┘    └─────────────┘    └──────────────┘    └─────────────┘
```

## Key Discovery: resona Already Implements Core Operations

The spec describes `getDiagnostics()` and `maintain()` as stubs returning dummy values. **This is no longer true.** The resona library (already a dependency) fully implements:

| Operation | resona Method | Status |
|-----------|--------------|--------|
| Diagnostics | `getDiagnostics()` → totalRows, version, index health | ✅ Implemented |
| Compaction | `maintain({ skipCompaction: false })` → fragment merge | ✅ Implemented |
| ANN Index | `maintain({ skipIndex: false })` → IVF_PQ index creation | ✅ Implemented |
| Version Cleanup | `maintain({ skipCleanup: false })` → old version pruning | ✅ Implemented |
| Stale Removal | `cleanup(keepIds)` → delete embeddings not in list | ✅ Implemented |

**What's NOT implemented** is the orchestration layer in supertag-cli that:
1. Cross-references LanceDB IDs against SQLite node IDs to find stale embeddings
2. Provides `--dry-run` mode
3. Shows before/after metrics including disk size
4. Adds stale cleanup as a step in the `embed maintain` pipeline

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Vector DB | LanceDB via resona | Already in use, all APIs available |
| Node DB | SQLite (bun:sqlite) | Existing indexed data |
| CLI | Commander.js | Matches existing embed commands |
| Disk size | `Bun.file().size` or `fs.statSync` | Native, no dependencies |

## Implementation Plan

### Phase 1: Enhanced Diagnostics Display (R1)

**Goal:** Make `embed stats` show real, useful health metrics.

**Current state:** `embed stats` calls `getDiagnostics()` which works, but the display is minimal and doesn't show disk size or fragment information.

**Changes:**

| File | Change |
|------|--------|
| `src/embeddings/tana-embedding-service.ts` | Add `getDiskSize()` method that walks the `.lance` directory and sums file sizes |
| `src/commands/embed.ts` (stats action) | Display disk size (human-readable: MB/GB), fragment count from diagnostics |

**getDiskSize() approach:**
```typescript
async getDiskSize(): Promise<{ bytes: number; formatted: string }> {
  // Walk the .lance directory recursively
  // Sum all file sizes
  // Return { bytes, formatted: "33.2 GB" }
}
```

**Enhanced stats output:**
```
Database Health:
  Rows:          1,067,375
  Disk Size:     33.2 GB
  Version:       28,193
  Fragments:     29,275
  Index:         ✓ healthy (1,067,375 indexed, 0 unindexed)
```

Note: `DatabaseDiagnostics` from resona includes `totalRows`, `version`, and index stats. Fragment count and disk size need to be computed separately — fragment count from the `.lance/embeddings.lance/data/` directory listing, disk size from recursive file size summation.

### Phase 2: Stale Embedding Cleanup (R3) — Main New Work

**Goal:** Remove embeddings for nodes that no longer exist in the SQLite database.

**Architecture:**

1. **Get embedded IDs** — `embeddingService.getEmbeddedIds()` returns all IDs from LanceDB
2. **Get valid node IDs** — Query SQLite `SELECT id FROM nodes WHERE name IS NOT NULL`
3. **Compute stale set** — `staleIds = embeddedIds - validNodeIds` (using a Set for O(1) lookup)
4. **Delete stale** — `embeddingService.cleanup(validNodeIds)` removes everything not in the keep list

**Batching concern:** With 1M+ embedded IDs and 693K node IDs, the ID comparison happens in memory using Sets. This is fine — 1M strings averaging ~12 chars each ≈ 12 MB memory. No batching needed for the comparison itself. The `cleanup()` call in resona handles batching internally.

**Changes:**

| File | Change |
|------|--------|
| `src/commands/embed.ts` (maintain action) | Add stale cleanup step between compaction and index rebuild |

**Stale cleanup step in maintain pipeline:**
```typescript
// Step: Stale embedding cleanup
if (!options.skipCleanup) {  // reuse existing flag or add --skip-stale
  onProgress?.("Checking for stale embeddings...");

  const embeddedIds = await embeddingService.getEmbeddedIds();

  // Get valid node IDs from SQLite
  const validNodeIds = await withDatabase({ dbPath: wsContext.dbPath, readonly: true }, (ctx) => {
    const rows = ctx.db.query("SELECT id FROM nodes WHERE name IS NOT NULL").all() as { id: string }[];
    return new Set(rows.map(r => r.id));
  });

  const staleCount = embeddedIds.filter(id => !validNodeIds.has(id)).length;

  if (staleCount > 0) {
    if (dryRun) {
      onProgress?.(`Would remove ${staleCount} stale embeddings`);
    } else {
      const removed = await embeddingService.cleanup([...validNodeIds]);
      onProgress?.(`Removed ${removed} stale embeddings`);
    }
  } else {
    onProgress?.("No stale embeddings found");
  }
}
```

### Phase 3: Dry-Run Mode (R5 partial)

**Goal:** Add `--dry-run` flag that reports what would happen without making changes.

**Changes:**

| File | Change |
|------|--------|
| `src/commands/embed.ts` (maintain command) | Add `--dry-run` option |
| `src/commands/embed.ts` (maintain action) | Gate all mutating operations behind `!dryRun` check |

**Dry-run behavior per operation:**
- **Compaction:** Show current fragment count, estimate reduction
- **Stale cleanup:** Compute and display stale count without deleting
- **Index rebuild:** Report current index staleness percentage
- **Version cleanup:** Report old version count without pruning

### Phase 4: Before/After Metrics (R5 partial)

**Goal:** Show before/after comparison for all maintenance operations.

**Changes:**

| File | Change |
|------|--------|
| `src/commands/embed.ts` (maintain action) | Capture diagnostics before maintenance, display delta after |

**Output format:**
```
🔧 Running maintenance [main]

Before:
  Rows:        1,067,375
  Disk Size:   33.2 GB
  Fragments:   29,275
  Stale:       373,470 (35.0%)

   Removing stale embeddings... (373,470 to remove)
   ✓ Removed 373,470 stale embeddings
   Compacting fragments...
   ✓ Compaction complete (29,250 fragments merged)
   Rebuilding index...
   ✓ Index rebuilt (693,905 rows indexed)
   Cleaning old versions...
   ✓ Cleanup complete (28,190 versions removed)

After:
  Rows:        693,905
  Disk Size:   4.1 GB
  Fragments:   3
  Stale:       0 (0.0%)
  Saved:       29.1 GB (87.7%)

✅ Maintenance complete (duration: 4m 32s)
```

### Phase 5: CLI Flag Alignment (R5)

**Current flags** (skip-based, opt-out):
```
--skip-compact     Skip fragment compaction
--skip-index       Skip index rebuild
--skip-cleanup     Skip old version cleanup
--retention-days   Days to retain old versions (default: 7)
```

**Spec requests** (action-based, opt-in):
```
--compact          Run compaction only
--cleanup          Run stale embedding cleanup only
--reindex          Rebuild the ANN index only
--all              Run all maintenance operations (default)
--dry-run          Report without making changes
```

**Decision: Keep skip-based flags, add new ones.** The skip-based pattern is already implemented and working. Adding action-based flags as well provides both usage patterns:

| New Flag | Behavior |
|----------|----------|
| `--stale` | Run stale embedding cleanup (new operation, not in resona maintain) |
| `--dry-run` | Show what would be done without executing |

The existing `--skip-compact`, `--skip-index`, `--skip-cleanup` stay as-is. The `--stale` flag is new because stale cleanup is a supertag-specific operation (requires SQLite cross-reference) not handled by resona's `maintain()`.

**Default behavior (`embed maintain` with no flags):** Run all operations including stale cleanup.

### File Change Summary

| File | Type | Changes |
|------|------|---------|
| `src/embeddings/tana-embedding-service.ts` | Edit | Add `getDiskSize()` method |
| `src/commands/embed.ts` (maintain action) | Edit | Add stale cleanup step, `--dry-run`, `--stale` flags, before/after metrics |
| `src/commands/embed.ts` (stats action) | Edit | Show disk size and fragment count |
| `tests/embed-maintain.test.ts` | Create | Tests for stale cleanup, dry-run, metrics display |

### Testing Strategy

**Unit tests for stale cleanup logic:**
- Stale IDs correctly computed from LanceDB vs SQLite diff
- `cleanup()` called with correct keepIds
- Dry-run mode doesn't call cleanup
- Before/after metrics captured correctly

**Integration test approach:**
- Use in-memory SQLite + temp LanceDB directory
- Insert known nodes in SQLite, embed subset, delete some nodes
- Run maintain with stale cleanup, verify correct IDs removed
- Verify before/after metrics are accurate

### Risks and Mitigations

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| `getEmbeddedIds()` OOM on 1M+ IDs | Medium | Low | ~12 MB for 1M IDs, well within memory limits |
| `cleanup()` slow on large deletions | Medium | Medium | resona handles batching internally; progress callback shows activity |
| Disk size calculation slow on 29K fragments | Low | Low | Single-pass recursive walk, cached result |
| Compaction fails on corrupt fragments | Medium | Low | resona's `maintain()` handles errors; catch and report |
| Index creation fails on <256 vectors | Low | Low | resona already handles small dataset fallback (flat index vs IVF_PQ) |

### Implementation Order

1. **Phase 1** (diagnostics) — Low risk, immediate value, enables before/after display
2. **Phase 2** (stale cleanup) — Main new work, high impact (removes ~373K stale vectors)
3. **Phase 3** (dry-run) — Safety feature, gates all mutations
4. **Phase 4** (before/after) — Depends on Phase 1 diagnostics
5. **Phase 5** (CLI flags) — Small, can be done alongside Phase 3

Phases 1 and 5 can be parallelized. Phases 2-4 are sequential.

### Estimated Effort

| Phase | Estimate |
|-------|----------|
| Phase 1: Enhanced diagnostics | ~30 min |
| Phase 2: Stale cleanup | ~45 min |
| Phase 3: Dry-run mode | ~20 min |
| Phase 4: Before/after metrics | ~20 min |
| Phase 5: CLI flags | ~15 min |
| Testing | ~30 min |
| **Total** | **~2.5 hours** |
