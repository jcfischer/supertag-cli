# Technical Plan: F-095 Delta-Sync via Local API with Semantic Search Consolidation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           supertag-cli v1.14+                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  CLI Layer                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐               │
│  │ sync --delta     │  │ sync --status    │  │ sync index       │               │
│  │ (NEW)            │  │ (ENHANCED)       │  │ (existing)       │               │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘               │
│           │                     │                      │                         │
├───────────┴─────────────────────┴──────────────────────┴─────────────────────────┤
│  Services Layer                                                                  │
│  ┌───────────────────────────────────────────┐  ┌──────────────────────────┐     │
│  │         DeltaSyncService (NEW)            │  │  TanaIndexer (existing)  │     │
│  │                                           │  │  Full export reindex     │     │
│  │  - fetchChangedNodes()                    │  └──────────────────────────┘     │
│  │  - mergeNodes()                           │                                   │
│  │  - reconcileTags()                        │                                   │
│  │  - generateEmbeddings()                   │                                   │
│  │  - updateWatermark()                      │                                   │
│  └─────────────────┬─────────────────────────┘                                   │
│                    │                                                              │
├────────────────────┴──────────────────────────────────────────────────────────────┤
│  API Layer                                                                       │
│  ┌──────────────────────────┐  ┌─────────────────────────────────────┐           │
│  │  LocalApiClient (F-094)  │  │  TanaEmbeddingService (existing)    │           │
│  │  searchNodes({edited:    │  │  embedNodes() for changed nodes     │           │
│  │    {since: <watermark>}})│  │                                     │           │
│  └──────────────────────────┘  └─────────────────────────────────────┘           │
│                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│  MCP Layer                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐     │
│  │  MCP Server (MODIFIED)                                                  │     │
│  │  ┌─────────────────────┐  ┌──────────────────────┐                     │     │
│  │  │ Background Poller   │  │ Tool Mode Filter     │                     │     │
│  │  │ (NEW)               │  │ (NEW)                │                     │     │
│  │  │ setInterval → delta │  │ full: 35 tools       │                     │     │
│  │  │ sync every N min    │  │ slim: ~15 tools      │                     │     │
│  │  └─────────────────────┘  └──────────────────────┘                     │     │
│  │                                                                         │     │
│  │  tana_sync (MODIFIED): mode="full"|"delta"|"status"                    │     │
│  └─────────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│  Storage Layer                                                                   │
│  ┌────────────────────┐  ┌──────────────────────────────────────────────┐        │
│  │  SQLite DB          │  │  LanceDB                                    │        │
│  │  sync_metadata:     │  │  Embeddings for delta-synced nodes          │        │
│  │  + delta_sync_ts    │  │  (reuses existing tana-index.lance)         │        │
│  │  + delta_nodes_count│  │                                              │        │
│  └────────────────────┘  └──────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Delta Sync Service | TypeScript class | Follows existing service patterns (TanaIndexer, TanaExportWatcher) |
| API Client | LocalApiClient (F-094) | Already has `searchNodes()` with deepObject serialization |
| Database | SQLite via `bun:sqlite` | Direct SQLite for performance-critical merge operations (matches indexer pattern) |
| Embeddings | TanaEmbeddingService + resona | Existing pipeline, reused for delta-synced nodes |
| Background Polling | `setInterval` in MCP process | Simple, no external dependencies, matches Node.js patterns |
| Config | ConfigManager singleton | Existing config system with env var override support |
| Locking | In-memory flag + sync_metadata check | Simple, no file locks needed (single-process) |

## Constitutional Compliance Checklist

- [x] **CLI-First**: `sync --delta` and `sync --status` exposed as CLI commands
- [x] **Library-First**: DeltaSyncService is a standalone class importable by CLI, MCP, and tests
- [x] **Test-First**: Unit tests for merge logic, integration tests against test DB
- [x] **Deterministic**: No probabilistic behavior; merge is idempotent
- [x] **Code Before Prompts**: All logic in service code, no prompt engineering
- [x] **No New Dependencies**: Reuses LocalApiClient, TanaEmbeddingService, bun:sqlite

---

## Data Model

### Schema Extension: `sync_metadata` table

The existing `sync_metadata` table (singleton, id=1) gains two new columns:

```sql
-- Migration: Add delta-sync columns to sync_metadata
ALTER TABLE sync_metadata ADD COLUMN delta_sync_timestamp INTEGER;
ALTER TABLE sync_metadata ADD COLUMN delta_nodes_synced INTEGER DEFAULT 0;
```

