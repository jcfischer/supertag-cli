# Implementation Tasks: F-104 Graph-Aware Embeddings

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Enrichment types |
| T-1.2 | ☐ | Enrichment config loader |
| T-2.1 | ☐ | Graph enricher core |
| T-2.2 | ☐ | Batch enrichment |
| T-3.1 | ☐ | Token truncation |
| T-4.1 | ☐ | CLI flags for embed generate |
| T-4.2 | ☐ | Pipeline integration |
| T-4.3 | ☐ | Enrichment preview command |
| T-5.1 | ☐ | CLI --type-hint search |
| T-5.2 | ☐ | MCP semantic search typeHint |
| T-6.1 | ☐ | Integration tests |
| T-6.2 | ☐ | Documentation updates |

## Group 1: Configuration Layer

### T-1.1: Define enrichment type interfaces [T]
- **File:** src/types/enrichment.ts
- **Test:** tests/embeddings/enrichment-config.test.ts
- **Dependencies:** none
- **Description:** Define `GraphAwareEnrichmentConfig`, `SupertagEnrichmentConfig`, `FieldType`, `EnrichedContextualizedNode`, and `ENRICHMENT_VERSION` constant. `EnrichedContextualizedNode` extends `ContextualizedNode` from `src/embeddings/contextualize.ts` with `enriched`, `enrichmentVersion`, `enrichedTextRaw`, `enrichmentTags`, and `enrichmentFields` properties. Export `DEFAULT_ENRICHMENT_CONFIG` with sensible defaults (includeTagName: true, includeFields: ["options", "date", "instance"], maxFieldsPerTag: 5).

### T-1.2: Implement enrichment config loader [T]
- **File:** src/embeddings/enrichment-config.ts
- **Test:** tests/embeddings/enrichment-config.test.ts
- **Dependencies:** T-1.1
- **Description:** Implement `loadEnrichmentConfig()` that reads `~/.config/supertag/embed-enrichment.json`, validates JSON structure, and returns `GraphAwareEnrichmentConfig`. Falls back to `DEFAULT_ENRICHMENT_CONFIG` when file is missing or invalid (log warning on parse error). Implement `getConfigForTag(config, tagName)` that merges defaults with per-supertag overrides. Tags with `disabled: true` return null to signal skip enrichment.

## Group 2: Graph Enrichment Core

### T-2.1: Implement single-node graph enricher [T]
- **File:** src/embeddings/graph-enricher.ts
- **Test:** tests/embeddings/graph-enricher.test.ts
- **Dependencies:** T-1.1, T-1.2
- **Description:** Implement `enrichNodeWithGraphContext(db, nodeId, nodeName, config)` that: (1) queries `tag_applications` for node's supertags, (2) queries `field_values` for field data matching config's includeFields, (3) formats as `[Type: #tag] [Field: value] node_name`, (4) returns `EnrichedContextualizedNode`. Handle edge cases: no supertag → plain text only (enriched: false); multiple supertags → include all type names; long field values → truncate to 50 chars each.

### T-2.2: Implement batch graph enrichment [T] [P with T-3.1]
- **File:** src/embeddings/graph-enricher.ts
- **Test:** tests/embeddings/graph-enricher.test.ts
- **Dependencies:** T-2.1
- **Description:** Implement `batchEnrichNodesWithGraphContext(db, nodes, config)` that batch-queries tags and fields for efficiency. Process nodes in chunks of 900 (SQLite variable limit). Cache tag configs per tag name to avoid repeated config resolution. Return array of `EnrichedContextualizedNode` preserving input order. Nodes without tags get `enriched: false` with plain `contextText`.

## Group 3: Token Truncation

### T-3.1: Implement enrichment truncator [T] [P with T-2.2]
- **File:** src/embeddings/enrichment-truncator.ts
- **Test:** tests/embeddings/enrichment-truncator.test.ts
- **Dependencies:** T-1.1
- **Description:** Implement `estimateTokenCount(text)` using character heuristic (4 chars ≈ 1 token, conservative). Implement `truncateEnrichedText(text, maxTokens = 512)` with priority-based truncation: preserve type name always → options fields → date fields → instance fields → node name → plain text fields. When over limit, truncate lowest-priority segments first. Return truncated text. No external dependency (tiktoken deferred per plan recommendation).

## Group 4: Pipeline Integration

