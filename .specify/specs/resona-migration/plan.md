---
feature: "Migrate Embeddings from SQLite-vec to Resona"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Migrate Embeddings from SQLite-vec to Resona

## Architecture Overview

Replace custom SQLite + sqlite-vec vector storage with resona (LanceDB) while preserving Tana-specific features (contextualization, ancestor resolution, content filtering).

```
BEFORE:                                  AFTER:
┌────────────────────────┐              ┌────────────────────────┐
│   CLI / MCP Server     │              │   CLI / MCP Server     │
└───────────┬────────────┘              └───────────┬────────────┘
            │                                       │
┌───────────▼────────────┐              ┌───────────▼────────────┐
│  embed.ts / semantic-  │              │  embed.ts / semantic-  │
│  search.ts             │              │  search.ts             │
└───────────┬────────────┘              └───────────┬────────────┘
            │                                       │
┌───────────▼────────────┐              ┌───────────▼────────────┐
│ Custom EmbeddingService│              │ TanaEmbeddingService   │
│ (service.ts)           │              │ (thin wrapper)         │
└───────────┬────────────┘              └───────────┬────────────┘
            │                                       │
┌───────────▼────────────┐              ┌───────────▼────────────┐
│ sqlite-vec + SQLite    │              │ resona.EmbeddingService│
│ • OllamaProvider       │              │ • OllamaProvider       │
│ • TransformersProvider │              │ • TransformersProvider │
│ • embed-config         │              └───────────┬────────────┘
│ • schema.ts            │                          │
└───────────┬────────────┘              ┌───────────▼────────────┐
            │                           │ LanceDB (.lance dir)   │
┌───────────▼────────────┐              └────────────────────────┘
│ vec_embeddings table   │
│ embeddings table       │                        + (unchanged)
│ embedding_config table │              ┌────────────────────────┐
└────────────────────────┘              │ Tana-Specific Features │
                                        │ • content-filter.ts    │
            + (unchanged)               │ • contextualize.ts     │
┌────────────────────────┐              │ • ancestor-resolution  │
│ Tana-Specific Features │              │ • search-filter.ts     │
│ • content-filter.ts    │              └────────────────────────┘
│ • contextualize.ts     │
│ • ancestor-resolution  │
│ • search-filter.ts     │
└────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Vector Storage | LanceDB (via resona) | No extensions, cross-platform |
| Embedding Providers | resona.OllamaProvider | Already implemented, tested |
| Tana Node DB | SQLite (unchanged) | Only embedding storage migrates |

## Constitutional Compliance

- [x] **CLI-First:** `supertag embed` commands preserved unchanged
- [x] **Library-First:** Core logic delegated to resona library; thin wrapper for Tana-specific needs
- [x] **Test-First:** TDD for TanaEmbeddingService; existing Tana-specific tests preserved
- [x] **Deterministic:** Vector search is deterministic (same query, same results)
- [x] **Code Before Prompts:** All logic in code; no LLM prompts in embedding pipeline

## Data Model

### Entities (from resona)

```typescript
// From resona - no changes needed
interface ItemToEmbed {
  id: string;
  text: string;
  contextText?: string;  // Tana uses this for ancestor context
  metadata?: Record<string, unknown>;
}

interface SearchResult {
  id: string;
  distance: number;
  similarity: number;
  contextText: string;
  metadata?: Record<string, unknown>;
}

interface EmbeddingStats {
  totalEmbeddings: number;
  model: string;
  dimensions: number;
  oldestEmbedding?: Date;
  newestEmbedding?: Date;
}
```

### Tana-Specific Types (preserved)

```typescript
// From contextualize.ts - unchanged
interface ContextualizedNode {
  nodeId: string;
  nodeName: string;
  ancestorId: string | null;
  ancestorName: string | null;
  ancestorTags: string[];
  contextText: string;
}

