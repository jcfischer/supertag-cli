# Technical Plan: F-105 PAI Memory Integration

## Architecture Overview

```
pai-seed (external)                   supertag-cli (this codebase)
┌────────────────────┐               ┌──────────────────────────────────────┐
│ seed.json          │               │                                      │
│  ├─ patterns[]     │──── sync ────>│  PaiSyncService                     │
│  ├─ insights[]     │               │    ├── readSeedFile()               │
│  └─ selfKnowledge[]│               │    ├── resolveEntities() [F-100]    │
│                    │               │    ├── deduplicateViaMapping()       │
│  proposals[]       │               │    └── createOrUpdateNodes()         │
│  (lifecycle state) │               │         └── TanaBackend.createNodes()│
│                    │               │                                      │
│ Session hooks:     │<── context ──│  PaiContextService                   │
│  start → load ctx  │               │    ├── assembleContext() [F-098]    │
│  confirm → sync    │               │    └── scoreFreshness()             │
└────────────────────┘               │                                      │
                                     │  ID Mapping                          │
                                     │    ~/.config/supertag/               │
                                     │       pai-mapping.json               │
                                     │                                      │
                                     │  CLI: supertag pai                   │
                                     │    ├── sync                          │
                                     │    ├── context <topic>               │
                                     │    ├── freshness                     │
                                     │    └── schema init                   │
                                     │                                      │
                                     │  MCP: tana_pai_sync                  │
                                     │       tana_pai_context               │
                                     │       tana_pai_freshness             │
                                     └──────────────────────────────────────┘

Write path: TanaBackend (local-api preferred, input-api fallback)
Read path:  TanaReadBackend (local-api preferred, sqlite fallback)
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| CLI framework | Commander.js | Project pattern — `Command` factories |
| Write API | `TanaBackend` via `resolveBackend()` | Existing write abstraction (F-094) — local-api → input-api fallback |
| Read API | `TanaReadBackend` via `resolveReadBackend()` | Existing read abstraction (F-097) — local-api → sqlite fallback |
| Entity resolution | `resolveEntity()` from `src/db/entity-match.ts` | Existing F-100 — fuzzy + semantic matching |
| Context assembly | `assembleContext()` from `src/services/context-assembler.ts` | Existing F-098 — 6-phase pipeline |
| Schema service | `UnifiedSchemaService` | Existing — validates supertag fields |
| Node creation | `createNode()` from `src/services/node-builder.ts` | Shared CLI/MCP node builder |
| Validation | Zod | MCP schema standard in project |
| ID generation | `nanoid` | Already a project dependency (seed.json uses it) |
| Config persistence | JSON files | Project pattern (`~/.config/supertag/`) |
| Output formatting | Universal format system (Spec 060) | `--format table|json|csv|ids|minimal|jsonl` |
| Error handling | `StructuredError` (Spec 073) | Project standard for structured errors |

## Data Model

### seed.json Structure (External — Read-Only)

```typescript
// ~/.pai/seed.json — existing format, NOT modified by this feature
interface SeedFile {
  version: string;
  identity: { principalName: string; aiName: string; /* ... */ };
  learned: {
    patterns: SeedEntry[];
    insights: SeedEntry[];
    selfKnowledge: SeedEntry[];
  };
  state: {
    proposals: SeedProposal[];
  };
}

interface SeedEntry {
  id: string;                    // nanoid
  content: string;               // Learning text
  source: string;                // Session ID or label
  extractedAt: string;           // ISO date
  confirmedAt: string;           // ISO date
  confirmed: boolean;            // Always true for learned entries
  tags: string[];                // Optional tags
}

interface SeedProposal {
  id: string;
  type: 'pattern' | 'insight' | 'self_knowledge';
  content: string;
  source: string;
  extractedAt: string;
  status: 'pending' | 'accepted' | 'rejected';
  method?: string;
  decidedAt?: string;
}
```

### ID Mapping (New)

```typescript
// ~/.config/supertag/pai-mapping.json
interface PaiMapping {
  version: 1;
  workspace: string;              // Workspace alias (e.g., "main")
  lastSync: string;               // ISO timestamp of last sync
  mappings: Record<string, string>; // seedEntryId → tanaNodeId
  deletedSeedIds?: string[];      // Seed entries removed since last sync
}
```

### PAI Supertag Schemas (Created via Tana Local MCP)

```typescript
// #pai_learning — created by `supertag pai schema init`
interface PaiLearningSchema {
  // Fields to create on the supertag:
  type: 'pattern' | 'insight' | 'self_knowledge';  // options field
  content: string;                                    // plain field
  confidence: number;                                 // number field (0-10)
  source: string;                                     // plain field
  confirmedAt: string;                                // date field
  seedEntryId: string;                                // plain field (bidirectional link)
  relatedPeople: string[];                            // instance → #person (multi-value)
  relatedProjects: string[];                          // instance → #project (multi-value)
}

