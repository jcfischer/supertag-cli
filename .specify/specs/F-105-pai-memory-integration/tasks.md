# Implementation Tasks: F-108 PAI Memory Integration

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | PAI type definitions |
| T-1.2 | ☐ | Seed.json reader |
| T-1.3 | ☐ | ID mapping CRUD |
| T-1.4 | ☐ | Test fixture |
| T-2.1 | ☐ | Schema initialization service |
| T-2.2 | ☐ | CLI command group + schema init subcommand |
| T-3.1 | ☐ | Entity linker |
| T-3.2 | ☐ | Sync service |
| T-3.3 | ☐ | CLI sync subcommand |
| T-4.1 | ☐ | Context service |
| T-4.2 | ☐ | CLI context subcommand |
| T-5.1 | ☐ | Freshness service |
| T-5.2 | ☐ | CLI freshness subcommand |
| T-6.1 | ☐ | MCP schemas |
| T-6.2 | ☐ | MCP tana_pai_sync tool |
| T-6.3 | ☐ | MCP tana_pai_context tool |
| T-6.4 | ☐ | MCP tana_pai_freshness tool |
| T-6.5 | ☐ | MCP tool registration |
| T-7.1 | ☐ | Graceful degradation |
| T-7.2 | ☐ | Auto-init and CLI registration |
| T-7.3 | ☐ | Documentation |

## Group 1: Foundation — Types, Reader, Mapping

### T-1.1: Define PAI type definitions [T]
- **File:** `src/types/pai.ts`
- **Test:** `tests/pai/types.test.ts`
- **Dependencies:** none
- **Description:**
  Define all PAI TypeScript interfaces and Zod schemas:
  - `PaiLearningEntry` — learning ready to sync (seedId, type, content, source, confirmedAt, tags)
  - `EntityLink` — resolved entity link (entityName, tanaNodeId, tagType, confidence)
  - `SyncEntryResult` — per-entry sync outcome (seedId, tanaNodeId, action, entityLinks, error)
  - `PaiSyncResult` — overall sync summary (total, created, updated, skipped, failed, entries, lastSync)
  - `FreshnessResult` — per-learning freshness (seedId, tanaNodeId, content, type, confirmedAt, graphActivity, contextualFreshness, status, daysSinceActive, linkedEntities)
  - `PaiContextResponse` — context for pai-seed hooks (learnings[], relatedNodes[], tokenCount)
  - `PaiMapping` — ID mapping file structure (version, workspace, lastSync, mappings, schema?)
  - `SeedFile`, `SeedEntry`, `SeedProposal` — Zod schemas for seed.json parsing (use `.passthrough()` for forwards-compat)
  - `PaiSyncOptions`, `PaiContextOptions`, `FreshnessOptions` — option types for services
  - Export learning type enum: `'pattern' | 'insight' | 'self_knowledge'`
- **Acceptance:**
  - All interfaces exported and importable
  - Zod schemas validate sample seed.json fixture
  - `.passthrough()` on SeedFile schema preserves unknown fields

