# Implementation Tasks: F-100 Entity Resolution

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ✅ | Core types and interfaces |
| T-1.2 | ✅ | normalizeQuery() |
| T-1.3 | ✅ | calculateFuzzyConfidence() |
| T-1.4 | ✅ | mapSemanticToConfidence() |
| T-1.5 | ✅ | mergeAndDeduplicate() |
| T-1.6 | ✅ | determineAction() |
| T-1.7 | ✅ | Unit tests for core logic (47 tests) |
| T-2.1 | ✅ | findExactMatches() |
| T-2.2 | ✅ | findFuzzyMatches() with FTS5 + LIKE fallback |
| T-2.3 | ✅ | Semantic search integration (graceful degradation) |
| T-2.4 | ✅ | Tag filtering |
| T-2.5 | ✅ | resolveEntity() orchestration |
| T-2.6 | ✅ | Database integration tests (16 tests) |
| T-3.1 | ✅ | createResolveCommand() |
| T-3.2 | ✅ | CLI options (tag, threshold, exact, batch, format) |
| T-3.3 | ✅ | --create-if-missing (prints suggestion) |
| T-3.4 | ✅ | --batch mode (stdin processing) |
| T-3.5 | ✅ | Output formatting (table, json, ids, jsonl, csv) |
| T-3.6 | ✅ | Register command in src/index.ts |
| T-3.7 | ✅ | CLI tests (10 tests) |
| T-4.1 | ✅ | resolveSchema Zod |
| T-4.2 | ✅ | MCP tool handler |
| T-4.3 | ✅ | Tool registry entry |
| T-4.4 | ✅ | Tool mode assignment (slim + lite) |
| T-4.5 | ✅ | Dispatcher integration |
| T-4.6 | ✅ | MCP tool tests (13 tests) |
| T-5.1 | ✅ | Name reversal (generateNameVariants) |
| T-5.2 | ✅ | Short query protection (validateShortQuery) |
| T-5.3 | ✅ | FTS5 escaping (escapeFTS5Query) |
| T-5.4 | ☐ | Documentation (deferred to release) |
| T-5.5 | ✅ | Edge case tests (30 tests) |

---

## Group 1: Core Service Layer (Pure Functions)

### T-1.1: Define data model and types [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution.test.ts`
- **Dependencies:** none
- **Markers:** [P]
- **Description:** Define TypeScript interfaces for entity resolution:
  - `MatchType`: `'exact' | 'fuzzy' | 'semantic'`
  - `MatchDetails`: levenshteinDistance, ftsRank, cosineSimilarity
  - `ResolvedCandidate`: id, name, tags, confidence, matchType, matchDetails
  - `ResolutionAction`: `'matched' | 'ambiguous' | 'no_match'`
  - `ResolutionResult`: query, normalizedQuery, candidates, bestMatch, action, embeddingsAvailable
  - `ResolveOptions`: tag, threshold, limit, exact, createIfMissing, workspace

### T-1.2: Implement normalizeQuery() [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution.test.ts`
- **Dependencies:** T-1.1
- **Markers:** [P with T-1.3, T-1.4]
- **Description:** Query normalization function:
  - Trim whitespace
  - Lowercase
  - Remove punctuation (preserve hyphens and apostrophes in names)
  - Handle Unicode characters (preserve accented letters)
  - Return both original and normalized string

### T-1.3: Implement calculateFuzzyConfidence() [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution.test.ts`
- **Dependencies:** T-1.1
- **Markers:** [P with T-1.2, T-1.4]
- **Description:** Levenshtein-based confidence scoring:
  - Import `distance` from `fastest-levenshtein`
  - Base score: `1.0 - (distance / max(queryLength, candidateLength))`
  - Boost +0.10 if `sameTag` option is true
  - Boost +0.05 if `isEntity` option is true
  - Cap at 0.95 (only exact match gets 1.0)
  - Return 0 for negative scores

### T-1.4: Implement mapSemanticToConfidence() [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution.test.ts`
- **Dependencies:** T-1.1
- **Markers:** [P with T-1.2, T-1.3]
- **Description:** Cosine similarity to confidence mapping:
  - Input: cosine similarity (0-1)
  - Output: confidence (0-0.95)
  - Values below 0.5 → 0 confidence
  - Linear scale: 0.5 cosine → 0, 1.0 cosine → 0.95
  - Formula: `Math.min(0.95, (cosineSimilarity - 0.5) * 1.9)`

