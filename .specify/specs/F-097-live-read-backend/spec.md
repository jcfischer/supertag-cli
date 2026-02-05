# Specification: F-097 Live Read Backend

## Context
> Successor to F-094 (tana-local API Integration), which established the write path.
> F-094 explicitly listed "Read operation integration" as "Designed For But Not Implemented."

## Problem Statement

**Core Problem**: All read/search operations (CLI commands, MCP tools) are hardcoded to the SQLite index built from Tana JSON exports. When Tana Desktop is running with its Local API, supertag-cli should prefer live data for reads — giving users real-time results instead of stale indexed data.

**Current State**:
- `LocalApiClient` already has read methods: `readNode()`, `searchNodes()`, `getChildren()`, `listTags()`, `getTagSchema()`, `listWorkspaces()`
- These are only used by delta-sync (`DeltaSyncService`) and the separate `tana-local` MCP server
- The `TanaBackend` interface (F-094) is **write-only** — no read abstraction exists
- All CLI commands (`search`, `nodes show`, `tags list`) directly instantiate `TanaQueryEngine(dbPath)` or open `Database(dbPath)`
- All `supertag-mcp` tools query SQLite directly

**Impact if Unsolved**: Users must sync before every query to get fresh data. AI agents via MCP get stale results. Two separate MCP servers (`supertag-mcp` for reads, `tana-local` for writes) fragment the experience.

## Users & Stakeholders

**Primary User**: Users running supertag-cli on local dev machines where Tana Desktop is running
- Expects reads to reflect current Tana state without manual sync
- CLI and MCP tools should "just work" with live data when available

**Secondary**:
- AI agents via supertag-mcp (MCP server) — get fresh results
- Offline users — SQLite fallback must keep working identically

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Create `TanaReadBackend` interface with read operations (search, readNode, getChildren, listTags, getTagSchema) | Must |
| FR-2 | Implement `LocalApiReadBackend` using existing `LocalApiClient` read methods | Must |
| FR-3 | Implement `SqliteReadBackend` wrapping existing `TanaQueryEngine` and SQLite queries | Must |
| FR-4 | Create `resolveReadBackend()` that selects Local API when available, falls back to SQLite | Must |
| FR-5 | Normalize return types — both backends return the same shapes for the same operations | Must |
| FR-6 | `supertag search` uses read backend (Local API search → SQLite FTS fallback) | Must |
| FR-7 | `supertag nodes show` uses read backend (Local API readNode → SQLite fallback) | Must |
| FR-8 | `supertag tags list` uses read backend | Should |
| FR-9 | `supertag nodes recent` uses read backend (Local API edited.last → SQLite fallback) | Should |
| FR-10 | supertag-mcp tools (`tana_search`, `tana_node`) use read backend | Should |
| FR-11 | Semantic search (`--semantic`) stays on SQLite (embeddings are local-only) | Must |
| FR-12 | `--offline` flag forces SQLite path regardless of Local API availability | Should |
| FR-13 | Read backend resolver caches health check result for session (like write backend) | Must |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Zero behavior change when Local API is unavailable — SQLite path is identical to current |
| NFR-2 | Read backend resolution adds < 50ms latency (one health check, cached) |
| NFR-3 | No breaking changes to CLI output format — same columns, same --format options |
| NFR-4 | Existing 1741+ tests continue to pass without modification |

## Architecture

### Data Shape Challenge

The core challenge: Local API and SQLite return different shapes.

| Operation | Local API Returns | SQLite Returns |
|-----------|------------------|----------------|
| search | `SearchResultNode[]` (id, name, breadcrumb, tags, description, created) | Row objects (id, name, docType, ownerId, etc.) + ancestor resolution |
| readNode | `ReadNodeResponse` (markdown string) | Row + children rows + field tuples |
| getChildren | `GetChildrenResponse` (children[], total, hasMore) | Row arrays from direct query |
| listTags | `TagInfo[]` (id, name, color) | Rows from supertag_metadata table |