// #pai_proposal — created by `supertag pai schema init`
interface PaiProposalSchema {
  status: 'pending' | 'accepted' | 'rejected';       // options field
  confidence: number;                                  // number field
  extractedFrom: string;                               // plain field
  decidedAt: string;                                   // date field
  content: string;                                     // plain field
}
```

### Internal Types (New)

```typescript
// src/types/pai.ts

/** A learning ready to sync to Tana */
interface PaiLearningEntry {
  seedId: string;
  type: 'pattern' | 'insight' | 'self_knowledge';
  content: string;
  source: string;
  confirmedAt: string;
  tags: string[];
}

/** Entity link resolved during sync */
interface EntityLink {
  entityName: string;           // Name found in content
  tanaNodeId: string;           // Resolved Tana node ID
  tagType: string;              // person, project, etc.
  confidence: number;           // Resolution confidence (0-1)
}

/** Sync result for a single entry */
interface SyncEntryResult {
  seedId: string;
  tanaNodeId?: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  entityLinks: EntityLink[];
  error?: string;
}

/** Overall sync result */
interface PaiSyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  entries: SyncEntryResult[];
  lastSync: string;
}

/** Freshness assessment for a single learning */
interface FreshnessResult {
  seedId: string;
  tanaNodeId?: string;
  content: string;
  type: string;
  confirmedAt: string;
  graphActivity?: string;       // Latest activity from linked nodes
  contextualFreshness: string;  // max(confirmedAt, graphActivity)
  status: 'fresh' | 'stale' | 'unknown';
  daysSinceActive: number;
  linkedEntities: { name: string; lastModified?: string }[];
}

/** Context response for pai-seed session hooks */
interface PaiContextResponse {
  learnings: Array<{
    content: string;
    type: string;
    confirmedAt: string;
    freshness: 'fresh' | 'stale';
    linkedTo: string[];           // Names of linked entities
  }>;
  relatedNodes: Array<{
    name: string;
    type: string;
    lastModified?: string;
  }>;
  tokenCount: number;
}
```

## API Contracts

### CLI Commands

#### `supertag pai sync`

```
supertag pai sync [--seed-path <path>] [--workspace <alias>] [--dry-run] [--force] [--format <type>]

Options:
  --seed-path <path>    Path to seed.json (default: ~/.pai/seed.json)
  --workspace <alias>   Target workspace (default: configured default)
  --dry-run             Show what would be synced without creating nodes
  --force               Re-sync all entries, not just new/modified
  --format <type>       Output format (table|json|csv|jsonl)

Output (table):
  Type       | Content (truncated)     | Action  | Entity Links
  pattern    | User prefers TypeSc...  | created | person:Jens-Christian
  insight    | 90% garbage proposa...  | skipped | (already synced)

  Summary: 12 synced (8 created, 2 updated, 2 skipped), 0 failed
```

#### `supertag pai context <topic>`

```
supertag pai context <topic> [--max-tokens <n>] [--type <type>] [--workspace <alias>] [--format markdown|json]

Options:
  --max-tokens <n>      Token budget (default: 2000)
  --type <type>         Filter by learning type: pattern|insight|self_knowledge
  --workspace <alias>   Workspace for graph context
  --format <type>       Output format (default: markdown)

Output (markdown):
  ## PAI Context: "deployment"

  ### Learnings (3 results)
  - [pattern] The deploy.yml playbook could optionally trigger seed.yml...
    Linked to: #project:CTF Platform
    Freshness: fresh (project active 2d ago)

  ### Related Tana Context
  - #project CTF Platform (last modified: 2026-02-25)
  - #meeting Deployment Review (2026-02-20)
```

#### `supertag pai freshness`

```
supertag pai freshness [--threshold <days>] [--type <type>] [--workspace <alias>] [--format <type>]