### T-1.5: Implement mergeAndDeduplicate() [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution.test.ts`
- **Dependencies:** T-1.1
- **Description:** Combine results from multiple match strategies:
  - Input: arrays of ResolvedCandidate from exact, fuzzy, semantic
  - Deduplicate by node ID (keep highest confidence per ID)
  - Preserve the matchType of the highest-confidence match
  - Sort by confidence descending
  - Apply limit if specified

### T-1.6: Implement determineAction() [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution.test.ts`
- **Dependencies:** T-1.1, T-1.5
- **Description:** Determine resolution action:
  - Input: candidates array, threshold
  - Filter to candidates >= threshold
  - 0 above threshold → `'no_match'`
  - 1 above threshold → `'matched'`
  - Multiple: if top confidence - second >= 0.1 → `'matched'`
  - Otherwise → `'ambiguous'`

### T-1.7: Unit tests for core logic [T]
- **File:** `tests/entity-resolution.test.ts`
- **Test:** N/A (this IS the test file)
- **Dependencies:** T-1.1 through T-1.6
- **Description:** Comprehensive unit tests:
  - `normalizeQuery()`: whitespace, case, punctuation, Unicode
  - `calculateFuzzyConfidence()`: exact match (1.0), typos, boosts, capping
  - `mapSemanticToConfidence()`: boundary conditions (0, 0.5, 1.0)
  - `mergeAndDeduplicate()`: dedup, sorting, limit
  - `determineAction()`: all three action types, confidence gaps

---

## Group 2: Database Integration

### T-2.1: Implement findExactMatches() [T]
- **File:** `src/db/entity-match.ts`
- **Test:** `tests/entity-match.test.ts`
- **Dependencies:** T-1.1
- **Markers:** [P with T-2.2]
- **Description:** Case-insensitive exact name search:
  - Query `nodes` table with `LOWER(name) = LOWER(?)`
  - Join with `tag_applications` to get tags
  - Use `isEntityById()` from `src/db/entity.ts` for entity boost
  - Return ResolvedCandidate[] with confidence 1.0, matchType 'exact'
  - Apply tag filter if provided

### T-2.2: Implement findFuzzyMatches() [T]
- **File:** `src/db/entity-match.ts`
- **Test:** `tests/entity-match.test.ts`
- **Dependencies:** T-1.1, T-1.3
- **Markers:** [P with T-2.1]
- **Description:** FTS5 search + Levenshtein scoring:
  - Use FTS5 `MATCH` to get initial candidates (limit ~100)
  - Calculate Levenshtein distance for each candidate
  - Use `calculateFuzzyConfidence()` for scoring
  - Join with `tag_applications` for tags
  - Filter by tag if specified
  - Return ResolvedCandidate[] with matchType 'fuzzy'

### T-2.3: Implement semantic search integration [T]
- **File:** `src/db/entity-match.ts`
- **Test:** `tests/entity-match.test.ts`
- **Dependencies:** T-1.1, T-1.4
- **Description:** Vector similarity search:
  - Import `TanaEmbeddingService` from `src/embeddings/tana-embedding-service.ts`
  - Check if embeddings are available (graceful degradation)
  - Call `service.search(query, { limit })` to get semantic matches
  - Use `mapSemanticToConfidence()` for scoring
  - Return ResolvedCandidate[] with matchType 'semantic'
  - Return empty array + flag if embeddings unavailable

### T-2.4: Implement tag filtering [T]
- **File:** `src/db/entity-match.ts`
- **Test:** `tests/entity-match.test.ts`
- **Dependencies:** T-2.1, T-2.2
- **Description:** Filter candidates by supertag:
  - Query `tag_applications` table for matching tag
  - Support tag name (fuzzy match via `supertag_metadata` table)
  - Support tag ID (exact match)
  - Apply filter to all match strategies (exact, fuzzy, semantic)
  - Boost confidence +0.10 when tag matches filter

### T-2.5: Implement resolveEntity() orchestration [T]
- **File:** `src/db/entity-match.ts`
- **Test:** `tests/entity-match.test.ts`
- **Dependencies:** T-1.5, T-1.6, T-2.1, T-2.2, T-2.3, T-2.4
- **Description:** Main resolution orchestrator:
  - Accept ResolveOptions
  - Run exact match first (fast path: if confidence=1.0 and only one, done)
  - Run fuzzy match (unless `--exact` flag)
  - Run semantic match (unless `--exact` flag or embeddings unavailable)
  - Call `mergeAndDeduplicate()` to combine results
  - Call `determineAction()` to classify result
  - Return complete ResolutionResult

### T-2.6: Database integration tests [T]
- **File:** `tests/entity-match.test.ts`
- **Test:** N/A (this IS the test file)
- **Dependencies:** T-2.1 through T-2.5
- **Description:** Integration tests with in-memory SQLite:
  - Create test fixtures: nodes, tag_applications, supertag_metadata
  - Test exact match: finds exact name
  - Test fuzzy match: finds with typo
  - Test tag filter: only returns matching tag
  - Test semantic fallback: graceful degradation
  - Test deduplication: same node from multiple strategies

---

## Group 3: CLI Command

### T-3.1: Create command scaffold [T]
- **File:** `src/commands/resolve.ts`
- **Test:** `tests/commands/resolve.test.ts`
- **Dependencies:** T-2.5
- **Markers:** [P with T-3.2]
- **Description:** Commander.js command setup:
  - `createResolveCommand()` function following project pattern
  - `.argument('<name>', 'Name to resolve')`
  - Import helpers from `src/commands/helpers.ts`
  - Use `withDatabase()` pattern from existing commands
  - Use `resolveWorkspaceContext()` for workspace resolution

### T-3.2: Add CLI options [T]
- **File:** `src/commands/resolve.ts`
- **Test:** `tests/commands/resolve.test.ts`
- **Dependencies:** T-3.1
- **Markers:** [P with T-3.1]
- **Description:** Command options:
  - `--tag <supertag>`: Filter to specific supertag
  - `--threshold <float>`: Minimum confidence (default: 0.85)
  - `--limit <n>`: Max candidates (default: 5)
  - `--exact`: Exact match only, no fuzzy/semantic
  - `--format <type>`: Output format (table, json, ids, etc.)
  - `--workspace <alias>`: Workspace selection
  - Use `addStandardOptions()` for common options

### T-3.3: Implement --create-if-missing [T]
- **File:** `src/commands/resolve.ts`
- **Test:** `tests/commands/resolve.test.ts`
- **Dependencies:** T-3.1, T-2.5
- **Description:** Create node when no match found:
  - Only trigger when `action === 'no_match'`
  - Refuse to create if `action === 'ambiguous'` (print warning)
  - Require `--tag` when using `--create-if-missing`
  - Use Tana Input API to create node (via existing `create.ts` logic)
  - Return created node info in output

### T-3.4: Implement --batch mode [T]
- **File:** `src/commands/resolve.ts`
- **Test:** `tests/commands/resolve.test.ts`
- **Dependencies:** T-3.1, T-2.5
- **Description:** Process multiple names from stdin:
  - Read from stdin line by line
  - Process in chunks of 50 (configurable)
  - Stream output as each name resolves
  - Show progress bar or counter
  - Aggregate statistics at end

### T-3.5: Implement output formatting [T]
- **File:** `src/commands/resolve.ts`
- **Test:** `tests/commands/resolve.test.ts`
- **Dependencies:** T-3.1
- **Description:** Multiple output formats:
  - Table (default): human-readable with emoji indicators
  - JSON: full ResolutionResult object
  - IDs: just the best match ID (for piping)
  - Use `createFormatter()` from `src/utils/output-formatter.ts`
  - Include matchType indicator in table output

### T-3.6: Register command in main CLI [T]
- **File:** `src/index.ts`
- **Test:** N/A (verified by E2E tests)
- **Dependencies:** T-3.1
- **Description:** Wire command to main program:
  - Import `createResolveCommand` from `./commands/resolve`
  - Add to program: `program.addCommand(createResolveCommand())`
  - Position after `search` command in help output

### T-3.7: CLI E2E tests [T]
- **File:** `tests/commands/resolve.test.ts`
- **Test:** N/A (this IS the test file)
- **Dependencies:** T-3.1 through T-3.6
- **Description:** End-to-end CLI tests:
  - Basic resolution: `supertag resolve "Test Name"`
  - Tag filter: `supertag resolve "Test" --tag person`
  - Threshold: `supertag resolve "Test" --threshold 0.9`
  - Exact mode: `supertag resolve "Test" --exact`
  - JSON output: `supertag resolve "Test" --format json`
  - Error cases: empty query, no matches, ambiguous

---

## Group 4: MCP Tool

### T-4.1: Define resolveSchema [T]
- **File:** `src/mcp/schemas.ts`
- **Test:** `tests/mcp/resolve.test.ts`
- **Dependencies:** T-1.1
- **Markers:** [P with T-4.2]
- **Description:** Zod schema for MCP tool:
  ```typescript
  export const resolveSchema = z.object({
    name: z.string().min(1).describe('Name to resolve'),
    tag: z.string().optional().describe('Filter to specific supertag'),
    threshold: z.number().min(0).max(1).default(0.85),
    limit: z.number().min(1).max(20).default(5),
    exact: z.boolean().default(false),
    createIfMissing: z.boolean().default(false),
    workspace: workspaceSchema,
  });
  ```

### T-4.2: Implement MCP tool handler [T]
- **File:** `src/mcp/tools/resolve.ts`
- **Test:** `tests/mcp/resolve.test.ts`
- **Dependencies:** T-2.5, T-4.1
- **Markers:** [P with T-4.1]
- **Description:** MCP tool implementation:
  - Parse input with resolveSchema
  - Call `resolveEntity()` from `src/db/entity-match.ts`
  - Handle `createIfMissing` logic (same as CLI)
  - Format response with candidates and action
  - Use `handleMcpError()` for error handling

### T-4.3: Add tool to registry [T]
- **File:** `src/mcp/tool-registry.ts`
- **Test:** `tests/mcp/resolve.test.ts`
- **Dependencies:** T-4.1
- **Description:** Add metadata to TOOL_METADATA:
  ```typescript
  {
    name: 'tana_resolve',
    description: 'Find existing node by name with confidence scoring',
    category: 'query',
    example: 'Find #person named Daniel',
  }
  ```
  Add schema to TOOL_SCHEMAS: `tana_resolve: schemas.zodToJsonSchema(schemas.resolveSchema)`

### T-4.4: Assign tool mode [T]
- **File:** `src/mcp/tool-mode.ts`
- **Test:** `tests/mcp-lite-mode.test.ts`
- **Dependencies:** T-4.3
- **Description:** Add to appropriate mode sets:
  - Add to `SLIM_MODE_TOOLS` (useful for dedup before create)
  - Add to `LITE_MODE_TOOLS` (query capability)
  - Update lite mode tool count test assertions

### T-4.5: Add dispatcher case [T]
- **File:** `src/mcp/index.ts`
- **Test:** `tests/mcp/resolve.test.ts`
- **Dependencies:** T-4.2, T-4.3
- **Description:** Wire tool to dispatcher:
  - Import `resolve` from `./tools/resolve`
  - Add case in switch statement: `case 'tana_resolve': return resolve(args)`
  - Follow existing tool dispatch pattern

### T-4.6: MCP tool tests [T]
- **File:** `tests/mcp/resolve.test.ts`
- **Test:** N/A (this IS the test file)
- **Dependencies:** T-4.1 through T-4.5
- **Description:** MCP tool test suite:
  - Schema validation (valid and invalid inputs)
  - Successful resolution
  - Tag filtering
  - Threshold behavior
  - createIfMissing logic
  - Error handling

---

## Group 5: Edge Cases & Polish

### T-5.1: Implement name reversal [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution-edge.test.ts`
- **Dependencies:** T-1.2
- **Description:** Handle "Last, First" patterns:
  - Detect comma in query: "Miessler, Daniel"
  - Generate reversed form: "Daniel Miessler"
  - Try both forms in resolution
  - Deduplicate results (same node, keep higher confidence)
  - Store which form matched in matchDetails

### T-5.2: Implement short query protection [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution-edge.test.ts`
- **Dependencies:** T-1.2, T-2.5
- **Description:** Protect against too-short queries:
  - If query < 3 characters after normalization:
    - Require `--exact` OR `--tag` option
    - Return error/warning if neither provided
  - Document behavior in CLI help text
  - MCP tool should return helpful error message

### T-5.3: Implement FTS5 special character escaping [T]
- **File:** `src/lib/entity-resolution.ts`
- **Test:** `tests/entity-resolution-edge.test.ts`
- **Dependencies:** T-2.2
- **Description:** Escape special characters for FTS5:
  - Characters to escape: `"`, `*`, `^`, `(`, `)`, `:`
  - Double-quote wrapping for phrases
  - Handle OR/AND/NOT as literals (not operators)
  - Test with actual FTS5 query execution

### T-5.4: Update documentation
- **File:** `README.md`, `SKILL.md`
- **Test:** N/A
- **Dependencies:** T-3.6, T-4.5
- **Description:** Document new capability:
  - README.md: Add `supertag resolve` to CLI reference
  - README.md: Add usage examples with flags
  - SKILL.md: Add `tana_resolve` MCP tool description
  - SKILL.md: Add USE WHEN triggers for entity resolution