// From content-filter.ts - unchanged
interface ContentFilterOptions {
  minLength?: number;
  excludeTimestamps?: boolean;
  excludeSystemTypes?: boolean;
  tag?: string;
  limit?: number;
  includeAll?: boolean;
}
```

### Storage Location

```
# Before (sqlite-vec)
~/.local/share/supertag/workspaces/{alias}/tana-index.db
  └── embeddings table
  └── embedding_config table
  └── vec_embeddings virtual table

# After (LanceDB via resona)
~/.local/share/supertag/workspaces/{alias}/embeddings.lance/
  └── embeddings/ (LanceDB table directory)
```

## API Contracts

### TanaEmbeddingService (new wrapper)

```typescript
/**
 * Thin wrapper around resona for Tana-specific embedding needs.
 * Delegates all storage/search to resona, adds Tana metadata.
 */
export class TanaEmbeddingService {
  private service: resona.EmbeddingService;
  private sourceId: string;

  constructor(dbPath: string, options?: {
    model?: string;
    ollamaEndpoint?: string;
    sourceId?: string;
  });

  // Embed contextualized Tana nodes
  async embedNodes(nodes: ContextualizedNode[], options?: {
    forceAll?: boolean;
    onProgress?: (progress: BatchEmbedProgress) => void;
  }): Promise<BatchEmbedResult>;

  // Search returns node IDs (enrichment happens in caller via Tana DB)
  async search(query: string, k?: number): Promise<Array<{
    nodeId: string;
    distance: number;
    similarity: number;
  }>>;

  async getStats(): Promise<EmbeddingStats>;
  async getEmbeddedIds(): Promise<string[]>;
  close(): void;
}
```

### Provider Factory (simplified)

```typescript
/**
 * Create embedding provider from config.
 * Delegates to resona providers directly.
 */
export function createProvider(config: {
  model: string;
  endpoint?: string;
}): resona.EmbeddingProvider {
  return new resona.OllamaProvider(config.model, config.endpoint);
}
```

## Implementation Strategy

### Phase 1: Foundation (TDD setup)

Set up resona dependency and create failing tests for TanaEmbeddingService.

- [ ] Add resona dependency to package.json
- [ ] Create TanaEmbeddingService test file with failing tests
- [ ] Define TanaEmbeddingService interface

### Phase 2: Core Implementation

Implement TanaEmbeddingService wrapper and migrate core functionality.

- [ ] Implement TanaEmbeddingService (make tests pass)
- [ ] Update embed command to use TanaEmbeddingService
- [ ] Update semantic search MCP tool
- [ ] Verify CLI commands work end-to-end

### Phase 3: Cleanup & Integration

Remove sqlite-vec code and update all references.

- [ ] Remove sqlite-vec files and dependencies
- [ ] Remove sqlite-vec extension loading code
- [ ] Update package.json (remove sqlite-vec deps)
- [ ] Run full test suite
- [ ] Update documentation (CHANGELOG, README)

## File Structure

```
src/embeddings/
├── tana-embedding-service.ts        # [NEW] Wrapper around resona
├── tana-embedding-service.test.ts   # [NEW] Tests for wrapper
│
│ # KEEP (Tana-specific, use SQLite nodes DB)
├── ancestor-resolution.ts           # [KEEP] Finds tagged ancestors
├── ancestor-resolution.test.ts      # [KEEP]
├── content-filter.ts                # [KEEP] Filters nodes for embedding
├── content-filter.test.ts           # [KEEP]
├── contextualize.ts                 # [KEEP] Adds ancestor context
├── contextualize.test.ts            # [KEEP]
├── search-filter.ts                 # [KEEP] Post-search filtering
│
│ # DELETE (replaced by resona)
├── service.ts                       # [DELETE] → resona.EmbeddingService
├── service.test.ts                  # [DELETE]
├── schema.ts                        # [DELETE] → LanceDB
├── schema.test.ts                   # [DELETE]
├── ollama.ts                        # [DELETE] → resona.OllamaProvider
├── ollama.test.ts                   # [DELETE]
├── transformers.ts                  # [DELETE] → resona.TransformersProvider
├── transformers.test.ts             # [DELETE]
├── factory.ts                       # [DELETE] → inline provider creation
├── provider.test.ts                 # [DELETE]
├── types.ts                         # [DELETE] → resona types
├── embed-config.ts                  # [DELETE] → use config file
├── embed-config.test.ts             # [DELETE]
├── sqlite-vec-loader.ts             # [DELETE]
├── preload-sqlite.ts                # [DELETE]
│
│ # NEEDS DECISION
├── ab-test.ts                       # [DEFER] A/B testing - complex, defer

