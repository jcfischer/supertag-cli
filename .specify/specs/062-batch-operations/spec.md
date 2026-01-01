---
id: "062"
feature: "Batch Operations"
status: "draft"
created: "2026-01-01"
---

# Specification: Batch Operations

## Overview

Add batch operation tools and commands that allow multiple nodes to be fetched or created in a single call. This replaces N sequential API calls with one batch call, reducing latency and improving efficiency for both AI agents and CLI users.

## User Scenarios

### Scenario 1: Batch Node Retrieval

**As an** AI agent that found multiple node IDs
**I want to** fetch all their details in one call
**So that** I avoid N sequential `tana_node` calls

**Acceptance Criteria:**
- [ ] `tana_batch_get` accepts array of node IDs
- [ ] Returns array of node contents in same order
- [ ] Missing nodes return null in their position (don't fail whole batch)
- [ ] Supports `select` parameter to reduce response size

### Scenario 2: CLI Batch Fetch with Piping

**As a** CLI user
**I want to** pipe node IDs to a batch command
**So that** I can efficiently get details for search results

**Acceptance Criteria:**
- [ ] `supertag batch get id1 id2 id3` fetches multiple nodes
- [ ] `supertag search "x" --format ids | xargs supertag batch get` works
- [ ] `supertag batch get --stdin` reads IDs from stdin (one per line)
- [ ] Output format options work (--format json/table/csv)

### Scenario 3: Batch Node Creation

**As a** user importing data
**I want to** create multiple nodes in one operation
**So that** I can bulk-import data efficiently

**Acceptance Criteria:**
- [ ] `tana_batch_create` accepts array of node definitions
- [ ] All nodes created atomically (all succeed or all fail)
- [ ] Returns array of created node IDs
- [ ] Supports common supertag for all nodes

### Scenario 4: Batch Create from File

**As a** CLI user with a JSON file
**I want to** create nodes from file content
**So that** I can import prepared data

**Acceptance Criteria:**
- [ ] `supertag batch create --file nodes.json` reads from file
- [ ] `cat nodes.json | supertag batch create --stdin` reads from pipe
- [ ] JSON structure: `[{supertag, name, fields?, children?}, ...]`
- [ ] Dry-run mode validates without creating

## Functional Requirements

### FR-1: Batch Get API

MCP tool and CLI command for fetching multiple nodes:

```typescript
// MCP
tana_batch_get({
  nodeIds: ["id1", "id2", "id3"],
  select: ["name", "tags", "fields"],  // optional
  depth: 1  // optional, child traversal
})

// CLI
supertag batch get id1 id2 id3 --select name,tags
```

**Validation:**
- Returns array matching input order
- Non-existent IDs return `null` in their position
- Maximum 100 nodes per batch

### FR-2: Batch Create API

MCP tool and CLI command for creating multiple nodes:

```typescript
// MCP
tana_batch_create({
  nodes: [
    { supertag: "task", name: "Task 1", fields: { Status: "Open" } },
    { supertag: "task", name: "Task 2", fields: { Status: "Open" } }
  ],
  target: "INBOX"  // optional, default destination
})

// CLI
supertag batch create --file tasks.json --target INBOX
```

**Validation:**
- All nodes created with same target if specified
- Returns array of created node IDs
- Atomic: all succeed or all fail (transaction)

### FR-3: Stdin Support for CLI

CLI commands accept input from stdin:

**Validation:**
- `--stdin` flag reads from stdin
- For `batch get`: one ID per line
- For `batch create`: JSON array or JSON Lines
- Detects JSON array vs JSON Lines automatically

### FR-4: Error Handling

Batch operations handle partial failures gracefully:

**Validation:**
- `batch get`: null for missing nodes, don't fail whole batch
- `batch create`: atomic - fail all if any fails
- Error messages include which item failed and why
- `--continue-on-error` flag for non-atomic batch create (future)

### FR-5: Rate Limiting

Respect Tana API rate limits for batch create:

**Validation:**
- Batch create chunks requests if > 10 nodes
- Implements exponential backoff on 429 responses
- Reports progress for large batches

## Non-Functional Requirements

- **Performance:** Batch get 10 nodes faster than 10 sequential gets
- **Limits:** Maximum 100 nodes per batch get, 50 per batch create
- **Atomicity:** Batch create is transactional (all or nothing)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| BatchGetRequest | Request for multiple nodes | `nodeIds[]`, `select?`, `depth?` |
| BatchGetResponse | Array of node contents | `results[]` (nullable items) |
| BatchCreateRequest | Request to create nodes | `nodes[]`, `target?`, `dryRun?` |
| BatchCreateResponse | Created node IDs | `ids[]`, `success: boolean` |

## Success Criteria

- [ ] `tana_batch_get` fetches 10 nodes faster than 10 sequential calls
- [ ] `tana_batch_create` creates 10 nodes in single API transaction
- [ ] CLI supports both positional args and stdin for IDs
- [ ] Missing nodes don't fail batch get (return null)
- [ ] Dry-run works for batch create validation

## Assumptions

- Tana Input API supports batch operations or we simulate with sequential calls
- Node IDs are valid format (no validation against workspace)
- Users have appropriate permissions for all nodes in batch

## Out of Scope

- Batch update (modifying existing nodes)
- Batch delete
- Batch move (reparenting nodes)
- Cross-workspace batch operations
- Async/background batch processing