**Column semantics:**
| Column | Type | Description |
|--------|------|-------------|
| `delta_sync_timestamp` | INTEGER (ms epoch) | Last successful delta-sync watermark. NULL = never run. |
| `delta_nodes_synced` | INTEGER | Count of nodes processed in last delta-sync cycle |

**Migration strategy:** Applied in `DeltaSyncService.ensureSchema()` via `ALTER TABLE ... ADD COLUMN`. SQLite silently ignores `ADD COLUMN` if column exists (wrapped in try/catch).

### Configuration Extension: `localApi` section

```typescript
// Extend existing LocalApiConfig in src/types/local-api.ts
interface LocalApiConfig {
  enabled: boolean;              // existing
  bearerToken?: string;          // existing
  endpoint: string;              // existing
  deltaSyncInterval?: number;    // NEW: minutes between auto-syncs (default: 5, 0 = disabled)
}

// New top-level config in TanaConfig
interface TanaConfig {
  // ... existing fields
  mcp?: {
    toolMode?: 'full' | 'slim';  // NEW: default 'full'
  };
}
```

**Environment variable overrides:**
- `TANA_DELTA_SYNC_INTERVAL` → `localApi.deltaSyncInterval`
- `TANA_MCP_TOOL_MODE` → `mcp.toolMode`

---

## Component Design

### 1. DeltaSyncService (`src/services/delta-sync.ts`)

Core service handling all delta-sync operations.

```typescript
interface DeltaSyncOptions {
  dbPath: string;
  lancePath: string;          // LanceDB path for embeddings
  localApiClient: LocalApiClient;
  embeddingConfig?: EmbeddingConfig;  // Optional: skip embeddings if not configured
  logger?: Logger;
}

interface DeltaSyncResult {
  nodesFound: number;         // Total changed nodes from API
  nodesInserted: number;      // New nodes added to DB
  nodesUpdated: number;       // Existing nodes updated
  nodesSkipped: number;       // Skipped (e.g., trash nodes)
  embeddingsGenerated: number;
  embeddingsSkipped: boolean; // True if no embedding model configured
  watermarkBefore: number;    // Previous watermark (ms)
  watermarkAfter: number;     // New watermark (ms)
  durationMs: number;
  pages: number;              // Number of API pages fetched
}

class DeltaSyncService {
  constructor(options: DeltaSyncOptions);

  // Main entry point: run one delta-sync cycle
  async sync(): Promise<DeltaSyncResult>;

  // Schema migration for delta-sync columns
  ensureSchema(): void;

  // Read current delta watermark (ms) or fall back to last_sync_timestamp
  getWatermark(): number | null;

  // Check if full sync has ever been performed
  hasFullSync(): boolean;

  // Status report for CLI/MCP
  getStatus(): DeltaSyncStatus;
}
```

**Sync algorithm:**

```
1. ensureSchema()  — Ensure delta columns exist
2. getWatermark()  — Read delta_sync_timestamp or last_sync_timestamp
3. If watermark is null → Error: "No full sync found. Run supertag sync index first."
4. Acquire lock (in-memory flag)
5. Page through API results:
   a. searchNodes({edited: {since: watermark}}, {limit: 100, offset: page * 100})
   b. Continue until empty page returned
6. For each SearchResultNode:
   a. Check if node exists in DB (SELECT id FROM nodes WHERE id = ?)
   b. If exists → UPDATE name, node_type (docType), updated = NOW
   c. If new → INSERT with id, name, node_type, created (from API), updated = NOW
   d. Reconcile tag_applications: DELETE existing for node, INSERT from API tags
   e. If inTrash → Mark node (set node_type = 'trash' or add metadata)
7. Generate embeddings for all changed node IDs (batch)
8. Update watermark: delta_sync_timestamp = NOW, delta_nodes_synced = count
9. Release lock
10. Return DeltaSyncResult
```

**Merge rules (critical):**

| DB Column | Delta Behavior | Rationale |
|-----------|---------------|-----------|
| `id` | Match key | Unique node identifier |
| `name` | Overwrite from API `name` | API has latest name |
| `parent_id` | **Preserve** | API doesn't return parent |
| `node_type` | Overwrite from API `docType` | API has current type |
| `created` | Set from API `created` (parse ISO to epoch) | Only set on INSERT |
| `updated` | Set to current time | API doesn't return modifiedTs |
| `done_at` | **Preserve** | API doesn't return done state |
| `raw_data` | **Preserve** (NULL for new nodes) | Only from full export |
| tag_applications | **Replace** for changed node | API returns full tag list |

