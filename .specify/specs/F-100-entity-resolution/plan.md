# Technical Plan: F-100 Entity Resolution

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Entity Resolution Pipeline                         │
└─────────────────────────────────────────────────────────────────────────────┘

Input: (name, --tag?, --threshold?, --exact?)
                    │
                    ▼
        ┌───────────────────────┐
        │      Normalize        │  → lowercase, trim, punctuation removal
        └───────────────────────┘
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Exact   │  │  Fuzzy   │  │ Semantic │  ← Three parallel match strategies
│  Match   │  │  Match   │  │  Match   │
│ conf=1.0 │  │conf=0.5-│  │conf=0.5- │
│          │  │    0.95  │  │    0.95  │
└──────────┘  └──────────┘  └──────────┘
       │            │            │
       └────────────┼────────────┘
                    ▼
        ┌───────────────────────┐
        │   Merge & Deduplicate │  → Highest confidence per node ID
        └───────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │   Filter & Rank       │  → Apply --threshold, --tag, --limit
        └───────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │   ResolutionResult    │  → action: matched | ambiguous | no_match
        └───────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                            Integration Points                                │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   CLI Command    │    │  Service Layer   │    │    MCP Tool      │
│  src/commands/   │───>│    src/lib/      │<───│  src/mcp/tools/  │
│   resolve.ts     │    │entity-resolution │    │   resolve.ts     │
└──────────────────┘    └──────────────────┘    └──────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │   FTS5       │    │  Levenshtein │    │   LanceDB    │
   │   Search     │    │   (fastest-  │    │  Embeddings  │
   │  (SQLite)    │    │  levenshtein)│    │   (resona)   │
   └──────────────┘    └──────────────┘    └──────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard, fast startup |
| Database | SQLite (via bun:sqlite) | Local-first, FTS5 already set up |
| CLI Framework | Commander.js | Project pattern, consistent UX |
| Fuzzy Matching | `fastest-levenshtein` | **Already in package.json** (v1.0.16), fast and proven |
| Vector Search | `resona` (LanceDB wrapper) | **Already in package.json**, existing semantic search |
| Schema Validation | Zod | Project pattern, MCP schema integration |
| MCP SDK | `@modelcontextprotocol/sdk` | Project standard for MCP tools |

**Key insight:** No new dependencies required. Entity resolution combines existing infrastructure.

## Data Model

```typescript
// src/lib/entity-resolution.ts

/**
 * Match type identifies which strategy found this candidate
 */
export type MatchType = 'exact' | 'fuzzy' | 'semantic';

/**
 * Details about how the match was scored
 */
export interface MatchDetails {
  levenshteinDistance?: number;     // For fuzzy matches
  ftsRank?: number;                 // For exact FTS matches
  cosineSimilarity?: number;        // For semantic matches
}

/**
 * A single candidate match from the resolution pipeline
 */
export interface ResolvedCandidate {
  id: string;                       // Tana node ID
  name: string;                     // Node name
  tags: string[];                   // Applied supertags
  confidence: number;               // 0.0 - 1.0 normalized score
  matchType: MatchType;             // Which strategy found this
  matchDetails: MatchDetails;       // Raw scoring data
}

/**
 * Resolution outcome determines next action
 */
export type ResolutionAction = 'matched' | 'ambiguous' | 'no_match';

/**
 * Complete result from the resolution pipeline
 */
export interface ResolutionResult {
  query: string;                    // Original search term
  normalizedQuery: string;          // After normalization
  candidates: ResolvedCandidate[];  // All matches above threshold
  bestMatch: ResolvedCandidate | null;  // Highest confidence if unambiguous
  action: ResolutionAction;         // matched | ambiguous | no_match
  embeddingsAvailable: boolean;     // Whether semantic search was used
}

/**
 * Options for the resolve operation
 */
export interface ResolveOptions {
  tag?: string;                     // Filter to specific supertag
  threshold?: number;               // Minimum confidence (default: 0.85)
  limit?: number;                   // Max candidates (default: 5)
  exact?: boolean;                  // Exact match only, no fuzzy/semantic
  createIfMissing?: boolean;        // Create node if no match
  workspace?: string;               // Workspace alias
}
```

## Confidence Scoring

### Fuzzy Score Formula

```typescript
function calculateFuzzyConfidence(
  query: string,
  candidateName: string,
  options: { sameTag?: boolean; isEntity?: boolean }
): number {
  const distance = levenshtein(query.toLowerCase(), candidateName.toLowerCase());
  const maxLen = Math.max(query.length, candidateName.length);

  // Base score: 1.0 - (distance / max_length)
  let score = 1.0 - (distance / maxLen);

  // Boost factors (capped at 0.95 - only exact match gets 1.0)
  if (options.sameTag) score += 0.10;
  if (options.isEntity) score += 0.05;

  return Math.min(0.95, Math.max(0, score));
}
```

### Semantic Score Mapping

