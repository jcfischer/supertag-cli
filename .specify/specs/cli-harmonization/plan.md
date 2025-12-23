---
feature: "CLI Harmonization"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: CLI Harmonization

## Architecture Overview

Restructure CLI commands from scattered verb-noun/noun-verb patterns to consistent `object action` pattern, and refactor webhook server from ad-hoc endpoints to RESTful structure. Core business logic in `TanaQueryEngine` and `TanaEmbeddingService` remains unchanged - only the command/endpoint layer is restructured.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Layer (NEW)                          │
├─────────────────────────────────────────────────────────────────┤
│  search.ts    nodes.ts    tags.ts    stats.ts                  │
│     │            │           │          │                       │
│     └────────────┴───────────┴──────────┘                       │
│                       │                                         │
├─────────────────────────────────────────────────────────────────┤
│                   Core Services (UNCHANGED)                     │
├─────────────────────────────────────────────────────────────────┤
│  TanaQueryEngine    TanaEmbeddingService    TanaIndexer        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Webhook Layer (REFACTORED)                   │
├─────────────────────────────────────────────────────────────────┤
│  /search     /nodes/:id    /tags    /stats                     │
│     │            │            │         │                       │
│     └────────────┴────────────┴─────────┘                       │
│                       │                                         │
├─────────────────────────────────────────────────────────────────┤
│                   Core Services (UNCHANGED)                     │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Existing codebase |
| Runtime | Bun | Existing codebase, PAI standard |
| CLI Framework | Commander.js | Already used, supports subcommands |
| HTTP Server | Fastify | Already used, supports route params |
| Testing | bun:test | Existing test suite |

## Constitutional Compliance

- [x] **CLI-First:** Primary interface remains CLI with new harmonized structure
- [x] **Library-First:** Core logic (`TanaQueryEngine`, `TanaEmbeddingService`) unchanged and reusable
- [x] **Test-First:** TDD for all new commands, update existing tests for removed commands
- [x] **Deterministic:** No probabilistic behavior, same inputs = same outputs
- [x] **Code Before Prompts:** All logic in TypeScript, no LLM prompts

## Data Model

No database schema changes required. The harmonization affects only the command/endpoint layer.

### Shared Types (New)

```typescript
// src/types.ts - Add standardized option types

/** Standard flag options shared across commands */
interface StandardOptions {
  workspace?: string;    // -w, --workspace
  limit?: number;        // -l, --limit (NOT -k)
  json?: boolean;        // --json (NOT --format json)
  show?: boolean;        // -s, --show
  depth?: number;        // -d, --depth
}

/** Search type for unified search */
type SearchType = 'fts' | 'semantic' | 'tagged';

/** Stats type for unified stats */
type StatsType = 'all' | 'db' | 'embed' | 'filter';
```

## API Contracts

### CLI Commands

```typescript
// New: supertag search
function searchCommand(
  query: string | undefined,
  options: StandardOptions & {
    semantic?: boolean;  // --semantic flag
    tag?: string;        // --tag <tagname>
  }
): Promise<void>

// New: supertag nodes show
function nodesShowCommand(
  nodeId: string,
  options: StandardOptions
): Promise<void>

// New: supertag nodes refs
function nodesRefsCommand(
  nodeId: string,
  options: StandardOptions
): Promise<void>

// New: supertag stats
function statsCommand(
  options: StandardOptions & {
    db?: boolean;      // --db
    embed?: boolean;   // --embed
    filter?: boolean;  // --filter
  }
): Promise<void>

// New: supertag tags list/top/show
function tagsListCommand(options: StandardOptions): Promise<void>
function tagsTopCommand(options: StandardOptions): Promise<void>
function tagsShowCommand(tagName: string, options: StandardOptions): Promise<void>
```

### Webhook Endpoints

```typescript
// POST /search - Unified search
interface SearchRequest {
  query?: string;           // FTS query text
  tag?: string;             // Supertag name (for type='tagged')
  type?: 'fts' | 'semantic' | 'tagged';  // Default: 'fts'
  show?: boolean;           // Include full node content
  depth?: number;           // Child traversal depth (with show)
  limit?: number;           // Result limit (default: 10)
  workspace?: string;       // Workspace alias
  format?: 'tana' | 'json'; // Response format (default: 'tana')
}

// GET /nodes/:id - Get single node
// Query params: depth, workspace, format

// GET /nodes/:id/refs - Get node references
// Query params: workspace, format

// GET /nodes/recent - Recent nodes
// Query params: limit, workspace, format

// POST /nodes/find - Find nodes by criteria
interface NodesFindRequest {
  pattern?: string;    // SQL LIKE pattern
  tag?: string;        // Filter by supertag
  limit?: number;
  workspace?: string;
  format?: 'tana' | 'json';
}

// GET /stats - Unified statistics
// Query params: type (all|db|embed|filter), workspace, format

// GET /tags - List all supertags
// Query params: limit, workspace, format

// GET /tags/top - Top supertags
// Query params: limit, workspace, format

// GET /tags/:name - Tag schema
// Query params: workspace, format
```

## Implementation Strategy

### Phase 1: Foundation (New Command Files)

Create new command files without removing old ones yet. This allows incremental testing.

- [ ] Create `src/commands/search.ts` - Unified search command
- [ ] Create `src/commands/nodes.ts` - Node operations command group
- [ ] Create `src/commands/tags.ts` - Tag operations command group
- [ ] Create `src/commands/stats.ts` - Unified stats command
- [ ] Add shared types to `src/types.ts`
- [ ] Create helper functions for common patterns (resolveDbPath, formatOutput)

### Phase 2: Wire New Commands

Register new commands in main entry point.

- [ ] Update `src/index.ts` to register new commands
- [ ] Add new commands alongside old ones temporarily
- [ ] Write tests for all new commands
- [ ] Verify new commands work correctly

### Phase 3: Refactor Webhook Server

Restructure webhook endpoints to match new CLI structure.

- [ ] Update `src/server/tana-webhook-server.ts`
- [ ] Add unified `/search` endpoint with type parameter
- [ ] Add RESTful `/nodes/:id`, `/nodes/:id/refs`, `/nodes/recent`, `/nodes/find`
- [ ] Add unified `/stats` endpoint with type parameter
- [ ] Add RESTful `/tags`, `/tags/top`, `/tags/:name`
- [ ] Update `/help` endpoint documentation
- [ ] Write tests for new endpoints

### Phase 4: Remove Old Commands (Breaking Change)

Remove deprecated commands and endpoints.

- [ ] Remove `registerQueryCommands` from `src/index.ts`
- [ ] Remove `registerShowCommands` from `src/index.ts`
- [ ] Delete `src/commands/query.ts`
- [ ] Delete `src/commands/show.ts`
- [ ] Remove old webhook endpoints
- [ ] Update all tests that reference old commands
- [ ] Update help text and examples

### Phase 5: Documentation

Update all documentation to reflect new structure.

- [ ] Update `README.md`
- [ ] Update demo scripts in `~/work/supertag-demos/`
- [ ] Update `SKILL.md` (if exists)
- [ ] Update inline help text in commands
- [ ] Update CHANGELOG.md

## File Structure

```
src/
├── commands/
│   ├── search.ts          # [NEW] Unified search (FTS, semantic, tagged)
│   ├── nodes.ts           # [NEW] nodes show|refs|recent
│   ├── tags.ts            # [NEW] tags list|top|show|search
│   ├── stats.ts           # [NEW] Unified stats (db, embed, filter)
│   ├── query.ts           # [DELETE] Old query commands
│   ├── show.ts            # [MODIFY] Keep helper functions, remove commands
│   ├── embed.ts           # [MODIFY] Remove embed search (moved to search.ts)
│   ├── schema.ts          # [MODIFY] Convert to Commander subcommands
│   └── ... (unchanged)
├── server/
│   └── tana-webhook-server.ts  # [MODIFY] New RESTful endpoints
├── types.ts               # [MODIFY] Add StandardOptions, SearchType
└── index.ts               # [MODIFY] Register new commands, remove old

tests/
├── commands/
│   ├── search.test.ts     # [NEW]
│   ├── nodes.test.ts      # [NEW]
│   ├── tags.test.ts       # [NEW]
│   └── stats.test.ts      # [NEW]
└── server/
    └── webhook.test.ts    # [MODIFY] Test new endpoints
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing scripts | High | High | Document all changes in CHANGELOG, bump major version |
| Test coverage gaps | Medium | Medium | Write tests before removing old commands |
| Webhook consumers break | Medium | Low | Only user, update immediately after |
| Missing functionality | High | Low | Verify all old features exist in new structure |
| Flag conflicts | Low | Low | Audit all commands for flag consistency |

## Dependencies

### External

- `commander` ^12.0.0 - CLI framework (existing)
- `fastify` ^5.0.0 - HTTP server (existing)
- `@fastify/cors` - CORS support (existing)

### Internal

- `TanaQueryEngine` - Core query logic (unchanged)
- `TanaEmbeddingService` - Embedding operations (unchanged)
- `ConfigManager` - Configuration management (unchanged)
- `TanaPasteConverter` - Output formatting (unchanged)

## Migration/Deployment

- [x] Database migrations needed? **No**
- [x] Environment variables? **No changes**
- [x] Breaking changes? **Yes - major version bump required**

### Breaking Change Checklist

1. All `query *` commands removed → use `search`, `nodes`, `tags`, `stats`
2. All `show *` commands removed → use `nodes show`, `search --show`
3. `embed search` moved → use `search --semantic`
4. `embed stats` moved → use `stats --embed`
5. `/semantic-search` endpoint removed → use `/search` with `type: "semantic"`
6. `/embed-stats` endpoint removed → use `/stats?type=embed`
7. `POST /tags` removed → use `GET /tags/top`
8. `POST /nodes` removed → use `POST /nodes/find`
9. `POST /refs` removed → use `GET /nodes/:id/refs`

## Estimated Complexity

- **New files:** 4 (search.ts, nodes.ts, tags.ts, stats.ts)
- **Modified files:** 6 (index.ts, show.ts, embed.ts, schema.ts, tana-webhook-server.ts, types.ts)
- **Deleted files:** 1 (query.ts)
- **Test files:** 4 new + 2 modified
- **Estimated tasks:** ~25-30

## Flag Normalization Reference

| Flag | Short | Used In | Notes |
|------|-------|---------|-------|
| `--limit` | `-l` | All list/search commands | Replace `-k` in embed |
| `--workspace` | `-w` | All commands | Already consistent |
| `--json` | (none) | All commands | Replace `--format json` |
| `--show` | `-s` | search, nodes | Show full content |
| `--depth` | `-d` | search --show, nodes show | Child traversal |
| `--semantic` | (none) | search | Switch to vector search |
| `--tag` | `-t` | search, embed generate | Filter by supertag |
| `--db` | (none) | stats | DB stats only |
| `--embed` | (none) | stats | Embedding stats only |
| `--filter` | (none) | stats | Filter breakdown |