### 2. Background Poller (`src/mcp/delta-sync-poller.ts`)

Manages automatic delta-sync in the MCP server process.

```typescript
interface DeltaSyncPollerOptions {
  intervalMinutes: number;    // From config, default 5
  workspace: ResolvedWorkspace;
  localApiClient: LocalApiClient;
  embeddingConfig?: EmbeddingConfig;
  logger: Logger;
}

class DeltaSyncPoller {
  private timer: Timer | null = null;
  private running: boolean = false;
  private paused: boolean = false;

  constructor(options: DeltaSyncPollerOptions);

  // Start the polling loop
  start(): void;

  // Stop polling (cleanup on MCP shutdown)
  stop(): void;

  // Manual trigger (from tana_sync MCP tool)
  async triggerNow(): Promise<DeltaSyncResult>;

  // Check if currently syncing (for lock)
  isSyncing(): boolean;
}
```

**Lifecycle in MCP server:**

```typescript
// In src/mcp/index.ts main()
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // NEW: Start background delta-sync if configured
  const poller = await initDeltaSyncPoller();
  if (poller) {
    poller.start();
    logger.info('Delta-sync polling started', {
      intervalMinutes: config.localApi?.deltaSyncInterval || 5
    });
  }

  // Cleanup on exit
  process.on('SIGINT', () => {
    poller?.stop();
  });
  process.on('SIGTERM', () => {
    poller?.stop();
  });
}
```

**Health-aware polling:**

```
On each tick:
  1. Check localApiClient.health()
  2. If unhealthy AND was previously healthy:
     → Log warning "Delta-sync paused: Tana Desktop not reachable"
     → Set paused = true
  3. If healthy AND was previously paused:
     → Log info "Delta-sync resumed: Tana Desktop connected"
     → Set paused = false
  4. If healthy AND not paused AND not already running:
     → Run delta-sync cycle
     → Log result summary
  5. On error:
     → Log error, continue polling (don't crash MCP server)
```

### 3. MCP Tool Mode Filter (`src/mcp/tool-mode.ts`)

Single configuration point for slim mode tool filtering.

```typescript
// Tool categories for mode filtering
const SLIM_MODE_TOOLS: Set<string> = new Set([
  // Semantic search (unique value)
  'tana_semantic_search',

  // Mutation tools (Local API-backed)
  'tana_create',
  'tana_batch_create',
  'tana_update_node',
  'tana_tag_add',
  'tana_tag_remove',
  'tana_create_tag',
  'tana_set_field',
  'tana_set_field_option',
  'tana_trash_node',
  'tana_done',
  'tana_undone',

  // Sync & system
  'tana_sync',
  'tana_cache_clear',
  'tana_capabilities',
  'tana_tool_schema',
]);

// Excluded in slim mode (tana-local handles these natively):
// tana_search, tana_tagged, tana_stats, tana_supertags, tana_node,
// tana_related, tana_field_values, tana_supertag_info,
// tana_transcript_list, tana_transcript_show, tana_transcript_search,
// tana_batch_get, tana_query, tana_aggregate, tana_timeline, tana_recent

export function isToolEnabled(toolName: string, mode: 'full' | 'slim'): boolean {
  if (mode === 'full') return true;
  return SLIM_MODE_TOOLS.has(toolName);
}

export function getToolMode(): 'full' | 'slim' {
  const config = ConfigManager.getInstance();
  return config.get('mcp.toolMode') || 'full';
}
```

**Integration in MCP server:**

```typescript
// In ListToolsRequestSchema handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const mode = getToolMode();
  const allTools = [ /* existing 35 tool definitions */ ];
  return {
    tools: allTools.filter(t => isToolEnabled(t.name, mode))
  };
});
```

### 4. tana_sync MCP Tool Enhancement

**Schema change:**

```typescript
// In src/mcp/schemas.ts
export const syncSchema = z.object({
  action: z.enum(['index', 'status', 'delta']).default('index')  // ADD 'delta'
    .describe('Action: "index" for full reindex, "delta" for incremental sync, "status" for current state'),
  workspace: z.string().optional()
    .describe('Workspace alias'),
  mode: z.enum(['full', 'delta']).optional()  // DEPRECATED alias for action
    .describe('Deprecated: use action instead. "full" maps to "index", "delta" maps to "delta"'),
});
```

