# Specification: Delta-Sync via Local API with Semantic Search Consolidation

**Feature ID:** F-095
**Status:** SPECIFIED
**Priority:** High
**Depends on:** F-094 (Tana Local API Integration — complete)

---

## Overview

After a full Tana JSON export and database reindex, the SQLite database immediately starts going stale. New nodes created in Tana, tag changes, and edits are invisible to semantic search until the next manual export cycle. This export requires launching a browser via Playwright, navigating Tana's export UI, downloading a multi-hundred-MB JSON file, and running a full reindex. The gap between "node created in Tana" and "node findable via semantic search" can be **hours**.

F-094 added the tana-local REST API client which can query `{edited: {since: milliseconds}}` to discover recently changed nodes in real-time. This provides enough data (id, name, description, tags, docType, created) to update the database and generate embeddings without a full export.

Additionally, the Local API's native MCP endpoint now provides live read operations (`search_nodes`, `read_node`, `get_children`, `list_tags`) that overlap with supertag-cli's read-only MCP tools. Maintaining both creates confusion about which tool to use and doubles the tool surface for AI agents.

**Target state:** Full export runs periodically (every 6 hours). Delta-sync runs automatically every ~5 minutes when Tana Desktop is running. Semantic search always finds recent nodes. MCP tool surface is optionally trimmed to avoid duplication with tana-local.

---

## User Scenarios

### Scenario 1: Recent Node Appears in Semantic Search

- **Given** a user has created a node "Project kickoff meeting with marketing" in Tana Desktop 3 minutes ago
- **And** the MCP server is running with background delta-sync enabled
- **When** the user runs `supertag search --semantic "marketing kickoff"`
- **Then** the recently created node appears in the search results
- **And** the search result includes the node's name, tags, and breadcrumb

### Scenario 2: Manual Delta-Sync via CLI

- **Given** a user has been creating and editing nodes in Tana for the past hour
- **And** the Local API is running on localhost:8262
- **When** the user runs `supertag sync --delta`
- **Then** all nodes created or modified since the last sync are added/updated in the database
- **And** embeddings are generated for all changed nodes
- **And** a summary is printed showing nodes added, updated, and embeddings generated

### Scenario 3: Delta-Sync via MCP Tool

- **Given** an AI agent is connected via the MCP server
- **And** the user asks the agent to "sync my recent Tana changes"
- **When** the agent calls `tana_sync` with `mode: "delta"`
- **Then** the delta-sync runs and returns a status summary
- **And** subsequent `tana_semantic_search` calls include the newly synced nodes

### Scenario 4: Background Polling While MCP Active

- **Given** the MCP server is running with `localApi.deltaSyncInterval` set to 5 (minutes)
- **And** Tana Desktop is running with the Local API enabled
- **When** 5 minutes elapse since the last delta-sync
- **Then** the MCP server automatically triggers a delta-sync cycle
- **And** logs the number of changed nodes found and embeddings generated

### Scenario 5: Graceful Handling When Tana Desktop Is Offline

- **Given** the MCP server is running with background polling enabled
- **And** Tana Desktop is not running (Local API unreachable)
- **When** the background poll timer fires
- **Then** the poll detects the unhealthy API and pauses polling
- **And** logs a warning that delta-sync is paused
- **And** resumes polling automatically when the API becomes reachable

### Scenario 6: Slim MCP Mode Reduces Tool Surface

- **Given** the user has configured `mcp.toolMode` to `"slim"`
- **And** tana-local's native MCP server is also configured
- **When** the MCP server starts
- **Then** only semantic search, mutation tools, sync, and system tools are registered
- **And** read-only query tools (FTS search, tag listing, field queries) are not registered
- **And** total tool count drops from ~32 to ~15

### Scenario 7: First Delta-Sync After Fresh Full Export

- **Given** a user has just completed a full sync via `supertag sync index`
- **And** no delta-sync watermark exists yet
- **When** the user runs `supertag sync --delta` for the first time
- **Then** the delta-sync uses the last full sync timestamp as its starting watermark
- **And** only nodes modified after the full sync are fetched

### Scenario 8: Embedding Model Not Configured

- **Given** the user has not configured any embedding model (no Ollama, no Transformers.js)
- **When** delta-sync runs and finds changed nodes
- **Then** the database is updated with the new/changed node data
- **And** embedding generation is skipped with a warning logged
- **And** the sync is still considered successful

---

## Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Delta-sync service queries Local API for nodes edited since the last sync watermark using `searchNodes({edited: {since: <watermark_ms>}})` | High |
| FR-2 | Delta-sync pages through all results with no cap (API returns up to 100 per page with limit/offset) | High |
| FR-3 | Changed nodes are merged into the `nodes` table: name, node_type (docType), created, updated (set to current time) | High |
| FR-4 | Tag applications are reconciled: tags from API replace existing tag_applications for each changed node | High |
| FR-5 | Export-only DB columns are preserved during merge: raw_data, done_at, field_values, references, _flags | High |
| FR-6 | New nodes (not yet in DB) are inserted with all available fields from the API response | High |
| FR-7 | After DB merge, embeddings are generated/updated for all changed nodes using the configured embedding model | High |
| FR-8 | Delta-sync watermark is stored in `sync_metadata` table as `delta_sync_timestamp` (ms epoch), updated after each successful sync | High |
| FR-9 | Nodes returned with `inTrash: true` are marked in DB but not deleted (preserves history for full sync reconciliation) | Medium |
| FR-10 | CLI command `supertag sync --delta` triggers a single delta-sync cycle | High |
| FR-11 | CLI command `supertag sync --status` shows: last full sync timestamp, last delta-sync timestamp, nodes synced in last delta, total nodes in DB, embedding coverage percentage | Medium |
| FR-12 | Background polling runs every N minutes (configurable) when the MCP server is active and the Local API is healthy | High |
| FR-13 | Background polling is opt-in via config: `localApi.deltaSyncInterval` (minutes, default: 5, set to 0 to disable) | High |
| FR-14 | `tana_sync` MCP tool gains a `mode` parameter: `"full"` (existing behavior) or `"delta"` (new). Default depends on Local API availability | High |
| FR-15 | New config flag `mcp.toolMode` with values `"full"` (default) or `"slim"` controls which tools are registered | Medium |
| FR-16 | In `"slim"` mode, only semantic search, mutation tools, sync, create, and system tools are registered. Read-only query tools (FTS, tag listing, field queries) are excluded | Medium |
| FR-17 | In `"full"` mode (default), all tools are registered as before — no breaking change | High |
| FR-18 | CLI command `supertag config --mcp-tool-mode slim|full` sets the tool mode | Low |
| FR-19 | If no delta-sync watermark exists, the first delta-sync uses the last full sync timestamp from `sync_metadata.last_sync_timestamp` | High |
| FR-20 | If no full sync has ever been performed, delta-sync requires a full sync first and reports this to the user | High |
| FR-21 | Concurrent full sync and delta-sync are prevented via a lock mechanism — if full sync is running, delta-sync is skipped | Medium |
| FR-22 | Delta-sync logs: number of changed nodes found, new vs updated count, embeddings generated count, duration | Medium |

---

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | Delta-sync for <50 changed nodes completes in <10 seconds (excluding embedding generation time) | Performance |
| NFR-2 | Embedding generation for changed nodes runs after DB merge, not blocking the sync completion report | Performance |
| NFR-3 | Background poll interval is configurable from 1 to 60 minutes | Configurability |
| NFR-4 | Delta-sync uses the existing `LocalApiClient` from F-094 — no new HTTP client or API abstraction | Maintainability |
| NFR-5 | All delta-sync operations use parameterized SQL queries (no injection risk) | Security |
| NFR-6 | Delta-sync errors do not crash the MCP server — failures are logged and the next poll retries | Reliability |
| NFR-7 | Slim mode tool exclusion list is maintained in a single configuration point, not scattered across tool files | Maintainability |
| NFR-8 | All new code has unit tests; delta-sync merge logic has integration tests against a test database | Quality |

---

## Constraints & Accepted Limitations

The Local API search results **do not include** these data points. This is an accepted limitation — full sync remains the source of truth for:

| Data | Available in Delta? | Consequence |
|------|---------------------|-------------|
| Field values (tuple data) | No | `field_values` table only updates on full export |
| Inline references | No | `references` table only updates on full export |
| Entity detection flags (`_flags`, `_ownerId`) | No | Entity status only updates on full export |
| Raw node JSON blob | No | `raw_data` column only updates on full export |
| Modification timestamps | No | API returns `created` but not `modifiedTs` — `updated` is set to sync time |
| Node hierarchy/parent-child | No | Parent-child relationships only update on full export |

**Clarification resolved:** The search API DOES return `description` as an optional field. No secondary `readNode` call is needed — the search result provides sufficient data for embedding generation.

**Design constraints:**
- Merge strategy: API data overwrites name/tags/docType but preserves export-only columns
- No new embedding dependencies — reuses configured model
- Staleness target: <5 minutes when background polling active
- No proxying: slim mode does NOT proxy tana-local MCP; users configure both servers separately
- Workspace isolation: each workspace syncs independently

---

## Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| First delta-sync ever | Uses last full sync timestamp as watermark. If no full sync exists, requires full sync first |
| Tana Desktop goes offline | Background poll detects unhealthy API, pauses polling, resumes when API returns |
| Large initial delta (hundreds of nodes) | Pages through all results sequentially; may take longer but completes |
| Node moved to trash | Marked in DB with trash flag but not deleted; full sync reconciles |
| Workspace mismatch | Delta-sync uses the configured workspace; multi-workspace delta is out of scope |
| Concurrent full + delta sync | Lock prevents concurrent execution; delta-sync skipped with log message |
| Embedding model not configured | DB updates succeed; embedding generation skipped with warning |
| API returns duplicate nodes across pages | Merge is idempotent; last write wins for name/tags |
| deepObject numeric params | `edited.last` expects number but URL params are strings — use `edited.since` (ms timestamp) which has the same issue. Need to verify API coercion or switch search to POST for numeric queries |

---

## Success Criteria

- [ ] A node created in Tana 5 minutes ago appears in `supertag search --semantic` results after delta-sync
- [ ] Background polling runs every 5 minutes when MCP server is active and Tana Desktop is running
- [ ] `supertag sync --delta` completes in <10 seconds for <50 changed nodes (excluding embedding time)
- [ ] Slim MCP mode registers only 12-15 tools (down from ~32)
- [ ] Full MCP mode is unchanged — no regressions, all existing tools still work
- [ ] Delta-sync preserves export-only DB fields (raw_data, field_values, references) without overwriting
- [ ] All existing tests pass (2550+)
- [ ] `supertag sync --status` shows both full and delta sync timestamps and statistics

---

## Scope

### In scope
- DeltaSyncService with merge strategy
- CLI `sync --delta` and `sync --status` enhancements
- Background polling in MCP server process
- MCP tool mode config flag (slim/full)
- `sync_metadata` schema extension for delta watermark
- `tana_sync` MCP tool mode parameter
- Documentation updates (CHANGELOG, README, SKILL.md)

### Out of scope
- Real-time WebSocket streaming from Tana
- Proxying tana-local MCP through supertag-mcp
- Delta-sync for field_values or references tables
- Multi-workspace simultaneous delta-sync
- Automatic full-sync scheduling
- Node hierarchy/parent resolution during delta-sync
