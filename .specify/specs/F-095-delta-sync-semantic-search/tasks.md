# Implementation Tasks: F-095 Delta-Sync via Local API with Semantic Search Consolidation

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Config extensions |
| T-1.2 | ☐ | Type extensions |
| T-1.3 | ☐ | Schema migration helper |
| T-2.1 | ☐ | DeltaSyncService core |
| T-2.2 | ☐ | Pagination + embedding |
| T-2.3 | ☐ | Locking + watermark |
| T-3.1 | ☐ | CLI sync --delta |
| T-3.2 | ☐ | CLI sync --status |
| T-3.3 | ☐ | MCP tana_sync delta mode |
| T-4.1 | ☐ | Background poller |
| T-4.2 | ☐ | MCP server integration |
| T-5.1 | ☐ | Tool mode filter |
| T-5.2 | ☐ | MCP ListTools integration |
| T-6.1 | ☐ | Integration tests |
| T-6.2 | ☐ | MCP tool mode tests |
| T-7.1 | ☐ | Documentation updates |

---

## Group 1: Foundation

### T-1.1: Extend configuration for delta-sync and tool mode [T]
- **File:** `src/config/manager.ts`
- **Test:** `tests/unit/config-delta-sync.test.ts`
- **Dependencies:** none
- **Parallelizable:** [P with T-1.2, T-1.3]
- **Description:**
  Add delta-sync and MCP tool mode configuration support to `ConfigManager`:
  1. Add `deltaSyncInterval` to `LocalApiConfig` interface (number, default 5, 0 = disabled)
  2. Add `mcp.toolMode` to `TanaConfig` interface (`'full' | 'slim'`, default `'full'`)
  3. Add environment variable overrides:
     - `TANA_DELTA_SYNC_INTERVAL` → `localApi.deltaSyncInterval`
     - `TANA_MCP_TOOL_MODE` → `mcp.toolMode`
  4. Add getter methods: `getDeltaSyncInterval()`, `getMcpToolMode()`
- **Acceptance:**
  - [ ] `getDeltaSyncInterval()` returns configured value or default 5
  - [ ] `getMcpToolMode()` returns `'full'` or `'slim'`
  - [ ] Environment variables override config file values
  - [ ] Invalid `toolMode` values fall back to `'full'`

### T-1.2: Extend type definitions for delta-sync [T]
- **File:** `src/types/local-api.ts`
- **Test:** `tests/unit/delta-sync-types.test.ts`
- **Dependencies:** none
- **Parallelizable:** [P with T-1.1, T-1.3]
- **Description:**
  Add TypeScript interfaces for delta-sync results and status:
  1. `DeltaSyncResult` interface: nodesFound, nodesInserted, nodesUpdated, nodesSkipped, embeddingsGenerated, embeddingsSkipped, watermarkBefore, watermarkAfter, durationMs, pages
  2. `DeltaSyncStatus` interface: lastFullSync (ms | null), lastDeltaSync (ms | null), lastDeltaNodesCount (number), totalNodes (number), embeddingCoverage (percentage)
  3. `DeltaSyncOptions` interface: dbPath, localApiClient, embeddingConfig?, logger?
  4. Add `deltaSyncInterval` to existing `LocalApiConfig` interface
- **Acceptance:**
  - [ ] All interfaces exported and importable
  - [ ] `DeltaSyncResult` has all fields from plan spec
  - [ ] `DeltaSyncStatus` has all fields needed by `sync --status`

### T-1.3: Create schema migration helper for delta-sync columns [T]
- **File:** `src/db/delta-sync-schema.ts`
- **Test:** `tests/unit/delta-sync-schema.test.ts`
- **Dependencies:** none
- **Parallelizable:** [P with T-1.1, T-1.2]
- **Description:**
  Create a migration function that adds delta-sync columns to the existing `sync_metadata` table:
  1. `ensureDeltaSyncSchema(db: Database): void`
     - `ALTER TABLE sync_metadata ADD COLUMN delta_sync_timestamp INTEGER`
     - `ALTER TABLE sync_metadata ADD COLUMN delta_nodes_synced INTEGER DEFAULT 0`
  2. Idempotent: wrap each ALTER in try/catch (SQLite errors on duplicate column)
  3. Follow pattern from existing migrations in `src/db/migrate.ts`
