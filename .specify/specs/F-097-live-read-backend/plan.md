---
feature: "F-097 Live Read Backend"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: F-097 Live Read Backend

## Architecture Overview

Route read/search operations through the Tana Local API when Tana Desktop is running, with automatic fallback to the existing SQLite index. A new `TanaReadBackend` interface (separate from the write-only `TanaBackend`) provides a normalized API that both CLI commands and MCP tools consume.

```
                    ┌─────────────────────┐
                    │   CLI Commands &     │
                    │   MCP Tools          │
                    │   (search, show,     │
                    │    tags, recent)     │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │ resolveReadBackend() │
                    │ (health check +     │
                    │  session cache)      │
                    └───┬─────────────┬───┘
                        │             │
           ┌────────────▼──┐   ┌──────▼──────────┐
           │ LocalApi      │   │ Sqlite           │
           │ ReadBackend   │   │ ReadBackend      │
           │               │   │                  │
           │ ┌───────────┐ │   │ ┌──────────────┐ │
           │ │LocalApi   │ │   │ │TanaQuery     │ │
           │ │Client     │ │   │ │Engine        │ │
           │ └───────────┘ │   │ └──────────────┘ │
           └───────────────┘   └──────────────────┘
                 │                      │
           localhost:8262         SQLite DB
           (Tana Desktop)     (indexed exports)
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Interface pattern | Strategy pattern | Same pattern as write TanaBackend (F-094) |
| Validation | Zod | Existing schemas for Local API types |
| Testing | bun:test | Existing test infrastructure |

## Constitutional Compliance

- [x] **CLI-First:** Read backend is consumed by CLI commands (search, nodes, tags)
- [x] **Library-First:** `TanaReadBackend` interface + implementations are reusable modules, decoupled from CLI/MCP
- [x] **Test-First:** Each backend testable in isolation; SqliteReadBackend wraps existing tested logic
- [x] **Deterministic:** Same query → same results (within backend). Backend selection is deterministic (health check → cache).
- [x] **Code Before Prompts:** All logic in code, no prompts involved

## Data Model

### Canonical Read Types

The core design decision: define normalized types that both backends produce, regardless of their native shapes.

```typescript
// src/api/read-backend.ts

/**
 * Canonical search result — normalized from both Local API SearchResultNode
 * and SQLite FTS query rows.
 */
export interface ReadSearchResult {
  id: string;
  name: string;
  tags: string[];          // Tag names (resolved from IDs in both backends)
  rank?: number;           // FTS rank (SQLite only, omitted for Local API)
  description?: string;    // Node description
  created?: string;        // ISO timestamp
  breadcrumb?: string[];   // Path breadcrumb (Local API only, omitted for SQLite)
}

/**
 * Canonical node content — normalized from Local API markdown response
 * and SQLite row + children queries.
 */
export interface ReadNodeContent {
  id: string;
  name: string;
  description?: string;
  markdown: string;        // Full content as markdown
  tags?: string[];
  children?: ReadNodeContent[];  // When depth > 0
}

/**
 * Canonical tag info — same shape from both backends.
 */
export interface ReadTagInfo {
  id: string;
  name: string;
  color?: string;
  instanceCount?: number;  // SQLite can count, Local API may not
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResult<T> {
  items: T[];
  total?: number;     // Not always available from Local API
  hasMore: boolean;
}
```

### No Database Schema Changes

This feature adds no tables or columns. It only adds an abstraction layer over existing read paths.

## API Contracts

### TanaReadBackend Interface

```typescript
// src/api/read-backend.ts

export type ReadBackendType = 'local-api' | 'sqlite';

export interface SearchOptions {
  limit?: number;
  offset?: number;
  createdAfter?: number;   // Epoch ms (SQLite) or ISO string normalized
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
}

export interface TanaReadBackend {
  readonly type: ReadBackendType;

  /**
   * Text search across node names.
   * Local API: structured search with textContains
   * SQLite: FTS5 query
   */
  search(query: string, options?: SearchOptions): Promise<ReadSearchResult[]>;