**Handler logic for `action: 'delta'`:**

```typescript
case 'delta': {
  const deltaService = new DeltaSyncService({
    dbPath: workspace.dbPath,
    lancePath: workspace.dbPath.replace('.db', '.lance'),
    localApiClient: getOrCreateLocalApiClient(),
    embeddingConfig: config.getEmbeddingConfig(),
  });
  const result = await deltaService.sync();
  return { ...baseResult, action: 'delta', ...result };
}
```

### 5. CLI sync --delta Command

Added as a flag on the existing `sync` command group (not a new subcommand):

```typescript
// In src/commands/sync.ts, modify the sync group
sync
  .command("index")  // existing
  // ... existing options
  .option("--delta", "Run incremental delta-sync via Local API instead of full export reindex")
  .action(async (options) => {
    if (options.delta) {
      // Delta-sync path
      const config = getConfig();
      const localApiConfig = config.getLocalApiConfig();
      if (!localApiConfig.bearerToken) {
        logger.error('Local API bearer token not configured.');
        logger.error('Set it with: supertag config --local-api-token <token>');
        process.exit(1);
      }
      const client = new LocalApiClient({
        endpoint: localApiConfig.endpoint,
        bearerToken: localApiConfig.bearerToken,
      });
      const healthy = await client.health();
      if (!healthy) {
        logger.error('Tana Desktop Local API is not reachable.');
        logger.error(`Tried: ${localApiConfig.endpoint}`);
        process.exit(1);
      }

      const deltaService = new DeltaSyncService({ ... });
      const result = await deltaService.sync();
      logger.info(`Delta-sync complete:`);
      logger.info(`  Changed nodes found: ${result.nodesFound}`);
      logger.info(`  Inserted: ${result.nodesInserted}`);
      logger.info(`  Updated: ${result.nodesUpdated}`);
      logger.info(`  Embeddings generated: ${result.embeddingsGenerated}`);
      logger.info(`  Duration: ${result.durationMs}ms`);
      process.exit(0);
    }

    // ... existing full index path
  });
```

### 6. CLI sync status Enhancement

The existing `sync status` command gains delta-sync information:

```
$ supertag sync status
Workspace: main
Export directory: ~/Documents/Tana-Export/main/
Database: ~/.local/share/supertag/workspaces/main/tana-index.db

Full Sync:
  Last export: M9rkJkwuED@2026-01-30.json
  Last indexed: 2026-01-30 08:15:00
  Total nodes: 145,230

Delta Sync:
  Last delta-sync: 2026-01-30 09:10:00 (5 minutes ago)
  Nodes synced: 12
  Embedding coverage: 98.2% (142,456 / 145,242 nodes)
```

---

## Failure Mode Analysis

| Failure Mode | Likelihood | Impact | Mitigation |
|--------------|-----------|--------|------------|
| Tana Desktop offline during poll | High | Low | Health check before sync, pause polling, auto-resume |
| Large initial delta (1000+ nodes) | Medium | Medium | Pagination with no cap, log progress per page |
| Bearer token expired/invalid | Medium | Medium | Clear error message with fix instructions, 401 → stop polling |
| Concurrent full + delta sync | Low | High | In-memory lock flag, delta skipped if full running |
| Embedding model not available | Medium | Low | DB updates succeed, embeddings skipped with warning |
| deepObject numeric params fail | Low | Medium | Use string coercion in `serializeDeepObject`; fallback to large timestamp range if 400 |
| Network timeout during pagination | Low | Medium | Retry logic in LocalApiClient (3 retries, exponential backoff) |
| SQLite busy (WAL contention) | Low | Low | Existing `withDbRetrySync` pattern, WAL mode configured |
| Node deleted between pages | Very Low | Very Low | Merge is idempotent; missing node simply not processed |
| MCP server crash during delta-sync | Low | Medium | Transaction-wrapped DB writes; incomplete sync leaves valid state |

---

## Testing Strategy

### Unit Tests (`tests/delta-sync.test.ts`)

