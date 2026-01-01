---
feature: "Error Context"
plan: "./plan.md"
status: "pending"
total_tasks: 20
completed: 0
---

# Tasks: Error Context

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Types & Registry)

- [ ] **T-1.1** Create error type definitions [T] [P]
  - File: `src/types/errors.ts`
  - Test: `tests/unit/types-errors.test.ts`
  - Description: Define `ErrorCode` type, `StructuredErrorData`, `RecoveryInfo`, `ValidationErrorItem`, `ErrorLogEntry` interfaces

- [ ] **T-1.2** Create error registry with metadata [T] [P]
  - File: `src/utils/error-registry.ts`
  - Test: `tests/unit/error-registry.test.ts`
  - Description: Define `ERROR_REGISTRY` mapping error codes to category, default suggestion, doc path, and retryable flag

- [ ] **T-1.3** Add fuzzy matching dependency [P]
  - File: `package.json`
  - Description: Add `fastest-levenshtein` package for typo suggestions

### Group 2: Core Error Infrastructure

- [ ] **T-2.1** Create StructuredError class [T] (depends: T-1.1, T-1.2)
  - File: `src/utils/structured-errors.ts`
  - Test: `tests/unit/structured-errors.test.ts`
  - Description: Extend `TanaError` with `code`, `details`, `suggestion`, `recovery` properties. Include `createStructuredError()` and `enrichError()` functions

- [ ] **T-2.2** Create suggestion generator [T] (depends: T-1.2, T-1.3)
  - File: `src/utils/suggestion-generator.ts`
  - Test: `tests/unit/suggestion-generator.test.ts`
  - Description: Implement `generateSuggestion()` for error-type-specific hints, `findSimilarValues()` using Levenshtein distance for typo detection

- [ ] **T-2.3** Create CLI error formatter [T] (depends: T-2.1, T-2.2)
  - File: `src/utils/error-formatter.ts`
  - Test: `tests/unit/error-formatter.test.ts`
  - Description: Implement `formatErrorForCli()` with human-readable output (emoji, colors), debug mode support, and suggestion display

- [ ] **T-2.4** Create MCP error formatter [T] (depends: T-2.1)
  - File: `src/utils/error-formatter.ts` (extend)
  - Test: `tests/unit/error-formatter.test.ts` (extend)
  - Description: Add `formatErrorForMcp()` returning structured JSON with all error context for AI agents

### Group 3: Validation Aggregation

- [ ] **T-3.1** Create validation error collector [T] (depends: T-2.1)
  - File: `src/utils/validation-collector.ts`
  - Test: `tests/unit/validation-collector.test.ts`
  - Description: Implement `ValidationCollector` class to aggregate multiple validation errors, with Zod error mapping

- [ ] **T-3.2** Integrate with Zod schemas [T] (depends: T-3.1)
  - File: `src/mcp/schemas.ts` (modify)
  - Test: `tests/unit/mcp-validation.test.ts`
  - Description: Update schema validation to use collector for aggregated error reporting

### Group 4: Error Logging

- [ ] **T-4.1** Create error logger [T] (depends: T-2.1)
  - File: `src/utils/error-logger.ts`
  - Test: `tests/unit/error-logger.test.ts`
  - Description: Implement `logError()`, `readErrorLog()`, `clearErrorLog()`, `exportErrorLog()`. Include log rotation (max 1000 entries)

- [ ] **T-4.2** Add privacy filtering [T] (depends: T-4.1)
  - File: `src/utils/error-logger.ts` (extend)
  - Test: `tests/unit/error-logger.test.ts` (extend)
  - Description: Implement `sanitizeForLogging()` to strip API keys, tokens, passwords before logging

- [ ] **T-4.3** Create errors CLI command [T] (depends: T-4.1, T-4.2)
  - File: `src/commands/errors.ts`
  - Test: `tests/unit/commands-errors.test.ts`
  - Description: Implement `supertag errors`, `supertag errors --last N`, `supertag errors --clear`, `supertag errors --export`

### Group 5: Integration - Migrate Existing Errors