  /**
   * Read a single node's content.
   * Local API: GET /nodes/{id} → markdown
   * SQLite: row + children query → formatted markdown
   */
  readNode(nodeId: string, depth?: number): Promise<ReadNodeContent>;

  /**
   * Get paginated children of a node.
   * Local API: GET /nodes/{id}/children
   * SQLite: direct children query
   */
  getChildren(nodeId: string, options?: { limit?: number; offset?: number }): Promise<PaginatedResult<ReadNodeContent>>;

  /**
   * List available supertags.
   * Local API: GET /workspaces/{id}/tags
   * SQLite: supertag_metadata table
   */
  listTags(options?: { limit?: number }): Promise<ReadTagInfo[]>;

  /**
   * Whether this backend has live (real-time) data.
   * True for Local API, false for SQLite.
   */
  isLive(): boolean;

  /**
   * Clean up resources (close DB connections, etc.)
   */
  close(): void;
}
```

### resolveReadBackend()

```typescript
// src/api/read-backend-resolver.ts

export interface ReadBackendOptions {
  workspace?: string;         // Workspace alias
  offline?: boolean;          // Force SQLite (--offline flag)
  forceRefresh?: boolean;     // Bypass cache
}

/**
 * Resolve which read backend to use.
 *
 * Resolution order:
 * 1. --offline flag → SqliteReadBackend
 * 2. Cached backend (unless forceRefresh)
 * 3. Local API configured + healthy → LocalApiReadBackend
 * 4. Fallback → SqliteReadBackend
 *
 * Never throws — always falls back to SQLite.
 */
export async function resolveReadBackend(
  options?: ReadBackendOptions
): Promise<TanaReadBackend>;

export function clearReadBackendCache(): void;
```

**Key difference from write resolver**: The read resolver **never throws**. If Local API is unavailable, it silently falls back to SQLite. Reads should always work.

## Implementation Strategy

### Phase 1: Interface + Canonical Types

Foundation: define the interface and types that everything else builds on.

- [ ] `src/api/read-backend.ts` — `TanaReadBackend` interface + canonical types (`ReadSearchResult`, `ReadNodeContent`, `ReadTagInfo`, `PaginatedResult`)
- [ ] Types exported from package for testing

### Phase 2: LocalApiReadBackend

Wrap existing `LocalApiClient` read methods, normalizing responses to canonical types.

- [ ] `src/api/local-api-read-backend.ts`
  - `search()` → `localApiClient.searchNodes({ textContains: query })` → normalize `SearchResultNode[]` to `ReadSearchResult[]`
  - `readNode()` → `localApiClient.readNode(id, depth)` → normalize `ReadNodeResponse` to `ReadNodeContent`
  - `getChildren()` → `localApiClient.getChildren(id, opts)` → normalize `GetChildrenResponse` to `PaginatedResult`
  - `listTags()` → `localApiClient.listTags(workspaceId)` → normalize `TagInfo[]` to `ReadTagInfo[]`
  - `isLive()` → `true`
  - `close()` → no-op (no persistent resources)

**Normalization details:**
- `SearchResultNode.tags` (array of `{id, name}`) → extract names → `ReadSearchResult.tags`
- `SearchResultNode.breadcrumb` → `ReadSearchResult.breadcrumb`
- FTS `rank` unavailable from Local API → omit from `ReadSearchResult`
- `ReadNodeResponse.markdown` → `ReadNodeContent.markdown` (direct pass-through)

### Phase 3: SqliteReadBackend

Wrap existing `TanaQueryEngine` methods, normalizing to canonical types.

- [ ] `src/api/sqlite-read-backend.ts`
  - `search()` → `engine.searchNodes(query, opts)` + `engine.getNodeTags(id)` → `ReadSearchResult[]`
  - `readNode()` → `getNodeContents(db, id)` / `getNodeContentsWithDepth()` → format to `ReadNodeContent`
  - `getChildren()` → direct SQLite query on parent_id → `PaginatedResult`
  - `listTags()` → query `supertag_metadata` table → `ReadTagInfo[]`
  - `isLive()` → `false`
  - `close()` → close SQLite database

**Key**: This backend reproduces the exact current behavior. It's a thin wrapper, not a rewrite.

### Phase 4: Read Backend Resolver

- [ ] `src/api/read-backend-resolver.ts`
  - Reuse `ConfigManager.getLocalApiConfig()` to check if Local API is configured
  - Reuse `LocalApiClient.health()` for health check
  - Session cache (like write resolver)
  - `--offline` override
  - **Silent fallback**: never throws, always returns a backend

### Phase 5: Command Refactoring

Refactor CLI commands to use read backend. Minimal changes — swap data source, keep all formatting/output logic.

**`search` command** (`src/commands/search.ts`):
- FTS path: Replace `withQueryEngine` + `engine.searchNodes()` with `readBackend.search()`
- Semantic path: **No change** — stays on SQLite (embeddings are local-only)
- Tagged path: **Phase 2** — Local API `hasType` query can replace SQLite tag lookup
- Ancestor resolution: When using Local API, breadcrumb replaces ancestor lookup. When SQLite, existing logic preserved.
- `--offline` flag: Force SQLite path

**`nodes show` command** (`src/commands/nodes.ts`):
- Replace `getNodeContents(db, id)` with `readBackend.readNode(id, depth)`
- Markdown output already exists for both backends

**`tags list` command** (`src/commands/tags.ts`):
- Replace direct SQLite query with `readBackend.listTags()`

**`nodes recent` command**:
- Replace SQLite `recentlyUpdated()` with Local API `edited.last` search
- Fallback: existing SQLite query

### Phase 6: MCP Tool Refactoring

- [ ] `src/mcp/tools/search.ts` — Use read backend instead of direct `TanaQueryEngine`
- [ ] `src/mcp/tools/node.ts` — Use read backend for node reads
- [ ] Other MCP tools stay on SQLite (aggregate, timeline, field-values — complex analytics)

## File Structure

```
src/
├── api/
│   ├── backend.ts                    # [Existing] Write backend interface
│   ├── backend-resolver.ts           # [Existing] Write backend resolver
│   ├── read-backend.ts               # [New] Read backend interface + canonical types
│   ├── read-backend-resolver.ts      # [New] Read backend resolver
│   ├── local-api-read-backend.ts     # [New] Local API read implementation
│   ├── sqlite-read-backend.ts        # [New] SQLite read implementation
│   ├── local-api-client.ts           # [Existing] Already has read methods
│   ├── local-api-backend.ts          # [Existing] Write-only, unchanged
│   └── input-api-backend.ts          # [Existing] Unchanged
├── commands/
│   ├── search.ts                     # [Modified] Use read backend for FTS
│   ├── nodes.ts                      # [Modified] Use read backend for show
│   └── tags.ts                       # [Modified] Use read backend for list
├── mcp/tools/
│   ├── search.ts                     # [Modified] Use read backend
│   └── node.ts                       # [Modified] Use read backend
└── utils/
    └── output-options.ts             # [Modified] Add --offline option

tests/
├── read-backend.test.ts              # [New] Interface contract tests
├── local-api-read-backend.test.ts    # [New] Mock-based unit tests
├── sqlite-read-backend.test.ts       # [New] Uses test fixtures
└── read-backend-resolver.test.ts     # [New] Resolution logic tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Local API returns different data than SQLite | Medium | High | Expected — document. Canonical types normalize what can be normalized. |
| Health check adds latency | Low | Medium | Session cache — one check per run, < 50ms |
| Breaking output format in table/csv modes | High | Low | Canonical types feed into existing formatters unchanged |
| Ancestor resolution differs between backends | Medium | Medium | Local API has breadcrumb (richer). SQLite has ancestor resolution. Both produce context. |
| Semantic search broken by refactor | High | Low | Semantic search explicitly stays on SQLite — no code change in that path |

## Failure Mode Analysis

### How This Code Can Fail

| Failure Mode | Trigger | Detection | Degradation | Recovery |
|-------------|---------|-----------|-------------|----------|
| Local API down at startup | Tana Desktop closed | Health check returns false | SqliteReadBackend used (silent) | Start Tana Desktop |
| Local API goes down mid-session | Tana Desktop crash | Request timeout/error | Cached as healthy; operations fail | Use `--offline` flag |
| Local API returns unexpected schema | Tana API update | Zod validation error | Fallback to SQLite on error | Update Zod schemas |
| SQLite database missing | Never synced | File check in resolver | Error: "Run supertag sync first" | Run sync |

### Assumptions That Could Break

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Local API search `textContains` is sufficient for FTS replacement | If users need FTS-specific syntax (phrase matching, prefix) | User bug reports; add FTS-specific flag to force SQLite |
| Health check is fast (< 50ms) | Network issues on localhost | Performance monitoring in tests |
| Local API tag names match SQLite tag names | Tana changes tag name format | Integration tests comparing both backends |
| `ReadNodeResponse.markdown` format is stable | Tana changes markdown generation | Zod schema validation catches structural changes |

### Blast Radius

- **Files touched:** ~10 files (4 new, 6 modified)
- **Systems affected:** CLI search, CLI nodes show, CLI tags list, MCP tana_search, MCP tana_node
- **Rollback strategy:** `--offline` flag forces old behavior. Removing new files + reverting command changes restores original.

## Dependencies

### External

- None (all dependencies already in project)

### Internal

- `src/api/local-api-client.ts` — Already has `readNode()`, `searchNodes()`, `getChildren()`, `listTags()`
- `src/query/tana-query-engine.ts` — Existing SQLite query engine
- `src/config/manager.ts` — `getLocalApiConfig()` for backend configuration
- `src/commands/show.ts` — `getNodeContents()`, `formatNodeOutput()` for SQLite read path
- `src/embeddings/ancestor-resolution.ts` — `findMeaningfulAncestor()` for SQLite ancestor context

## Migration/Deployment

- [ ] Database migrations needed? **No** — no schema changes
- [ ] Environment variables? **No** — uses existing `localApi` config
- [ ] Breaking changes? **No** — `--offline` preserves old behavior; default behavior improves
- [ ] Binary rebuild needed? **Yes** — `./scripts/build.sh` after implementation

## Estimated Complexity

- **New files:** ~4 (`read-backend.ts`, `read-backend-resolver.ts`, `local-api-read-backend.ts`, `sqlite-read-backend.ts`)
- **Modified files:** ~6 (`search.ts` command, `nodes.ts` command, `tags.ts` command, `search.ts` MCP, `node.ts` MCP, `output-options.ts`)
- **Test files:** ~4
- **Estimated tasks:** ~12-15
- **Debt score:** 2 (well-defined interface, wraps existing code)

## Longevity Assessment

### Maintainability Indicators

| Indicator | Status | Notes |
|-----------|--------|-------|
| **Readability:** Can a developer understand this in 6 months? | Yes | Strategy pattern, same as write backend |
| **Testability:** Can changes be verified without manual testing? | Yes | Each backend testable in isolation with mocks/fixtures |
| **Documentation:** Is the "why" captured, not just the "what"? | Yes | Spec documents the live-vs-indexed tradeoff |

### Evolution Vectors

| What Might Change | Preparation | Impact |
|------------------|-------------|--------|
| Tana ships Server API (remote) | Interface is backend-agnostic; add `RemoteApiReadBackend` | Low |
| More operations need live reads (aggregate, timeline) | Interface is extensible; add methods | Low |
| Tana Local API changes endpoints | Zod schemas catch; update `LocalApiClient` | Low |
| SQLite index deprecated in favor of live API | Remove `SqliteReadBackend`; keep interface | Low |

### Deletion Criteria

When should this code be deleted?

- [ ] Feature superseded by: Tana ships its own CLI/MCP with full read support
- [ ] Dependency deprecated: Tana Local API discontinued
- [ ] User need eliminated: All users have always-on Tana Desktop (SQLite fallback unnecessary)
- [ ] Maintenance cost exceeds value when: Tana API changes faster than we can update schemas