src/commands/
├── embed.ts                         # [MODIFY] Remove sqlite-vec, use wrapper

src/mcp/
├── index.ts                         # [MODIFY] Remove sqlite-vec preloading
├── tools/
│   └── semantic-search.ts           # [MODIFY] Use TanaEmbeddingService

tests/
├── embeddings/
│   └── tana-embedding-service.test.ts  # [NEW] Integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance regression | Medium | Low | Benchmark before/after; LanceDB is fast |
| API compatibility | High | Low | TDD approach; test CLI commands first |
| Concurrent access issues | Medium | Low | LanceDB handles concurrency; test multi-workspace |
| Existing users must regenerate | Low | High | Clear migration docs; regeneration is fast |
| A/B test feature loss | Low | Medium | Defer A/B test migration; document as known limitation |

## Dependencies

### External

| Package | Purpose | Notes |
|---------|---------|-------|
| `resona` | Embedding storage/search | `^0.1.0` from npm |
| `@lancedb/lancedb` | Transitive via resona | Bundled, no extension needed |

### Internal (unchanged)

| Module | Purpose |
|--------|---------|
| `src/config/paths.ts` | Workspace database paths |
| `src/config/manager.ts` | Configuration management |
| `src/db/entity.ts` | Entity detection |
| `src/commands/show.ts` | Node content formatting |

### Removed Dependencies

| Package | Reason |
|---------|--------|
| `sqlite-vec` | Replaced by LanceDB |
| `sqlite-vec-darwin-arm64` | Platform-specific extension |
| `sqlite-vec-darwin-x64` | Platform-specific extension |
| `sqlite-vec-linux-x64` | Platform-specific extension |

## Migration/Deployment

- [x] **Database migrations needed?** No - clean break, users regenerate
- [ ] **Environment variables?** None (model/endpoint in config file)
- [x] **Breaking changes?** Yes - embeddings must be regenerated

### User Migration Steps

```bash
# 1. Update supertag
supertag update  # or reinstall

# 2. Configure provider (if not already)
supertag embed config --provider ollama --model mxbai-embed-large

# 3. Regenerate embeddings
supertag embed generate --all  # Force regeneration
```

### Release Notes Template

```markdown
## Breaking Changes

- Embedding storage migrated from SQLite-vec to LanceDB
- **Action Required:** Run `supertag embed generate --all` to regenerate embeddings
- Old embeddings in SQLite format will be ignored

## Improvements

- Removed platform-specific sqlite-vec extension dependency
- Simplified embedding infrastructure
- Unified embedding backend with other PAI skills
```

## Estimated Complexity

- **New files:** 2 (TanaEmbeddingService + tests)
- **Modified files:** 4 (embed.ts, semantic-search.ts, mcp/index.ts, package.json)
- **Deleted files:** 16 (sqlite-vec related)
- **Test files:** 1 new, 8 deleted
- **Estimated tasks:** ~12-15 discrete tasks across 3 phases

## Configuration Storage Decision

Per user clarification: Use resona's internal config, not separate embedding_config table.

**Approach:**
1. Model/endpoint stored in supertag's existing config file (`~/.config/supertag/config.json`)
2. Resona handles embedding metadata (model, dimensions) internally in LanceDB
3. No separate `embedding_config` SQLite table needed

```typescript
// Config structure in ~/.config/supertag/config.json
{
  "workspaces": { ... },
  "embeddings": {
    "model": "mxbai-embed-large",
    "endpoint": "http://localhost:11434"
  }
}
```
