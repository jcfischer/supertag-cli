---
id: "F-106"
feature: "embedding-maintenance"
status: "specify"
phase: "specify"
created: "2026-02-23"
priority: "medium"
---

# Specification: Embedding Maintenance & Diagnostics

**Author**: Ivy (PAI)

## Problem Statement

The `embed maintain` command and `embed stats` diagnostics are stubs that return dummy values. After months of incremental `embed generate` runs, the LanceDB storage for the main workspace has grown to **33 GB** with **29,275 data fragments**, **12,690 deletion records**, and **28,193 transaction log entries**. Coverage shows **153.8%** (1,067,375 embeddings vs 693,905 named nodes), meaning ~373K stale embeddings exist for nodes that have been deleted or renamed in Tana.

### Current State

- `getDiagnostics()` in `TanaEmbeddingService` returns hardcoded `{ version: "unknown", totalRows: 0 }` with a `// TODO` comment
- `maintain()` returns immediately with a "not yet implemented" message
- No ANN index exists for the embedding table (brute-force scan on 1M+ vectors)
- No compaction has ever run — every `embed generate` appends new fragments
- The `embed stats` "Database Health" section shows misleading zeros

### Impact

- **33 GB disk usage** for what should be ~4-6 GB of 1024-dim vectors
- **No index** means semantic search scans all vectors on every query
- **Stale vectors** pollute search results with matches to deleted nodes
- **Stats are misleading** — users see "Rows: 0" and "Version: unknown" despite 1M+ embeddings

## Requirements

### R1: Implement getDiagnostics()

Query LanceDB/resona for actual database health metrics:
- Total row count (actual embeddings stored)
- Database size on disk
- Fragment count and deletion count
- Index status (indexed rows, unindexed rows, stale percentage)
- LanceDB version

### R2: Implement maintain() with compaction

Run LanceDB compaction to merge small data fragments into larger ones:
- Merge the 29K+ fragments into a manageable number
- Reclaim space from the 12K+ deletion records
- Report before/after metrics (size, fragment count, duration)

### R3: Implement stale embedding cleanup

Remove embeddings for nodes that no longer exist in the SQLite index:
- Compare embedding IDs against current node IDs in `nodes` table
- Delete orphaned embeddings
- Report count of removed stale embeddings

### R4: Implement ANN index creation/rebuild

Create or rebuild the vector index for faster semantic search:
- Use IVF_PQ or similar ANN index appropriate for ~300K-1M vectors
- Report indexing progress and duration
- Support `--rebuild` flag to force full index recreation

### R5: CLI subcommand improvements

Enhance the `embed maintain` command with options:
- `--compact` — Run compaction only
- `--cleanup` — Run stale embedding cleanup only
- `--reindex` — Rebuild the ANN index only
- `--all` — Run all maintenance operations (default)
- `--dry-run` — Report what would be done without making changes
- Show before/after metrics for each operation

## Success Criteria

- `embed stats` shows actual row count, disk size, fragment count, and index health
- `embed maintain` reduces disk usage by removing stale data and compacting fragments
- `embed maintain --cleanup` removes embeddings for deleted nodes
- ANN index is created and semantic search uses it
- Before/after metrics are displayed for all maintenance operations

## Dependencies

- **resona library** — Must expose compaction, index creation, and diagnostic APIs. If resona doesn't support these yet, the spec should document what APIs are needed and potentially contribute them upstream.
- **LanceDB APIs** — The underlying `@lancedb/lancedb` package supports compaction (`table.compact()`) and indexing (`table.createIndex()`) — resona may need to expose these.

## Technical Notes

- Key files: `src/embeddings/tana-embedding-service.ts` (stubs at lines 210-219, 227+)
- LanceDB storage: `~/.local/share/supertag/workspaces/{alias}/tana-index.lance/embeddings.lance/`
- The resona library wraps LanceDB — check if it already has compaction/diagnostic methods not yet used
- Current model: `bge-m3` with 1024 dimensions