- **Acceptance:**
  - [ ] Columns added to `sync_metadata` table
  - [ ] Running twice does not throw errors (idempotent)
  - [ ] Existing `sync_metadata` data preserved after migration
  - [ ] Works on fresh database with no `sync_metadata` rows

---

## Group 2: Core Service

### T-2.1: Implement DeltaSyncService merge logic [T]
- **File:** `src/services/delta-sync.ts`
- **Test:** `tests/unit/delta-sync-merge.test.ts`
- **Dependencies:** T-1.1, T-1.2, T-1.3
- **Description:**
  Core `DeltaSyncService` class with merge operations:
  1. Constructor accepts `DeltaSyncOptions` (dbPath, localApiClient, embeddingConfig?, logger?)
  2. `ensureSchema()` — calls `ensureDeltaSyncSchema()` from T-1.3
  3. `getWatermark(): number | null` — reads `delta_sync_timestamp` from `sync_metadata`, falls back to `last_sync_timestamp`, returns null if no sync ever done
  4. `hasFullSync(): boolean` — checks if `sync_metadata` has a row with `last_sync_timestamp`
  5. `mergeNode(node: SearchResultNode): { inserted: boolean, updated: boolean }` — upsert logic:
     - SELECT existing node by id
     - If exists: UPDATE name, node_type (from docType), updated = Date.now()
     - If new: INSERT with id, name, node_type, created (parse ISO), updated = Date.now()
     - **Preserve**: parent_id, done_at, raw_data (never overwrite from delta)
  6. `reconcileTags(nodeId: string, tags: Array<{id, name}>): void` — DELETE existing tag_applications for nodeId, INSERT new ones from API response
  7. `updateWatermark(nodesCount: number): void` — UPDATE sync_metadata SET delta_sync_timestamp = Date.now(), delta_nodes_synced = count
  8. Uses `bun:sqlite` directly (not Drizzle) matching `TanaIndexer` pattern for performance-critical operations
- **Acceptance:**
  - [ ] New node inserted with all available fields
  - [ ] Existing node updated: name/node_type overwritten, raw_data/done_at/parent_id preserved
  - [ ] Tag applications replaced for changed node
  - [ ] Watermark updated after merge
  - [ ] `getWatermark()` falls back to `last_sync_timestamp` when no delta watermark
  - [ ] `getWatermark()` returns null when no sync metadata exists

