---
feature: "Error Context"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Error Context

## Architecture Overview

Enhance the existing error infrastructure to provide structured, actionable errors with recovery suggestions. The system will unify error handling across CLI and MCP while maintaining backward compatibility.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Error Flow                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐   │
│   │   Throw     │───>│  StructuredError │───>│   Formatter     │   │
│   │   Error     │    │   (enriched)     │    │   (CLI/MCP)     │   │
│   └─────────────┘    └──────────────────┘    └─────────────────┘   │
│         │                    │                        │              │
│         │                    │                        ▼              │
│         │                    │            ┌──────────────────────┐  │
│         │                    │            │  CLI: Human-readable │  │
│         │                    │            │  MCP: JSON structure │  │
│         │                    │            └──────────────────────┘  │
│         │                    │                                       │
│         │                    ▼                                       │
│         │           ┌──────────────────┐                            │
│         │           │  ErrorRegistry   │                            │
│         │           │  (codes, hints)  │                            │
│         │           └──────────────────┘                            │
│         │                    │                                       │
│         ▼                    ▼                                       │
│   ┌──────────────────────────────────────┐                          │
│   │           Error Logger               │                          │
│   │  (~/.cache/supertag/errors.log)      │                          │
│   └──────────────────────────────────────┘                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Fuzzy matching | `fastest-levenshtein` | Lightweight, fast, for typo suggestions |
| Error serialization | Zod | Already used for validation, consistent typing |
| Log rotation | Built-in | Simple file-based, no external deps |

## Constitutional Compliance

- [x] **CLI-First:** New `supertag errors` command for error log management
- [x] **Library-First:** Core error utilities in `src/utils/structured-errors.ts`, reusable across CLI/MCP
- [x] **Test-First:** TDD for error formatting, suggestion generation, and recovery hints
- [x] **Deterministic:** All error codes and suggestions are deterministic mappings
- [x] **Code Before Prompts:** Error messages and suggestions are code-driven, not AI-generated

## Data Model

### Entities

```typescript
// src/types/errors.ts

/**
 * Standardized error codes organized by category
 */
export type ErrorCode =
  // Config errors
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'WORKSPACE_NOT_FOUND'
  | 'API_KEY_MISSING'
  // Input errors
  | 'INVALID_PARAMETER'
  | 'MISSING_REQUIRED'
  | 'INVALID_FORMAT'
  | 'NODE_NOT_FOUND'
  | 'TAG_NOT_FOUND'
  // Database errors
  | 'DATABASE_NOT_FOUND'
  | 'DATABASE_CORRUPT'
  | 'DATABASE_LOCKED'
  | 'SYNC_REQUIRED'
  // Network errors
  | 'API_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  // Auth errors
  | 'AUTH_FAILED'
  | 'PERMISSION_DENIED'
  // Internal
  | 'INTERNAL_ERROR'
  | 'VALIDATION_ERRORS';

/**
 * Structured error with full context
 */
export interface StructuredErrorData {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  suggestion?: string;
  example?: string;
  docUrl?: string;
  recovery?: RecoveryInfo;
  validationErrors?: ValidationErrorItem[];
}

/**
 * Recovery information for AI agents
 */
export interface RecoveryInfo {
  retryable: boolean;
  retryAfter?: number;          // seconds
  retryStrategy?: 'immediate' | 'exponential';
  maxRetries?: number;
  alternativeAction?: string;
  alternativeParams?: Record<string, unknown>;
  retryWith?: Record<string, unknown>;
}

/**
 * Field-level validation error
 */
export interface ValidationErrorItem {
  field: string;
  code: string;
  message: string;
  value?: unknown;
  expected?: string;
  suggestion?: string;
}

/**
 * Error log entry
 */
export interface ErrorLogEntry {
  timestamp: string;
  code: ErrorCode;
  message: string;
  command?: string;
  workspace?: string;
  details?: Record<string, unknown>;
  stack?: string;
}
```

### Error Registry

```typescript
// src/utils/error-registry.ts

/**
 * Error metadata for each error code
 */
export interface ErrorMeta {
  category: 'config' | 'input' | 'database' | 'network' | 'auth' | 'internal';
  defaultSuggestion?: string;
  docPath?: string;
  retryable: boolean;
}

export const ERROR_REGISTRY: Record<ErrorCode, ErrorMeta> = {
  WORKSPACE_NOT_FOUND: {
    category: 'config',
    defaultSuggestion: 'Use one of the available workspaces, or create a new one with: supertag workspace add <name>',
    docPath: '/docs/workspaces',
    retryable: false,
  },
  DATABASE_NOT_FOUND: {
    category: 'database',
    defaultSuggestion: 'Run "supertag sync" to create the database.',
    docPath: '/docs/sync',
    retryable: false,
  },
  RATE_LIMITED: {
    category: 'network',
    defaultSuggestion: 'Wait and retry after the specified time.',
    retryable: true,
  },
  // ... etc
};
```

