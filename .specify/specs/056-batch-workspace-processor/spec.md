---
id: "056"
feature: "Batch Workspace Processor"
status: "completed"
created: "2025-12-30"
completed: "2026-01-01"
priority: "medium"
---

# Specification: Batch Workspace Processor

**Priority**: Medium (~120 LOC saved, consistent multi-workspace handling)

## Overview

This specification defines a batch processing utility for executing operations across multiple workspaces. Several commands support `--all` or `--workspaces` flags to operate on multiple workspaces, but each implements this logic independently.

## Problem Statement

### Current State: Duplicated Batch Logic

Multi-workspace operations are scattered with similar patterns:

```typescript
// Pattern repeated in stats, embed, sync commands:
const workspaces = options.all
  ? Object.keys(config.workspaces)
  : [options.workspace || config.defaultWorkspace];

for (const alias of workspaces) {
  try {
    const ws = resolveWorkspace(alias, config);
    // ... perform operation
    console.log(`✓ ${alias}: completed`);
  } catch (error) {
    console.error(`✗ ${alias}: ${error.message}`);
    if (!options.continueOnError) throw error;
  }
}
```

### Duplication Statistics

- **~120 lines** of duplicated batch processing logic
- **~5 commands** with `--all` flag support
- **Inconsistent error handling** - Some continue on error, some stop
- **Inconsistent output** - Different progress reporting

### Issues

1. **Duplicate workspace iteration** - Same loop in multiple commands
2. **Inconsistent error handling** - Some stop on first error, some continue
3. **No progress tracking** - Hard to see which workspaces processed
4. **Missing parallel support** - All commands run sequentially

## Proposed Solution

### New Module: `src/config/batch-processor.ts`

A batch processing utility that:

1. Iterates over multiple workspaces
2. Provides consistent error handling options
3. Reports progress uniformly
4. Supports parallel execution (optional)

## Interface Design

### Core Types

```typescript
import { ResolvedWorkspace } from './workspace-resolver';

/**
 * Options for batch processing
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
 * Progress callback for batch operations
 */
export type ProgressCallback = (
  workspace: string,
  index: number,
  total: number,
  status: 'start' | 'success' | 'error'
) => void;
```

### processWorkspaces()

```typescript
/**
 * Process operation across one or more workspaces
 *
 * @param options - Batch processing options
 * @param operation - Function to execute for each workspace
 * @param onProgress - Optional progress callback
 * @returns Batch result with all workspace results
 *
 * @example
 * // Single workspace (normal operation)
 * const result = await processWorkspaces(
 *   { workspace: 'main' },
 *   async (ws) => getStats(ws.dbPath)
 * );
 *
 * @example
 * // All workspaces
 * const result = await processWorkspaces(
 *   { all: true, continueOnError: true },
 *   async (ws) => syncWorkspace(ws),
 *   (ws, i, total, status) => console.log(`[${i}/${total}] ${ws}: ${status}`)
 * );
 *
 * @example
 * // Specific workspaces in parallel
 * const result = await processWorkspaces(
 *   { workspaces: ['main', 'books'], parallel: true },
 *   async (ws) => generateEmbeddings(ws.dbPath)
 * );
 */
export async function processWorkspaces<T>(
  options: BatchOptions,
  operation: (workspace: ResolvedWorkspace) => Promise<T>,
  onProgress?: ProgressCallback
): Promise<BatchResult<T>>;
```

### resolveWorkspaceList()

```typescript
/**
 * Resolve batch options to list of workspace aliases
 *
 * @param options - Batch options
 * @returns Array of workspace aliases to process
 *
 * @example
 * // All workspaces
 * resolveWorkspaceList({ all: true });
 * // ['main', 'books', 'work']
 *
 * @example
 * // Specific workspaces
 * resolveWorkspaceList({ workspaces: ['main', 'books'] });
 * // ['main', 'books']
 *
 * @example
 * // Single workspace (defaults to 'main')
 * resolveWorkspaceList({ workspace: 'books' });
 * // ['books']
 */
export function resolveWorkspaceList(options: BatchOptions): string[];
```

### isBatchMode()

```typescript
/**
 * Check if options indicate batch mode (multiple workspaces)
 *
 * @param options - Batch options
 * @returns True if processing multiple workspaces
 */
export function isBatchMode(options: BatchOptions): boolean;
```

## Implementation Details

### processWorkspaces Implementation