### T-2.2: Add pagination and embedding generation to DeltaSyncService [T]
- **File:** `src/services/delta-sync.ts` (extends T-2.1)
- **Test:** `tests/unit/delta-sync-pagination.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  Complete the `sync()` method with pagination and embedding integration:
  1. `fetchChangedNodes(sinceMs: number): AsyncGenerator<SearchResultNode[]>` — pages through API:
     - Call `localApiClient.searchNodes({edited: {since: sinceMs}}, {limit: 100, offset})`
     - Yield each page of results
     - Stop when empty page returned
  2. `sync(): Promise<DeltaSyncResult>` — orchestrates full cycle:
     - Call `ensureSchema()`
     - Get watermark (error if null and no full sync)
     - Page through changed nodes, merge each
     - Collect all changed node IDs
     - Generate embeddings for changed nodes (if embedding model configured)
     - Update watermark
     - Return `DeltaSyncResult` with all statistics
  3. Embedding integration:
     - Import `TanaEmbeddingService`
     - For each changed node, prepare embedding content (name + description)
     - Skip with warning if no embedding model configured (`embeddingsSkipped: true`)
  4. Duration tracking via `performance.now()`
- **Acceptance:**
  - [ ] Pagination stops on empty page
  - [ ] Multi-page responses processed correctly (100+ nodes)
  - [ ] Embeddings generated for all changed nodes
  - [ ] Embeddings gracefully skipped when model not configured
  - [ ] `DeltaSyncResult` statistics accurate
  - [ ] Error: "No full sync found" when watermark is null and no full sync

### T-2.3: Add sync locking and status reporting [T]
- **File:** `src/services/delta-sync.ts` (extends T-2.1)
- **Test:** `tests/unit/delta-sync-locking.test.ts`
- **Dependencies:** T-2.1
- **Parallelizable:** [P with T-2.2]
- **Description:**
  Add concurrency protection and status query:
  1. In-memory lock flag: `private syncing = false`
  2. `isSyncing(): boolean` — returns lock state
  3. Wrap `sync()` in lock acquire/release (with try/finally)
  4. If `sync()` called while locked, return immediately with `nodesFound: 0` and log warning
  5. `getStatus(): DeltaSyncStatus` — query `sync_metadata` for:
     - `lastFullSync`: `last_sync_timestamp`
     - `lastDeltaSync`: `delta_sync_timestamp`
     - `lastDeltaNodesCount`: `delta_nodes_synced`
     - `totalNodes`: COUNT from nodes table
     - `embeddingCoverage`: percentage from LanceDB vs nodes count
- **Acceptance:**
  - [ ] Concurrent `sync()` calls prevented (second returns immediately)
  - [ ] Lock released even on error (try/finally)
  - [ ] `getStatus()` returns all delta-sync statistics
  - [ ] Status works even before first delta-sync (null timestamps)

---

## Group 3: CLI & MCP Integration

### T-3.1: Add `sync --delta` CLI command [T]
- **File:** `src/commands/sync.ts`
- **Test:** `tests/unit/sync-delta-cli.test.ts`
- **Dependencies:** T-2.1, T-2.2, T-2.3
- **Description:**
  Add `--delta` flag to the `sync index` command:
  1. Add `--delta` option: "Run incremental delta-sync via Local API"
  2. When `--delta` is set:
     - Verify Local API bearer token configured (error + instructions if not)
     - Create `LocalApiClient` and check health (error if unreachable)
     - Create `DeltaSyncService` with workspace dbPath and embedding config
     - Run `sync()` and print result summary
  3. Output format:
     ```
     Delta-sync complete:
       Changed nodes found: 12
       Inserted: 3
       Updated: 9
       Embeddings generated: 12
       Duration: 2340ms
     ```
  4. Non-zero exit on error
- **Acceptance:**
  - [ ] `supertag sync index --delta` triggers delta-sync
  - [ ] Missing bearer token shows config instructions
  - [ ] Unreachable API shows endpoint in error
  - [ ] Success output shows all statistics
  - [ ] Supports `--workspace` flag for non-default workspace

### T-3.2: Enhance `sync status` with delta-sync info [T]
- **File:** `src/commands/sync.ts`
- **Test:** `tests/unit/sync-status-cli.test.ts`
- **Dependencies:** T-2.3
- **Parallelizable:** [P with T-3.1]
- **Description:**
  Enhance the existing `sync status` output or add it as a subcommand:
  1. Add `sync status` subcommand if not already present
  2. Display full sync info (existing: last export, last indexed, total nodes)
  3. Add delta-sync section:
     ```
     Delta Sync:
       Last delta-sync: 2026-01-30 09:10:00 (5 minutes ago)
       Nodes synced: 12
       Embedding coverage: 98.2% (142,456 / 145,242 nodes)
     ```
  4. Show "Never" if delta-sync hasn't run yet
  5. Show relative time ("5 minutes ago") for last delta-sync
- **Acceptance:**
  - [ ] Shows full sync timestamps and stats
  - [ ] Shows delta-sync timestamps and node count
  - [ ] Shows embedding coverage percentage
  - [ ] Handles "never synced" state gracefully
  - [ ] Supports `--workspace` flag

### T-3.3: Extend `tana_sync` MCP tool with delta mode [T]
- **File:** `src/mcp/tools/sync.ts`
- **Schema:** `src/mcp/schemas.ts`
- **Test:** `src/mcp/tools/__tests__/sync-delta.test.ts`
- **Dependencies:** T-2.1, T-2.2, T-2.3
- **Parallelizable:** [P with T-3.1, T-3.2]
- **Description:**
  Add delta-sync and status modes to the existing `tana_sync` MCP tool:
  1. In `src/mcp/schemas.ts`: extend sync action enum to include `'delta'`
     - `action: z.enum(['index', 'status', 'delta']).default('index')`
  2. In `src/mcp/tools/sync.ts`: handle `action: 'delta'`:
     - Create `LocalApiClient` from config
     - Check health (return error if unhealthy)
     - Create `DeltaSyncService`, run `sync()`
     - Return `DeltaSyncResult` fields in response
  3. Enhance `action: 'status'` to include delta-sync info from `getStatus()`
  4. Update tool description in `src/mcp/index.ts` to document delta mode
- **Acceptance:**
  - [ ] `tana_sync` with `action: 'delta'` triggers delta-sync
  - [ ] Returns structured result with node counts
  - [ ] `action: 'status'` includes delta-sync watermark and count
  - [ ] Unhealthy API returns clear error (not crash)

---

## Group 4: Background Polling

### T-4.1: Create DeltaSyncPoller [T]
- **File:** `src/mcp/delta-sync-poller.ts`
- **Test:** `tests/unit/delta-sync-poller.test.ts`
- **Dependencies:** T-2.1, T-2.2, T-2.3
- **Description:**
  Background polling manager for automatic delta-sync:
  1. `DeltaSyncPollerOptions`: intervalMinutes, workspace, localApiClient, embeddingConfig?, logger
  2. `start()`: begin `setInterval` with configured interval
  3. `stop()`: clear interval (cleanup on shutdown)
  4. `triggerNow(): Promise<DeltaSyncResult>`: manual trigger (for MCP tool)
  5. `isSyncing(): boolean`: check if currently running
  6. Health-aware polling logic:
     - Check `localApiClient.health()` before each cycle
     - If unhealthy and was healthy → log warning, set `paused = true`
     - If healthy and was paused → log info "resumed", set `paused = false`
     - If healthy and not paused and not syncing → run delta-sync
     - On error → log error, continue polling (never crash MCP server)
  7. Logging: node count, duration, pause/resume events
- **Acceptance:**
  - [ ] Polls at configured interval
  - [ ] Pauses when API unreachable, resumes when available
  - [ ] `stop()` cleans up interval
  - [ ] Errors don't crash the poller
  - [ ] `triggerNow()` runs immediate delta-sync cycle

### T-4.2: Integrate poller into MCP server lifecycle [T]
- **File:** `src/mcp/index.ts`
- **Test:** `tests/unit/mcp-poller-integration.test.ts`
- **Dependencies:** T-4.1
- **Description:**
  Wire `DeltaSyncPoller` into the MCP server process:
  1. After `server.connect(transport)`, initialize poller:
     - Check if Local API is configured (bearerToken exists)
     - Check if `deltaSyncInterval > 0` (polling enabled)
     - Create `LocalApiClient`, `DeltaSyncPoller`
     - Call `poller.start()`
     - Log startup message with interval
  2. Register cleanup handlers:
     - `process.on('SIGINT', () => poller?.stop())`
     - `process.on('SIGTERM', () => poller?.stop())`
  3. Export poller reference for `tana_sync` tool to call `triggerNow()`
- **Acceptance:**
  - [ ] Poller starts automatically when MCP server launches
  - [ ] Poller only starts if Local API configured and interval > 0
  - [ ] Clean shutdown via SIGINT/SIGTERM stops poller
  - [ ] Poller reference accessible from sync tool handler

---

## Group 5: MCP Slim Mode

### T-5.1: Create tool mode filter module [T]
- **File:** `src/mcp/tool-mode.ts`
- **Test:** `tests/unit/tool-mode.test.ts`
- **Dependencies:** T-1.1
- **Parallelizable:** [P with T-2.1, T-3.1, T-4.1]
- **Description:**
  Single configuration point for slim/full mode tool filtering:
  1. Define `SLIM_MODE_TOOLS` set with tool names to keep in slim mode:
     - Semantic search: `tana_semantic_search`
     - Mutation tools: `tana_create`, `tana_batch_create`, `tana_update_node`, `tana_tag_add`, `tana_tag_remove`, `tana_create_tag`, `tana_set_field`, `tana_set_field_option`, `tana_trash_node`, `tana_done`, `tana_undone`
     - Sync & system: `tana_sync`, `tana_cache_clear`, `tana_capabilities`, `tana_tool_schema`
  2. `isToolEnabled(toolName: string, mode: 'full' | 'slim'): boolean`
     - `'full'` → always true
     - `'slim'` → check SLIM_MODE_TOOLS set
  3. `getToolMode(): 'full' | 'slim'` — reads from ConfigManager
  4. `getSlimModeToolCount(): number` — returns size of SLIM_MODE_TOOLS
  5. `getExcludedTools(mode: 'full' | 'slim'): string[]` — returns list of excluded tools for logging
- **Acceptance:**
  - [ ] Full mode enables all tools
  - [ ] Slim mode enables only ~15 tools
  - [ ] `isToolEnabled()` correctly filters by mode
  - [ ] SLIM_MODE_TOOLS is the single source of truth
  - [ ] Tool list matches plan specification

### T-5.2: Integrate tool mode into MCP ListTools handler [T]
- **File:** `src/mcp/index.ts`
- **Test:** `tests/unit/mcp-tool-mode-integration.test.ts`
- **Dependencies:** T-5.1
- **Description:**
  Filter tools based on configured mode in the ListTools handler:
  1. In `ListToolsRequestSchema` handler:
     - Call `getToolMode()` to get current mode
     - Filter `allTools` array through `isToolEnabled(t.name, mode)`
  2. In `CallToolRequestSchema` handler:
     - Check `isToolEnabled(toolName, mode)` before execution
     - Return error for disabled tools: "Tool {name} is disabled in slim mode"
  3. Log tool count at startup: "MCP server started with N tools (mode: full|slim)"
  4. No change in full mode — all tools registered as before
- **Acceptance:**
  - [ ] Full mode: all 35+ tools registered (no regression)
  - [ ] Slim mode: only ~15 tools registered
  - [ ] Disabled tool calls return clear error
  - [ ] Startup log shows tool count and mode

---

## Group 6: Testing

### T-6.1: Integration tests for delta-sync full cycle [T]
- **File:** `tests/integration/delta-sync-integration.test.ts`
- **Dependencies:** T-2.1, T-2.2, T-2.3
- **Description:**
  End-to-end integration tests with a real SQLite database:
  1. **Full cycle test**: Seed DB with nodes via TanaIndexer → mock LocalApiClient response with changed nodes → run DeltaSyncService.sync() → verify:
     - New nodes inserted
     - Existing nodes updated (name changed)
     - Export-only columns preserved (raw_data not null for existing)
     - Tag applications updated
     - Watermark updated in sync_metadata
  2. **Pagination test**: Mock API returning 3 pages (100, 100, 50 nodes) → verify all 250 processed
  3. **Embedding skip test**: No embedding config → verify DB updates succeed, embeddingsSkipped = true
  4. **First delta after full sync**: No delta watermark → verify falls back to last_sync_timestamp
  5. **No full sync error**: Empty sync_metadata → verify appropriate error message
  6. **Idempotent merge test**: Same nodes in two pages → verify no duplicates
- **Acceptance:**
  - [ ] All integration tests pass
  - [ ] Tests use real SQLite database (in-memory or temp file)
  - [ ] API calls mocked (no real network)
  - [ ] Tests are deterministic and parallelizable

### T-6.2: MCP tool mode filter tests [T]
- **File:** `tests/unit/tool-mode.test.ts`
- **Dependencies:** T-5.1, T-5.2
- **Parallelizable:** [P with T-6.1]
- **Description:**
  Comprehensive tests for tool mode filtering:
  1. Full mode enables all known tool names
  2. Slim mode enables only SLIM_MODE_TOOLS members
  3. Slim mode excludes read-only query tools (tana_search, tana_tagged, tana_stats, tana_supertags, tana_node, etc.)
  4. Slim mode tool count is ~15 (exact number from SLIM_MODE_TOOLS.size)
  5. `getToolMode()` defaults to `'full'` when not configured
  6. Invalid config values fall back to `'full'`
  7. Environment variable override works
- **Acceptance:**
  - [ ] All filter tests pass
  - [ ] Edge cases covered (empty config, invalid values)
  - [ ] Tool count assertions match plan specification

---

## Group 7: Documentation

### T-7.1: Update documentation for F-095 [T]
- **Files:**
  - `CHANGELOG.md` (internal)
  - `README.md` (CLI usage, MCP setup)
  - `SKILL.md` (PAI skill triggers)
- **Dependencies:** T-3.1, T-3.2, T-3.3, T-4.2, T-5.2
- **Description:**
  Update all documentation locations:
  1. `CHANGELOG.md`: Add `[Unreleased]` entry with:
     - Delta-sync via Local API (`sync --delta`)
     - Sync status command (`sync status`)
     - Background polling in MCP server
     - MCP tool slim mode (`mcp.toolMode`)
     - `tana_sync` delta mode
  2. `README.md`: Update CLI reference:
     - Add `sync --delta` command documentation
     - Add `sync status` command documentation
     - Add MCP tool mode configuration section
     - Add delta-sync interval configuration
  3. `SKILL.md`: Add triggers for delta-sync related queries
- **Acceptance:**
  - [ ] CHANGELOG has all new features listed
  - [ ] README CLI reference updated
  - [ ] Configuration options documented
  - [ ] SKILL.md triggers updated

---

## Execution Order

```
Phase 1: Foundation (parallel)
  T-1.1  Config extensions          ─┐
  T-1.2  Type definitions           ─┼─ No dependencies, all parallel
  T-1.3  Schema migration           ─┘

