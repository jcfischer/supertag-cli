# Specification: F-104 Graph-Aware Embeddings

## Context
> Identified as Tier 3 in the Tana Graph DB analysis.
> Enhances the existing embedding pipeline by incorporating graph structure metadata into embedding content.
> Uses the "metadata enrichment" approach: prepend supertag type + key field values to text before embedding.

## Problem Statement

**Core Problem**: The current embedding pipeline (`supertag embed generate`) embeds node names as plain text, losing the rich type and relationship context that makes Tana a knowledge graph. A node named "AI" tagged as `#topic` and a node named "AI" tagged as `#project` produce nearly identical embeddings despite being fundamentally different concepts.

**Current State**:
- `supertag embed generate` creates BGE-M3 embeddings for node content
- Embeddings are pure text vectors — no type, field, or relationship context
- Semantic search returns results based on text similarity only
- Content filtering excludes system nodes but doesn't enrich meaningful ones
- LanceDB stores embeddings with basic metadata (id, name, docType)

**Impact if Unsolved**: Semantic search returns false positives (same word, different types). Context assembler (F-098) can't use semantic similarity for type-aware relevance scoring. The graph structure that makes Tana valuable is invisible to the embedding layer.

## Users & Stakeholders

**Primary User**: Semantic search users who need type-aware results
- Expects: "find AI projects" returns #project nodes about AI, not #topic nodes
- Needs: embeddings that capture both content AND type/field context

**Secondary**:
- Context assembler (F-098) — uses semantic similarity for relevance scoring
- Entity resolution (F-100) — uses semantic matching for candidate scoring
- Any future RAG pipeline over Tana data

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Enrich embedding text with supertag type information before vectorization | Must |
| FR-2 | Include key field values in embedding text (configurable per supertag) | Must |
| FR-3 | `--graph-aware` flag on `supertag embed generate` enables enriched embeddings (default: true for new generations) | Must |
| FR-4 | Enrichment template: `[Type: #supertag] [Field: value] [Field: value] Node name and content` | Must |
| FR-5 | Configurable enrichment: `~/.config/supertag/embed-enrichment.json` defines which fields to include per supertag | Should |
| FR-6 | Default enrichment: include tag name + all non-empty text/options fields | Must |
| FR-7 | Re-generation: `--force` flag rebuilds all embeddings with enrichment | Should |
| FR-8 | Backward compatible: unenriched embeddings still work for search | Must |
| FR-9 | `--enrichment-preview <node-id>` shows what text will be embedded for a node | Should |
| FR-10 | Store enrichment metadata in LanceDB record (enriched: boolean, version: number) | Should |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Enrichment adds < 5% to embedding generation time |
| NFR-2 | Enriched text stays within model's context limit (512 tokens for BGE-M3) |
| NFR-3 | Embedding quality: enriched search should have higher precision than plain search for typed queries |
| NFR-4 | No increase in LanceDB storage size (embedding dimension stays the same) |

## Architecture

### Enrichment Pipeline

```
Node
  → Identify: lookup supertag(s) from tag_applications
  → Enrich: prepend type + field values to node content
  → Truncate: ensure enriched text fits model context window
  → Embed: generate vector from enriched text
  → Store: save to LanceDB with enrichment metadata
```

### Enrichment Template

```
[Type: #meeting] [Date: 2026-02-20] [Attendees: Daniel, Sarah] Weekly sync meeting about AI project roadmap
```

**Priority order when truncating** (keep most important first):
1. Supertag type name (always included)
2. Options/enum fields (compact, high signal)
3. Date fields
4. Instance/reference fields (resolved names)
5. Node name
6. Plain text fields (truncated last)

### Enrichment Configuration

```json
// ~/.config/supertag/embed-enrichment.json
{
  "defaults": {
    "includeTagName": true,
    "includeFields": ["options", "date", "instance"],
    "maxFieldsPerTag": 5
  },
  "overrides": {
    "meeting": {
      "includeFields": ["Date", "Attendees", "Status"],
      "maxFieldsPerTag": 3
    },
    "person": {
      "includeFields": ["Role", "Company"],
      "maxFieldsPerTag": 2
    }
  }
}
```

### LanceDB Schema Extension

```typescript
// Existing fields
interface EmbeddingRecord {
  id: string;
  name: string;
  docType: string;
  vector: Float32Array;
  // New fields
  enriched: boolean;          // Was graph context included?
  enrichmentVersion: number;  // For re-generation tracking
  enrichedText: string;       // The actual text that was embedded (for debugging)
}
```

### Search Enhancement

When searching with enriched embeddings, also enrich the search query:

```
User query: "AI projects"
  → Detect intent: looking for type "project" + topic "AI"
  → Enriched query: "[Type: #project] AI"
  → Higher similarity to project-typed nodes than topic-typed nodes
```

This query enrichment is optional and controlled by a `--type-hint <supertag>` flag on `embed search`.

## Scope

### In Scope
- Metadata enrichment of embedding text
- Configurable per-supertag field inclusion
- `--graph-aware` flag on embed generate
- `--enrichment-preview` for debugging
- LanceDB schema extension for enrichment tracking
- Search query enrichment via `--type-hint`

### Explicitly Out of Scope
- Multi-vector embeddings (content + graph position as separate vectors)
- Graph neighborhood inclusion (1-hop neighbor text)
- Alternative embedding models (stays on BGE-M3)
- Real-time embedding updates (still batch via `embed generate`)

### Designed For But Not Implemented
- Automatic enrichment config learning (analyze which fields improve search quality)
- Hybrid scoring (combine enriched semantic + graph distance in one score)
- Incremental re-enrichment (only re-embed nodes whose type/fields changed)

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Node has no supertag | Embed as plain text (no enrichment possible) |
| Node has multiple supertags | Include all type names; use primary tag's enrichment config |
| Enriched text exceeds 512 tokens | Truncate field values, then node content; always keep type name |
| Field value is a long paragraph | Truncate to first 50 chars for enrichment text |
| Enrichment config file missing | Use defaults (tag name + all non-empty options/date fields) |
| Mixed enriched/unenriched embeddings in same DB | Works — both are valid vectors; enriched ones rank better for typed queries |
| `--type-hint person` on embed search | Prepend `[Type: #person]` to search query text |

## Success Criteria

- [ ] `supertag embed generate --graph-aware` produces enriched embeddings
- [ ] `--enrichment-preview <id>` shows the enriched text for a specific node
- [ ] Search for "project about AI" ranks #project nodes higher than #topic nodes
- [ ] `--type-hint meeting` on embed search boosts #meeting results
- [ ] Enrichment adds < 5% to total generation time
- [ ] Unenriched embeddings still work for search (backward compatible)
- [ ] Enrichment config file customizes which fields are included

## Dependencies

- Existing embedding infrastructure (BGE-M3, LanceDB)
- Existing content filter pipeline
- Tag schema introspection for field discovery
- Field value extraction for enrichment content

---
*Spec created: 2026-02-22*