### T-1.2: Seed.json reader [T] [P with T-1.3]
- **File:** `src/pai/seed-reader.ts`
- **Test:** `tests/pai/seed-reader.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Read and parse `~/.pai/seed.json` with Zod validation:
  - `readSeedFile(path?: string): SeedFile` — reads file, validates with Zod, defaults to `~/.pai/seed.json`
  - `getConfirmedLearnings(seed: SeedFile): PaiLearningEntry[]` — extracts all entries from `seed.learned.patterns`, `seed.learned.insights`, `seed.learned.selfKnowledge` with correct type labels
  - `getNewLearningsSince(seed: SeedFile, lastSync: string): PaiLearningEntry[]` — filters to entries with `confirmedAt > lastSync`
  - Error handling: `StructuredError` with code `CONFIG_NOT_FOUND` if seed.json missing
- **Acceptance:**
  - Parses valid seed.json fixture correctly
  - Returns empty arrays for empty/missing categories
  - Throws structured error for missing file
  - Throws structured error for invalid JSON
  - Incremental filter works with ISO date comparison
  - Unknown fields in seed.json are preserved (passthrough)

### T-1.3: ID mapping CRUD [T] [P with T-1.2]
- **File:** `src/pai/mapping.ts`
- **Test:** `tests/pai/mapping.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  ID mapping persistence at `~/.config/supertag/pai-mapping.json`:
  - `loadMapping(workspace?: string): PaiMapping` — load from disk, or return empty mapping if not found
  - `saveMapping(mapping: PaiMapping): void` — write to disk (create parent dirs if needed)
  - `getMappedNodeId(mapping: PaiMapping, seedId: string): string | undefined`
  - `setMappedNodeId(mapping: PaiMapping, seedId: string, tanaNodeId: string): void` — mutates mapping in-place
  - `getUnmappedEntries(entries: PaiLearningEntry[], mapping: PaiMapping): PaiLearningEntry[]` — filter to entries not in mapping
  - `getMappingPath(): string` — returns config path
  - Use `~/.config/supertag/` directory (project config pattern)
- **Acceptance:**
  - Creates empty mapping when file doesn't exist
  - Round-trip: save then load returns same data
  - `getUnmappedEntries` correctly filters out already-mapped entries
  - `setMappedNodeId` updates mapping in place
  - Creates parent directories if missing

### T-1.4: Test fixture [P with T-1.2, T-1.3]
- **File:** `tests/fixtures/pai/seed-fixture.json`
- **Test:** (used by other tests)
- **Dependencies:** T-1.1
- **Description:**
  Create a realistic seed.json test fixture with:
  - 3 patterns (one mentioning "Jens-Christian", one mentioning "CTF Platform" project)
  - 2 insights (one mentioning both a person and project)
  - 1 self_knowledge entry
  - 2 proposals (one pending, one accepted)
  - Valid identity section
  - All entries have unique nanoid-style IDs, ISO dates, source labels
  - Mix of entries with and without tags
- **Acceptance:**
  - Validates against SeedFile Zod schema from T-1.1
  - Contains enough variety for sync, entity linking, and freshness tests

## Group 2: Schema Initialization