```typescript
function mapSemanticToConfidence(cosineSimilarity: number): number {
  // Cosine similarity < 0.5 maps to 0 confidence
  // Cosine similarity 0.5-1.0 maps to 0-0.95 confidence
  if (cosineSimilarity < 0.5) return 0;

  // Linear scaling: 0.5 cosine → 0, 1.0 cosine → 0.95
  return Math.min(0.95, (cosineSimilarity - 0.5) * 1.9);
}
```

### Action Determination

```typescript
function determineAction(
  candidates: ResolvedCandidate[],
  threshold: number
): ResolutionAction {
  const aboveThreshold = candidates.filter(c => c.confidence >= threshold);

  if (aboveThreshold.length === 0) return 'no_match';
  if (aboveThreshold.length === 1) return 'matched';

  // Multiple candidates: check if top is significantly better
  const [first, second] = aboveThreshold;
  if (first.confidence - second.confidence >= 0.1) return 'matched';

  return 'ambiguous';
}
```

## Implementation Phases

### Phase 1: Core Service Layer (Day 1)

**Goal:** Pure business logic with no I/O dependencies.

| Task | File | Description |
|------|------|-------------|
| 1.1 | `src/lib/entity-resolution.ts` | Core types and interfaces |
| 1.2 | `src/lib/entity-resolution.ts` | `normalizeQuery()` - whitespace, case, punctuation |
| 1.3 | `src/lib/entity-resolution.ts` | `calculateFuzzyConfidence()` with Levenshtein |
| 1.4 | `src/lib/entity-resolution.ts` | `mapSemanticToConfidence()` rescaling |
| 1.5 | `src/lib/entity-resolution.ts` | `mergeAndDeduplicate()` - combine results |
| 1.6 | `src/lib/entity-resolution.ts` | `determineAction()` - matched/ambiguous/no_match |
| 1.7 | `tests/entity-resolution.test.ts` | Unit tests for all pure functions |

### Phase 2: Database Integration (Day 1-2)

**Goal:** Connect to existing FTS and semantic search.

| Task | File | Description |
|------|------|-------------|
| 2.1 | `src/db/entity-match.ts` | `findExactMatches()` - case-insensitive name search |
| 2.2 | `src/db/entity-match.ts` | `findFuzzyMatches()` - FTS5 + Levenshtein scoring |
| 2.3 | `src/db/entity-match.ts` | Integration with `TanaEmbeddingService.search()` |
| 2.4 | `src/db/entity-match.ts` | Tag filtering with `tag_applications` table |
| 2.5 | `tests/entity-match.test.ts` | Integration tests with test fixtures |

### Phase 3: CLI Command (Day 2)

**Goal:** User-facing CLI with all options.

| Task | File | Description |
|------|------|-------------|
| 3.1 | `src/commands/resolve.ts` | `createResolveCommand()` with Commander |
| 3.2 | `src/commands/resolve.ts` | Options: `--tag`, `--threshold`, `--exact`, `--limit` |
| 3.3 | `src/commands/resolve.ts` | `--create-if-missing` with Tana Input API |
| 3.4 | `src/commands/resolve.ts` | `--batch` mode for stdin processing |
| 3.5 | `src/commands/resolve.ts` | Output formatting (table, JSON, ids) |
| 3.6 | `src/index.ts` | Register command with main CLI |
| 3.7 | `tests/commands/resolve.test.ts` | E2E tests for CLI |

### Phase 4: MCP Tool (Day 2-3)

**Goal:** AI-accessible entity resolution.

| Task | File | Description |
|------|------|-------------|
| 4.1 | `src/mcp/schemas.ts` | `resolveSchema` with Zod validation |
| 4.2 | `src/mcp/tools/resolve.ts` | `resolve()` handler function |
| 4.3 | `src/mcp/tool-registry.ts` | Add `tana_resolve` to registry |
| 4.4 | `src/mcp/tool-mode.ts` | Add to appropriate mode (query) |
| 4.5 | `src/mcp/index.ts` | Register tool in dispatcher |
| 4.6 | `tests/mcp/resolve.test.ts` | MCP tool tests |

### Phase 5: Name Reversal & Polish (Day 3)

**Goal:** Handle edge cases, improve accuracy.

| Task | File | Description |
|------|------|-------------|
| 5.1 | `src/lib/entity-resolution.ts` | Name reversal for "Last, First" patterns |
| 5.2 | `src/lib/entity-resolution.ts` | Short query protection (require `--exact` or `--tag`) |
| 5.3 | `src/lib/entity-resolution.ts` | Special character escaping for FTS5 |
| 5.4 | Documentation | README.md and SKILL.md updates |
| 5.5 | `tests/entity-resolution-edge.test.ts` | Edge case tests |

## File Structure