Options:
  --threshold <days>    Days before marking stale (default: 30)
  --type <type>         Filter by learning type
  --format <type>       Output format

Output (table):
  Status | Type       | Content                    | Confirmed  | Graph Activity | Days
  fresh  | pattern    | User prefers TypeScript...  | 2026-02-01 | 2026-02-25    | 2
  stale  | insight    | Regex capture reframe...    | 2026-02-02 | —             | 25

  Summary: 15 fresh, 3 stale, 2 unknown (no Tana link)
```

#### `supertag pai schema init`

```
supertag pai schema init [--workspace <alias>] [--dry-run]

Output:
  Creating PAI supertags in workspace 'main'...
  ✓ Created #pai_learning (7 fields)
  ✓ Created #pai_proposal (5 fields)

  Supertags ready. Run `supertag pai sync` to sync learnings.
```

### MCP Tools

#### `tana_pai_sync`

```typescript
// Schema
const paiSyncSchema = z.object({
  seedPath: z.string().optional().describe('Path to seed.json (default: ~/.pai/seed.json)'),
  workspace: workspaceSchema,
  dryRun: z.boolean().default(false).describe('Preview sync without creating nodes'),
  force: z.boolean().default(false).describe('Re-sync all entries, not just incremental'),
});

// Response: PaiSyncResult (JSON)
```

#### `tana_pai_context`

```typescript
// Schema
const paiContextSchema = z.object({
  topic: z.string().min(1).describe('Topic to find related learnings for'),
  maxTokens: z.number().default(2000).describe('Token budget for context'),
  type: z.enum(['pattern', 'insight', 'self_knowledge']).optional()
    .describe('Filter by learning type'),
  workspace: workspaceSchema,
});

// Response: PaiContextResponse (JSON)
```

#### `tana_pai_freshness`

```typescript
// Schema
const paiFresnessSchema = z.object({
  threshold: z.number().default(30).describe('Days before marking stale'),
  type: z.enum(['pattern', 'insight', 'self_knowledge']).optional(),
  workspace: workspaceSchema,
});

// Response: FreshnessResult[] (JSON)
```

## Implementation Phases

### Phase 1: Types and Configuration (Foundation)

**Goal**: Define all types, mapping file, and seed.json reader.

1. **Create `src/types/pai.ts`** — All PAI type definitions (PaiLearningEntry, EntityLink, SyncEntryResult, PaiSyncResult, FreshnessResult, PaiContextResponse, PaiMapping)
2. **Create `src/pai/seed-reader.ts`** — Read and parse `~/.pai/seed.json`:
   - `readSeedFile(path?: string): SeedFile` — Parse with Zod validation (.passthrough() for forwards-compat)
   - `getConfirmedLearnings(seed: SeedFile): PaiLearningEntry[]` — Extract all confirmed entries across categories
   - `getNewLearningsSince(seed: SeedFile, lastSync: string): PaiLearningEntry[]` — Incremental: only entries confirmed after lastSync
3. **Create `src/pai/mapping.ts`** — ID mapping CRUD:
   - `loadMapping(workspace?: string): PaiMapping` — Load or create empty mapping
   - `saveMapping(mapping: PaiMapping): void` — Persist to `~/.config/supertag/pai-mapping.json`
   - `getMappedNodeId(mapping: PaiMapping, seedId: string): string | undefined`
   - `setMappedNodeId(mapping: PaiMapping, seedId: string, tanaNodeId: string): void`
   - `getUnmappedEntries(entries: PaiLearningEntry[], mapping: PaiMapping): PaiLearningEntry[]`

**Tests**: Unit tests for seed-reader (parse valid/invalid/empty), mapping (CRUD, incremental detection).

### Phase 2: Schema Initialization

**Goal**: Create `#pai_learning` and `#pai_proposal` supertags in Tana workspace.

1. **Create `src/pai/schema-init.ts`** — Supertag creation via Tana Local MCP API:
   - `initPaiSchema(options: { workspace?: string; dryRun?: boolean }): Promise<SchemaInitResult>`
   - Uses `LocalApiClient.createTag()` to create `#pai_learning` with 8 fields
   - Uses `LocalApiClient.createTag()` to create `#pai_proposal` with 5 fields
   - Stores created tag IDs in `pai-mapping.json` under a `schema` key
   - Idempotent: checks if tags exist before creating (search by name)
