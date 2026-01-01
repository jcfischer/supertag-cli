---
feature: "Progressive Disclosure"
plan: "./plan.md"
status: "pending"
total_tasks: 12
completed: 0
---

# Tasks: Progressive Disclosure (tana_capabilities)

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Tool Registry)

- [ ] **T-1.1** Define TypeScript types for tool registry [T] [P]
  - File: `src/mcp/tool-registry.ts` (types section)
  - Test: `src/mcp/__tests__/tool-registry.test.ts`
  - Description: Define ToolCategory, ToolSummary, ToolMetadata, CapabilitiesResponse interfaces

- [ ] **T-1.2** Define Zod schemas for MCP tools [T] [P]
  - File: `src/mcp/schemas.ts`
  - Test: `src/mcp/tools/__tests__/schemas.test.ts`
  - Description: Add capabilitiesSchema and toolSchemaSchema to existing schemas file

- [ ] **T-1.3** Implement tool metadata registry [T] (depends: T-1.1)
  - File: `src/mcp/tool-registry.ts`
  - Test: `src/mcp/__tests__/tool-registry.test.ts`
  - Description: Create TOOL_METADATA constant with all 14 tools, categories, descriptions, examples

- [ ] **T-1.4** Implement getCapabilities() [T] (depends: T-1.3)
  - File: `src/mcp/tool-registry.ts`
  - Test: `src/mcp/__tests__/tool-registry.test.ts`
  - Description: Return lightweight capabilities inventory, optional category filter

- [ ] **T-1.5** Implement getToolSchema() with caching [T] (depends: T-1.3)
  - File: `src/mcp/tool-registry.ts`
  - Test: `src/mcp/__tests__/tool-registry.test.ts`
  - Description: Return full JSON schema for tool, session-level caching

### Group 2: MCP Tools

- [ ] **T-2.1** Implement tana_capabilities handler [T] (depends: T-1.4)
  - File: `src/mcp/tools/capabilities.ts`
  - Test: `src/mcp/tools/__tests__/capabilities.test.ts`
  - Description: MCP tool handler calling getCapabilities(), format response

- [ ] **T-2.2** Implement tana_tool_schema handler [T] (depends: T-1.5)
  - File: `src/mcp/tools/tool-schema.ts`
  - Test: `src/mcp/tools/__tests__/tool-schema.test.ts`
  - Description: MCP tool handler calling getToolSchema(), error for unknown tools

- [ ] **T-2.3** Token budget validation [T] (depends: T-2.1)
  - File: `src/mcp/tools/__tests__/capabilities.test.ts`
  - Test: Same file
  - Description: Verify capabilities response < 500 tokens, individual schemas < 300 tokens

### Group 3: Integration

- [ ] **T-3.1** Register tools in MCP server [T] (depends: T-2.1, T-2.2)
  - File: `src/mcp/index.ts`
  - Test: `src/mcp/tools/__tests__/progressive.test.ts`
  - Description: Add tana_capabilities and tana_tool_schema to ListTools and CallTool handlers

- [ ] **T-3.2** E2E progressive disclosure test [T] (depends: T-3.1)
  - File: `tests/progressive-disclosure.test.ts`
  - Test: Same file
  - Description: Full flow test: capabilities → schema → tool execution

- [ ] **T-3.3** Update README documentation (depends: T-3.1)
  - Files: `README.md`
  - Description: Document progressive disclosure pattern, tana_capabilities usage

- [ ] **T-3.4** Update SKILL.md (depends: T-3.1)
  - Files: `SKILL.md`
  - Description: Add tana_capabilities to MCP tools section

## Dependency Graph

```
T-1.1 ──┬──> T-1.3 ──┬──> T-1.4 ──> T-2.1 ──┬──> T-2.3
        │           │                       │
        │           └──> T-1.5 ──> T-2.2 ───┼──> T-3.1 ──> T-3.2
        │                                   │        │
T-1.2 ──┴───────────────────────────────────┘        ├──> T-3.3
                                                     └──> T-3.4
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2
2. **Sequential:** T-1.3 (after T-1.1)
3. **Parallel batch 2:** T-1.4, T-1.5 (after T-1.3)
4. **Parallel batch 3:** T-2.1, T-2.2 (after T-1.4/T-1.5)
5. **Sequential:** T-2.3 (after T-2.1)
6. **Sequential:** T-3.1 (after T-2.1, T-2.2)
7. **Sequential:** T-3.2 (after T-3.1)
8. **Parallel batch 4:** T-3.3, T-3.4 (after T-3.1)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Types for registry |
| T-1.2 | pending | - | - | Zod schemas |
| T-1.3 | pending | - | - | Tool metadata |
| T-1.4 | pending | - | - | getCapabilities() |
| T-1.5 | pending | - | - | getToolSchema() |
| T-2.1 | pending | - | - | capabilities handler |
| T-2.2 | pending | - | - | tool-schema handler |
| T-2.3 | pending | - | - | Token validation |
| T-3.1 | pending | - | - | MCP registration |
| T-3.2 | pending | - | - | E2E test |
| T-3.3 | pending | - | - | README |
| T-3.4 | pending | - | - | SKILL.md |

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

## Test Coverage Targets

| Component | Unit Tests | Integration Tests |
|-----------|------------|-------------------|
| tool-registry.ts | 15-20 tests | - |
| capabilities.ts | 5-8 tests | 2-3 tests |
| tool-schema.ts | 5-8 tests | 2-3 tests |
| E2E flow | - | 3-5 tests |
| **Total** | ~25-36 | ~7-11 |