### T-4.1: Add CLI flags for embed generate [T]
- **File:** src/commands/embed.ts
- **Test:** tests/embeddings/graph-enrichment-integration.test.ts
- **Dependencies:** T-2.2, T-3.1
- **Description:** Add `--graph-aware` boolean flag (default: true) and `--no-graph-aware` to disable. Add `--enrichment-preview <node-id>` option. Wire flags through to `processWorkspaceEmbeddings()` options. Update stats display to show "Graph-aware: enabled/disabled" line.

### T-4.2: Integrate enrichment into embedding pipeline [T]
- **File:** src/commands/embed.ts
- **Test:** tests/embeddings/graph-enrichment-integration.test.ts
- **Dependencies:** T-4.1
- **Description:** Modify `processWorkspaceEmbeddings()`: when `graphAware` is true, load enrichment config via `loadEnrichmentConfig()`, call `batchEnrichNodesWithGraphContext()` on filtered nodes, pipe enriched `contextText` through `truncateEnrichedText()`, then pass to existing `TanaEmbeddingService`. Add `enriched: true` and `enrichmentVersion` to resona's `ItemToEmbed.metadata`. When `graphAware` is false, use existing `batchContextualizeNodes()` unchanged.

### T-4.3: Implement enrichment preview [T]
- **File:** src/commands/embed.ts
- **Test:** tests/embeddings/graph-enrichment-integration.test.ts
- **Dependencies:** T-4.2
- **Description:** When `--enrichment-preview <node-id>` is provided, load config, enrich the single node, display: original name, supertags found, fields included, enriched text (before truncation), enriched text (after truncation), estimated token count. Exit without generating embeddings.

## Group 5: Search Enhancement

### T-5.1: Add --type-hint to CLI search [T] [P with T-5.2]
- **File:** src/commands/search.ts
- **Test:** tests/embeddings/graph-enrichment-integration.test.ts
- **Dependencies:** T-4.2
- **Description:** Add `--type-hint <tag>` option to `search` command. When provided with `--semantic`, prepend `[Type: #tag]` to the search query text before passing to embedding search. Validate that tag name is non-empty. Works with existing `--semantic` flag only — ignored for FTS search.

### T-5.2: Add typeHint to MCP semantic search [T] [P with T-5.1]
- **File:** src/mcp/tools/semantic-search.ts, src/mcp/schemas.ts
- **Test:** tests/embeddings/graph-enrichment-integration.test.ts
- **Dependencies:** T-4.2
- **Description:** Add optional `typeHint` string parameter to semantic search MCP schema in `schemas.ts`. In `semantic-search.ts`, when `typeHint` is provided, prepend `[Type: #typeHint]` to search query before embedding. Document parameter in schema description.

## Group 6: Documentation & Final Testing

### T-6.1: Write integration tests [T]
- **File:** tests/embeddings/graph-enrichment-integration.test.ts
- **Test:** (self)
- **Dependencies:** T-4.2, T-5.1, T-5.2
- **Description:** End-to-end tests covering: (1) full pipeline with real database — create nodes with tags, generate enriched embeddings, verify metadata; (2) backward compatibility — unenriched embeddings still searchable; (3) mixed mode — some enriched, some not, both return results; (4) performance benchmark — enrichment adds < 5% overhead on 1000 nodes (skip in fast test suite). Use test database fixtures from existing `tests/fixtures/`.

### T-6.2: Update documentation
- **File:** CLAUDE.md, CHANGELOG.md
- **Dependencies:** T-6.1
- **Description:** Add "Graph-Aware Embeddings (F-104)" section to CLAUDE.md covering: enrichment config file location, CLI flags, search type-hint usage, LanceDB metadata fields. Add feature entry to CHANGELOG.md under [Unreleased]. No code tests needed.

## Execution Order

1. **T-1.1** (foundation — no dependencies)
2. **T-1.2** (depends on T-1.1)
3. **T-2.1** (depends on T-1.1, T-1.2)
4. **T-2.2, T-3.1** (can run in parallel — T-2.2 depends on T-2.1, T-3.1 depends only on T-1.1)
5. **T-4.1** (depends on T-2.2, T-3.1)
6. **T-4.2** (depends on T-4.1)
7. **T-4.3** (depends on T-4.2)
8. **T-5.1, T-5.2** (can run in parallel — both depend on T-4.2)
9. **T-6.1** (depends on T-4.2, T-5.1, T-5.2)
10. **T-6.2** (depends on T-6.1)