## API Contracts

### Internal APIs

```typescript
// src/utils/structured-errors.ts

/**
 * Create a structured error with full context
 */
export function createStructuredError(
  code: ErrorCode,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    cause?: Error;
    recovery?: RecoveryInfo;
  }
): StructuredError;

/**
 * Enrich an existing error with structured data
 */
export function enrichError(
  error: Error,
  code: ErrorCode,
  options?: {
    details?: Record<string, unknown>;
    recovery?: RecoveryInfo;
  }
): StructuredError;

/**
 * Find similar values using fuzzy matching
 */
export function findSimilarValues(
  input: string,
  candidates: string[],
  options?: { maxResults?: number; threshold?: number }
): string[];

/**
 * Generate suggestion based on error code and context
 */
export function generateSuggestion(
  code: ErrorCode,
  details?: Record<string, unknown>
): string | undefined;
```

```typescript
// src/utils/error-formatter.ts

/**
 * Format error for CLI output (human-readable)
 */
export function formatErrorForCli(
  error: StructuredError,
  options?: { debug?: boolean; color?: boolean }
): string;

/**
 * Format error for MCP response (JSON)
 */
export function formatErrorForMcp(
  error: StructuredError
): { error: StructuredErrorData };
```

```typescript
// src/utils/error-logger.ts

/**
 * Log error to persistent log file
 */
export function logError(
  error: StructuredError,
  context?: { command?: string; workspace?: string }
): void;

/**
 * Read recent errors from log
 */
export function readErrorLog(options?: {
  last?: number;
  since?: Date;
}): ErrorLogEntry[];

/**
 * Clear error log
 */
export function clearErrorLog(): void;

/**
 * Export error log as JSON
 */
export function exportErrorLog(): ErrorLogEntry[];
```

### MCP Error Response Format

```typescript
// Standard MCP error response
{
  error: {
    code: "TAG_NOT_FOUND",
    message: "Tag 'meetting' not found",
    details: {
      tag: "meetting",
      availableTags: ["meeting", "meetings", "task"]
    },
    suggestion: "Did you mean: meeting, meetings?",
    example: "tana_tagged({ tag: 'meeting' })",
    docUrl: "https://supertag.dev/docs/tags",
    recovery: {
      retryable: true,
      retryWith: { tag: "meeting" }
    }
  }
}
```

## Implementation Strategy

### Phase 1: Foundation

Extend existing error infrastructure with structured data.

- [ ] Create `src/types/errors.ts` with error code types
- [ ] Create `src/utils/error-registry.ts` with error metadata
- [ ] Create `src/utils/structured-errors.ts` with `StructuredError` class
- [ ] Add `fastest-levenshtein` dependency for fuzzy matching
- [ ] Write unit tests for structured error creation

**Key decision:** `StructuredError` extends existing `TanaError` to maintain backward compatibility.

### Phase 2: Core Features

Implement error formatting and suggestion generation.

- [ ] Create `src/utils/error-formatter.ts` for CLI/MCP formatting
- [ ] Create `src/utils/suggestion-generator.ts` for smart suggestions
- [ ] Integrate fuzzy matching for typo detection
- [ ] Add debug mode support to formatter
- [ ] Write unit tests for formatting and suggestions

### Phase 3: Error Logging

Add persistent error logging infrastructure.

- [ ] Create `src/utils/error-logger.ts` for log management
- [ ] Create `supertag errors` CLI command
- [ ] Add log rotation (keep last 1000 entries)
- [ ] Ensure no sensitive data is logged
- [ ] Write unit tests for logging

### Phase 4: Integration

Wire structured errors throughout the codebase.

- [ ] Update `src/utils/errors.ts` to use structured errors
- [ ] Update MCP server to format errors consistently
- [ ] Add `--debug` flag to all CLI commands
- [ ] Migrate existing error throws to use new system
- [ ] Add integration tests for error flows

### Phase 5: Validation Aggregation

Enhance validation error handling.

- [ ] Create `src/utils/validation-collector.ts` for aggregating errors
- [ ] Update Zod error handling to collect all errors
- [ ] Format multi-error responses
- [ ] Write tests for validation aggregation

