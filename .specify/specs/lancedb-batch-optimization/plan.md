---
feature: "LanceDB Batch Optimization - Tana Integration"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: LanceDB Batch Optimization - Tana Integration

## Architecture Overview

Minimal integration layer to pass resona's new `storeBatchSize` option through the Tana skill and display dual progress counters.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         embed.ts (CLI)                              │
│  --lance-batch-size option → displays dual progress counters        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ passes storeBatchSize
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  TanaEmbeddingService                               │
│  embedNodes(nodes, { storeBatchSize }) → forwards to resona         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ delegates
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  resona EmbeddingService (v0.2.0)                   │
│  - Buffer records in memory until storeBatchSize threshold          │
│  - Progress callback includes: stored, bufferSize                   │
└─────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Embedding | resona 0.2.0 | Already implements batch optimization |
| CLI | Commander.js | Existing CLI framework in tana |

## Constitutional Compliance

- [x] **CLI-First:** Exposes `--lance-batch-size` CLI option
- [x] **Library-First:** Core logic is in resona (separate library)
- [x] **Test-First:** Tests for TanaEmbeddingService passing new options
- [x] **Deterministic:** Same inputs produce same embeddings; only write timing changes
- [x] **Code Before Prompts:** All logic in TypeScript, no prompts involved

## Data Model

### No New Entities

No new data models needed. The resona library handles all buffering internally.

### Type Updates

```typescript
// Updated progress callback in embed.ts to show dual counters
interface DualProgressDisplay {
  generated: number;  // From progress.processed
  persisted: number;  // From progress.stored
  bufferSize: number; // From progress.bufferSize
}
```

## API Contracts

### CLI Interface

```bash
# New option for embed generate command
supertag embed generate --lance-batch-size <n>

# Default: 5000 (matches resona default)
# Range: 1000-10000 recommended
```

### TanaEmbeddingService.embedNodes()

```typescript
// Current signature (unchanged)
async embedNodes(
  nodes: ContextualizedNode[],
  options: BatchEmbedOptions = {}
): Promise<BatchEmbedResult>

// BatchEmbedOptions now includes (from resona 0.2.0):
interface BatchEmbedOptions {
  onProgress?: (progress: BatchEmbedProgress) => void;
  progressInterval?: number;
  forceAll?: boolean;
  storeBatchSize?: number;  // NEW: LanceDB write batch size
}

// BatchEmbedProgress now includes (from resona 0.2.0):
interface BatchEmbedProgress {
  processed: number;
  skipped: number;
  errors: number;
  total: number;
  rate?: number;
  stored: number;       // NEW: Written to LanceDB
  bufferSize: number;   // NEW: Current buffer occupancy
}
```

## Implementation Strategy

### Phase 1: Update Dependencies

- [ ] Update resona to ^0.2.0 in package.json
- [ ] Verify resona types include new fields

### Phase 2: CLI Integration

- [ ] Add `--lance-batch-size <n>` option to `embed generate` command
- [ ] Pass `storeBatchSize` option through to `embedNodes()`
- [ ] Update progress display to show dual counters

### Phase 3: Testing

- [ ] Test TanaEmbeddingService with storeBatchSize option
- [ ] Test progress callback receives stored/bufferSize
- [ ] Verify backward compatibility (no option = default behavior)

## File Structure

```
src/
├── commands/
│   └── embed.ts           # [Modified] Add --lance-batch-size, dual progress
└── embeddings/
    └── tana-embedding-service.ts  # [No changes] - resona handles it

test/
└── unit/
    └── tana-embedding-service.test.ts  # [Modified] Add batch option tests
```

## Implementation Details

### embed.ts Changes

1. Add CLI option:
```typescript
.option("--lance-batch-size <n>", "LanceDB write batch size (default: 5000)")
```

2. Pass to embedNodes:
```typescript
const result = await embeddingService.embedNodes(contextualizedNodes, {
  forceAll: options.all,
  storeBatchSize: options.lanceBatchSize ? parseInt(options.lanceBatchSize) : undefined,
  onProgress: (progress) => { /* ... */ },
});
```

3. Update progress display:
```typescript
// Current:
const line = `   ⏳ ${pct}% | ${progress.processed} done | ${progress.errors} errors | ${rateStr}`;

// New:
const line = `   ⏳ ${pct}% | Ollama: ${progress.processed} | LanceDB: ${progress.stored} | Buffer: ${progress.bufferSize} | ${rateStr}`;
```

### No Changes to TanaEmbeddingService

TanaEmbeddingService already passes options directly to resona:
```typescript
// This already works - resona 0.2.0 handles storeBatchSize
return this.service.embedBatch(items, options);
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| resona 0.2.0 not installed | High | Low | Version check at startup |
| Progress display breaks | Low | Low | Graceful fallback if fields undefined |
| Memory pressure on large batch | Medium | Low | Document recommended batch sizes |

## Dependencies

### External

- `resona ^0.2.0` - New version with batch optimization

### Internal

- TanaEmbeddingService - Thin wrapper, no changes needed
- embed.ts - CLI command handler

## Migration/Deployment

- [ ] **Package update:** `bun add resona@0.2.0`
- [ ] **Database migrations:** None needed
- [ ] **Environment variables:** None needed
- [ ] **Breaking changes:** None - fully backward compatible

## Estimated Complexity

- **New files:** 0
- **Modified files:** 2 (embed.ts, package.json)
- **Test files:** 1 modified (tana-embedding-service.test.ts)
- **Estimated tasks:** 4-5