```
src/
├── lib/
│   └── entity-resolution.ts      # Core resolution logic (pure functions)
├── db/
│   └── entity-match.ts           # Database queries for matching
├── commands/
│   └── resolve.ts                # CLI command handler
├── mcp/
│   ├── schemas.ts                # + resolveSchema
│   ├── tool-registry.ts          # + tana_resolve metadata
│   ├── tool-mode.ts              # + mode assignment
│   ├── index.ts                  # + dispatcher case
│   └── tools/
│       └── resolve.ts            # MCP tool implementation

tests/
├── entity-resolution.test.ts     # Unit tests for core logic
├── entity-match.test.ts          # Database integration tests
├── commands/
│   └── resolve.test.ts           # CLI E2E tests
└── mcp/
    └── resolve.test.ts           # MCP tool tests
```

## API Contracts

### CLI Interface

```bash
# Basic resolution
supertag resolve "Daniel Miessler"
# → { action: "matched", confidence: 0.95, id: "abc123", matchType: "exact" }

# Type-filtered resolution
supertag resolve "Daniel Miessler" --tag person
# → Limits candidates to #person nodes

# Exact match only
supertag resolve "Daniel Miessler" --exact
# → No fuzzy or semantic matching

# Custom threshold
supertag resolve "Daniel" --threshold 0.9 --limit 3
# → Returns up to 3 candidates with confidence >= 0.9

# Batch mode
cat names.txt | supertag resolve --batch --tag person --format json
# → Process multiple names from stdin

# Create if missing
supertag resolve "New Person" --tag person --create-if-missing
# → Creates #person node if no match found
```

### MCP Tool Interface

```typescript
// Input schema (Zod)
const resolveSchema = z.object({
  name: z.string().min(1).describe('Name to resolve'),
  tag: z.string().optional().describe('Filter to specific supertag'),
  threshold: z.number().min(0).max(1).default(0.85),
  limit: z.number().min(1).max(20).default(5),
  exact: z.boolean().default(false),
  createIfMissing: z.boolean().default(false),
  workspace: workspaceSchema,
});

// Response structure
interface ResolveResponse {
  query: string;
  action: 'matched' | 'ambiguous' | 'no_match';
  candidates: Array<{
    id: string;
    name: string;
    tags: string[];
    confidence: number;
    matchType: 'exact' | 'fuzzy' | 'semantic';
  }>;
  bestMatch: { id: string; name: string; confidence: number } | null;
  created?: { id: string; name: string };  // If createIfMissing triggered
}
```

## Dependencies

### Internal Dependencies

| Module | Purpose |
|--------|---------|
| `src/embeddings/tana-embedding-service.ts` | Semantic search via LanceDB |
| `src/embeddings/search-filter.ts` | Result filtering, deduplication |
| `src/db/entity.ts` | Entity detection (`isEntityById`) |
| `src/config/workspace-resolver.ts` | Workspace database resolution |
| `src/commands/helpers.ts` | Standard CLI helpers |
| `src/utils/output-formatter.ts` | Format output (table, JSON, etc.) |

### External Dependencies (All Existing)

| Package | Version | Purpose |
|---------|---------|---------|
| `fastest-levenshtein` | ^1.0.16 | Fuzzy string matching |
| `resona` | github:jcfischer/resona#main | Embeddings and vector search |
| `commander` | ^12.0.0 | CLI framework |
| `zod` | 3.25.76 | Schema validation |
| `@modelcontextprotocol/sdk` | ^1.24.3 | MCP server implementation |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Levenshtein on large candidate sets is slow | Medium | Medium | Pre-filter with FTS5 to limit candidates to ~100 before Levenshtein scoring |
| Semantic search unavailable (no embeddings) | Low | Medium | Graceful degradation: fuzzy-only mode with clear messaging |
| Ambiguous results frustrate users | Medium | High | Return confidence gap analysis; suggest `--tag` filter |
| Short queries return too many false positives | Medium | Medium | Require `--exact` or `--tag` for queries < 3 characters |
| Name reversal creates duplicate matches | Low | Low | Deduplicate by node ID before returning |
| `--create-if-missing` with ambiguous match | High | Medium | Refuse to create; require explicit human decision |
| Batch mode memory usage with 1000+ names | Medium | Low | Process in chunks of 50; stream output |

## Performance Budget

| Operation | Target | Verification |
|-----------|--------|--------------|
| Single resolve (fuzzy only) | < 500ms | CLI timing output |
| Single resolve (fuzzy + semantic) | < 2s | CLI timing output |
| Batch resolve (50 names) | < 10s | E2E test assertion |
| Memory per resolve | < 50MB | Profile during tests |

## Test Strategy

### Unit Tests (Phase 1)
- `normalizeQuery()` with edge cases (Unicode, punctuation)
- `calculateFuzzyConfidence()` with known Levenshtein distances
- `mapSemanticToConfidence()` boundary conditions
- `determineAction()` with various candidate distributions

### Integration Tests (Phase 2-4)
- FTS + Levenshtein pipeline with test fixtures
- Semantic search integration (mock LanceDB)
- MCP tool end-to-end with schema validation

### E2E Tests (Phase 3-5)
- CLI command with all option combinations
- Batch mode with stdin piping
- Create-if-missing with Tana Input API (mocked)

---

*Plan created: 2026-02-22*
*Spec: F-100 Entity Resolution*
*Estimated effort: 3 days*
