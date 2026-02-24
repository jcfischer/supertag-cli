# Technical Plan: F-104 Graph-Aware Embeddings

## Architecture Overview

The enrichment pipeline intercepts nodes after content filtering and before embedding generation, prepending graph context (supertag type + field values) to the text being embedded.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Graph-Aware Embedding Pipeline                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Content    │────>│    Graph     │────>│  Enrichment  │────>│   Existing   │
│   Filter     │     │  Enricher    │     │  Truncator   │     │   Pipeline   │
│              │     │   (NEW)      │     │   (NEW)      │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │                    │
       │                    │                    │                    │
       ▼                    ▼                    ▼                    ▼
  ┌─────────┐        ┌──────────────┐    ┌──────────────┐     ┌──────────────┐
  │ Filtered │        │ tag_apps     │    │  512 token   │     │   resona     │
  │  Nodes   │        │ field_values │    │    limit     │     │   LanceDB    │
  └─────────┘        └──────────────┘    └──────────────┘     └──────────────┘

Graph Enricher transforms:
  "Weekly sync meeting"
  ────────────────────────>
  "[Type: #meeting] [Date: 2026-02-20] [Attendees: Daniel, Sarah] Weekly sync meeting"
```

### Integration Points

1. **Content Filter** (`content-filter.ts`): Returns filtered node IDs — unchanged
2. **Graph Enricher** (NEW): Prepends `[Type: #tag] [Field: value]` prefix
3. **Truncator** (NEW): Ensures enriched text fits 512-token limit
4. **TanaEmbeddingService** (`tana-embedding-service.ts`): Receives enriched text via `ContextualizedNode.contextText`

### Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│  Node: "Weekly sync meeting"  (id: abc123)                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  1. LOOKUP TAGS (tag_applications table)                               │
│     └── tags: ["meeting"]                                              │
│                                                                        │
│  2. LOOKUP FIELDS (field_values table)                                 │
│     └── Date: "2026-02-20"                                             │
│     └── Attendees: "Daniel, Sarah"                                     │
│     └── Status: "completed"                                            │
│                                                                        │
│  3. LOAD CONFIG (~/.config/supertag/embed-enrichment.json)             │
│     └── meeting.includeFields: ["Date", "Attendees", "Status"]         │
│     └── meeting.maxFieldsPerTag: 3                                     │
│                                                                        │
│  4. BUILD ENRICHED TEXT                                                │
│     └── "[Type: #meeting] [Date: 2026-02-20] [Attendees: Daniel, ..."  │
│                                                                        │
│  5. TRUNCATE TO 512 TOKENS                                             │
│     └── Priority: Type > Options > Date > Instance > Name > Text       │
│                                                                        │
│  6. EMBED VIA RESONA                                                   │
│     └── Vector: Float32Array[1024] (BGE-M3 dimensions)                 │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Embedding Library | resona (existing) | Already integrated, handles LanceDB operations |
| Vector Storage | LanceDB (via resona) | Already in use, no changes needed |
| Embedding Model | BGE-M3 (existing) | 1024 dimensions, 512 token context — stays unchanged |
| Token Counter | tiktoken (add) | Accurate token counting for truncation |
| Config Storage | JSON file | Simple, human-editable enrichment config |

### Dependencies

**Existing (no changes):**
- `resona` — EmbeddingService, OllamaProvider, BatchEmbedOptions
- `bun:sqlite` — Database queries for tag_applications, field_values
- `commander` — CLI framework

**New:**
- `tiktoken` (or `js-tiktoken`) — Token counting for 512-token truncation
  - Alternative: Use character-based heuristic (4 chars ≈ 1 token) to avoid dependency

## Data Model

### Configuration Interface

```typescript
/**
 * Graph-aware enrichment configuration
 * Stored at: ~/.config/supertag/embed-enrichment.json
 */
export interface GraphAwareEnrichmentConfig {
  /** Global defaults for all supertags */
  defaults: {
    /** Include supertag name in enrichment (default: true) */
    includeTagName: boolean;
    /** Field types to include: "options", "date", "instance", "text" */
    includeFields: FieldType[];
    /** Maximum fields per supertag (default: 5) */
    maxFieldsPerTag: number;
  };
  /** Per-supertag overrides (key is lowercase tag name) */
  overrides: Record<string, SupertagEnrichmentConfig>;
}

export interface SupertagEnrichmentConfig {
  /** Specific field names to include (overrides defaults.includeFields) */
  includeFields?: string[];
  /** Maximum fields for this specific tag */
  maxFieldsPerTag?: number;
  /** Completely disable enrichment for this tag */
  disabled?: boolean;
}

export type FieldType = "options" | "date" | "instance" | "text";

/**
 * Default configuration when no config file exists
 */
export const DEFAULT_ENRICHMENT_CONFIG: GraphAwareEnrichmentConfig = {
  defaults: {
    includeTagName: true,
    includeFields: ["options", "date", "instance"],
    maxFieldsPerTag: 5,
  },
  overrides: {},
};
```

### Enriched Node Interface

```typescript
/**
 * Extended ContextualizedNode with graph enrichment metadata
 * Extends existing ContextualizedNode from contextualize.ts
 */
export interface EnrichedContextualizedNode extends ContextualizedNode {
  /** Whether graph enrichment was applied */
  enriched: boolean;
  /** Enrichment format version (for re-generation tracking) */
  enrichmentVersion: number;
  /** The raw enriched text before any truncation (for debugging) */
  enrichedTextRaw: string;
  /** Supertag names used for enrichment */
  enrichmentTags: string[];
  /** Fields included in enrichment */
  enrichmentFields: Array<{ name: string; value: string }>;
}

/**
 * Current enrichment format version
 * Bump when enrichment template changes to trigger re-generation
 */
export const ENRICHMENT_VERSION = 1;
```

### LanceDB Metadata Extension

The resona library stores metadata alongside vectors. Extend the existing metadata schema:

```typescript
/**
 * Metadata stored in LanceDB via resona's ItemToEmbed.metadata
 * Existing fields: ancestorId, ancestorName, ancestorTags
 * New fields: enriched, enrichmentVersion
 */
interface TanaEmbeddingMetadata {
  // Existing (from contextualize.ts)
  ancestorId: string | null;
  ancestorName: string | null;
  ancestorTags: string[];
  // New (for graph-aware embeddings)
  enriched: boolean;
  enrichmentVersion: number;
}
```

## API Contracts

### CLI Interface

```bash
# Generate embeddings with graph-aware enrichment (default: enabled)
supertag embed generate [--graph-aware] [--no-graph-aware]

# Preview enriched text for a specific node
supertag embed generate --enrichment-preview <node-id>

# Search with type hint (enriches query)
supertag search --semantic "AI projects" --type-hint project
```

### Internal Functions

```typescript
// src/embeddings/graph-enricher.ts
export function enrichNodeWithGraphContext(
  db: Database,
  nodeId: string,
  nodeName: string,
  config: GraphAwareEnrichmentConfig
): EnrichedContextualizedNode;

export function batchEnrichNodesWithGraphContext(
  db: Database,
  nodes: Array<{ id: string; name: string }>,
  config: GraphAwareEnrichmentConfig
): EnrichedContextualizedNode[];

// src/embeddings/enrichment-config.ts
export function loadEnrichmentConfig(): GraphAwareEnrichmentConfig;
export function getConfigForTag(
  config: GraphAwareEnrichmentConfig,
  tagName: string
): SupertagEnrichmentConfig;

// src/embeddings/enrichment-truncator.ts
export function truncateEnrichedText(
  text: string,
  maxTokens: number
): string;
export function estimateTokenCount(text: string): number;
```

## Implementation Phases

### Phase 1: Configuration Layer (T-1)

**Goal:** Config loading and validation for enrichment settings

**Tasks:**
1. Create `src/embeddings/enrichment-config.ts`
2. Define `GraphAwareEnrichmentConfig` interface
3. Implement `loadEnrichmentConfig()` with defaults
4. Implement `getConfigForTag()` for per-supertag resolution
5. Add JSON schema validation for config file

**Files:**
- `src/embeddings/enrichment-config.ts` (NEW)
- `src/types/enrichment.ts` (NEW)

**Tests:**
- Config loading with missing file (uses defaults)
- Config loading with overrides
- Tag-specific config resolution

### Phase 2: Graph Enrichment Core (T-2)

**Goal:** Build enriched text from node + tags + fields

**Tasks:**
1. Create `src/embeddings/graph-enricher.ts`
2. Implement `enrichNodeWithGraphContext()`:
   - Query `tag_applications` for node's supertags
   - Query `field_values` for field data
   - Format as `[Type: #tag] [Field: value] node_name`
3. Implement `batchEnrichNodesWithGraphContext()`:
   - Batch query tags and fields for efficiency
   - Process nodes in chunks (SQLite variable limit)
4. Handle edge cases:
   - No supertag → plain text only
   - Multiple supertags → include all types
   - Long field values → truncate to 50 chars

**Files:**
- `src/embeddings/graph-enricher.ts` (NEW)

**Tests:**
- Single tag enrichment
- Multiple tags enrichment
- No tags (plain text fallback)
- Field value truncation
- Batch enrichment performance

### Phase 3: Token Truncation (T-3)

**Goal:** Ensure enriched text fits 512-token limit

**Tasks:**
1. Create `src/embeddings/enrichment-truncator.ts`
2. Implement `estimateTokenCount()`:
   - Option A: tiktoken dependency (accurate)
   - Option B: Character heuristic (no dependency)
3. Implement `truncateEnrichedText()`:
   - Priority order: Type > Options > Date > Instance > Name > Text
   - Preserve type name always
   - Truncate field values before node content

**Files:**
- `src/embeddings/enrichment-truncator.ts` (NEW)

**Tests:**
- Text under limit (no truncation)
- Text over limit (field truncation)
- Extreme case (type name only)

### Phase 4: Pipeline Integration (T-4)

**Goal:** Integrate enrichment into existing embed generate flow

**Tasks:**
1. Modify `src/commands/embed.ts`:
   - Add `--graph-aware` flag (default: true)
   - Add `--no-graph-aware` flag to disable
   - Add `--enrichment-preview <id>` option
2. Modify `processWorkspaceEmbeddings()`:
   - Load enrichment config
   - Call `batchEnrichNodesWithGraphContext()` instead of `batchContextualizeNodes()`
3. Update metadata passed to resona:
   - Add `enriched: true/false`
   - Add `enrichmentVersion: ENRICHMENT_VERSION`

**Files:**
- `src/commands/embed.ts` (MODIFY)

**Tests:**
- `--graph-aware` produces enriched embeddings
- `--no-graph-aware` produces plain embeddings
- `--enrichment-preview` shows formatted text

### Phase 5: Search Enhancement (T-5)

**Goal:** Add type-hint query enrichment

**Tasks:**
1. Modify `src/commands/search.ts`:
   - Add `--type-hint <tag>` option
   - Prepend `[Type: #tag]` to semantic search query
2. Modify `src/mcp/tools/semantic-search.ts`:
   - Add `typeHint` parameter
   - Apply same query enrichment

**Files:**
- `src/commands/search.ts` (MODIFY)
- `src/mcp/tools/semantic-search.ts` (MODIFY)
- `src/mcp/schemas.ts` (MODIFY — add typeHint to schema)

**Tests:**
- Search with `--type-hint` enriches query
- MCP semantic search with typeHint

### Phase 6: Documentation & Testing (T-6)

**Goal:** Comprehensive tests and documentation

**Tasks:**
1. Integration tests:
   - Full pipeline with real database
   - Performance test (< 5% overhead target)
   - Backward compatibility with unenriched embeddings
2. Update CLAUDE.md with enrichment notes
3. Update CHANGELOG.md with feature entry

**Files:**
- `tests/graph-enrichment.test.ts` (NEW)
- `tests/enrichment-integration.test.ts` (NEW)
- `CLAUDE.md` (MODIFY)
- `CHANGELOG.md` (MODIFY)

## File Structure

```
src/
├── embeddings/
│   ├── content-filter.ts           # Existing (unchanged)
│   ├── contextualize.ts            # Existing (unchanged, still used for --no-graph-aware)
│   ├── context-builder.ts          # Existing (unchanged)
│   ├── tana-embedding-service.ts   # Existing (unchanged)
│   ├── enrichment-config.ts        # NEW: Config loading and validation
│   ├── graph-enricher.ts           # NEW: Core enrichment logic
│   └── enrichment-truncator.ts     # NEW: Token-aware truncation
├── types/
│   └── enrichment.ts               # NEW: TypeScript interfaces
├── commands/
│   ├── embed.ts                    # MODIFY: Add --graph-aware flags
│   └── search.ts                   # MODIFY: Add --type-hint option
└── mcp/
    ├── tools/
    │   └── semantic-search.ts      # MODIFY: Add typeHint parameter
    └── schemas.ts                  # MODIFY: Add typeHint schema

tests/
├── embeddings/
│   ├── graph-enricher.test.ts      # NEW: Unit tests for enrichment
│   ├── enrichment-config.test.ts   # NEW: Config loading tests
│   └── enrichment-truncator.test.ts # NEW: Truncation tests
└── integration/
    └── graph-enrichment.test.ts    # NEW: E2E pipeline tests

~/.config/supertag/
└── embed-enrichment.json           # NEW: User config file (optional)
```

## Dependencies

### External Services
- Ollama server (existing) — for BGE-M3 embedding generation
- No new external services required

### Internal Dependencies
- `tag_applications` table — supertag lookups
- `field_values` table — field value extraction
- `nodes` table — node name retrieval
- resona library — embedding storage and search

### New Package Dependencies
- **Option A:** `js-tiktoken` or `tiktoken` — accurate token counting
- **Option B:** None (use character-based heuristic)

**Recommendation:** Start with character heuristic (4 chars ≈ 1 token) to avoid dependency. Add tiktoken later if precision issues arise.

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Performance degradation** — batch field queries add latency | Medium | Medium | Batch queries by chunk (900 nodes), cache tag lookups, profile before/after. Target: < 5% overhead. |
| **Token truncation quality** — important content cut off | Medium | Low | Priority-based truncation preserves type names. Character heuristic is conservative (overestimates tokens). |
| **Backward compatibility** — mixed enriched/unenriched DBs | Low | High (expected) | Both are valid vectors. No schema migration needed. Document in CLAUDE.md. |
| **Config file errors** — invalid JSON breaks generation | Medium | Low | Validate config on load, use defaults on error, log warning. |
| **Field value privacy** — sensitive data embedded | Low | Low | Fields already indexed in SQLite. Enrichment adds to embedding text but not to new storage. |
| **Multi-tag conflicts** — conflicting enrichment configs | Low | Low | Use first tag's config (primary tag). Document behavior. |

## Success Metrics

1. **Functional:** `supertag embed generate --graph-aware` produces embeddings with `enriched: true` metadata
2. **Quality:** Search for "project about AI" ranks #project nodes higher than #topic nodes
3. **Performance:** Enrichment adds < 5% to total generation time (measure with 10K nodes)
4. **Backward compatibility:** Existing unenriched embeddings still work for search

## Open Questions

1. **Token counting:** Use tiktoken (accurate, adds dependency) or character heuristic (no dependency, ~10% margin)?
   - **Recommendation:** Start with heuristic, add tiktoken if truncation issues arise.

2. **Re-generation trigger:** How to detect when enrichment config changes require re-embedding?
   - **Recommendation:** Store config hash in LanceDB metadata. Warn when hash mismatch.

3. **Incremental re-enrichment:** Only re-embed nodes whose tags/fields changed?
   - **Recommendation:** Out of scope for F-104. Use `--force` flag for full re-generation.

---
*Plan created: 2026-02-24*