Phase 2: Core Service (sequential after Phase 1)
  T-2.1  Merge logic                ← depends on T-1.1, T-1.2, T-1.3
  T-2.2  Pagination + embeddings    ← depends on T-2.1
  T-2.3  Locking + status           ← depends on T-2.1 (parallel with T-2.2)

Phase 3: CLI & MCP (parallel after Phase 2)
  T-3.1  CLI sync --delta           ─┐
  T-3.2  CLI sync --status          ─┼─ All depend on T-2.x, parallel with each other
  T-3.3  MCP tana_sync delta        ─┘

Phase 4: Background Polling (sequential)
  T-4.1  DeltaSyncPoller            ← depends on T-2.1, T-2.2, T-2.3
  T-4.2  MCP server integration     ← depends on T-4.1

Phase 5: Slim Mode (independent, parallel with Phase 2-4)
  T-5.1  Tool mode filter           ← depends on T-1.1 only
  T-5.2  MCP ListTools integration  ← depends on T-5.1

Phase 6: Testing (after implementation phases)
  T-6.1  Integration tests          ← depends on T-2.x
  T-6.2  Tool mode tests            ← depends on T-5.x (parallel with T-6.1)

Phase 7: Documentation (last)
  T-7.1  Docs update                ← depends on all implementation tasks