| Test | Category |
|------|----------|
| `ensureSchema()` adds columns idempotently | Schema |
| `getWatermark()` returns delta timestamp when present | Watermark |
| `getWatermark()` falls back to last_sync_timestamp | Watermark |
| `getWatermark()` returns null when no sync ever done | Watermark |
| Merge: new node inserted with correct columns | Merge |
| Merge: existing node updated, raw_data preserved | Merge |
| Merge: tag_applications replaced for changed node | Merge |
| Merge: node with inTrash=true gets trash marker | Merge |
| Merge: created timestamp parsed from ISO string | Merge |
| Merge: empty API response → 0 changes, watermark still updated | Merge |
| Merge: duplicate nodes across pages → idempotent | Merge |
| Concurrent sync prevented by lock | Locking |

### Integration Tests (`tests/integration/delta-sync-integration.test.ts`)

| Test | Category |
|------|----------|
| Full cycle: seed DB → mock API response → verify merged state | E2E |
| Pagination: multi-page response correctly pages through all | Pagination |
| Embeddings generated for delta-synced nodes | Embeddings |
| Embeddings skipped when model not configured | Embeddings |
| Status report includes delta-sync info | Status |
| First delta after full sync uses correct watermark | Watermark |

### MCP Tool Tests

| Test | Category |
|------|----------|
| `tana_sync` with `action: 'delta'` triggers delta-sync | MCP |
| `tana_sync` with `action: 'status'` includes delta info | MCP |
| Slim mode registers only ~15 tools | MCP |
| Full mode registers all 35+ tools (no regression) | MCP |
| Tool mode config respected at registration time | MCP |

---

## File Inventory

### New Files

| File | Purpose |
|------|---------|
| `src/services/delta-sync.ts` | DeltaSyncService class |
| `src/mcp/delta-sync-poller.ts` | Background polling manager |
| `src/mcp/tool-mode.ts` | Slim/full mode filter logic |
| `tests/delta-sync.test.ts` | Unit tests for merge logic |
| `tests/integration/delta-sync-integration.test.ts` | Integration tests |
| `tests/mcp/tool-mode.test.ts` | Tool mode filter tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/commands/sync.ts` | Add `--delta` flag to `sync index`, enhance `sync status` |
| `src/mcp/index.ts` | Add background poller init, filter tools by mode |
| `src/mcp/tools/sync.ts` | Handle `action: 'delta'` and `action: 'status'` with delta info |
| `src/mcp/schemas.ts` | Add `'delta'` to sync action enum, add `mode` param |
| `src/types/local-api.ts` | Add `deltaSyncInterval` to LocalApiConfig |
| `src/types.ts` | Add `mcp.toolMode` to TanaConfig |
| `src/config/manager.ts` | Add getters/setters for new config fields, env var handling |

### Unchanged Files

| File | Rationale |
|------|-----------|
| `src/db/schema.ts` | Schema migration via ALTER TABLE, not Drizzle definition change |
| `src/db/indexer.ts` | Full indexer untouched; delta-sync is a separate path |
| `src/embeddings/tana-embedding-service.ts` | Reused as-is |
| `src/api/local-api-client.ts` | Already has `searchNodes()` and `health()` |

---

## Implementation Order

| Phase | Work | Depends On |
|-------|------|-----------|
| 1 | DeltaSyncService: schema migration, watermark read, merge logic | — |
| 2 | DeltaSyncService: pagination, embedding generation | Phase 1 |
| 3 | CLI `sync --delta` command and `sync --status` enhancement | Phase 2 |
| 4 | MCP `tana_sync` mode parameter, delta handler | Phase 2 |
| 5 | Background poller with health-aware polling | Phase 4 |
| 6 | MCP slim mode (tool-mode.ts, ListTools filter) | — (independent) |
| 7 | Config extensions (deltaSyncInterval, mcp.toolMode) | — (independent) |
| 8 | Tests: unit, integration, MCP tool mode | All phases |

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|-----------|
| Does search API return `description`? | **Yes** — optional field in SearchResultNode. No secondary `readNode` call needed. |
| Can `edited.since` accept string params? | **Needs runtime test** — URL params are strings. `serializeDeepObject` converts to string. If API rejects, try POST or coerce to number. |
| Should delta-sync update `node_checksums`? | **No** — checksums are for full export change detection. Delta-sync is a separate path. Mixing would corrupt full-sync diffing. |
| Where to store sync lock? | **In-memory flag** on DeltaSyncService instance. MCP server is single-process. CLI commands create separate instances. |
| Should deleted nodes (inTrash) be removed from DB? | **No** — mark only. Full sync reconciles deletions. |