**Solution**: Define canonical `ReadResult` types in the interface. Both backends normalize to these types. Commands consume only canonical types.

### Interface Design

```typescript
// src/api/read-backend.ts

interface SearchResult {
  id: string;
  name: string;
  tags: string[];
  description?: string;
  created?: string;
  breadcrumb?: string[];
}

interface NodeContent {
  id: string;
  name: string;
  markdown: string;          // Both backends can produce markdown
  children?: NodeContent[];  // For depth > 0
  fields?: FieldValue[];     // Extracted fields
  tags?: string[];
}

interface TanaReadBackend {
  readonly type: 'local-api' | 'sqlite';

  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  readNode(nodeId: string, depth?: number): Promise<NodeContent>;
  getChildren(nodeId: string, options?: PaginationOptions): Promise<PaginatedResult<NodeContent>>;
  listTags(options?: PaginationOptions): Promise<TagInfo[]>;
  supportsLiveData(): boolean;
}
```

### Resolution Flow

```
resolveReadBackend(options?)
  ├─ cached? → return cache
  ├─ Local API configured + healthy? → LocalApiReadBackend (cached)
  ├─ --offline flag? → SqliteReadBackend
  └─ fallback → SqliteReadBackend(dbPath)
```

### Command Refactoring Pattern

Before (current):
```typescript
const db = openDatabase(ws.dbPath);
const results = engine.searchNodes(db, query, options);
```

After:
```typescript
const readBackend = await resolveReadBackend({ workspace: ws });
const results = await readBackend.search(query, options);
```

## Scope

### In Scope
- `TanaReadBackend` interface with canonical return types
- `LocalApiReadBackend` implementation
- `SqliteReadBackend` implementation wrapping existing query logic
- `resolveReadBackend()` with health check and caching
- Refactor `search`, `nodes show`, `nodes recent`, `tags list` commands
- Refactor key MCP tools (`tana_search`, `tana_node`)
- `--offline` flag to force SQLite

### Explicitly Out of Scope
- Semantic search via Local API (embeddings are local-only, stays on SQLite)
- `tana_aggregate`, `tana_timeline`, `tana_field_values` — complex analytics stay on SQLite for now
- Hybrid queries (mixing Local API and SQLite in one request)
- Write backend changes (F-094 already handled this)
- supertag-export (Playwright-based, unrelated)

### Designed For But Not Implemented
- Remote server API support (when Tana ships server API, same interface)
- Caching layer between Local API and consumer (for repeated reads)
- Priority routing (some operations better on SQLite, e.g., aggregation)

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Local API healthy at start, goes down mid-session | Cached as healthy; operations fail with retryable error. User runs `--offline` or waits. |
| No Local API configured at all | SqliteReadBackend used. No change from current. |
| Local API returns different results than SQLite | Expected — Local API has live data, SQLite is a snapshot. Not a bug. |
| `--format csv` with Local API backend | Same output format. Canonical types normalize shape before formatting. |
| Semantic search with Local API available | Stays on SQLite — embeddings don't exist in Local API |
| Large result sets from Local API | Respect existing --limit defaults. Local API supports limit/offset pagination. |

## Success Criteria

- [ ] `supertag search "meeting"` returns live results when Tana Desktop is running
- [ ] `supertag nodes show <id>` returns live node content from Tana
- [ ] `supertag search "meeting" --offline` uses SQLite even when Local API is available
- [ ] `supertag search "meeting" --semantic` always uses SQLite (embeddings)
- [ ] All 1741+ existing tests pass without modification
- [ ] Output format (table, json, csv) is identical regardless of backend
- [ ] supertag-mcp `tana_search` tool returns live results when available

## Dependencies

- F-094 (tana-local API Integration) — provides `LocalApiClient`, `TanaBackend`, `resolveBackend()`
- Existing `TanaQueryEngine` — provides SQLite query logic to wrap

---
*Spec created: 2026-02-05*
