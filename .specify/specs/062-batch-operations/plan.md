---
feature: "Batch Operations"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Batch Operations

## Architecture Overview

Add batch operation capabilities to both MCP tools and CLI commands. Batch get reads multiple nodes from the local SQLite database in a single efficient query. Batch create posts multiple nodes to the Tana Input API with automatic chunking for rate limits.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Layer                                 │
│  supertag batch get id1 id2 --select name,tags                  │
│  supertag batch create --file nodes.json --dry-run              │
│  cat ids.txt | supertag batch get --stdin                       │
└────────────────────┬───────────────────────────────────────────┘
                     │
┌────────────────────▼───────────────────────────────────────────┐
│                     Batch Service                               │
│  src/services/batch-operations.ts                               │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ batchGetNodes│  │ batchCreateNodes │  │ chunkAndPost     │  │
│  │   (local DB) │  │   (Tana API)     │  │ (rate limit)     │  │
│  └──────────────┘  └──────────────────┘  └──────────────────┘  │
└────────────────────┬──────────────────────┬────────────────────┘
                     │                      │
     ┌───────────────▼──────┐    ┌──────────▼────────────┐
     │   SQLite Database    │    │   Tana Input API      │
     │   (local workspace)  │    │   (POST /nodes)       │
     └──────────────────────┘    └───────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        MCP Layer                                 │
│  tana_batch_get { nodeIds: [...], select: [...] }               │
│  tana_batch_create { nodes: [...], target: "INBOX" }            │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, fast execution |
| Database | SQLite (bun:sqlite) | Existing local index, efficient batch queries |
| CLI | Commander.js | Existing pattern for CLI commands |
| API Client | TanaApiClient | Existing Tana API integration |
| Validation | Zod | Existing schema validation pattern |
| Output | output-formatter | Existing format support (json/csv/table/ids) |

## Constitutional Compliance

- [x] **CLI-First:** `supertag batch get/create` commands with full format support
- [x] **Library-First:** Core logic in `src/services/batch-operations.ts`, reusable by CLI and MCP
- [x] **Test-First:** TDD for batch service, CLI commands, and MCP tools
- [x] **Deterministic:** Fixed ordering (input order preserved), no randomness
- [x] **Code Before Prompts:** All logic in TypeScript, no prompt-based behavior

## Data Model

### Request Types

```typescript
// Batch Get Request
interface BatchGetRequest {
  nodeIds: string[];           // Max 100 node IDs
  select?: string[];           // Field projection
  depth?: number;              // Child traversal depth (0-3)
  workspace?: string;          // Workspace alias
}

// Batch Get Response Item
interface BatchGetResult {
  id: string;
  node: NodeContents | null;   // null if node not found
  error?: string;              // Error message if lookup failed
}

// Batch Create Request
interface BatchCreateRequest {
  nodes: CreateNodeInput[];    // Max 50 nodes
  target?: string;             // Default target (INBOX)
  dryRun?: boolean;            // Validate only
  workspace?: string;          // Workspace alias
}

// Batch Create Response
interface BatchCreateResult {
  success: boolean;
  created: number;             // Count of successfully created nodes
  nodeIds: (string | null)[];  // Created IDs in input order
  errors: BatchError[];        // Any errors encountered
}

interface BatchError {
  index: number;               // Position in input array
  message: string;             // Error description
}
```

### No Database Schema Changes

Batch operations use existing tables:
- `nodes` - Node lookup by ID
- `tag_applications` - Supertag resolution
- `field_names` - Field name lookup

## API Contracts

### Internal APIs (Batch Service)

```typescript
// src/services/batch-operations.ts

/**
 * Fetch multiple nodes by ID from local database
 * @param dbPath - Path to workspace database
 * @param nodeIds - Array of node IDs to fetch
 * @param options - Depth, select projection
 * @returns Array of results in same order as input
 */
function batchGetNodes(
  dbPath: string,
  nodeIds: string[],
  options?: { depth?: number; select?: string[] }
): BatchGetResult[];

/**
 * Create multiple nodes via Tana API
 * @param nodes - Array of node definitions
 * @param options - Target, dryRun, workspace
 * @returns Creation result with node IDs
 */
async function batchCreateNodes(
  nodes: CreateNodeInput[],
  options?: { target?: string; dryRun?: boolean }
): Promise<BatchCreateResult>;
```

### MCP Tools

```typescript
// tana_batch_get
{
  nodeIds: string[];           // Required: 1-100 node IDs
  select?: string[];           // Optional: field projection
  depth?: number;              // Optional: 0-3
  workspace?: string;          // Optional: workspace alias
}

// tana_batch_create
{
  nodes: Array<{               // Required: 1-50 node definitions
    supertag: string;
    name: string;
    fields?: Record<string, string | string[]>;
    children?: ChildNode[];
  }>;
  target?: string;             // Optional: target node ID
  dryRun?: boolean;            // Optional: validate only
  workspace?: string;          // Optional: workspace alias
}
```