- [ ] **T-5.1** Update base errors.ts [T] (depends: T-2.1, T-2.3)
  - File: `src/utils/errors.ts` (modify)
  - Test: `tests/unit/errors.test.ts`
  - Description: Update existing error classes to extend StructuredError, update `formatErrorMessage()` to use new formatter

- [ ] **T-5.2** Migrate workspace resolver errors [T] (depends: T-5.1)
  - File: `src/config/workspace-resolver.ts` (modify)
  - Test: `tests/unit/workspace-resolver-errors.test.ts`
  - Description: Update `WorkspaceNotFoundError` and `WorkspaceDatabaseMissingError` to use structured format with recovery hints

- [ ] **T-5.3** Update MCP server error handling [T] (depends: T-2.4, T-3.2, T-5.1)
  - File: `src/mcp/index.ts` (modify)
  - Test: `tests/unit/mcp-errors.test.ts`
  - Description: Wrap all tool execution errors in structured format, return consistent JSON error responses

- [ ] **T-5.4** Add --debug flag support [T] (depends: T-2.3)
  - File: `src/commands/helpers.ts` (modify)
  - Test: `tests/unit/debug-mode.test.ts`
  - Description: Add global `--debug` flag parsing, pass to error formatter for verbose output with stack traces

### Group 6: CLI Command Registration & Docs

- [ ] **T-6.1** Register errors command [T] (depends: T-4.3)
  - File: `src/commands/index.ts` (modify)
  - File: `src/index.ts` (modify if needed)
  - Test: `tests/e2e/errors-command.test.ts`
  - Description: Wire `supertag errors` into main CLI

- [ ] **T-6.2** Update existing commands for structured errors (depends: T-5.1, T-5.4)
  - Files: `src/commands/search.ts`, `src/commands/create.ts`, `src/commands/sync.ts`
  - Description: Migrate key commands to use structured error throwing

- [ ] **T-6.3** Add integration tests [T] (depends: T-6.1, T-6.2)
  - File: `tests/integration/error-flows.test.ts`
  - Description: End-to-end tests for error scenarios: missing workspace, invalid tag, database not found, API errors

- [ ] **T-6.4** Update documentation (depends: T-6.3)
  - Files: `README.md`, `CLAUDE.md`, `SKILL.md`
  - Description: Document error codes, `--debug` flag, `supertag errors` command, MCP error response format

