---
id: "004"
feature: "resona-migration"
status: "completed"
created: "2025-12-18"
completed: "2025-12-20"
---

# Specification: Migrate Embeddings from SQLite-vec to Resona

## Overview

Replace the current custom SQLite + sqlite-vec vector storage implementation with the resona library. Resona provides a cleaner abstraction over LanceDB for embedding storage and search, eliminating the need for platform-specific sqlite-vec extension handling and simplifying the codebase significantly.

**Why this matters:**
- Removes sqlite-vec extension complexity (platform-specific binaries, custom SQLite loading, extension path resolution)
- Unifies embedding infrastructure with other PAI skills (email already uses resona)
- Enables potential future cross-source semantic search via resona's UnifiedSearchService
- Reduces maintenance burden by delegating vector storage to a well-tested library

## User Scenarios

### Scenario 1: Generate Embeddings

**As a** supertag user
**I want to** generate embeddings for my Tana workspace nodes
**So that** I can perform semantic search to find conceptually related content

**Acceptance Criteria:**
- [ ] `supertag embed generate` creates embeddings using resona/LanceDB instead of sqlite-vec
- [ ] Progress reporting works the same (nodes/sec, processed/skipped/errors)
- [ ] Content filtering still applies (minLength, excludeTimestamps, excludeSystemTypes)
- [ ] Entity nodes bypass minLength filter (short-named entities still get embedded)
- [ ] Embedding model selection still works (ollama, transformers.js)
- [ ] Contextualized embeddings are preserved (ancestor context prepended to text)

### Scenario 2: Semantic Search via CLI

**As a** supertag user
**I want to** search my Tana content semantically via CLI
**So that** I can find conceptually related nodes without exact keyword matches

**Acceptance Criteria:**
- [ ] `supertag semantic <query>` returns similar results as before
- [ ] Results include similarity scores
- [ ] Ancestor resolution still works (finding nearest tagged ancestor)
- [ ] Entity detection still works (isEntity flag on results)
- [ ] Trash filtering still works (deleted nodes excluded)
- [ ] Reference syntax filtering still works ([[...]] nodes excluded)
- [ ] Deduplication still works (same name+tags collapsed)

### Scenario 3: Semantic Search via MCP

**As an** AI assistant using the MCP server
**I want to** perform semantic search on Tana content
**So that** I can find relevant context for user queries

**Acceptance Criteria:**
- [ ] `tana_semantic_search` MCP tool works with resona backend
- [ ] All existing parameters function correctly (query, limit, minSimilarity, includeContents, includeAncestor, depth, raw)
- [ ] Response format unchanged (nodeId, name, similarity, distance, tags, ancestor, etc.)
- [ ] No extension loading errors or platform-specific issues

### Scenario 4: Embedding Statistics

**As a** supertag user
**I want to** view statistics about my embeddings
**So that** I can monitor embedding coverage and health

**Acceptance Criteria:**
- [ ] `supertag embed stats` shows total embeddings, model, dimensions
- [ ] Oldest/newest embedding timestamps preserved
- [ ] Stats retrieved from LanceDB instead of sqlite-vec

### Scenario 5: Configuration Management

**As a** supertag user
**I want to** configure embedding providers and models
**So that** I can choose between local (ollama) and other providers

**Acceptance Criteria:**
- [ ] `supertag embed config` still works for provider/model selection
- [ ] Configuration persists correctly
- [ ] Model dimensions auto-detected from provider

## Functional Requirements

### FR-1: Replace sqlite-vec with LanceDB via Resona

The embedding storage layer must use resona's EmbeddingService backed by LanceDB instead of the current custom SQLite + sqlite-vec implementation.

**Validation:** Embeddings stored in `.lance` directory format instead of SQLite tables

### FR-2: Preserve Embedding Provider Support

Continue supporting Ollama provider for local embedding generation. TransformersProvider support optional but desired.

**Validation:** `supertag embed config --provider ollama --model mxbai-embed-large` configures provider correctly

### FR-3: Maintain Contextual Embedding Generation

The contextual embedding logic (prepending ancestor path to node text) must be preserved for better semantic retrieval.

**Validation:** Embedded text includes ancestor context when contextualization is enabled

### FR-4: Preserve Change Detection

Hash-based change detection must continue working to skip unchanged nodes during re-embedding.

**Validation:** Running `supertag embed generate` twice shows high skip rate on second run

### FR-5: Keep Tana-Specific Search Enrichment

Post-search enrichment (ancestor resolution, entity detection, trash filtering) uses the Tana SQLite database, not embeddings. This must continue working.

**Validation:** Search results include correct ancestor info, entity flags, and exclude trashed nodes

### FR-6: Migrate Embedding Storage Location

Embeddings should be stored at workspace-specific path using LanceDB format.

**Validation:** Embeddings stored at `~/.local/share/supertag/workspaces/{alias}/embeddings.lance/`

### FR-7: Remove sqlite-vec Dependencies

All sqlite-vec related code, extension files, and custom SQLite loading logic should be removed.

**Validation:** No references to sqlite-vec, vec0.dylib, or custom SQLite loading remain

## Non-Functional Requirements

- **Performance:** Embedding generation speed should not regress significantly (within 10% of current)
- **Storage:** LanceDB storage should be comparable or smaller than sqlite-vec
- **Compatibility:** Works on macOS (ARM and Intel) and Linux without additional setup
- **Dependencies:** Replaces sqlite-vec dependency with @lancedb/lancedb (already bundled in resona)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| EmbeddingService | Resona service for embedding operations | provider, dbPath |
| OllamaProvider | Embedding provider using local Ollama | model, endpoint, dimensions |
| SearchResult | Result from semantic search | id, similarity, distance, contextText, metadata |
| NodeToEmbed | Item prepared for embedding | id, text, contextText (with ancestor), metadata |

## Success Criteria

- [ ] All existing embedding tests pass with resona backend
- [ ] MCP semantic search tool returns equivalent results
- [ ] No platform-specific extension loading errors
- [ ] sqlite-vec code and dependencies removed
- [ ] Email and Tana skills can potentially share unified search in future

## Assumptions

- Resona library is published on npm as `resona@0.1.0`
- LanceDB handles concurrent access appropriately
- Embedding dimensions compatibility (mxbai-embed-large = 1024d) maintained
- Tana SQLite database (nodes, tags) remains unchanged (only embedding storage migrates)

## [NEEDS CLARIFICATION]

- Should existing sqlite-vec embeddings be migrated, or should users regenerate? (Recommend: regenerate - cleaner approach)
    -> regenerrate
- Should we preserve the separate embedding_config table, or use resona's internal config storage?
    -> use resona, ideally the subertag code doens't know about embedding providers
## Out of Scope

- Changing the Tana node/tag SQLite database structure
- Adding new embedding providers beyond what resona supports
- Cross-source unified search (deferred to future enhancement)
- Backward compatibility layer for sqlite-vec (clean break preferred)
- Changes to content filtering logic (minLength, system types, etc.)