```typescript
import { resolveWorkspaceContext, listAvailableWorkspaces } from './workspace-resolver';

export async function processWorkspaces<T>(
  options: BatchOptions,
  operation: (workspace: ResolvedWorkspace) => Promise<T>,
  onProgress?: ProgressCallback
): Promise<BatchResult<T>> {
  const startTime = Date.now();
  const workspaceAliases = resolveWorkspaceList(options);
  const total = workspaceAliases.length;

  const results: WorkspaceResult<T>[] = [];

  // Parallel execution
  if (options.parallel) {
    const concurrency = options.concurrency ?? 4;
    const chunks = chunkArray(workspaceAliases, concurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map((alias, idx) =>
          processOne(alias, operation, onProgress, results.length + idx, total, options)
        )
      );
      results.push(...chunkResults);
    }
  }
  // Sequential execution
  else {
    for (let i = 0; i < workspaceAliases.length; i++) {
      const alias = workspaceAliases[i];
      const result = await processOne(alias, operation, onProgress, i, total, options);
      results.push(result);

      // Stop on first error if not continuing
      if (!result.success && !options.continueOnError) {
        break;
      }
    }
  }

  return {
    results,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    totalDuration: Date.now() - startTime,
  };
}

async function processOne<T>(
  alias: string,
  operation: (workspace: ResolvedWorkspace) => Promise<T>,
  onProgress: ProgressCallback | undefined,
  index: number,
  total: number,
  options: BatchOptions
): Promise<WorkspaceResult<T>> {
  const startTime = Date.now();

  onProgress?.(alias, index + 1, total, 'start');

  try {
    const workspace = resolveWorkspaceContext({ workspace: alias });
    const result = await operation(workspace);

    onProgress?.(alias, index + 1, total, 'success');

    return {
      workspace,
      success: true,
      result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    onProgress?.(alias, index + 1, total, 'error');

    return {
      workspace: { alias } as ResolvedWorkspace,
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      duration: Date.now() - startTime,
    };
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```

### resolveWorkspaceList Implementation

```typescript
export function resolveWorkspaceList(options: BatchOptions): string[] {
  // Explicit list of workspaces
  if (options.workspaces && options.workspaces.length > 0) {
    return options.workspaces;
  }

  // All workspaces
  if (options.all) {
    return listAvailableWorkspaces();
  }

  // Single workspace (default to 'main')
  const single = options.workspace ?? getDefaultWorkspace();
  return [single];
}

export function isBatchMode(options: BatchOptions): boolean {
  return options.all === true ||
    (options.workspaces !== undefined && options.workspaces.length > 1);
}
```

## Migration Targets

### Files to Update

| File | Current Pattern | New Pattern |
|------|-----------------|-------------|
| `src/commands/stats.ts` | Manual workspace loop | `processWorkspaces()` |
| `src/commands/embed.ts` | Manual workspace loop | `processWorkspaces()` |
| `src/commands/sync.ts` | Manual workspace loop | `processWorkspaces()` |
| `src/commands/check.ts` | Manual workspace loop | `processWorkspaces()` |

### Before/After Example

**Before** (stats command):
```typescript
export async function statsCommand(options: StatsOptions) {
  const configManager = ConfigManager.getInstance();
  const config = configManager.getConfig();

  const workspaces = options.all
    ? Object.keys(config.workspaces)
    : [options.workspace || config.defaultWorkspace];

  const allStats: WorkspaceStats[] = [];

  for (const alias of workspaces) {
    try {
      const ws = resolveWorkspace(alias, config);
      if (!existsSync(ws.dbPath)) {
        console.error(`Workspace '${alias}' has no database. Run 'supertag sync' first.`);
        continue;
      }

      const db = new Database(ws.dbPath);
      try {
        const stats = collectStats(db);
        allStats.push({ workspace: alias, ...stats });

        if (options.all) {
          console.log(`✓ ${alias}: ${stats.nodes} nodes`);
        }
      } finally {
        db.close();
      }
    } catch (error) {
      console.error(`✗ ${alias}: ${error.message}`);
      if (!options.continueOnError) throw error;
    }
  }

  // Format and output
  formatStats(allStats, options);
}
```

**After**:
```typescript
export async function statsCommand(options: StatsOptions) {
  const result = await processWorkspaces(
    {
      all: options.all,
      workspace: options.workspace,
      continueOnError: options.continueOnError,
    },
    async (ws) => withDatabase({ dbPath: ws.dbPath }, (ctx) => collectStats(ctx.db)),
    (alias, i, total, status) => {
      if (isBatchMode(options)) {
        const icon = status === 'success' ? '✓' : status === 'error' ? '✗' : '⋯';
        console.log(`${icon} [${i}/${total}] ${alias}`);
      }
    }
  );

  // Format and output results
  const allStats = result.results
    .filter(r => r.success)
    .map(r => ({ workspace: r.workspace.alias, ...r.result }));

  formatStats(allStats, options);

  if (result.failed > 0) {
    console.error(`\n${result.failed} workspace(s) failed`);
    process.exitCode = 1;
  }
}
```

