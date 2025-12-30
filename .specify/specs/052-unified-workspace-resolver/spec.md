---
id: "052"
feature: "Unified Workspace Resolver"
status: "draft"
created: "2025-12-30"
priority: "high"
---

# Specification: Unified Workspace Resolver

**Priority**: High (cross-binary duplication, ~250 LOC saved)

## Overview

This specification defines a unified workspace resolution module to eliminate duplicated workspace lookup logic across all three binaries (CLI, Export CLI, MCP Server).

## Problem Statement

### Current State: Duplicated Resolution Logic

Workspace resolution is implemented in 3+ locations:

1. **CLI** (`src/commands/*.ts`): Multiple commands call `resolveWorkspace()` with similar patterns
2. **Export CLI** (`src/export/commands/*.ts`): Duplicates workspace detection logic
3. **MCP Server** (`src/mcp/tools/*.ts`): Each tool resolves workspaces independently

### Duplication Examples

```typescript
// Pattern repeated in ~15 files:
const configManager = ConfigManager.getInstance();
const config = configManager.getConfig();
const workspace = resolveWorkspace(input.workspace, config);
const db = new Database(workspace.dbPath);
try {
  // use database
} finally {
  db.close();
}
```

### Issues

1. **Inconsistent error handling** - Each location handles missing workspaces differently
2. **Repeated boilerplate** - Same 5-10 lines copied across many files
3. **Different default behaviors** - Some commands fall back to 'main', others throw
4. **No caching** - Workspace resolution computed repeatedly
5. **Testing difficulty** - Hard to mock workspace resolution in tests

## Proposed Solution

### New Module: `src/config/workspace-resolver.ts`

A single, well-tested module that:
1. Resolves workspace alias to full workspace context
2. Provides consistent error messages
3. Caches resolved workspaces within a request
4. Supports test overrides
5. Handles all edge cases uniformly

## Interface Design

```typescript
/**
 * Resolved workspace context - everything needed to work with a workspace
 */
export interface ResolvedWorkspace {
  alias: string;
  config: WorkspaceConfig;
  dbPath: string;
  isDefault: boolean;
}

/**
 * Options for workspace resolution
 */
export interface ResolveOptions {
  /** Workspace alias (optional, uses default if not provided) */
  workspace?: string;

  /** Require database to exist (default: true for most operations) */
  requireDatabase?: boolean;

  /** Custom config override (for testing) */
  config?: Config;
}

/**
 * Error thrown when workspace resolution fails
 */
export class WorkspaceNotFoundError extends Error {
  constructor(
    public readonly alias: string,
    public readonly availableWorkspaces: string[]
  ) {
    const available = availableWorkspaces.length > 0
      ? `\nAvailable: ${availableWorkspaces.join(', ')}`
      : '\nNo workspaces configured.';
    super(`Workspace not found: ${alias}${available}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

/**
 * Error thrown when workspace database is missing
 */
export class WorkspaceDatabaseMissingError extends Error {
  constructor(
    public readonly alias: string,
    public readonly dbPath: string
  ) {
    super(
      `Workspace '${alias}' database not found at: ${dbPath}\n` +
      `Run 'supertag sync' to create the database.`
    );
    this.name = 'WorkspaceDatabaseMissingError';
  }
}
```

## Core Functions

### resolveWorkspaceContext()

```typescript
/**
 * Resolve workspace alias to full context
 *
 * @param options - Resolution options
 * @returns Resolved workspace context
 * @throws WorkspaceNotFoundError if alias doesn't exist
 * @throws WorkspaceDatabaseMissingError if requireDatabase and DB missing
 *
 * @example
 * // Use default workspace
 * const ws = resolveWorkspaceContext();
 *
 * @example
 * // Resolve specific workspace
 * const ws = resolveWorkspaceContext({ workspace: 'books' });
 *
 * @example
 * // Allow missing database (for sync command)
 * const ws = resolveWorkspaceContext({
 *   workspace: 'new-workspace',
 *   requireDatabase: false
 * });
 */
export function resolveWorkspaceContext(
  options?: ResolveOptions
): ResolvedWorkspace;
```

### listAvailableWorkspaces()

```typescript
/**
 * Get all configured workspace aliases
 *
 * @returns Array of workspace aliases
 */
export function listAvailableWorkspaces(): string[];
```

### getDefaultWorkspace()

```typescript
/**
 * Get the default workspace alias
 *
 * @returns Default workspace alias (usually 'main')
 */
export function getDefaultWorkspace(): string;
```

### withWorkspace()

```typescript
/**
 * Execute a function with resolved workspace context
 * Useful for commands that need workspace context
 *
 * @param options - Resolution options
 * @param fn - Function to execute with workspace context
 * @returns Result of the function
 *
 * @example
 * const result = await withWorkspace({ workspace: 'main' }, async (ws) => {
 *   const db = new Database(ws.dbPath);
 *   try {
 *     return await queryDatabase(db);
 *   } finally {
 *     db.close();
 *   }
 * });
 */
