---
feature: "Universal Select Parameter"
plan: "./plan.md"
status: "pending"
total_tasks: 17
completed: 0
---

# Tasks: Universal Select Parameter

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Core Projection Utility)

- [ ] **T-1.1** Create select projection types [T]
  - File: `src/utils/select-projection.ts`
  - Test: `tests/utils/select-projection.test.ts`
  - Description: Define `SelectPath` and `SelectProjection` interfaces

- [ ] **T-1.2** Implement parseSelectPaths function [T] (depends: T-1.1)
  - File: `src/utils/select-projection.ts`
  - Test: `tests/utils/select-projection.test.ts`
  - Description: Parse comma-separated or array input into SelectProjection

- [ ] **T-1.3** Implement applyProjection function [T] (depends: T-1.1)
  - File: `src/utils/select-projection.ts`
  - Test: `tests/utils/select-projection.test.ts`
  - Description: Apply projection to single object, handle nested paths with dot notation

- [ ] **T-1.4** Implement applyProjectionToArray function [T] (depends: T-1.3)
  - File: `src/utils/select-projection.ts`
  - Test: `tests/utils/select-projection.test.ts`
  - Description: Apply projection to array of objects, handle edge cases

### Group 2: MCP Schema Updates

- [ ] **T-2.1** Add selectSchema to MCP schemas [T] (depends: T-1.4)
  - File: `src/mcp/schemas.ts`
  - Test: `tests/mcp/select-parameter.test.ts`
  - Description: Create reusable Zod schema for select parameter

- [ ] **T-2.2** Update tana_search with select [T] [P] (depends: T-2.1)
  - Files: `src/mcp/schemas.ts`, `src/mcp/tools/search.ts`
  - Test: `tests/mcp/select-parameter.test.ts`
  - Description: Add select to searchSchema, apply projection in tool

- [ ] **T-2.3** Update tana_tagged with select [T] [P] (depends: T-2.1)
  - Files: `src/mcp/schemas.ts`, `src/mcp/tools/tagged.ts`
  - Test: `tests/mcp/select-parameter.test.ts`
  - Description: Add select to taggedSchema, apply projection in tool

- [ ] **T-2.4** Update tana_semantic_search with select [T] [P] (depends: T-2.1)
  - Files: `src/mcp/schemas.ts`, `src/mcp/tools/semantic-search.ts`
  - Test: `tests/mcp/select-parameter.test.ts`
  - Description: Add select to semanticSearchSchema, apply projection in tool

- [ ] **T-2.5** Update tana_node with select [T] [P] (depends: T-2.1)
  - Files: `src/mcp/schemas.ts`, `src/mcp/tools/node.ts`
  - Test: `tests/mcp/select-parameter.test.ts`
  - Description: Add select to nodeSchema, apply projection in tool

- [ ] **T-2.6** Update tana_field_values with select [T] [P] (depends: T-2.1)
  - Files: `src/mcp/schemas.ts`, `src/mcp/tools/field-values.ts`
  - Test: `tests/mcp/select-parameter.test.ts`
  - Description: Add select to fieldValuesSchema, apply projection in tool

### Group 3: CLI Integration

- [ ] **T-3.1** Add parseSelectOption helper [T] (depends: T-1.4)
  - File: `src/commands/helpers.ts`
  - Test: `tests/commands/helpers.test.ts`
  - Description: Parse CLI --select string into array format

- [ ] **T-3.2** Update search command with --select [T] (depends: T-3.1)
  - File: `src/commands/search.ts`
  - Test: `tests/e2e/select-cli.test.ts`
  - Description: Add --select option, apply projection to all output modes

- [ ] **T-3.3** Update nodes show command with --select [T] (depends: T-3.1)
  - File: `src/commands/nodes.ts`
  - Test: `tests/e2e/select-cli.test.ts`
  - Description: Add --select option to nodes show subcommand

- [ ] **T-3.4** Update fields command with --select [T] (depends: T-3.1)
  - File: `src/commands/fields.ts`
  - Test: `tests/e2e/select-cli.test.ts`
  - Description: Add --select option to fields values subcommand

### Group 4: Documentation & Finalization

- [ ] **T-4.1** Update README.md (depends: T-3.4)
  - File: `README.md`
  - Description: Add --select examples to CLI documentation

- [ ] **T-4.2** Update SKILL.md (depends: T-2.6)
  - File: `SKILL.md`
  - Description: Document select parameter for all MCP tools

- [ ] **T-4.3** Final integration test [T] (depends: T-3.4, T-2.6)
  - Test: `tests/integration/select-integration.test.ts`
  - Description: End-to-end test of select across CLI and MCP

## Dependency Graph

```
T-1.1 ──> T-1.2 ──> T-1.3 ──> T-1.4 ──┬──> T-2.1 ──┬──> T-2.2 [P]
                                      │            ├──> T-2.3 [P]
                                      │            ├──> T-2.4 [P]
                                      │            ├──> T-2.5 [P]
                                      │            └──> T-2.6 [P] ──> T-4.2
                                      │
                                      └──> T-3.1 ──┬──> T-3.2
                                                   ├──> T-3.3
                                                   └──> T-3.4 ──> T-4.1
                                                            │
                                                            └──────────> T-4.3
```

## Execution Order

1. **Sequential batch:** T-1.1 → T-1.2 → T-1.3 → T-1.4 (foundation)
2. **Parallel split:**
   - Branch A: T-2.1 → [T-2.2, T-2.3, T-2.4, T-2.5, T-2.6 parallel]
   - Branch B: T-3.1 → T-3.2 → T-3.3 → T-3.4
3. **Parallel batch:** T-2.2, T-2.3, T-2.4, T-2.5, T-2.6 (MCP tools)
4. **Documentation:** T-4.1 (after CLI), T-4.2 (after MCP)
5. **Final:** T-4.3 (integration test after all implementation)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Types and interfaces |
| T-1.2 | pending | - | - | Parse select paths |
| T-1.3 | pending | - | - | Single object projection |
| T-1.4 | pending | - | - | Array projection |
| T-2.1 | pending | - | - | selectSchema |
| T-2.2 | pending | - | - | tana_search |
| T-2.3 | pending | - | - | tana_tagged |
| T-2.4 | pending | - | - | tana_semantic_search |
| T-2.5 | pending | - | - | tana_node |
| T-2.6 | pending | - | - | tana_field_values |
| T-3.1 | pending | - | - | CLI helper |
| T-3.2 | pending | - | - | search command |
| T-3.3 | pending | - | - | nodes show command |
| T-3.4 | pending | - | - | fields command |
| T-4.1 | pending | - | - | README docs |
| T-4.2 | pending | - | - | SKILL.md docs |
| T-4.3 | pending | - | - | Integration test |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun run test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |
