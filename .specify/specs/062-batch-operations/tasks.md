---
feature: "Batch Operations"
plan: "./plan.md"
status: "pending"
total_tasks: 16
completed: 0
---

# Tasks: Batch Operations

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation

- [ ] **T-1.1** Create batch operations types and service skeleton [T]
  - File: `src/services/batch-operations.ts`
  - Test: `tests/batch-operations.test.ts`
  - Description: Define `BatchGetRequest`, `BatchGetResult`, `BatchCreateRequest`, `BatchCreateResult`, `BatchError` interfaces. Create service skeleton with function signatures.

- [ ] **T-1.2** Implement batchGetNodes with efficient SQL [T] (depends: T-1.1)
  - File: `src/services/batch-operations.ts`
  - Test: `tests/batch-operations.test.ts`
  - Description: Fetch multiple nodes by ID using single SQL query with `WHERE id IN (...)`. Return results in input order. Handle missing nodes (return null). Support depth traversal.

- [ ] **T-1.3** Add batch get validation [T] (depends: T-1.1)
  - File: `src/services/batch-operations.ts`
  - Test: `tests/batch-operations.test.ts`
  - Description: Validate max 100 node IDs, validate ID format, validate depth 0-3. Throw `StructuredError` on validation failure.

### Group 2: Batch Get (MCP + CLI)

- [ ] **T-2.1** Add batch get MCP schema [T] [P]
  - File: `src/mcp/schemas.ts`
  - Test: `src/mcp/tools/__tests__/batch-get.test.ts`
  - Description: Create `batchGetSchema` with Zod: `nodeIds` (string array, 1-100), `select`, `depth` (0-3), `workspace`. Export `BatchGetInput` type.

- [ ] **T-2.2** Implement tana_batch_get MCP tool [T] (depends: T-1.2, T-2.1)
  - File: `src/mcp/tools/batch-get.ts`
  - Test: `src/mcp/tools/__tests__/batch-get.test.ts`
  - Description: Implement MCP handler using `batchGetNodes()`. Apply select projection. Return array of node contents or nulls. Handle workspace resolution.

- [ ] **T-2.3** Register tana_batch_get in tool registry [T] (depends: T-2.2)
  - File: `src/mcp/tool-registry.ts`
  - Test: `src/mcp/tools/__tests__/batch-get.test.ts`
  - Description: Add `tana_batch_get` to `TOOL_METADATA` (category: query). Add schema to `TOOL_SCHEMAS`. Update `tana_capabilities` response.

- [ ] **T-2.4** Create batch CLI command group [T] [P]
  - File: `src/commands/batch.ts`
  - Test: `tests/batch-cli.test.ts`
  - Description: Create `batch` command group with Commander.js. Add `batch get <ids...>` subcommand with `--stdin`, `--select`, `--depth`, `--format` options.

- [ ] **T-2.5** Implement batch get CLI with stdin support [T] (depends: T-1.2, T-2.4)
  - File: `src/commands/batch.ts`
  - Test: `tests/batch-cli.test.ts`
  - Description: Handle positional IDs and `--stdin` flag. Read stdin line by line. Call `batchGetNodes()`. Format output (table/json/csv/ids/jsonl/minimal).

- [ ] **T-2.6** Wire batch commands into main CLI [T] (depends: T-2.5)
  - File: `src/index.ts`
  - Test: `tests/batch-cli.test.ts`
  - Description: Import `createBatchCommand()` and add to main program. Verify `supertag batch get` works end-to-end.

### Group 3: Batch Create

- [ ] **T-3.1** Implement batchCreateNodes with chunking [T] (depends: T-1.1)
  - File: `src/services/batch-operations.ts`
  - Test: `tests/batch-operations.test.ts`
  - Description: Create nodes via Tana API in chunks of 10. Use existing `createNode()` for payload building. Collect node IDs in order. Implement exponential backoff for 429s.

- [ ] **T-3.2** Add batch create validation and dry-run [T] (depends: T-3.1)
  - File: `src/services/batch-operations.ts`
  - Test: `tests/batch-operations.test.ts`
  - Description: Validate max 50 nodes, validate each node structure. Implement dry-run mode (validate all without posting). Return validation errors with index.

- [ ] **T-3.3** Add batch create MCP schema [T] (depends: T-3.1)
  - File: `src/mcp/schemas.ts`
  - Test: `src/mcp/tools/__tests__/batch-create.test.ts`
  - Description: Create `batchCreateSchema` with Zod: `nodes` (array of node definitions, 1-50), `target`, `dryRun`, `workspace`. Reuse existing `childNodeSchema`.

