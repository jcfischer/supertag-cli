# Specification: F-100 Entity Resolution

## Context
> Identified as Tier 2 in the Tana Graph DB analysis.
> Essential for AI-maintained knowledge graph workflows — before creating a new node, check if it already exists.

## Problem Statement

**Core Problem**: When AI agents or automation pipelines want to create or reference a node in Tana, they need to determine whether a matching node already exists. Currently this requires manual search + human judgment. There's no "find-or-create" primitive with configurable confidence thresholds.

**Current State**:
- `supertag search` does full-text search (exact or fuzzy via FTS5)
- `supertag embed search` does semantic similarity search
- No combined resolution that uses both approaches
- No confidence scoring to decide "match" vs "create new"
- No type-aware matching (e.g., "find a #person named Daniel, not a #project named Daniel")

**Impact if Unsolved**: AI-driven knowledge graph enrichment creates duplicates. Users must manually deduplicate. Automated workflows can't safely create nodes without human review of every potential match.

## Users & Stakeholders

**Primary User**: AI agents enriching the Tana knowledge graph
- Expects: "Does 'Daniel Miessler' exist as a #person?" → yes (confidence 0.95) or no → safe to create
- Needs: configurable threshold, type filtering, both fuzzy and semantic matching

**Secondary**:
- Bulk import workflows (CSV → Tana) needing deduplication
- Data cleaning / merge detection tools
- pai-seed integration (F-105) — checks if a learning already exists before creating

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | `supertag resolve <name>` searches for existing nodes matching the name | Must |
| FR-2 | `--tag <supertag>` limits resolution to nodes of a specific type | Must |
| FR-3 | Returns match candidates with confidence scores (0.0 - 1.0) | Must |
| FR-4 | `--threshold <float>` sets minimum confidence for a "match" (default: 0.85) | Must |
| FR-5 | Resolution strategy: fuzzy text match first (fast), then semantic similarity if available | Must |
| FR-6 | `--exact` flag for strict name-only matching (no fuzzy, no semantic) | Should |
| FR-7 | Return top-N candidates ranked by confidence (default: 5) | Should |
| FR-8 | `--create-if-missing` flag that creates a new node if no match above threshold | Should |
| FR-9 | MCP tool `tana_resolve` with same capabilities | Must |
| FR-10 | Batch resolution: `--batch` flag accepting newline-separated names from stdin | Should |
| FR-11 | Output includes match type: `exact`, `fuzzy`, `semantic` | Should |
| FR-12 | For multi-word names, also try reversed order (e.g., "Miessler, Daniel" → "Daniel Miessler") | Should |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Single resolution completes in < 500ms (fuzzy only) or < 2s (fuzzy + semantic) |
| NFR-2 | Batch resolution of 50 names completes in < 10 seconds |
| NFR-3 | Confidence scoring is deterministic for the same input and database state |
| NFR-4 | Works without embeddings (fuzzy-only mode) — semantic is an enhancement, not a requirement |

## Architecture

### Resolution Pipeline

```
Input (name, optional --tag)
  → Normalize: lowercase, trim, remove punctuation
  → Exact Match: case-insensitive name search (confidence: 1.0)
  → Fuzzy Match: FTS5 search + Levenshtein distance scoring (confidence: 0.5-0.95)
  → Semantic Match (if embeddings available): embed query, cosine similarity (confidence: 0.5-0.95)
  → Merge: combine candidates, deduplicate, take highest confidence per node
  → Filter: apply --threshold, --tag filters
  → Return: ranked candidates with confidence and match type
```

### Confidence Scoring

```typescript
interface ResolvedCandidate {
  id: string;
  name: string;
  tags: string[];
  confidence: number;         // 0.0 - 1.0
  matchType: 'exact' | 'fuzzy' | 'semantic';
  matchDetails: {
    levenshteinDistance?: number;
    ftsScore?: number;
    cosineSimilarity?: number;
  };
}

interface ResolutionResult {
  query: string;
  candidates: ResolvedCandidate[];
  bestMatch: ResolvedCandidate | null;   // Highest confidence above threshold
  action: 'matched' | 'ambiguous' | 'no_match';
  // matched: one candidate clearly above threshold
  // ambiguous: multiple candidates near threshold
  // no_match: nothing above threshold
}
```

### Fuzzy Scoring Formula

```
fuzzyConfidence = 1.0 - (levenshteinDistance / max(queryLength, candidateLength))
```

Boosted by:
- +0.1 if same supertag type matches --tag filter
- +0.05 if candidate is an entity (has _flags entity bit)
- Capped at 0.95 (only exact match gets 1.0)

### Semantic Scoring

```
semanticConfidence = cosineSimilarity(embed(query), embed(candidate))
```

Rescaled to match fuzzy scale: values below 0.5 cosine similarity map to 0.0 confidence.

## Scope

### In Scope
- `supertag resolve` CLI command
- `tana_resolve` MCP tool
- Fuzzy text matching with Levenshtein distance
- Semantic matching via existing embeddings (optional enhancement)
- Type-filtered resolution (--tag)
- Confidence scoring and thresholds
- Batch resolution mode
- `--create-if-missing` convenience flag

### Explicitly Out of Scope
- Automatic merging of duplicate nodes
- Learning from user corrections (adaptive thresholds)
- Cross-workspace resolution
- Resolution based on field values (e.g., "find person with email X")

### Designed For But Not Implemented
- User feedback loop (thumbs up/down on matches to improve scoring)
- Field-based resolution ("resolve by email address instead of name")
- Merge suggestions ("these 3 nodes might be duplicates")

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Exact name match exists | Return with confidence 1.0, action: matched |
| Multiple exact matches (same name, different types) | Return all, action: ambiguous if no --tag filter |
| Query is very short (1-2 chars) | Require --exact or --tag to avoid too many false matches |
| Query contains special characters | Normalize before matching; escape for FTS5 |
| No embeddings generated | Fall back to fuzzy-only mode; note in output |
| Batch with 1000 names | Process in chunks of 50; show progress |
| `--create-if-missing` with ambiguous match | Don't create; return ambiguous result for human decision |

## Success Criteria

- [ ] `supertag resolve "Daniel Miessler"` finds the person node with confidence > 0.85
- [ ] `supertag resolve "Daniel Miessler" --tag person` filters to #person nodes only
- [ ] `supertag resolve "Dniel Miessler"` (typo) still finds the match via fuzzy (confidence ~0.9)
- [ ] `supertag resolve "nonexistent thing"` returns action: no_match
- [ ] `supertag resolve "common name" --tag project` returns action: ambiguous with multiple candidates
- [ ] `tana_resolve` MCP tool returns identical results to CLI
- [ ] Batch mode resolves 20 names in under 5 seconds

## Dependencies

- Existing FTS5 search infrastructure
- Existing embedding/semantic search (optional — graceful degradation)
- F-097 (Live Read Backend) — for data access

---
*Spec created: 2026-02-22*
