---
feature: "Batch Workspace Processor"
spec: "./spec.md"
status: "complete"
---

# Technical Plan: Batch Workspace Processor

## Architecture Overview

A utility module that provides consistent batch processing across multiple workspaces. The processor wraps workspace iteration, error handling, progress reporting, and optional parallel execution into a single reusable function.

```
                    ┌─────────────────────────────────────┐
                    │         processWorkspaces()         │
                    │                                     │
                    │  ┌───────────────────────────────┐  │
                    │  │     resolveWorkspaceList()    │  │
                    │  │   (options → [alias, ...])    │  │
                    │  └───────────────────────────────┘  │
                    │                 │                   │
                    │       ┌─────────▼─────────┐         │
                    │       │   For each alias  │         │
                    │       │  (seq or parallel)│         │
                    │       └─────────┬─────────┘         │
                    │                 │                   │
                    │  ┌──────────────▼───────────────┐   │
                    │  │ resolveWorkspaceContext(alias)│   │
                    │  │    (from workspace-resolver)  │   │
                    │  └──────────────┬───────────────┘   │
                    │                 │                   │
                    │       ┌─────────▼─────────┐         │
                    │       │ operation(ws) →   │         │
                    │       │ WorkspaceResult   │         │
                    │       └─────────┬─────────┘         │
                    │                 │                   │
                    │       ┌─────────▼─────────┐         │
                    │       │ onProgress(...)   │         │
                    │       └───────────────────┘         │
                    │                                     │
                    └─────────────────┬───────────────────┘
                                      │
                                      ▼
                              BatchResult<T>
                       {results, successful, failed}
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Async | Native Promise.all | Simple parallel execution |
| Types | Zod-free | Pure TypeScript interfaces (no runtime validation needed) |

## Constitutional Compliance

- [x] **CLI-First:** Utility supports CLI commands with `--all` and `--workspaces` flags
- [x] **Library-First:** Core `processWorkspaces()` function is importable and reusable
- [x] **Test-First:** Unit tests for all functions (see Testing Strategy)
- [x] **Deterministic:** Sequential execution by default; parallel is opt-in with configurable concurrency
- [x] **Code Before Prompts:** Pure code utility, no AI/prompt logic

## Data Model

### Entities

```typescript
/**
 * Options for batch processing (from spec)
 */
export interface BatchOptions {
  /** Process all configured workspaces */
  all?: boolean;

  /** Specific workspaces to process (alternative to --all) */
  workspaces?: string[];

  /** Single workspace (used when not batch mode) */
  workspace?: string;

  /** Continue processing remaining workspaces on error (default: false) */
  continueOnError?: boolean;

  /** Run operations in parallel (default: false for safety) */
  parallel?: boolean;

  /** Maximum parallel operations (default: 4) */
  concurrency?: number;

  /** Show progress for each workspace */
  showProgress?: boolean;
}

/**
 * Result of processing a single workspace
 */
export interface WorkspaceResult<T> {
  workspace: ResolvedWorkspace;
  success: boolean;
  result?: T;
  error?: Error;
  duration: number; // milliseconds
}

/**
 * Summary of batch operation
 */
export interface BatchResult<T> {
  results: WorkspaceResult<T>[];
  successful: number;
  failed: number;
  totalDuration: number;
}

/**
 * Progress callback signature
 */
export type ProgressCallback = (
  workspace: string,
  index: number,
  total: number,
  status: 'start' | 'success' | 'error'
) => void;
```

### Database Schema

No database changes required. Uses existing workspace configuration.

## API Contracts

### Internal APIs

```typescript
// Core batch processing function
export async function processWorkspaces<T>(
  options: BatchOptions,
  operation: (workspace: ResolvedWorkspace) => Promise<T>,
  onProgress?: ProgressCallback
): Promise<BatchResult<T>>;

// Resolve batch options to workspace list
export function resolveWorkspaceList(options: BatchOptions): string[];

// Check if options indicate batch mode
export function isBatchMode(options: BatchOptions): boolean;

// Default progress logger factory
export function createProgressLogger(
  mode: 'pretty' | 'unix'
): ProgressCallback;
```

## Implementation Strategy

### Phase 1: Foundation

Create core types and helper functions.

- [x] Define TypeScript interfaces (BatchOptions, WorkspaceResult, BatchResult)
- [x] Implement `resolveWorkspaceList()` - workspace alias resolution
- [x] Implement `isBatchMode()` - batch detection helper
- [x] Write unit tests for resolution functions

### Phase 2: Core Features

Implement the main processing function.

- [x] Implement `processWorkspaces()` - sequential execution
- [x] Add parallel execution support with chunking
- [x] Add error handling (stop vs continue on error)
- [x] Implement `createProgressLogger()` for default formatting
- [x] Write unit tests for processing logic

### Phase 3: Integration

Migrate existing commands to use the new utility.

- [x] Migrate `sync index --all` command
- [x] Migrate `sync status --all` command
- [x] Migrate `sync cleanup --all` command
- [x] Migrate `embed generate --all-workspaces` command
- [x] Migrate `tana-export --all` command
- [ ] Add `--all` to stats command (new capability) - deferred
- [x] Write integration tests

## File Structure

```
src/
├── config/
│   ├── workspace-resolver.ts    # [Existing] Provides ResolvedWorkspace
│   ├── batch-processor.ts       # [New] Core batch processing utility
│   └── index.ts                 # [Modified] Re-export batch functions
├── commands/
│   ├── sync.ts                  # [Modified] Use processWorkspaces()
│   ├── embed.ts                 # [Modified] Use processWorkspaces()
│   └── stats.ts                 # [Modified] Add --all support
└── cli/
    └── tana-export.ts           # [Modified] Use processWorkspaces()

tests/
├── batch-processor.test.ts      # [New] Unit tests
└── batch-integration.test.ts    # [New] Integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing --all behavior | High | Low | Keep existing error handling semantics as default |
| Parallel execution race conditions | Medium | Low | Default to sequential; parallel is opt-in |
| Performance regression | Low | Low | Benchmark before/after on batch operations |
| Type compatibility with getEnabledWorkspaces | Medium | Medium | Use adapters or migrate callers to ResolvedWorkspace |

## Dependencies

### External

None - uses only built-in Bun/Node APIs.

### Internal

- `workspace-resolver.ts` - Uses `resolveWorkspaceContext()`, `listAvailableWorkspaces()`, `getDefaultWorkspace()`
- `paths.ts` - May need to align `WorkspaceContext` with `ResolvedWorkspace`

## Migration/Deployment

### Compatibility Considerations

The existing `getEnabledWorkspaces()` returns `WorkspaceContext[]` while `resolveWorkspaceContext()` returns `ResolvedWorkspace`. These types are similar but not identical:

| Field | WorkspaceContext | ResolvedWorkspace |
|-------|------------------|-------------------|
| alias | ✓ | ✓ |
| nodeid | ✓ | ✓ (as optional) |
| rootFileId | ✓ | ✓ |
| dbPath | ✓ | ✓ |
| schemaPath | ✓ | ✓ |
| exportDir | ✓ | ✓ |
| config | - | ✓ (full WorkspaceConfig) |
| isDefault | - | ✓ |

**Approach:** The batch processor will use `resolveWorkspaceContext()` internally to get `ResolvedWorkspace`, which is the canonical type from spec 052.

### Migration Steps

1. No database migrations needed
2. No environment variables needed
3. No breaking changes - existing `--all` flags continue to work
4. Commands migrate incrementally

## Estimated Complexity

- **New files:** 1 (`batch-processor.ts`)
- **Modified files:** 5 (`sync.ts`, `embed.ts`, `stats.ts`, `tana-export.ts`, `config/index.ts`)
- **Test files:** 1-2 (`batch-processor.test.ts`, optional integration tests)
- **Estimated tasks:** 8-10
- **Lines saved:** ~120 (duplicated batch logic consolidated)