## File Structure

```
src/
├── types/
│   └── errors.ts               # [New] Error type definitions
├── utils/
│   ├── errors.ts               # [Modified] Extend with structured errors
│   ├── error-registry.ts       # [New] Error metadata registry
│   ├── structured-errors.ts    # [New] StructuredError class
│   ├── error-formatter.ts      # [New] CLI/MCP formatters
│   ├── suggestion-generator.ts # [New] Smart suggestions
│   ├── error-logger.ts         # [New] Persistent logging
│   └── validation-collector.ts # [New] Validation aggregation
├── commands/
│   ├── errors.ts               # [New] `supertag errors` command
│   └── index.ts                # [Modified] Add errors command
├── mcp/
│   └── index.ts                # [Modified] Use structured error responses
└── config/
    └── workspace-resolver.ts   # [Modified] Use structured errors

tests/
├── unit/
│   ├── structured-errors.test.ts
│   ├── error-formatter.test.ts
│   ├── suggestion-generator.test.ts
│   ├── error-logger.test.ts
│   └── validation-collector.test.ts
└── integration/
    └── error-flows.test.ts
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing error handling | High | Medium | Extend rather than replace; maintain backward compat with `TanaError` |
| Performance overhead from enrichment | Low | Low | Lazy evaluation of suggestions; cache fuzzy matches |
| Log file grows unbounded | Medium | Medium | Implement log rotation (max 1000 entries, ~500KB) |
| Sensitive data in error logs | High | Low | Strip API keys, tokens, passwords before logging |
| MCP response format change | Medium | Low | Errors in MCP are already unstructured; this improves consistency |

## Dependencies

### External

- `fastest-levenshtein` (^1.0.16) - Fuzzy string matching for typo suggestions
  - Already using similar patterns, just need optimized algorithm
  - Lightweight (2KB), no dependencies, fast

### Internal

- `src/utils/errors.ts` - Existing error classes (extend)
- `src/utils/logger.ts` - Existing logger (use for debug output)
- `src/config/workspace-resolver.ts` - Existing workspace errors (migrate)
- `src/mcp/schemas.ts` - Zod schemas (for validation error mapping)

## Migration/Deployment

- [ ] **Database migrations:** None required
- [ ] **Environment variables:** None required
- [ ] **Breaking changes:** None - backward compatible extension
- [ ] **Error log location:** `~/.cache/supertag/errors.log`

**Migration strategy:**
1. Deploy structured error infrastructure
2. Gradually migrate existing error throws
3. Add structured errors to new code immediately
4. Optional: Migrate old errors in follow-up PR

## Estimated Complexity

- **New files:** ~8
- **Modified files:** ~5
- **Test files:** ~6
- **Estimated tasks:** ~18-22

## Appendix: Error Code Reference

| Code | Category | Retryable | Default Suggestion |
|------|----------|-----------|-------------------|
| `CONFIG_NOT_FOUND` | config | No | Run `supertag config` to create configuration |
| `CONFIG_INVALID` | config | No | Check config file syntax |
| `WORKSPACE_NOT_FOUND` | config | No | Use available workspace or create new one |
| `API_KEY_MISSING` | config | No | Set via `supertag config set apiKey <key>` |
| `INVALID_PARAMETER` | input | No | Check parameter value and type |
| `MISSING_REQUIRED` | input | No | Provide required parameter |
| `INVALID_FORMAT` | input | No | Use expected format |
| `NODE_NOT_FOUND` | input | No | Search for node with `supertag search` |
| `TAG_NOT_FOUND` | input | Yes | Use similar tag (fuzzy match) |
| `DATABASE_NOT_FOUND` | database | No | Run `supertag sync` |
| `DATABASE_CORRUPT` | database | No | Delete and re-sync database |
| `DATABASE_LOCKED` | database | Yes | Wait and retry |
| `SYNC_REQUIRED` | database | No | Run `supertag sync --force` |
| `API_ERROR` | network | Varies | Check API response for details |
| `RATE_LIMITED` | network | Yes | Wait `retryAfter` seconds |
| `TIMEOUT` | network | Yes | Retry with exponential backoff |
| `NETWORK_ERROR` | network | Yes | Check network connection |
| `AUTH_FAILED` | auth | No | Check API key |
| `PERMISSION_DENIED` | auth | No | Check permissions |
| `INTERNAL_ERROR` | internal | No | Report bug with error log |
| `VALIDATION_ERRORS` | input | No | Fix all listed validation errors |
