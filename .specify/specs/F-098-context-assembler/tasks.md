# Implementation Tasks: F-098 Context Assembler

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Context types and schemas |
| T-1.2 | ☐ | Token counter service |
| T-1.3 | ☐ | Relevance scorer service |
| T-1.4 | ☐ | Token budgeter service |
| T-2.1 | ☐ | Context assembler orchestrator |
| T-2.2 | ☐ | Read backend integration |
| T-2.3 | ☐ | Graph traversal integration |
| T-2.4 | ☐ | Context formatter |
| T-2.5 | ☐ | Lens configurations |
| T-3.1 | ☐ | CLI command handler |
| T-3.2 | ☐ | Standard options integration |
| T-3.3 | ☐ | CLI registration |
| T-3.4 | ☐ | CLI tests |
| T-4.1 | ☐ | MCP tool handler |
| T-4.2 | ☐ | MCP schema definition |
| T-4.3 | ☐ | MCP registry registration |
| T-4.4 | ☐ | MCP dispatch integration |
| T-5.1 | ☐ | Token counter tests |
| T-5.2 | ☐ | Relevance scorer tests |
| T-5.3 | ☐ | Integration tests |
| T-5.4 | ☐ | E2E CLI tests |
| T-5.5 | ☐ | README documentation |
| T-5.6 | ☐ | SKILL.md documentation |

---

## Group 1: Core Data Layer

### T-1.1: Create context types and Zod schemas [T]
- **File:** `src/types/context.ts`
- **Test:** `tests/types/context.test.ts`
- **Dependencies:** none
- **Description:** Define TypeScript interfaces and Zod schemas for ContextDocument, ContextNode, ContextMeta, RelevanceScore, TokenBudget, TokenUsage, LensType, LensConfig, OverflowSummary, and ContextOptionsSchema. Include LENS_CONFIGS constant with all 5 predefined lens configurations.

### T-1.2: Create token counter service [T] [P with T-1.3, T-1.4]
- **File:** `src/services/token-counter.ts`
- **Test:** `tests/services/token-counter.test.ts`
- **Dependencies:** T-1.1
- **Description:** Implement token counting using js-tiktoken (GPT-compatible). Export `countTokens(text: string): number` and `estimateNodeTokens(node: ContextNode): number`. Add js-tiktoken to package.json dependencies.

### T-1.3: Create relevance scorer service [T] [P with T-1.2, T-1.4]
- **File:** `src/services/relevance-scorer.ts`
- **Test:** `tests/services/relevance-scorer.test.ts`
- **Dependencies:** T-1.1
- **Description:** Implement relevance scoring formula: `score = (1/graphDistance)*0.4 + semanticSimilarity*0.35 + recencyBoost*0.25`. Export `scoreNode(node, options: ScoringOptions): RelevanceScore`. Handle fallback to 60%/40% weighting when embeddings unavailable. Include recency calculation based on node modification timestamp.

### T-1.4: Create token budgeter service [T] [P with T-1.2, T-1.3]
- **File:** `src/services/token-budgeter.ts`
- **Test:** `tests/services/token-budgeter.test.ts`
- **Dependencies:** T-1.1, T-1.2
- **Description:** Implement budget enforcement and pruning logic. Export `pruneToFitBudget(nodes: ContextNode[], budget: TokenBudget): { included: ContextNode[], overflow: OverflowSummary[], usage: TokenUsage }`. Sort by relevance score descending, include nodes until budget exhausted, create summaries for overflow nodes.

---

## Group 2: Context Assembly Service

### T-2.1: Create context assembler orchestrator [T]
- **File:** `src/services/context-assembler.ts`
- **Test:** `tests/services/context-assembler.test.ts`
- **Dependencies:** T-1.1, T-1.2, T-1.3, T-1.4
- **Description:** Implement main orchestration service that coordinates the 6-phase pipeline: Resolve → Traverse → Enrich → Score → Budget → Format. Export `assembleContext(query: string, options: ContextOptions): Promise<ContextDocument>`. Track visited nodes to prevent circular reference loops.

### T-2.2: Integrate with F-097 read backend [T]
- **File:** `src/services/context-assembler.ts` (extend)
- **Test:** `tests/services/context-assembler.test.ts` (extend)
- **Dependencies:** T-2.1
- **Description:** Add resolve phase using `resolveReadBackend()` from `src/api/read-backend-resolver.ts`. Detect if input is node ID (alphanumeric pattern) or search query. Use `backend.search()` for queries, `backend.readNode()` for direct IDs. Handle "topic not found" case with empty context + message.