2. **Create `src/commands/pai.ts`** — CLI command group:
   - `supertag pai schema init` subcommand (first command in the group)
   - Uses Commander.js subcommand pattern like `createWorkspaceCommand()`

**Design decision**: Use `LocalApiClient` directly (not Input API) for tag creation because `createTag()` returns the tag ID immediately, which we need for the mapping. The Input API's `createNodes()` doesn't support tag definition creation. If Local API is unavailable, fail with clear error — schema init requires Tana Desktop.

**Tests**: Mock LocalApiClient, verify correct API calls, test idempotency.

### Phase 3: Sync Engine (Core)

**Goal**: Sync confirmed learnings from seed.json → Tana as `#pai_learning` nodes.

1. **Create `src/pai/entity-linker.ts`** — Entity mention extraction and resolution:
   - `extractEntityMentions(content: string): string[]` — NLP-lite extraction: capitalized phrases, @-mentions, #-hashtags, quoted strings
   - `resolveEntityLinks(mentions: string[], options: { workspace?: string }): Promise<EntityLink[]>` — Uses `resolveEntity()` from F-100 with configurable threshold
   - Link resolution is best-effort: unresolved mentions are logged but don't block sync

2. **Create `src/pai/sync-service.ts`** — Core sync orchestrator:
   - `syncLearnings(options: PaiSyncOptions): Promise<PaiSyncResult>`
   - Steps:
     1. Load seed.json via `readSeedFile()`
     2. Load mapping via `loadMapping()`
     3. Determine entries to sync (incremental unless `--force`)
     4. For each entry:
        a. Check if already mapped → if so, skip (or update if content changed)
        b. Extract entity mentions → resolve via entity-linker
        c. Build node payload via `createNode()` / `node-builder`
        d. Post via `TanaBackend.createNodes()` (resolveBackend for write path)
        e. Record mapping: seedId → tanaNodeId
     5. Save updated mapping
     6. Return sync result summary

3. **Wire up `supertag pai sync` CLI command** in `src/commands/pai.ts`

**Design decisions**:
- **Write path**: Use `resolveBackend()` (from `src/api/backend-resolver.ts`) which prefers local-api and falls back to input-api. Both support `createNodes()`.
- **Node structure**: Learning content goes in the node name (truncated to ~100 chars) with full content as a child node. Fields (type, confidence, source, confirmedAt, seedEntryId) set via node builder's field system.
- **Entity links**: Set via instance fields (relatedPeople, relatedProjects) using the resolved Tana node IDs.
- **Deduplication**: Primary via mapping file. Secondary via `seedEntryId` field search if mapping is lost.
- **Batch processing**: Process entries sequentially (API rate limits) with progress output.

**Tests**:
- Unit: sync logic with mocked backend (create/update/skip scenarios)
- Unit: entity extraction (various content patterns)
- Integration: full sync cycle with fixture seed.json

### Phase 4: Context Retrieval

**Goal**: Graph-aware learning retrieval for pai-seed session hooks.

1. **Create `src/pai/context-service.ts`** — Context assembly for PAI learnings:
   - `getPaiContext(topic: string, options: PaiContextOptions): Promise<PaiContextResponse>`
   - Steps:
     1. Search for `#pai_learning` nodes matching topic (FTS via read backend)
     2. Use `assembleContext()` (F-098) for graph-enriched context around matched learnings
     3. Merge learning-specific data with graph context
     4. Apply token budgeting
     5. Return structured response

2. **Wire up `supertag pai context <topic>` CLI command** in `src/commands/pai.ts`

**Design decisions**:
- **Search strategy**: First search `#pai_learning` nodes by content (FTS), then use F-098 context assembler to expand graph context around matches.
- **Read path**: Uses `resolveReadBackend()` for search — local-api if Tana running, sqlite fallback.
- **Token budgeting**: Reuses existing `token-budgeter.ts` from F-098.

**Tests**: Unit tests with mocked read backend.

### Phase 5: Freshness Scoring

**Goal**: Graph-aware freshness that considers linked entity activity.

1. **Create `src/pai/freshness-service.ts`** — Contextual freshness scoring:
   - `assessFreshness(options: FreshnessOptions): Promise<FreshnessResult[]>`
   - Steps:
     1. Load all mapped learnings from mapping file
     2. For each mapped learning:
        a. Get the `#pai_learning` node from Tana
        b. Traverse to linked entities (relatedPeople, relatedProjects)
        c. Check `updated` timestamps on linked entities
        d. Calculate: `contextualFreshness = max(confirmedAt, max(linkedEntity.updated))`
        e. Compare against threshold
     3. For unmapped learnings: use confirmedAt only, status = 'unknown'