- [ ] **T-3.4** Implement tana_batch_create MCP tool [T] (depends: T-3.1, T-3.3)
  - File: `src/mcp/tools/batch-create.ts`
  - Test: `src/mcp/tools/__tests__/batch-create.test.ts`
  - Description: Implement MCP handler using `batchCreateNodes()`. Return created node IDs or errors. Handle dry-run mode.

- [ ] **T-3.5** Register tana_batch_create in tool registry [T] (depends: T-3.4)
  - File: `src/mcp/tool-registry.ts`
  - Test: `src/mcp/tools/__tests__/batch-create.test.ts`
  - Description: Add `tana_batch_create` to `TOOL_METADATA` (category: mutate). Add schema to `TOOL_SCHEMAS`.

- [ ] **T-3.6** Implement batch create CLI with file/stdin [T] (depends: T-3.1, T-2.4)
  - File: `src/commands/batch.ts`
  - Test: `tests/batch-cli.test.ts`
  - Description: Add `batch create` subcommand with `--file`, `--stdin`, `--target`, `--dry-run`, `--format`. Detect JSON array vs JSON Lines. Report progress for large batches.

### Group 4: Integration

- [ ] **T-4.1** End-to-end integration tests [T] (depends: T-2.6, T-3.6)
  - File: `tests/batch-integration.test.ts`
  - Test: (self)
  - Description: Test full CLI flows: `supertag batch get id1 id2`, pipe from search, `batch create --file`, stdin piping. Verify format outputs.

- [ ] **T-4.2** Update documentation (depends: T-4.1)
  - Files: `README.md`, `SKILL.md`, `CHANGELOG.md`
  - Description: Document batch commands and MCP tools. Add examples. Update CHANGELOG with new features.

## Dependency Graph

```
T-1.1 ──────────┬──> T-1.2 ──┬──> T-2.2 ──> T-2.3 ──┐
                │            │                      │
                │            └──> T-2.5 ──> T-2.6 ──┼──> T-4.1 ──> T-4.2
                │                      ▲            │
                │            T-2.4 ────┘            │
                │                                   │
                ├──> T-1.3                          │
                │                                   │
                └──> T-3.1 ──> T-3.2                │
                       │                            │
                       ├──> T-3.4 ──> T-3.5 ────────┤
                       │         ▲                  │
                       │  T-3.3 ─┘                  │
                       │                            │
                       └──> T-3.6 ──────────────────┘

T-2.1 ──> T-2.2 (MCP schema -> MCP tool)
T-2.4 ──> T-2.5, T-3.6 (CLI group -> subcommands)
```

## Execution Order

1. **Batch 1 (Sequential):** T-1.1 (types foundation - must come first)
2. **Batch 2 (Parallel):** T-1.2, T-1.3, T-2.1, T-2.4 (after T-1.1, independent tasks)
3. **Batch 3 (Sequential):** T-2.2, T-3.1 (after batch 2 dependencies)
4. **Batch 4 (Parallel):** T-2.3, T-2.5, T-3.2, T-3.3 (after their dependencies)
5. **Batch 5 (Parallel):** T-2.6, T-3.4, T-3.6 (after their dependencies)
6. **Batch 6 (Sequential):** T-3.5 (after T-3.4)
7. **Batch 7 (Sequential):** T-4.1 (after all implementation complete)
8. **Batch 8 (Sequential):** T-4.2 (after integration tests pass)

## Critical Path

```
T-1.1 -> T-1.2 -> T-2.2 -> T-2.3 -> T-2.5 -> T-2.6 -> T-4.1 -> T-4.2
```

Estimated: 8 sequential steps (with parallel opportunities in middle batches)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Types foundation |
| T-1.2 | pending | - | - | Core batch get |
| T-1.3 | pending | - | - | Validation |
| T-2.1 | pending | - | - | MCP schema |
| T-2.2 | pending | - | - | MCP batch get |
| T-2.3 | pending | - | - | Tool registry |
| T-2.4 | pending | - | - | CLI group |
| T-2.5 | pending | - | - | CLI batch get |
| T-2.6 | pending | - | - | Wire to main |
| T-3.1 | pending | - | - | Core batch create |
| T-3.2 | pending | - | - | Create validation |
| T-3.3 | pending | - | - | Create schema |
| T-3.4 | pending | - | - | MCP batch create |
| T-3.5 | pending | - | - | Create registry |
| T-3.6 | pending | - | - | CLI batch create |
| T-4.1 | pending | - | - | Integration tests |
| T-4.2 | pending | - | - | Documentation |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test --randomize`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |
