---
feature: "Supertag Inheritance Visualization"
plan: "./plan.md"
status: "pending"
total_tasks: 12
completed: 0
---

# Tasks: Supertag Inheritance Visualization

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation

- [ ] **T-1.1** Create visualization types [T] [P]
  - File: `src/visualization/types.ts`
  - Test: `tests/visualization/types.test.ts`
  - Description: Define TypeScript interfaces for VisualizationData, VisualizationNode, VisualizationLink, VisualizationMetadata, and VisualizationOptions. Include Zod schemas for runtime validation.

- [ ] **T-1.2** Create VisualizationService [T]
  - File: `src/visualization/service.ts`
  - Test: `tests/visualization/service.test.ts`
  - Description: Implement VisualizationService class with getData(), getSubtree(), and getMaxDepth() methods. Uses existing supertag_parents and supertag_metadata tables.
  - depends: T-1.1

### Group 2: Renderers

- [ ] **T-2.1** Create Mermaid renderer [T] [P]
  - File: `src/visualization/renderers/mermaid.ts`
  - Test: `tests/visualization/renderers/mermaid.test.ts`
  - Description: Pure function renderMermaid() that converts VisualizationData to Mermaid flowchart syntax. Supports direction options (TD/BT/LR/RL), field counts, colors.
  - depends: T-1.1

- [ ] **T-2.2** Create DOT renderer [T] [P]
  - File: `src/visualization/renderers/dot.ts`
  - Test: `tests/visualization/renderers/dot.test.ts`
  - Description: Pure function renderDOT() that converts VisualizationData to Graphviz DOT syntax. Supports rankdir, colors, node styling.
  - depends: T-1.1

- [ ] **T-2.3** Create JSON renderer [T] [P]
  - File: `src/visualization/renderers/json.ts`
  - Test: `tests/visualization/renderers/json.test.ts`
  - Description: Pure function renderJSON() that outputs formatted JSON. Supports pretty-printing option.
  - depends: T-1.1

- [ ] **T-2.4** Create renderer index [P]
  - File: `src/visualization/renderers/index.ts`
  - Test: (no test needed - pure exports)
  - Description: Export all renderers from single entry point. Include format type union and renderer lookup map.
  - depends: T-2.1, T-2.2, T-2.3

### Group 3: CLI Integration

- [ ] **T-3.1** Add visualize subcommand [T]
  - File: `src/commands/tags.ts` (modify)
  - Test: `tests/commands/tags-visualize.test.ts`
  - Description: Add `tags visualize` subcommand with --format, --root, --depth, --min-usage, --orphans, --output, --open options.
  - depends: T-1.2, T-2.4

- [ ] **T-3.2** Implement filter options [T]
  - File: `src/commands/tags.ts` (modify)
  - Test: `tests/commands/tags-visualize.test.ts` (extend)
  - Description: Implement --root (subtree filtering), --depth (limit traversal), --min-usage (filter by usage count), --orphans (include/exclude).
  - depends: T-3.1

- [ ] **T-3.3** Implement output options [T]
  - File: `src/commands/tags.ts` (modify)
  - Test: `tests/commands/tags-visualize.test.ts` (extend)
  - Description: Implement --output (write to file) and --open (open in browser/viewer). Handle file writing and platform-specific open command.
  - depends: T-3.1

### Group 4: Polish & Documentation

- [ ] **T-4.1** Add error handling and edge cases [T]
  - File: `src/visualization/service.ts`, `src/commands/tags.ts` (modify)
  - Test: `tests/visualization/edge-cases.test.ts`
  - Description: Handle empty workspace, unknown tag for --root, very large graphs (>500 tags warning), special characters in tag names.
  - depends: T-3.3

- [ ] **T-4.2** Update README documentation
  - File: `README.md` (modify)
  - Test: (no test needed)
  - Description: Add visualization section with usage examples, sample outputs, Graphviz installation instructions.
  - depends: T-4.1

- [ ] **T-4.3** Update SKILL.md
  - File: `SKILL.md` (modify)
  - Test: (no test needed)
  - Description: Add visualization commands to skill documentation for MCP/PAI integration.
  - depends: T-4.1

## Dependency Graph

```
T-1.1 ──────────────────────┬──────────────────────────────────────────────────────┐
   │                        │                                                      │
   ▼                        ▼                                                      ▼
T-1.2 ──────────────┐   T-2.1 ─────────┐                                       T-2.2 ─────────┐
                    │       │          │                                           │          │
                    │       │          ▼                                           │          ▼
                    │       │      T-2.4 ◄─────────────────────────────────────────┘      T-2.3
                    │       │          │                                                      │
                    ▼       ▼          ▼                                                      │
                    └───────┴────► T-3.1 ◄────────────────────────────────────────────────────┘
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                       T-3.2               T-3.3
                          │                   │
                          └─────────┬─────────┘
                                    ▼
                                 T-4.1
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                       T-4.2               T-4.3
```

## Execution Order

1. **Batch 1 (Types):** T-1.1
2. **Batch 2 (Parallel - Service + Renderers):** T-1.2, T-2.1, T-2.2, T-2.3
3. **Batch 3 (Renderer Index):** T-2.4
4. **Batch 4 (CLI Core):** T-3.1
5. **Batch 5 (Parallel - CLI Options):** T-3.2, T-3.3
6. **Batch 6 (Error Handling):** T-4.1
7. **Batch 7 (Parallel - Docs):** T-4.2, T-4.3

**Critical Path:** T-1.1 → T-1.2 → T-3.1 → T-3.2/T-3.3 → T-4.1 → T-4.2

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Foundation types |
| T-1.2 | pending | - | - | Data gathering service |
| T-2.1 | pending | - | - | Mermaid renderer |
| T-2.2 | pending | - | - | DOT renderer |
| T-2.3 | pending | - | - | JSON renderer |
| T-2.4 | pending | - | - | Renderer exports |
| T-3.1 | pending | - | - | CLI subcommand |
| T-3.2 | pending | - | - | Filter options |
| T-3.3 | pending | - | - | Output options |
| T-4.1 | pending | - | - | Edge cases |
| T-4.2 | pending | - | - | README |
| T-4.3 | pending | - | - | SKILL.md |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Test Coverage Requirements

| Task | Test Cases |
|------|------------|
| T-1.1 | Type validation, Zod schema parsing |
| T-1.2 | getData returns correct nodes/links, getSubtree filters correctly, getMaxDepth calculates |
| T-2.1 | Mermaid syntax correct, direction option works, handles empty graph |
| T-2.2 | DOT syntax correct, rankdir option works, special char escaping |
| T-2.3 | JSON output matches schema, pretty vs compact |
| T-3.1 | Command exists, --format option works, default format |
| T-3.2 | --root filters subtree, --depth limits, --min-usage filters, --orphans toggle |
| T-3.3 | --output writes file, --open launches viewer |
| T-4.1 | Empty workspace, unknown root tag, large graph warning |

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |
