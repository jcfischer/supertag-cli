---
feature: "Graph Traversal"
plan: "./plan.md"
status: "pending"
total_tasks: 13
completed: 0
---

# Tasks: Graph Traversal (Related Nodes)

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Types & Query Engine)

- [ ] **T-1.1** Create graph traversal types [T] [P]
  - File: `src/types/graph.ts`
  - Test: `tests/unit/graph-types.test.ts`
  - Description: Define `RelatedQuery`, `RelationshipType`, `RelationshipMetadata`, `RelatedNode`, `RelatedResult` interfaces with Zod validation

- [ ] **T-1.2** Extend TanaQueryEngine with getRelatedNodes [T] [P]
  - File: `src/query/tana-query-engine.ts`
  - Test: `tests/unit/related-query.test.ts`
  - Description: Add `getRelatedNodes(nodeId, direction, types, limit)` method with type filtering and batched lookups

### Group 2: Core Service

- [ ] **T-2.1** Create GraphTraversalService base [T] (depends: T-1.1, T-1.2)
  - File: `src/services/graph-traversal.ts`
  - Test: `tests/unit/graph-traversal.test.ts`
  - Description: Implement service class with constructor, close(), and basic single-hop traversal

- [ ] **T-2.2** Implement BFS multi-hop traversal [T] (depends: T-2.1)
  - File: `src/services/graph-traversal.ts`
  - Test: `tests/unit/graph-traversal.test.ts`
  - Description: Add depth traversal with visited set for cycle detection, path tracking, distance calculation

- [ ] **T-2.3** Add direction and type filtering [T] (depends: T-2.2)
  - File: `src/services/graph-traversal.ts`
  - Test: `tests/unit/graph-traversal.test.ts`
  - Description: Filter by direction (in/out/both) and relationship types (child/parent/reference/field)

- [ ] **T-2.4** Add limits, warnings, and edge cases [T] (depends: T-2.3)
  - File: `src/services/graph-traversal.ts`
  - Test: `tests/unit/graph-traversal.test.ts`
  - Description: Depth clamping (max 5), result truncation, unknown type warnings, empty results

### Group 3: MCP Tool

- [ ] **T-3.1** Add relatedSchema to schemas.ts [T] [P] (depends: T-1.1)
  - File: `src/mcp/schemas.ts`
  - Test: `tests/unit/schemas.test.ts`
  - Description: Define Zod schema for `tana_related` tool input with all parameters

- [ ] **T-3.2** Create MCP tool handler [T] (depends: T-2.4, T-3.1)
  - File: `src/mcp/tools/related.ts`
  - Test: `tests/mcp/related.test.ts`
  - Description: Implement tool handler following `node.ts` pattern with workspace resolution, projection support

- [ ] **T-3.3** Register tool in registry [T] (depends: T-3.2)
  - File: `src/mcp/tool-registry.ts`
  - Test: `tests/mcp/tool-registry.test.ts`
  - Description: Add `tana_related` to registry with category 'query', update capabilities

### Group 4: CLI Command

- [ ] **T-4.1** Create related CLI command [T] (depends: T-2.4)
  - File: `src/commands/related.ts`
  - Test: `tests/e2e/related-cli.test.ts`
  - Description: Implement `supertag related <nodeId>` with --direction, --types, --depth, --limit flags

- [ ] **T-4.2** Add output format support [T] (depends: T-4.1)
  - File: `src/commands/related.ts`
  - Test: `tests/e2e/related-cli.test.ts`
  - Description: Support all 6 formats (table, json, csv, ids, minimal, jsonl) per Spec 060

- [ ] **T-4.3** Wire command into main CLI (depends: T-4.2)
  - File: `src/index.ts`
  - Description: Register `related` command in main CLI entry point

### Group 5: Documentation & Polish

- [ ] **T-5.1** Update documentation (depends: T-4.3, T-3.3)
  - Files: `README.md`, `SKILL.md`, `CHANGELOG.md`
  - Description: Document new command/tool, add examples, update capability list