## Progress Formatting

### Default Progress Output

```typescript
/**
 * Default progress formatter for CLI output
 */
export function createProgressLogger(
  mode: 'pretty' | 'unix' = 'pretty'
): ProgressCallback {
  return (alias, index, total, status) => {
    if (mode === 'pretty') {
      const icon = {
        start: '⋯',
        success: '✓',
        error: '✗',
      }[status];
      console.log(`${icon} [${index}/${total}] ${alias}`);
    } else {
      // Unix mode: only output on completion
      if (status !== 'start') {
        console.log(`${alias}\t${status}`);
      }
    }
  };
}
```

## Testing Strategy

### Unit Tests

```typescript
describe('resolveWorkspaceList', () => {
  it('should return all workspaces when all=true', () => {
    const list = resolveWorkspaceList({ all: true });
    expect(list).toEqual(['main', 'books', 'work']);
  });

  it('should return explicit workspaces', () => {
    const list = resolveWorkspaceList({ workspaces: ['main', 'books'] });
    expect(list).toEqual(['main', 'books']);
  });

  it('should return single workspace', () => {
    const list = resolveWorkspaceList({ workspace: 'books' });
    expect(list).toEqual(['books']);
  });

  it('should default to main workspace', () => {
    const list = resolveWorkspaceList({});
    expect(list).toEqual(['main']);
  });
});

describe('processWorkspaces', () => {
  it('should process single workspace', async () => {
    const result = await processWorkspaces(
      { workspace: 'main' },
      async (ws) => `processed ${ws.alias}`
    );

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].result).toBe('processed main');
  });

  it('should process all workspaces', async () => {
    const result = await processWorkspaces(
      { all: true },
      async (ws) => `processed ${ws.alias}`
    );

    expect(result.successful).toBe(3);
    expect(result.results.map(r => r.result)).toEqual([
      'processed main',
      'processed books',
      'processed work',
    ]);
  });

  it('should stop on error by default', async () => {
    const result = await processWorkspaces(
      { workspaces: ['main', 'invalid', 'books'] },
      async (ws) => {
        if (ws.alias === 'invalid') throw new Error('Test error');
        return ws.alias;
      }
    );

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(2);
  });

  it('should continue on error when configured', async () => {
    const result = await processWorkspaces(
      { workspaces: ['main', 'invalid', 'books'], continueOnError: true },
      async (ws) => {
        if (ws.alias === 'invalid') throw new Error('Test error');
        return ws.alias;
      }
    );

    expect(result.successful).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(3);
  });

  it('should support parallel execution', async () => {
    const startTime = Date.now();

    await processWorkspaces(
      { all: true, parallel: true },
      async (ws) => {
        await new Promise(r => setTimeout(r, 100));
        return ws.alias;
      }
    );

    const duration = Date.now() - startTime;
    // Should be ~100ms (parallel) not ~300ms (sequential)
    expect(duration).toBeLessThan(200);
  });

  it('should call progress callback', async () => {
    const calls: string[] = [];

    await processWorkspaces(
      { workspaces: ['main', 'books'] },
      async () => 'done',
      (alias, i, total, status) => {
        calls.push(`${alias}:${status}`);
      }
    );

    expect(calls).toEqual([
      'main:start', 'main:success',
      'books:start', 'books:success',
    ]);
  });
});

describe('isBatchMode', () => {
  it('should return true for all=true', () => {
    expect(isBatchMode({ all: true })).toBe(true);
  });

  it('should return true for multiple workspaces', () => {
    expect(isBatchMode({ workspaces: ['a', 'b'] })).toBe(true);
  });

  it('should return false for single workspace', () => {
    expect(isBatchMode({ workspace: 'main' })).toBe(false);
    expect(isBatchMode({ workspaces: ['main'] })).toBe(false);
  });
});
```

## Success Criteria

1. **Unified batch processing** - One implementation for all commands
2. **Consistent progress** - Same output format across commands
3. **Error handling options** - Continue or stop on error
4. **Parallel support** - Optional parallel execution
5. **~120 lines saved** - Reduced duplication
6. **Type-safe results** - Full TypeScript coverage

## Out of Scope

- Cross-workspace queries (different concern)
- Workspace creation/deletion (handled by workspace command)
- Streaming results (batch returns all at once)

## Dependencies

- **Unified Workspace Resolver** - For `resolveWorkspaceContext()` and `listAvailableWorkspaces()`

## Related Specs

- **Unified Workspace Resolver** - Provides workspace resolution
- **Database Resource Management** - Used within batch operations