## Dependency Graph

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                         FOUNDATION                           │
                    │                                                              │
                    │   T-1.1 ────┬──────────────> T-2.1 ─────────┐               │
                    │   (types)   │               (StructuredError) │               │
                    │             │                     │           │               │
                    │   T-1.2 ────┤                     │           │               │
                    │   (registry)│                     │           │               │
                    │             │                     ▼           │               │
                    │   T-1.3 ────┴──> T-2.2 ─────> T-2.3          │               │
                    │   (deps)       (suggestions)  (CLI fmt)       │               │
                    │                                   │           │               │
                    └───────────────────────────────────┼───────────┼───────────────┘
                                                        │           │
                    ┌───────────────────────────────────┼───────────┼───────────────┐
                    │                    CORE FEATURES  │           │               │
                    │                                   │           │               │
                    │   T-2.4 <─────────────────────────┘           │               │
                    │   (MCP fmt)                                   │               │
                    │       │                                       │               │
                    │       │          T-3.1 <──────────────────────┘               │
                    │       │          (validation)                                 │
                    │       │              │                                        │
                    │       │              ▼                                        │
                    │       │          T-3.2                                        │
                    │       │          (Zod integration)                            │
                    │       │                                                       │
                    │       │          T-4.1 <──────────────────────────────────────┤
                    │       │          (logger)                                     │
                    │       │              │                                        │
                    │       │              ▼                                        │
                    │       │          T-4.2                                        │
                    │       │          (privacy)                                    │
                    │       │              │                                        │
                    │       │              ▼                                        │
                    │       │          T-4.3                                        │
                    │       │          (errors cmd)                                 │
                    └───────┼──────────────┼────────────────────────────────────────┘
                            │              │
                    ┌───────┼──────────────┼────────────────────────────────────────┐
                    │       │   INTEGRATION│                                        │
                    │       │              │                                        │
                    │       ▼              │                                        │
                    │   T-5.1 <────────────┘                                        │
                    │   (update errors.ts)                                          │
                    │       │                                                       │
                    │       ├──────────────> T-5.2                                  │
                    │       │                (workspace errors)                     │
                    │       │                                                       │
                    │       ├──────────────> T-5.3 <── T-2.4, T-3.2                 │
                    │       │                (MCP server)                           │
                    │       │                                                       │
                    │       └──────────────> T-5.4                                  │
                    │                        (--debug flag)                         │
                    │                            │                                  │
                    └────────────────────────────┼──────────────────────────────────┘
                                                 │
                    ┌────────────────────────────┼──────────────────────────────────┐
                    │           FINALIZATION     │                                  │
                    │                            ▼                                  │
                    │   T-6.1 <── T-4.3     T-6.2 <── T-5.1, T-5.4                  │
                    │   (register cmd)     (migrate commands)                       │
                    │       │                   │                                   │
                    │       └───────────────────┼───────────────────────────────────│
                    │                           ▼                                   │
                    │                       T-6.3                                   │
                    │                       (integration tests)                     │
                    │                           │                                   │
                    │                           ▼                                   │
                    │                       T-6.4                                   │
                    │                       (documentation)                         │
                    └───────────────────────────────────────────────────────────────┘
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2, T-1.3 (foundation - can all run together)
2. **Parallel batch 2:** T-2.1, T-2.2 (after batch 1)
3. **Parallel batch 3:** T-2.3, T-2.4, T-3.1, T-4.1 (after T-2.1)
4. **Parallel batch 4:** T-3.2, T-4.2 (after their deps)
5. **Sequential:** T-4.3 (after T-4.2)
6. **Sequential:** T-5.1 (after T-2.3)
7. **Parallel batch 5:** T-5.2, T-5.3, T-5.4 (after T-5.1)
8. **Parallel batch 6:** T-6.1, T-6.2 (after their deps)
9. **Sequential:** T-6.3 (after batch 6)
10. **Sequential:** T-6.4 (after T-6.3)

**Critical Path:** T-1.1 → T-2.1 → T-2.3 → T-5.1 → T-5.4 → T-6.2 → T-6.3 → T-6.4

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Error type definitions |
| T-1.2 | pending | - | - | Error registry |
| T-1.3 | pending | - | - | Add fastest-levenshtein |
| T-2.1 | pending | - | - | StructuredError class |
| T-2.2 | pending | - | - | Suggestion generator |
| T-2.3 | pending | - | - | CLI error formatter |
| T-2.4 | pending | - | - | MCP error formatter |
| T-3.1 | pending | - | - | Validation collector |
| T-3.2 | pending | - | - | Zod integration |
| T-4.1 | pending | - | - | Error logger |
| T-4.2 | pending | - | - | Privacy filtering |
| T-4.3 | pending | - | - | `supertag errors` command |
| T-5.1 | pending | - | - | Update base errors.ts |
| T-5.2 | pending | - | - | Workspace resolver errors |
| T-5.3 | pending | - | - | MCP server error handling |
| T-5.4 | pending | - | - | --debug flag support |
| T-6.1 | pending | - | - | Register errors command |
| T-6.2 | pending | - | - | Migrate existing commands |
| T-6.3 | pending | - | - | Integration tests |
| T-6.4 | pending | - | - | Documentation |

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

## Implementation Notes

### T-1.1: Type Definitions
- Export all types from `src/types/errors.ts`
- Re-export from `src/types/index.ts` for convenience
- Use string literal union for `ErrorCode` (not enum) for better type inference

### T-2.1: StructuredError Class
- Must extend existing `TanaError` for backward compatibility
- Include static factory methods: `createStructuredError()`, `enrichError()`
- Ensure `instanceof TanaError` still works

### T-4.1: Error Logger
- Log file location: `~/.cache/supertag/errors.log`
- Rotation: Keep last 1000 entries (approx 500KB)
- Format: JSONL (one JSON object per line) for easy parsing

### T-5.3: MCP Server Errors
- All tool errors must return `{ error: StructuredErrorData }` format
- Don't throw from tools - return error in response
- Log all errors before returning