### T-2.3: Integrate with F-065 graph traversal [T]
- **File:** `src/services/context-assembler.ts` (extend)
- **Test:** `tests/services/context-assembler.test.ts` (extend)
- **Dependencies:** T-2.2
- **Description:** Add traverse phase using `GraphTraversalService` from `src/services/graph-traversal.ts`. Apply lens-specific `priorityTypes` to traversal. Enforce depth limit (default: 2, max: 5). Sample top-N children for nodes with 500+ children using relevance pre-scoring.

### T-2.4: Create context formatter [T] [P with T-2.5]
- **File:** `src/services/context-formatter.ts`
- **Test:** `tests/services/context-formatter.test.ts`
- **Dependencies:** T-1.1
- **Description:** Implement markdown and JSON output formatting. Export `formatContext(doc: ContextDocument, format: 'markdown' | 'json'): string`. Markdown format: hierarchical headers with node content, field tables, overflow summary section. JSON format: pretty-printed ContextDocument structure.

### T-2.5: Implement lens configurations [T] [P with T-2.4]
- **File:** `src/services/lens-config.ts`
- **Test:** `tests/services/lens-config.test.ts`
- **Dependencies:** T-1.1
- **Description:** Export `getLensConfig(lens: LensType): LensConfig` and `applyLensBoosts(nodes: ContextNode[], lens: LensType): ContextNode[]`. Implement tag boosting for lens-specific tags. Handle `includeFields` filtering per lens configuration.

---

## Group 3: CLI Integration

### T-3.1: Create CLI command handler [T]
- **File:** `src/commands/context.ts`
- **Test:** `tests/commands/context.test.ts`
- **Dependencies:** T-2.1, T-2.4
- **Description:** Implement `supertag context <query>` command using Commander.js. Add options: `--depth <n>`, `--max-tokens <n>`, `--lens <name>`, `--include-fields`, `--no-include-fields`, `--format <markdown|json>`, `--workspace <alias>`. Validate depth 1-5, maxTokens >= 500. Output formatted context to stdout.

### T-3.2: Add standard options integration
- **File:** `src/commands/context.ts` (extend)
- **Test:** `tests/commands/context.test.ts` (extend)
- **Dependencies:** T-3.1
- **Description:** Integrate with existing `addStandardOptions()` helper for workspace resolution. Use `resolveWorkspaceContext()` with `requireDatabase: true`. Apply `--offline` flag to force SQLite backend.

### T-3.3: Register command in CLI entry point
- **File:** `src/index.ts` (extend)
- **Test:** N/A (covered by E2E)
- **Dependencies:** T-3.1
- **Description:** Import context command and register with main program. Add to command list in help output.

### T-3.4: CLI argument parsing tests [T]
- **File:** `tests/commands/context-args.test.ts`
- **Test:** (self)
- **Dependencies:** T-3.1, T-3.2, T-3.3
- **Description:** Test CLI argument parsing: default values, range validation for depth/maxTokens, lens enum validation, format enum validation, workspace resolution, error messages for invalid inputs.

---

## Group 4: MCP Tool Integration

### T-4.1: Create MCP tool handler [T]
- **File:** `src/mcp/tools/context.ts`
- **Test:** `tests/mcp/context-tool.test.ts`
- **Dependencies:** T-2.1, T-2.4
- **Description:** Implement `tana_context` tool handler. Parse input schema, validate parameters, call `assembleContext()`, return formatted response with `isError` handling using `handleMcpError()` from `src/mcp/error-handler.ts`.

### T-4.2: Add MCP schema definition
- **File:** `src/mcp/schemas.ts` (extend)
- **Test:** `tests/mcp/schemas.test.ts` (extend)
- **Dependencies:** T-4.1
- **Description:** Add `tana_context` tool schema with inputSchema matching specification: query (required), depth, maxTokens, lens, includeFields, format, workspace. Include descriptions for AI agent consumption.

### T-4.3: Register in tool registry and mode
- **File:** `src/mcp/tool-registry.ts` (extend), `src/mcp/tool-mode.ts` (extend)
- **Test:** `tests/mcp/tool-registry.test.ts` (extend)
- **Dependencies:** T-4.2
- **Description:** Add `tana_context` to tool registry exports. Determine if tool should be in LITE_MODE_TOOLS (recommend yes — context assembly is core AI workflow). Update tool count in lite mode tests if added.

### T-4.4: Add dispatch case in MCP index
- **File:** `src/mcp/index.ts` (extend)
- **Test:** `tests/mcp/dispatch.test.ts` (extend)
- **Dependencies:** T-4.1, T-4.3
- **Description:** Add switch case for `tana_context` tool name dispatching to context tool handler. Follow existing dispatch pattern with error handling.

---

## Group 5: Testing & Documentation

### T-5.1: Token counter accuracy tests [T]
- **File:** `tests/services/token-counter.test.ts` (extend)
- **Test:** (self)
- **Dependencies:** T-1.2
- **Description:** Test token count accuracy within 10% of expected values for known text samples. Test edge cases: empty string, very long text, unicode, markdown with code blocks. Compare against known OpenAI tokenization.

### T-5.2: Relevance scorer formula tests [T]
- **File:** `tests/services/relevance-scorer.test.ts` (extend)
- **Test:** (self)
- **Dependencies:** T-1.3
- **Description:** Test scoring formula correctness: closer nodes score higher, newer nodes score higher, embedding similarity contribution, fallback weights when embeddings unavailable. Test edge cases: distance 0, very old nodes, no embeddings.

### T-5.3: Integration tests for assembly pipeline [T]
- **File:** `tests/integration/context-assembler.test.ts`
- **Test:** (self)
- **Dependencies:** T-2.1, T-2.2, T-2.3, T-2.4, T-2.5
- **Description:** End-to-end tests with in-memory SQLite fixtures. Test: resolve by search, resolve by ID, depth limiting, token budget enforcement, lens application, circular reference handling, large node sampling, output format correctness.

### T-5.4: E2E CLI tests [T]
- **File:** `tests/e2e/context-cli.test.ts`
- **Test:** (self)
- **Dependencies:** T-3.1, T-3.2, T-3.3, T-3.4
- **Description:** Test CLI command execution with real filesystem and subprocess. Test: successful context assembly, error handling for missing topics, format output validation, help text, version output.

### T-5.5: Update README documentation
- **File:** `README.md` (extend)
- **Test:** N/A
- **Dependencies:** T-3.1, T-4.1
- **Description:** Add `context` command to CLI reference section. Document options, lenses, output formats. Add usage examples. Document `tana_context` MCP tool in MCP tools section.

### T-5.6: Update SKILL.md documentation
- **File:** `SKILL.md` (extend)
- **Test:** N/A
- **Dependencies:** T-4.1
- **Description:** Add `tana_context` tool to MCP tools list with description and USE WHEN triggers. Add examples showing AI context assembly workflow.

---

## Execution Order

### Wave 1: Foundation (no dependencies)
- T-1.1 (types — all else depends on this)

### Wave 2: Core Services (parallel after T-1.1)
- T-1.2, T-1.3, T-1.4 (can run in parallel)

### Wave 3: Orchestration (after Wave 2)
- T-2.1 (assembler core)

### Wave 4: Integration (parallel after T-2.1)
- T-2.2, T-2.3, T-2.4, T-2.5 (T-2.4 and T-2.5 parallelizable)

### Wave 5: CLI & MCP (parallel after Wave 4)
- T-3.1, T-3.2, T-3.3 (sequential)
- T-4.1, T-4.2, T-4.3, T-4.4 (sequential but parallel with CLI)

### Wave 6: Polish (after Waves 5)
- T-3.4, T-5.1, T-5.2, T-5.3, T-5.4 (tests, mostly parallel)
- T-5.5, T-5.6 (docs, parallel)

---

## Dependencies Graph

```
T-1.1 ──┬──▶ T-1.2 ──┐
        ├──▶ T-1.3 ──┼──▶ T-2.1 ──┬──▶ T-2.2 ──▶ T-2.3 ──┐
        ├──▶ T-1.4 ──┘            ├──▶ T-2.4 ─────────────┼──▶ T-3.1 ──▶ T-3.2 ──▶ T-3.3 ──▶ T-3.4
        └──▶ T-2.4                └──▶ T-2.5 ─────────────┤
        └──▶ T-2.5                                        └──▶ T-4.1 ──▶ T-4.2 ──▶ T-4.3 ──▶ T-4.4
                                                                                              │
T-5.1 ◀── T-1.2                                                                               │
T-5.2 ◀── T-1.3                                                                               │
T-5.3 ◀── T-2.1 + T-2.2 + T-2.3 + T-2.4 + T-2.5                                              │
T-5.4 ◀── T-3.4                                                                               │
T-5.5, T-5.6 ◀───────────────────────────────────────────────────────────────────────────────┘
```

---

## External Dependencies

### New Package Required
- `js-tiktoken` (^1.0.12) — Add in T-1.2

### Existing Internal Dependencies
| Module | Used In |
|--------|---------|
| `src/api/read-backend-resolver.ts` | T-2.2 |
| `src/api/read-backend.ts` | T-2.2 |
| `src/services/graph-traversal.ts` | T-2.3 |
| `src/types/graph.ts` | T-2.3 |
| `src/db/field-query.ts` | T-2.1 |
| `src/config/workspace-resolver.ts` | T-3.2 |
| `src/utils/structured-errors.ts` | T-4.1 |
| `src/mcp/error-handler.ts` | T-4.1 |