2. **Wire up `supertag pai freshness` CLI command** in `src/commands/pai.ts`

**Design decisions**:
- **Graph activity**: Uses node `updated` field from SQLite database (fastest) or Local API read backend.
- **Performance**: Batch-load all linked entity timestamps in one query rather than N+1.
- **Threshold**: Default 30 days, configurable via `--threshold`.

**Tests**: Unit tests with mock data (fresh/stale/unknown scenarios).

### Phase 6: MCP Tools

**Goal**: Expose all three operations as MCP tools.

1. **Create `src/mcp/tools/pai-sync.ts`** — `tana_pai_sync` tool
2. **Create `src/mcp/tools/pai-context.ts`** — `tana_pai_context` tool
3. **Create `src/mcp/tools/pai-freshness.ts`** — `tana_pai_freshness` tool
4. **Add Zod schemas** to `src/mcp/schemas.ts`
5. **Register tools** in MCP server tool list

Pattern: Each MCP tool calls the corresponding service, formats result with `handleMcpError()` wrapper.

**Tests**: MCP tool schema validation tests.

### Phase 7: Graceful Degradation and Polish

**Goal**: Ensure everything works without Tana, handle edge cases.

1. **Tana offline handling**:
   - Sync: detect unavailable backend, queue to retry file, warn user
   - Context: fall back to seed.json-only context (no graph enrichment)
   - Freshness: fall back to timestamp-only scoring

2. **Large seed.json pagination**:
   - Batch sync in groups of 20 entries
   - Progress bar via console output

3. **Schema auto-init**:
   - `supertag pai sync` checks if PAI supertags exist; runs schema init if not

4. **CLI help text and index.ts registration**:
   - Register `createPaiCommand()` in `src/index.ts`
   - Add help text examples

5. **pai-seed hook interface documentation**:
   - Document the expected hook calls for pai-seed to consume
   - `supertag pai context <topic> --format json` for session start hook
   - `supertag pai sync --seed-path <path>` for post-confirmation hook

## File Structure

```
src/
├── types/
│   └── pai.ts                          # All PAI type definitions
├── pai/                                # NEW: PAI integration module
│   ├── seed-reader.ts                  # Read and parse seed.json
│   ├── mapping.ts                      # ID mapping CRUD (pai-mapping.json)
│   ├── schema-init.ts                  # Create PAI supertags in Tana
│   ├── sync-service.ts                 # Core sync: seed.json → Tana
│   ├── entity-linker.ts               # Extract + resolve entity mentions
│   ├── context-service.ts             # Graph-aware context retrieval
│   └── freshness-service.ts           # Contextual freshness scoring
├── commands/
│   └── pai.ts                          # CLI: supertag pai {sync,context,freshness,schema}
├── mcp/
│   ├── schemas.ts                      # + PAI tool schemas (append)
│   └── tools/
│       ├── pai-sync.ts                 # tana_pai_sync MCP tool
│       ├── pai-context.ts              # tana_pai_context MCP tool
│       └── pai-freshness.ts            # tana_pai_freshness MCP tool
└── index.ts                            # + register createPaiCommand()

tests/
├── pai/                                # NEW: PAI test directory
│   ├── seed-reader.test.ts             # Seed file parsing tests
│   ├── mapping.test.ts                 # ID mapping CRUD tests
│   ├── schema-init.test.ts             # Schema creation tests
│   ├── sync-service.test.ts            # Sync logic tests
│   ├── entity-linker.test.ts           # Entity extraction/resolution tests
│   ├── context-service.test.ts         # Context retrieval tests
│   └── freshness-service.test.ts       # Freshness scoring tests
└── fixtures/
    └── pai/
        └── seed-fixture.json           # Test seed.json fixture
```

## Dependencies

### Internal Dependencies (Existing)