### CLI Commands

```bash
# Batch get - multiple IDs
supertag batch get <id1> [id2] [id3] [--select fields] [--depth n] [--format fmt]

# Batch get - from stdin
supertag batch get --stdin [--select fields] [--depth n] [--format fmt]

# Batch create - from file
supertag batch create --file nodes.json [--target NODE_ID] [--dry-run] [--format fmt]

# Batch create - from stdin (JSON array or JSON Lines)
supertag batch create --stdin [--target NODE_ID] [--dry-run] [--format fmt]
```

## Implementation Strategy

### Phase 1: Foundation

Core batch service with internal APIs.

- [ ] Create `src/services/batch-operations.ts` with types
- [ ] Implement `batchGetNodes()` with efficient SQL query
- [ ] Add input validation (max 100 nodes, ID format)
- [ ] Add error handling for missing nodes (return null, don't throw)
- [ ] Add tests for batch get service

### Phase 2: Batch Get

Complete batch get across CLI and MCP.

- [ ] Implement `tana_batch_get` MCP tool
- [ ] Add schema in `src/mcp/schemas.ts`
- [ ] Register tool in `src/mcp/tool-registry.ts`
- [ ] Create `supertag batch get` CLI command
- [ ] Support positional args and `--stdin` flag
- [ ] Add format output support (json/csv/table/ids/jsonl/minimal)
- [ ] Add select projection support
- [ ] Add tests for MCP and CLI

### Phase 3: Batch Create

Batch creation with Tana API integration.

- [ ] Implement `batchCreateNodes()` in batch service
- [ ] Add chunking for rate limits (10 nodes per request)
- [ ] Implement exponential backoff for 429 responses
- [ ] Add atomic mode (all or nothing via dry-run validation)
- [ ] Implement `tana_batch_create` MCP tool
- [ ] Create `supertag batch create` CLI command
- [ ] Support `--file` and `--stdin` input
- [ ] Add JSON array and JSON Lines detection
- [ ] Add `--dry-run` for validation
- [ ] Add tests for batch create

### Phase 4: Integration

Final integration and polish.

- [ ] Update tool registry with new batch tools
- [ ] Add to `tana_capabilities` response
- [ ] Add progress reporting for large batches
- [ ] Update documentation (README, SKILL.md)
- [ ] End-to-end integration tests

## File Structure

```
src/
├── services/
│   └── batch-operations.ts     # [New] Core batch logic
├── mcp/
│   ├── schemas.ts              # [Modified] Add batch schemas
│   ├── tool-registry.ts        # [Modified] Register batch tools
│   └── tools/
│       ├── batch-get.ts        # [New] tana_batch_get implementation
│       └── batch-create.ts     # [New] tana_batch_create implementation
├── commands/
│   └── batch.ts                # [New] CLI batch command group
└── index.ts                    # [Modified] Register batch commands

tests/
├── batch-operations.test.ts    # [New] Unit tests for batch service
├── batch-get.test.ts           # [New] Batch get tests
├── batch-create.test.ts        # [New] Batch create tests
└── batch-integration.test.ts   # [New] E2E integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Tana API doesn't support batch create | High | Medium | Simulate with sequential calls + chunking |
| Rate limit (429) during batch create | Medium | High | Exponential backoff, chunk size tuning |
| Large batch creates exceed payload limit | Medium | Medium | Validate payload size, chunk appropriately |
| Memory pressure with large batch get | Low | Low | Process nodes sequentially in SQL, streaming output |
| Inconsistent error states (partial create) | Medium | Medium | Atomic mode with dry-run validation first |

## Dependencies

### External

- None (uses existing dependencies: zod, commander)

### Internal

- `src/mcp/tools/node.ts` - Existing node fetching logic (reuse `getNodeContentsBasic`, `getNodeContentsWithDepth`)
- `src/services/node-builder.ts` - Existing node creation logic (reuse `createNode`, `buildNodePayload`)
- `src/api/client.ts` - Existing Tana API client (reuse `TanaApiClient.postNodes`)
- `src/config/workspace-resolver.ts` - Workspace resolution
- `src/utils/output-formatter.ts` - Format output support
- `src/utils/select-projection.ts` - Field projection

## Migration/Deployment

- [ ] **Database migrations needed?** No - uses existing schema
- [ ] **Environment variables?** No - uses existing config
- [ ] **Breaking changes?** No - new commands only

## Estimated Complexity

- **New files:** ~6 (batch service, 2 MCP tools, CLI command, 3 test files)
- **Modified files:** ~3 (schemas.ts, tool-registry.ts, index.ts)
- **Test files:** ~4
- **Estimated tasks:** ~16