## Dependency Graph

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                                                         │
T-1.1 ──┬──> T-2.1 ──> T-2.2 ──> T-2.3 ──> T-2.4 ──┬──> T-3.2 ──> T-3.3 ──┬──> T-5.1
        │                                          │                       │
T-1.2 ──┘                                          │                       │
        │                                          ├──> T-4.1 ──> T-4.2 ──> T-4.3 ──┘
        │                                          │
        └──> T-3.1 ────────────────────────────────┘
```

**Simplified view:**
```
Foundation:  T-1.1 ─┬─> T-2.1 ─> T-2.2 ─> T-2.3 ─> T-2.4 ─┬─> T-3.2 ─> T-3.3 ─┐
             T-1.2 ─┘                                     │                   │
                     T-3.1 ───────────────────────────────┤                   ├─> T-5.1
                                                          └─> T-4.1 ─> T-4.2 ─> T-4.3 ─┘
```

## Execution Order

1. **Parallel batch 1:** T-1.1 (types), T-1.2 (query engine extension)
2. **Sequential:** T-2.1 (service base) - after batch 1
3. **Sequential:** T-2.2 (BFS traversal)
4. **Sequential:** T-2.3 (filtering)
5. **Parallel batch 2:** T-2.4 (limits/edge cases) + T-3.1 (schema) - T-3.1 can start after T-1.1
6. **Parallel batch 3:** T-3.2 (MCP handler) + T-4.1 (CLI command) - after T-2.4
7. **Parallel batch 4:** T-3.3 (registry) + T-4.2 (formats)
8. **Sequential:** T-4.3 (wire CLI)
9. **Sequential:** T-5.1 (docs) - after T-4.3 and T-3.3

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Types with Zod |
| T-1.2 | pending | - | - | Query engine extension |
| T-2.1 | pending | - | - | Service base |
| T-2.2 | pending | - | - | BFS + cycle detection |
| T-2.3 | pending | - | - | Direction/type filtering |
| T-2.4 | pending | - | - | Limits/warnings |
| T-3.1 | pending | - | - | MCP schema |
| T-3.2 | pending | - | - | MCP handler |
| T-3.3 | pending | - | - | Tool registration |
| T-4.1 | pending | - | - | CLI command base |
| T-4.2 | pending | - | - | Output formats |
| T-4.3 | pending | - | - | Wire to main |
| T-5.1 | pending | - | - | Documentation |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun run test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Critical Path

The longest dependency chain determines minimum time:

```
T-1.1 → T-2.1 → T-2.2 → T-2.3 → T-2.4 → T-4.1 → T-4.2 → T-4.3 → T-5.1
```

**Critical path:** 9 tasks
**Parallel opportunities:** 4 batches can reduce wall-clock time

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Post-Implementation Verification

**Before marking feature complete, verify:**

### Functional Verification
- [ ] All unit tests pass (`bun run test`)
- [ ] All integration tests pass
- [ ] Feature works as specified in acceptance criteria:
  - [ ] `tana_related` returns nodes connected to given node
  - [ ] Direction filtering works (in/out/both)
  - [ ] Type filtering works (child/parent/reference/field)
  - [ ] Depth traversal finds multi-hop connections
  - [ ] Cycles detected and handled gracefully

### Failure Verification (Doctorow Gate)
- [ ] **Node not found:** Returns structured error with NODE_NOT_FOUND code
- [ ] **Cycle in graph:** Returns partial results without infinite loop
- [ ] **Empty references:** Returns empty array (not error)
- [ ] **Unknown type:** Ignored with warning in response
- [ ] **Depth > 5:** Clamped with warning

### Maintainability Verification
- [ ] **Documentation:** README, SKILL.md, CHANGELOG updated
- [ ] **No orphan code:** All new code reachable and tested
- [ ] **Consistent patterns:** Follows existing MCP tool and CLI patterns

### Sign-off
- [ ] All verification items checked
- [ ] Debt score: 2 (low complexity)
- Date completed: ___