### T-2.1: Schema initialization service [T]
- **File:** `src/pai/schema-init.ts`
- **Test:** `tests/pai/schema-init.test.ts`
- **Dependencies:** T-1.1, T-1.3
- **Description:**
  Create `#pai_learning` and `#pai_proposal` supertags in Tana via Local API:
  - `initPaiSchema(options: { workspace?: string; dryRun?: boolean }): Promise<SchemaInitResult>`
  - Uses Tana Local MCP tools: `mcp.createTag()` for tag creation, `mcp.addFieldToTag()` for fields
  - `#pai_learning` fields: type (options: pattern/insight/self_knowledge), content (plain), confidence (number), source (plain), confirmedAt (date), seedEntryId (plain), relatedPeople (instance→#person, multi), relatedProjects (instance→#project, multi)
  - `#pai_proposal` fields: status (options: pending/accepted/rejected), confidence (number), extractedFrom (plain), decidedAt (date), content (plain)
  - Idempotent: search for existing tags by name before creating
  - Store created tag/field IDs in mapping file under `schema` key
  - Requires Local API (Tana Desktop running) — fail with clear error if unavailable
  - `SchemaInitResult`: `{ created: string[]; existing: string[]; tagIds: Record<string, string>; fieldIds: Record<string, Record<string, string>> }`
- **Acceptance:**
  - Creates both supertags with all fields (mocked Local API)
  - Skips creation if tags already exist (idempotent)
  - Stores tag IDs and field IDs in mapping
  - Dry-run mode returns what would be created without calling API
  - Throws structured error if Local API unavailable

### T-2.2: CLI command group + schema init subcommand [T]
- **File:** `src/commands/pai.ts`
- **Test:** `tests/commands/pai.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  Create `supertag pai` command group with `schema init` subcommand:
  - `createPaiCommand(): Command` factory function
  - `pai` parent command with description and subcommands
  - `pai schema init` subcommand:
    - Options: `--workspace <alias>`, `--dry-run`
    - Calls `initPaiSchema()` from T-2.1
    - Outputs results using universal format system (table by default)
    - Error handling via `StructuredError`
  - Follow pattern from `src/commands/gquery.ts`: factory function, `addStandardOptions()`, async action handler
  - Do NOT register in `src/index.ts` yet (deferred to T-7.2)
- **Acceptance:**
  - `createPaiCommand()` returns valid Commander `Command`
  - `pai schema init` calls initPaiSchema and displays results
  - `--dry-run` flag works
  - `--workspace` flag is respected
  - Error messages are user-friendly

## Group 3: Sync Engine (Core)

### T-3.1: Entity linker [T] [P with T-3.2 partially]
- **File:** `src/pai/entity-linker.ts`
- **Test:** `tests/pai/entity-linker.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Extract entity mentions from learning content and resolve to Tana nodes:
  - `extractEntityMentions(content: string): string[]` — NLP-lite extraction:
    - Capitalized multi-word phrases (e.g., "Jens-Christian Fischer")
    - @-mentions (e.g., "@simon")
    - #-hashtags (e.g., "#CTFPlatform")
    - Quoted strings (e.g., `"Project Alpha"`)
    - Deduplicate results
  - `resolveEntityLinks(mentions: string[], options: { workspace?: string; threshold?: number }): Promise<EntityLink[]>`
    - Uses `resolveEntity()` from `src/db/entity-match.ts` (F-100) for each mention
    - Configurable confidence threshold (default: 0.7)
    - Returns only matches above threshold
    - Best-effort: unresolved mentions logged at info level, not errors
    - Classifies matched nodes by tag type (person, project, etc.)
- **Acceptance:**
  - Extracts "Jens-Christian Fischer" from "Jens-Christian Fischer prefers German"
  - Extracts quoted strings: `"CTF Platform"` → `CTF Platform`
  - Deduplicates mentions
  - Resolves mentions against mocked entity resolution
  - Filters by confidence threshold
  - Returns empty array when no matches (no errors)
  - Handles content with no entity mentions gracefully

### T-3.2: Sync service [T]
- **File:** `src/pai/sync-service.ts`
- **Test:** `tests/pai/sync-service.test.ts`
- **Dependencies:** T-1.1, T-1.2, T-1.3, T-2.1, T-3.1
- **Description:**
  Core sync orchestrator: seed.json → Tana `#pai_learning` nodes:
  - `syncLearnings(options: PaiSyncOptions): Promise<PaiSyncResult>`
  - Sync steps:
    1. Read seed.json via `readSeedFile()` (T-1.2)
    2. Load mapping via `loadMapping()` (T-1.3)
    3. Determine entries to sync: incremental (default) or all (`--force`)
    4. Check if PAI supertags exist in mapping.schema; auto-init if missing
    5. For each entry:
       a. Check mapping — if already mapped AND content unchanged → skip
       b. Check mapping — if mapped AND content changed → update (set fields)
       c. Extract entity mentions via `extractEntityMentions()` (T-3.1)
       d. Resolve entity links via `resolveEntityLinks()` (T-3.1)
       e. Build node: name = content truncated to ~100 chars, full content as `content` field
       f. Set fields: type, confidence (default 5), source, confirmedAt, seedEntryId
       g. Set instance fields: relatedPeople, relatedProjects (from resolved entity links)
       h. Create/update via `resolveBackend()` write path (from `src/api/backend-resolver.ts`)
       i. Record mapping: seedId → tanaNodeId
    6. Handle deleted entries: seed IDs in mapping but not in seed.json → optionally trash
    7. Save updated mapping with new lastSync timestamp
    8. Return PaiSyncResult summary
  - `--dry-run`: execute steps 1-4 and entity resolution, but skip node creation
  - Sequential processing (API rate limits), with progress output
  - Batch in groups of 20 for large seed files (>100 entries)
- **Acceptance:**
  - Creates new nodes for unmapped entries (mocked backend)
  - Skips already-mapped entries in incremental mode
  - Updates nodes when content has changed
  - Entity links are attached as instance fields
  - Mapping is updated with new entries after sync
  - `--force` re-syncs all entries
  - `--dry-run` creates no nodes, returns preview
  - Handles empty seed.json gracefully
  - Returns accurate summary counts

### T-3.3: CLI sync subcommand [T]
- **File:** `src/commands/pai.ts` (extend)
- **Test:** `tests/commands/pai-sync.test.ts`
- **Dependencies:** T-2.2, T-3.2
- **Description:**
  Add `pai sync` subcommand to existing CLI command group:
  - Options: `--seed-path <path>`, `--workspace <alias>`, `--dry-run`, `--force`, `--format <type>`
  - Calls `syncLearnings()` from T-3.2
  - Table output: Type | Content (truncated) | Action | Entity Links
  - Summary line: "12 synced (8 created, 2 updated, 2 skipped), 0 failed"
  - Supports all universal format options (table, json, csv, jsonl, ids, minimal)
  - Error handling via `StructuredError`
- **Acceptance:**
  - `pai sync` calls syncLearnings and displays formatted results
  - `--dry-run` shows preview without creating nodes
  - `--force` triggers full re-sync
  - `--seed-path` overrides default path
  - `--format json` returns structured JSON output
  - Error for missing seed.json is user-friendly

## Group 4: Context Retrieval

### T-4.1: Context service [T]
- **File:** `src/pai/context-service.ts`
- **Test:** `tests/pai/context-service.test.ts`
- **Dependencies:** T-1.1, T-1.3
- **Description:**
  Graph-aware learning retrieval for pai-seed session hooks:
  - `getPaiContext(topic: string, options: PaiContextOptions): Promise<PaiContextResponse>`
  - Steps:
    1. Search `#pai_learning` nodes matching topic via read backend FTS (`resolveReadBackend()`)
    2. Optionally filter by type (pattern/insight/self_knowledge)
    3. For matched learnings, use `assembleContext()` (F-098) to expand graph context
    4. Gather related Tana nodes (people, projects, meetings linked to matched learnings)
    5. Apply token budgeting (default 2000 tokens) using existing `token-budgeter.ts`
    6. Calculate freshness status for each returned learning
    7. Return structured PaiContextResponse
  - Fallback: if read backend unavailable, return learnings from seed.json only (via seed-reader)
- **Acceptance:**
  - Returns learnings matching topic (mocked read backend)
  - Includes linked entity names in response
  - Respects token budget
  - Type filter works correctly
  - Returns relatedNodes from graph traversal
  - Falls back to seed.json-only when backend unavailable
  - Empty topic returns recent learnings

### T-4.2: CLI context subcommand [T]
- **File:** `src/commands/pai.ts` (extend)
- **Test:** `tests/commands/pai-context.test.ts`
- **Dependencies:** T-2.2, T-4.1
- **Description:**
  Add `pai context <topic>` subcommand:
  - Arguments: `<topic>` (required)
  - Options: `--max-tokens <n>` (default 2000), `--type <type>`, `--workspace <alias>`, `--format <type>` (default markdown)
  - Markdown output format:
    ```
    ## PAI Context: "deployment"
    ### Learnings (3 results)
    - [pattern] The deploy.yml playbook could optionally trigger...
      Linked to: #project:CTF Platform
      Freshness: fresh (project active 2d ago)
    ### Related Tana Context
    - #project CTF Platform (last modified: 2026-02-25)
    ```
  - JSON format: returns raw PaiContextResponse
  - This is the primary interface for pai-seed session start hook
- **Acceptance:**
  - `pai context "deployment"` returns relevant learnings
  - Markdown output is well-formatted and readable
  - `--format json` returns structured PaiContextResponse
  - `--type pattern` filters correctly
  - `--max-tokens` limits output size

## Group 5: Freshness Scoring

### T-5.1: Freshness service [T]
- **File:** `src/pai/freshness-service.ts`
- **Test:** `tests/pai/freshness-service.test.ts`
- **Dependencies:** T-1.1, T-1.3
- **Description:**
  Contextual freshness scoring using graph activity:
  - `assessFreshness(options: FreshnessOptions): Promise<FreshnessResult[]>`
  - Steps:
    1. Load mapping to get all synced learnings (seedId → tanaNodeId)
    2. For each mapped learning:
       a. Read `#pai_learning` node via read backend
       b. Traverse to linked entities (relatedPeople, relatedProjects instance fields)
       c. Get `updated`/`modified` timestamps from linked entity nodes
       d. Calculate: `contextualFreshness = max(confirmedAt, max(linkedEntity.updated))`
       e. Calculate `daysSinceActive` from contextualFreshness
       f. Compare against threshold → status: 'fresh' | 'stale'
    3. For unmapped learnings: use `confirmedAt` only, status = 'unknown'
    4. Optionally filter by type
  - Performance: batch-load entity timestamps in one query (not N+1)
  - Target: < 500ms for typical workload (NFR-5)
- **Acceptance:**
  - Learning linked to recently-active project → 'fresh'
  - Learning with old confirmedAt but active linked entity → 'fresh' (graph-aware)
  - Learning with no links → uses confirmedAt only
  - Unmapped learning → status 'unknown'
  - Threshold parameter works correctly
  - Type filter works
  - Batch entity loading (not N+1 queries)

### T-5.2: CLI freshness subcommand [T]
- **File:** `src/commands/pai.ts` (extend)
- **Test:** `tests/commands/pai-freshness.test.ts`
- **Dependencies:** T-2.2, T-5.1
- **Description:**
  Add `pai freshness` subcommand:
  - Options: `--threshold <days>` (default 30), `--type <type>`, `--workspace <alias>`, `--format <type>`
  - Table output: Status | Type | Content | Confirmed | Graph Activity | Days
  - Summary line: "15 fresh, 3 stale, 2 unknown (no Tana link)"
  - Supports all universal format options
- **Acceptance:**
  - `pai freshness` displays freshness table
  - `--threshold 7` uses 7-day window
  - `--type insight` filters to insights only
  - `--format json` returns structured array
  - Summary line shows correct counts

## Group 6: MCP Tools

### T-6.1: MCP PAI schemas [T] [P with T-6.2, T-6.3, T-6.4]
- **File:** `src/mcp/schemas.ts` (extend)
- **Test:** `tests/pai/mcp-schemas.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Add Zod schemas for PAI MCP tools to existing schemas file:
  - `paiSyncSchema`: seedPath (string, optional), workspace, dryRun (boolean, default false), force (boolean, default false)
  - `paiContextSchema`: topic (string, min 1), maxTokens (number, default 2000), type (enum, optional), workspace
  - `paiFresnessSchema`: threshold (number, default 30), type (enum, optional), workspace
  - Export corresponding input types: `PaiSyncInput`, `PaiContextInput`, `PaiFreshnessInput`
  - Use existing `workspaceSchema` for workspace field
  - Add descriptions for AI documentation
- **Acceptance:**
  - Schemas validate valid inputs
  - Schemas reject invalid inputs (e.g., empty topic)
  - Defaults work correctly
  - Types are exported

### T-6.2: MCP tana_pai_sync tool [T]
- **File:** `src/mcp/tools/pai-sync.ts`
- **Test:** `tests/pai/mcp-pai-sync.test.ts`
- **Dependencies:** T-3.2, T-6.1
- **Description:**
  MCP tool wrapping sync service:
  - `export async function paiSync(input: PaiSyncInput)`
  - Calls `syncLearnings()` from T-3.2
  - Returns `PaiSyncResult` as JSON in MCP response format
  - Error handling via `handleMcpError()`
  - Follow pattern from `src/mcp/tools/graph-query.ts`
- **Acceptance:**
  - Returns structured sync result
  - Errors wrapped via handleMcpError
  - dryRun parameter works

### T-6.3: MCP tana_pai_context tool [T] [P with T-6.2]
- **File:** `src/mcp/tools/pai-context.ts`
- **Test:** `tests/pai/mcp-pai-context.test.ts`
- **Dependencies:** T-4.1, T-6.1
- **Description:**
  MCP tool wrapping context service:
  - `export async function paiContext(input: PaiContextInput)`
  - Calls `getPaiContext()` from T-4.1
  - Returns `PaiContextResponse` as JSON in MCP response format
  - Error handling via `handleMcpError()`
- **Acceptance:**
  - Returns structured context response
  - Topic parameter required
  - maxTokens parameter works

### T-6.4: MCP tana_pai_freshness tool [T] [P with T-6.2, T-6.3]
- **File:** `src/mcp/tools/pai-freshness.ts`
- **Test:** `tests/pai/mcp-pai-freshness.test.ts`
- **Dependencies:** T-5.1, T-6.1
- **Description:**
  MCP tool wrapping freshness service:
  - `export async function paiFreshness(input: PaiFreshnessInput)`
  - Calls `assessFreshness()` from T-5.1
  - Returns `FreshnessResult[]` as JSON in MCP response format
  - Error handling via `handleMcpError()`
- **Acceptance:**
  - Returns structured freshness results
  - threshold parameter works
  - Type filter works

### T-6.5: MCP tool registration [T]
- **File:** `src/mcp/index.ts` (extend)
- **Test:** (covered by existing MCP server tests)
- **Dependencies:** T-6.2, T-6.3, T-6.4
- **Description:**
  Register all three PAI MCP tools in MCP server:
  - Import `paiSync`, `paiContext`, `paiFreshness` from tool files
  - Import schemas from `schemas.ts`
  - Register `tana_pai_sync`, `tana_pai_context`, `tana_pai_freshness` in tool list
  - Add tool descriptions for AI discoverability
  - Register in tool registry for progressive disclosure (category: "pai" or "memory")
- **Acceptance:**
  - All three tools appear in MCP tool list
  - Tool descriptions are clear and actionable
  - Tools are callable via MCP protocol

## Group 7: Polish and Integration

### T-7.1: Graceful degradation [T]
- **File:** `src/pai/sync-service.ts` (extend), `src/pai/context-service.ts` (extend), `src/pai/freshness-service.ts` (extend)
- **Test:** `tests/pai/degradation.test.ts`
- **Dependencies:** T-3.2, T-4.1, T-5.1
- **Description:**
  Ensure all PAI operations work without Tana:
  - **Sync**: detect unavailable backend → return error with suggestion to start Tana Desktop
  - **Context**: detect unavailable backend → fall back to seed.json-only context (no graph enrichment), return learnings from seed-reader with freshness='unknown'
  - **Freshness**: detect unavailable backend → fall back to timestamp-only scoring (confirmedAt), all entries status='unknown' for graph freshness
  - **Schema init**: requires Local API → clear error message "Tana Desktop must be running"
  - All degradation paths logged at warn level
  - NFR-3: pai-seed continues standalone without Tana
- **Acceptance:**
  - Context returns results when Tana is offline (from seed.json)
  - Freshness returns timestamp-only results when Tana is offline
  - Sync returns clear error when Tana is offline
  - Schema init returns clear error when Tana is offline
  - No unhandled exceptions in any degradation path

### T-7.2: Auto-init and CLI registration
- **File:** `src/index.ts` (extend), `src/pai/sync-service.ts` (extend)
- **Test:** (covered by T-3.2 tests)
- **Dependencies:** T-2.2, T-3.3, T-4.2, T-5.2
- **Description:**
  Final wiring:
  - Register `createPaiCommand()` in `src/index.ts` command list
  - Add `pai` to CLI help text
  - Auto-init: `syncLearnings()` checks if PAI supertags exist in mapping; runs `initPaiSchema()` automatically if not (with user-visible message)
  - Ensure `supertag pai --help` shows all subcommands
- **Acceptance:**
  - `supertag pai` shows help with all subcommands
  - `supertag pai sync` auto-creates supertags if they don't exist
  - `supertag --help` includes pai command in list

### T-7.3: Hook interface documentation
- **File:** `src/pai/README.md`
- **Test:** none
- **Dependencies:** T-3.3, T-4.2
- **Description:**
  Document the pai-seed integration interface:
  - Session start hook: `supertag pai context <topic> --format json --max-tokens 2000`
  - Post-confirmation hook: `supertag pai sync --seed-path ~/.pai/seed.json`
  - Expected JSON response formats for each
  - Error response format
  - Configuration requirements (workspace setup, seed.json path)
  - Graceful degradation behavior
  - This is consumed by pai-seed developers (internal doc, not customer-facing)
- **Acceptance:**
  - Documents all CLI commands pai-seed should call
  - Includes example JSON responses
  - Describes error handling expectations

## Execution Order

```
Phase 1 (Foundation):
  T-1.1 ──────────────────────────┐
  T-1.4 (fixture, parallel) ──────┤
                                   ├── T-1.2 ─┐
                                   └── T-1.3 ─┤ (parallel)
                                               │
Phase 2 (Schema):                              │
  T-2.1 ◄─────────────────────────────────────┘
  T-2.2 ◄── T-2.1

Phase 3 (Sync):
  T-3.1 ◄── T-1.1 (can start in parallel with Phase 2)
  T-3.2 ◄── T-1.2, T-1.3, T-2.1, T-3.1
  T-3.3 ◄── T-2.2, T-3.2

Phase 4 (Context):
  T-4.1 ◄── T-1.1, T-1.3
  T-4.2 ◄── T-2.2, T-4.1

Phase 5 (Freshness):
  T-5.1 ◄── T-1.1, T-1.3
  T-5.2 ◄── T-2.2, T-5.1

Phase 6 (MCP):
  T-6.1 ◄── T-1.1 (can start early)
  T-6.2 ◄── T-3.2, T-6.1
  T-6.3 ◄── T-4.1, T-6.1 (parallel with T-6.2)
  T-6.4 ◄── T-5.1, T-6.1 (parallel with T-6.2, T-6.3)
  T-6.5 ◄── T-6.2, T-6.3, T-6.4

Phase 7 (Polish):
  T-7.1 ◄── T-3.2, T-4.1, T-5.1
  T-7.2 ◄── T-2.2, T-3.3, T-4.2, T-5.2
  T-7.3 ◄── T-3.3, T-4.2
```

**Critical path:** T-1.1 → T-1.2 → T-3.2 → T-3.3 → T-7.2

**Maximum parallelism opportunities:**
- T-1.2 ∥ T-1.3 ∥ T-1.4 (after T-1.1)
- T-3.1 ∥ Phase 2 (independent)
- T-4.1 ∥ T-5.1 ∥ T-3.1 (after foundation)
- T-6.2 ∥ T-6.3 ∥ T-6.4 (after respective services + T-6.1)
- T-7.1 ∥ T-7.3 (after services)

[PHASE COMPLETE: TASKS]