| Module | Used For | Import Path |
|--------|----------|-------------|
| Entity Resolution (F-100) | Linking mentions to Tana nodes | `src/db/entity-match.ts` → `resolveEntity()` |
| Context Assembler (F-098) | Graph-enriched retrieval | `src/services/context-assembler.ts` → `assembleContext()` |
| Read Backend (F-097) | Reading nodes and search | `src/api/read-backend-resolver.ts` → `resolveReadBackend()` |
| Write Backend (F-094) | Creating nodes in Tana | `src/api/backend-resolver.ts` → `resolveBackend()` |
| Node Builder | Shared node creation | `src/services/node-builder.ts` → `createNode()` |
| Local API Client | Tag creation, field setting | `src/api/local-api-client.ts` |
| Workspace Resolver | Workspace path resolution | `src/config/workspace-resolver.ts` → `resolveWorkspaceContext()` |
| Output Formatter | Universal format system | `src/utils/output-formatter.ts` |
| Structured Errors | Error handling | `src/utils/structured-errors.ts` |
| Schema Service | Tag field validation | `src/services/unified-schema-service.ts` |

### External Dependencies (Existing — No New Packages)

| Package | Used For |
|---------|----------|
| `commander` | CLI command framework |
| `zod` | Schema validation (MCP tools, seed.json parsing) |
| `bun:sqlite` | SQLite database access |
| `nanoid` | Already used in seed.json IDs |

### Runtime Dependencies

| Dependency | Required For | Degradation If Missing |
|------------|-------------|----------------------|
| Tana Desktop (Local API) | Schema init, real-time sync | Schema init fails with clear error; sync falls back to Input API |
| SQLite database | Freshness graph queries, context search | Falls back to Tana Local API for reads |
| `~/.pai/seed.json` | All sync operations | Clear error: "seed.json not found at <path>" |
| Tana workspace | All operations | Standard workspace resolution errors |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Tana Local API unavailable during sync | Medium | Medium | Write path falls back to Input API via `resolveBackend()`. Schema init requires Local API — document this. |
| seed.json format changes in pai-seed | High | Low | Zod schema with `.passthrough()` — unknown fields pass through silently. Only read known fields. |
| Entity resolution false positives | Medium | Medium | Use confidence threshold (default 0.7). Log but don't fail on ambiguous matches. User can review via `--dry-run`. |
| Large seed.json (1000+ entries) | Low | Low | Batch processing with progress output. Sequential API calls with rate limit respect. |
| Mapping file corruption/loss | Medium | Low | Secondary dedup via `seedEntryId` field search on `#pai_learning` nodes. Mapping rebuild command. |
| Schema init race condition (parallel runs) | Low | Low | Check-then-create with name search. Idempotent — creating existing tag is a no-op. |
| Input API doesn't return node IDs | High | Medium | Input API response includes nodeIds for created nodes. If missing, fall back to searching by seedEntryId after creation. |
| pai-seed hook integration requires pai-seed changes | Medium | Certain | Document the CLI interface clearly. pai-seed integration is a separate PR/codebase. This plan covers the supertag-cli side only. |

## Key Design Decisions

### 1. Separate `src/pai/` Module (Not Inline in Services)

PAI integration is a distinct domain with its own lifecycle (seed reader, mapping, sync). Keeping it in a dedicated `src/pai/` directory:
- Isolates complexity from existing services
- Makes it easy to test independently
- Clear ownership boundary

### 2. Node Name vs Content Field

Learning content goes in both the **node name** (truncated to first ~100 chars for scannability in Tana) and the **content field** (full text). This follows the Tana convention where node names are the primary display text.

### 3. Write via Backend Abstraction, Not Direct API

Using `resolveBackend()` (from F-094) rather than calling Local API directly for node creation. This gives automatic fallback to Input API if Local API is down, matching the project's architectural pattern.

Exception: Schema init (`createTag()`) requires Local API because Input API doesn't support tag definition creation.

### 4. Entity Linking is Best-Effort

Entity resolution (F-100) may not find matches for all mentions. This should never block sync. Unresolved mentions are logged at info level but the learning is created without those links.

### 5. pai-seed Integration is CLI-Based

The integration surface between pai-seed and supertag-cli is the CLI:
- Session start: `supertag pai context <topic> --format json`
- Post-confirmation: `supertag pai sync`

This avoids tight coupling between the two codebases. pai-seed calls supertag CLI as a subprocess.

### 6. Incremental Sync by Default

Default sync only processes entries with `confirmedAt` after `lastSync` from mapping file. `--force` re-processes all entries. This keeps sync fast for the common case.

[PHASE COMPLETE: PLAN]