### T-5.5: Edge case tests [T]
- **File:** `tests/entity-resolution-edge.test.ts`
- **Test:** N/A (this IS the test file)
- **Dependencies:** T-5.1, T-5.2, T-5.3
- **Description:** Edge case test suite:
  - Name reversal: "Last, First" patterns
  - Short queries: error with helpful message
  - Special characters: FTS5 escaping
  - Unicode names: accented characters preserved
  - Empty/whitespace-only queries
  - Very long names (>100 chars)
  - Multiple exact matches (ambiguous)

---

## Execution Order

### Phase 1: Foundation (can run in parallel)
```
T-1.1 (types)
├── T-1.2, T-1.3, T-1.4 (pure functions - parallel)
├── T-1.5 (depends on types)
├── T-1.6 (depends on types)
└── T-1.7 (tests - after all above)
```

### Phase 2: Database (after T-1.x complete)
```
T-2.1, T-2.2 (parallel - both need T-1.x)
├── T-2.3 (can parallel with T-2.4)
├── T-2.4 (can parallel with T-2.3)
├── T-2.5 (orchestration - after T-2.1 through T-2.4)
└── T-2.6 (tests - after T-2.5)
```

### Phase 3: CLI (after T-2.5)
```
T-3.1, T-3.2 (parallel - basic command setup)
├── T-3.3, T-3.4, T-3.5 (features - after T-3.1)
├── T-3.6 (registration - after T-3.1)
└── T-3.7 (tests - after all above)
```

### Phase 4: MCP (parallel with Phase 3)
```
T-4.1, T-4.2 (parallel - schema and handler)
├── T-4.3, T-4.4 (registry - after T-4.1)
├── T-4.5 (dispatcher - after T-4.2)
└── T-4.6 (tests - after all above)
```

### Phase 5: Polish (after Phases 3 and 4)
```
T-5.1, T-5.2, T-5.3 (edge cases - parallel)
├── T-5.4 (docs - after T-3.6 and T-4.5)
└── T-5.5 (tests - after T-5.1 through T-5.3)
```

---

## File Manifest

### New Files
| Path | Purpose |
|------|---------|
| `src/lib/entity-resolution.ts` | Core types and pure functions |
| `src/db/entity-match.ts` | Database queries for matching |
| `src/commands/resolve.ts` | CLI command handler |
| `src/mcp/tools/resolve.ts` | MCP tool handler |
| `tests/entity-resolution.test.ts` | Unit tests for core logic |
| `tests/entity-match.test.ts` | Database integration tests |
| `tests/commands/resolve.test.ts` | CLI E2E tests |
| `tests/mcp/resolve.test.ts` | MCP tool tests |
| `tests/entity-resolution-edge.test.ts` | Edge case tests |

### Modified Files
| Path | Change |
|------|--------|
| `src/index.ts` | Register resolve command |
| `src/mcp/schemas.ts` | Add resolveSchema |
| `src/mcp/tool-registry.ts` | Add tana_resolve metadata |
| `src/mcp/tool-mode.ts` | Add to SLIM_MODE_TOOLS and LITE_MODE_TOOLS |
| `src/mcp/index.ts` | Add dispatcher case |
| `README.md` | Document CLI command |
| `SKILL.md` | Document MCP tool |
| `tests/mcp-lite-mode.test.ts` | Update tool count assertions |

---

## Risk Mitigation

| Risk | Mitigation | Task |
|------|------------|------|
| Levenshtein slow on large sets | Pre-filter with FTS5 to ~100 candidates | T-2.2 |
| Embeddings unavailable | Graceful degradation with flag | T-2.3 |
| Short queries too many matches | Require --exact or --tag for <3 chars | T-5.2 |
| FTS5 special character errors | Escape function before query | T-5.3 |
| Ambiguous with --create-if-missing | Refuse to create, require human decision | T-3.3 |

---

## Dependencies (External)

| Package | Version | Already Installed | Purpose |
|---------|---------|-------------------|---------|
| `fastest-levenshtein` | ^1.0.16 | ✅ Yes | Fuzzy string matching |
| `resona` | github:jcfischer/resona#main | ✅ Yes | Embeddings/vector search |
| `commander` | ^12.0.0 | ✅ Yes | CLI framework |
| `zod` | 3.25.76 | ✅ Yes | Schema validation |

**No new dependencies required.**