export function withWorkspace<T>(
  options: ResolveOptions | undefined,
  fn: (workspace: ResolvedWorkspace) => T | Promise<T>
): Promise<T>;
```

## Migration Targets

### Files to Update

| File | Current Pattern | New Pattern |
|------|-----------------|-------------|
| `src/commands/search.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/commands/stats.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/commands/sync.ts` | Manual resolution | `resolveWorkspaceContext({ requireDatabase: false })` |
| `src/commands/create.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/commands/nodes.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/commands/tags.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/commands/embed.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/commands/workspace.ts` | Manual resolution | `listAvailableWorkspaces()` |
| `src/export/commands/*.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/mcp/tools/search.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/mcp/tools/create.ts` | Manual resolution | `resolveWorkspaceContext()` |
| `src/mcp/tools/query.ts` | Manual resolution | `resolveWorkspaceContext()` |

### Before/After Example

**Before** (repeated in 15+ files):
```typescript
export async function searchCommand(query: string, options: SearchOptions) {
  const configManager = ConfigManager.getInstance();
  const config = configManager.getConfig();

  let workspace: WorkspaceConfig;
  try {
    workspace = resolveWorkspace(options.workspace, config);
  } catch (error) {
    console.error(`Workspace error: ${error.message}`);
    process.exit(1);
  }

  if (!existsSync(workspace.dbPath)) {
    console.error(`Database not found. Run 'supertag sync' first.`);
    process.exit(1);
  }

  const db = new Database(workspace.dbPath);
  try {
    // ... actual search logic
  } finally {
    db.close();
  }
}
```

**After**:
```typescript
export async function searchCommand(query: string, options: SearchOptions) {
  const ws = resolveWorkspaceContext({ workspace: options.workspace });

  const db = new Database(ws.dbPath);
  try {
    // ... actual search logic
  } finally {
    db.close();
  }
}
```

## Implementation Details

### Caching Strategy

```typescript
// Cache resolved workspaces to avoid repeated lookups
const cache = new Map<string, ResolvedWorkspace>();

export function resolveWorkspaceContext(options?: ResolveOptions): ResolvedWorkspace {
  const config = options?.config ?? ConfigManager.getInstance().getConfig();
  const alias = options?.workspace ?? config.defaultWorkspace ?? 'main';

  // Return cached if available
  const cacheKey = alias;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  // Resolve and cache
  const resolved = doResolve(alias, config, options?.requireDatabase ?? true);
  cache.set(cacheKey, resolved);
  return resolved;
}

// Clear cache between requests (for MCP server)
export function clearWorkspaceCache(): void {
  cache.clear();
}
```

### Error Message Consistency

All workspace errors should include:
1. What was requested
2. What's available
3. Suggested action

```
Workspace not found: typo-workspace
Available: main, books, work
```

```
Workspace 'books' database not found at: /path/to/db
Run 'supertag sync --workspace books' to create the database.
```

## Testing Strategy

### Unit Tests

```typescript
describe('resolveWorkspaceContext', () => {
  it('should resolve default workspace when no alias provided', () => {
    const ws = resolveWorkspaceContext();
    expect(ws.alias).toBe('main');
    expect(ws.isDefault).toBe(true);
  });

  it('should resolve specific workspace by alias', () => {
    const ws = resolveWorkspaceContext({ workspace: 'books' });
    expect(ws.alias).toBe('books');
    expect(ws.isDefault).toBe(false);
  });

  it('should throw WorkspaceNotFoundError for unknown alias', () => {
    expect(() => resolveWorkspaceContext({ workspace: 'unknown' }))
      .toThrow(WorkspaceNotFoundError);
  });

  it('should throw WorkspaceDatabaseMissingError when requireDatabase', () => {
    expect(() => resolveWorkspaceContext({
      workspace: 'empty',
      requireDatabase: true
    })).toThrow(WorkspaceDatabaseMissingError);
  });

  it('should allow missing database when requireDatabase is false', () => {
    const ws = resolveWorkspaceContext({
      workspace: 'empty',
      requireDatabase: false
    });
    expect(ws.alias).toBe('empty');
  });
});
```

### Integration Tests

```typescript
describe('workspace resolution integration', () => {
  it('should work with search command', async () => {
    const result = await searchCommand('test', { workspace: 'main' });
    expect(result).toBeDefined();
  });

  it('should show helpful error for missing workspace', async () => {
    await expect(searchCommand('test', { workspace: 'nope' }))
      .rejects.toThrow(/Workspace not found.*Available:/);
  });
});
```

## Success Criteria

1. **Single source of truth** - All workspace resolution goes through this module
2. **Consistent errors** - Same error format and messages across all binaries
3. **Reduced duplication** - ~250 lines of duplicated code removed
4. **Better testability** - Easy to mock workspace resolution
5. **Type safety** - Full TypeScript types for workspace context
6. **Backward compatibility** - No change to CLI/MCP interface

## Out of Scope

- Workspace management (create, delete, configure) - existing commands handle this
- Workspace validation (checking DB integrity) - separate concern
- Multi-workspace queries - handled by batch processor spec

## Dependencies

- None (this is a foundational module)

## Related Specs

- **Database Resource Management** - Uses this for workspace resolution before opening DB
- **Batch Workspace Processor** - Uses `listAvailableWorkspaces()` for `--all` flag