```

**Critical path:** T-1.x → T-2.1 → T-2.2 → T-3.1/T-4.1 → T-4.2 → T-7.1

**Maximum parallelism:**
- Phase 1: 3 tasks parallel
- Phase 2: T-2.2 and T-2.3 parallel (after T-2.1)
- Phase 3: 3 tasks parallel
- Phase 5: runs parallel with Phases 2-4
- Phase 6: 2 tasks parallel

---

## File Inventory Summary

### New Files (7)
| File | Task | Purpose |
|------|------|---------|
| `src/services/delta-sync.ts` | T-2.1, T-2.2, T-2.3 | Core delta-sync service |
| `src/db/delta-sync-schema.ts` | T-1.3 | Schema migration for delta columns |
| `src/mcp/delta-sync-poller.ts` | T-4.1 | Background polling manager |
| `src/mcp/tool-mode.ts` | T-5.1 | Slim/full mode filter |
| `tests/unit/delta-sync-merge.test.ts` | T-2.1 | Merge logic unit tests |
| `tests/unit/delta-sync-poller.test.ts` | T-4.1 | Poller unit tests |
| `tests/integration/delta-sync-integration.test.ts` | T-6.1 | E2E integration tests |

### Modified Files (7)
| File | Task | Changes |
|------|------|---------|
| `src/config/manager.ts` | T-1.1 | Add delta-sync + tool mode config |
| `src/types/local-api.ts` | T-1.2 | Add DeltaSyncResult, DeltaSyncStatus interfaces |
| `src/commands/sync.ts` | T-3.1, T-3.2 | Add --delta flag, sync status subcommand |
| `src/mcp/tools/sync.ts` | T-3.3 | Handle action: 'delta' and enhanced 'status' |
| `src/mcp/schemas.ts` | T-3.3 | Add 'delta' to sync action enum |
| `src/mcp/index.ts` | T-4.2, T-5.2 | Poller init, tool mode filter |
| `CHANGELOG.md` | T-7.1 | Release notes |
