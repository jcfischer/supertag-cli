---
id: "053"
feature: "Database Resource Management"
status: "completed"
created: "2025-12-30"
completed: "2025-12-31"
priority: "high"
---

# Specification: Database Resource Management

**Priority**: High (~180 LOC saved, eliminates resource leak risks)

## Overview

This specification defines helper functions for safe database resource management, eliminating duplicated try-finally patterns and preventing resource leaks across all commands.

## Problem Statement

### Current State: Repeated try-finally Patterns

Every command that uses the database follows the same pattern:

```typescript
const db = new Database(dbPath);
try {
  // ... operations
} finally {
  db.close();
}
```

### Duplication Statistics

- **~40 instances** of this pattern across the codebase
- **~180 lines** of boilerplate try-finally blocks
- Pattern appears in: CLI commands, MCP tools, services, tests

### Issues

1. **Resource leak risk** - Easy to forget `finally` block
2. **Inconsistent cleanup** - Some places use try-finally, others don't
3. **Nested resources** - QueryEngine requires both DB and engine cleanup
4. **Error handling** - No standard way to handle DB open failures
5. **Testing** - Hard to inject mock databases

## Proposed Solution

### New Module: `src/db/with-database.ts`

Higher-order functions that handle resource lifecycle:

1. `withDatabase()` - Execute function with auto-closing database
2. `withQueryEngine()` - Execute function with DB + QueryEngine, auto-close both
3. `withTransaction()` - Execute function within a transaction

## Interface Design

### Core Types

```typescript
import { Database } from 'bun:sqlite';
import { QueryEngine } from './query-engine';

/**
 * Database handle with path information
 */
export interface DatabaseContext {
  db: Database;
  dbPath: string;
}

/**
 * Query context with both database and engine
 */
export interface QueryContext extends DatabaseContext {
  engine: QueryEngine;
}

/**
 * Options for database operations
 */
export interface DatabaseOptions {
  /** Database file path */
  dbPath: string;

  /** Open in readonly mode (default: false) */
  readonly?: boolean;

  /** Throw if database doesn't exist (default: true) */
  requireExists?: boolean;
}
```

### withDatabase()

```typescript
/**
 * Execute a function with an auto-closing database connection
 *
 * @param options - Database options
 * @param fn - Function to execute with database
 * @returns Result of the function
 *
 * @example
 * // Simple query
 * const count = await withDatabase({ dbPath }, (ctx) => {
 *   const result = ctx.db.query('SELECT COUNT(*) as count FROM nodes').get();
 *   return result.count;
 * });
 *
 * @example
 * // With readonly mode
 * const data = await withDatabase(
 *   { dbPath, readonly: true },
 *   (ctx) => ctx.db.query('SELECT * FROM nodes').all()
 * );
 *
 * @example
 * // Async operations
 * const result = await withDatabase({ dbPath }, async (ctx) => {
 *   const nodes = ctx.db.query('SELECT * FROM nodes').all();
 *   return processNodes(nodes); // async operation
 * });
 */
export async function withDatabase<T>(
  options: DatabaseOptions,
  fn: (ctx: DatabaseContext) => T | Promise<T>
): Promise<T>;
```

### withQueryEngine()

```typescript
/**
 * Execute a function with database and QueryEngine, auto-closing both
 *
 * QueryEngine provides high-level search and query operations.
 * Both database and engine are automatically cleaned up.
 *
 * @param options - Database options
 * @param fn - Function to execute with query context
 * @returns Result of the function
 *
 * @example
 * // Full-text search
 * const results = await withQueryEngine({ dbPath }, (ctx) => {
 *   return ctx.engine.search('meeting notes', { limit: 10 });
 * });
 *
 * @example
 * // Get nodes by tag
 * const todos = await withQueryEngine({ dbPath }, (ctx) => {
 *   return ctx.engine.getNodesByTag('todo');
 * });
 */
export async function withQueryEngine<T>(
  options: DatabaseOptions,
  fn: (ctx: QueryContext) => T | Promise<T>
): Promise<T>;
```

### withTransaction()

```typescript
/**
 * Execute a function within a database transaction
 *
 * Automatically commits on success, rolls back on error.
 *
 * @param options - Database options
 * @param fn - Function to execute within transaction
 * @returns Result of the function
 *
 * @example
 * // Batch insert
 * await withTransaction({ dbPath }, (ctx) => {
 *   const insert = ctx.db.prepare('INSERT INTO nodes (id, name) VALUES (?, ?)');
 *   for (const node of nodes) {
 *     insert.run(node.id, node.name);
 *   }
 * });
 *
 * @example
 * // Transaction with rollback on error
 * try {
 *   await withTransaction({ dbPath }, (ctx) => {
 *     ctx.db.run('UPDATE nodes SET name = ? WHERE id = ?', 'New', 'xyz');
 *     throw new Error('Oops'); // This will rollback
 *   });
 * } catch (e) {
 *   // Transaction was rolled back
 * }
 */
export async function withTransaction<T>(
  options: DatabaseOptions,
  fn: (ctx: DatabaseContext) => T | Promise<T>
): Promise<T>;
```

## Implementation Details

### withDatabase Implementation

```typescript
import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';

export async function withDatabase<T>(
  options: DatabaseOptions,
  fn: (ctx: DatabaseContext) => T | Promise<T>
): Promise<T> {
  const { dbPath, readonly = false, requireExists = true } = options;

  // Check existence if required
  if (requireExists && !existsSync(dbPath)) {
    throw new DatabaseNotFoundError(dbPath);
  }

  // Open database
  const db = new Database(dbPath, {
    readonly,
    create: !requireExists,
  });

  try {
    // Execute function
    const result = await fn({ db, dbPath });
    return result;
  } finally {
    // Always close database
    db.close();
  }
}
```

### withQueryEngine Implementation

```typescript
import { QueryEngine } from './query-engine';

export async function withQueryEngine<T>(
  options: DatabaseOptions,
  fn: (ctx: QueryContext) => T | Promise<T>
): Promise<T> {
  return withDatabase(options, async (ctx) => {
    const engine = new QueryEngine(ctx.db);

    // Execute function with both db and engine
    const result = await fn({ ...ctx, engine });

    // No explicit cleanup needed for QueryEngine
    return result;
  });
}
```

### withTransaction Implementation

```typescript
export async function withTransaction<T>(
  options: DatabaseOptions,
  fn: (ctx: DatabaseContext) => T | Promise<T>
): Promise<T> {
  return withDatabase(options, async (ctx) => {
    ctx.db.run('BEGIN TRANSACTION');

    try {
      const result = await fn(ctx);
      ctx.db.run('COMMIT');
      return result;
    } catch (error) {
      ctx.db.run('ROLLBACK');
      throw error;
    }
  });
}
```

### Error Types

```typescript
/**
 * Error thrown when database file is not found
 */
export class DatabaseNotFoundError extends Error {
  constructor(public readonly dbPath: string) {
    super(
      `Database not found: ${dbPath}\n` +
      `Run 'supertag sync' to create the database.`
    );
    this.name = 'DatabaseNotFoundError';
  }
}
```

## Migration Targets

### Files to Update

| File | Current Pattern | New Pattern |
|------|-----------------|-------------|
| `src/commands/search.ts` | Manual try-finally | `withQueryEngine()` |
| `src/commands/stats.ts` | Manual try-finally | `withDatabase()` |
| `src/commands/nodes.ts` | Manual try-finally | `withQueryEngine()` |
| `src/commands/tags.ts` | Manual try-finally | `withQueryEngine()` |
| `src/commands/schema.ts` | Manual try-finally | `withDatabase()` |
| `src/commands/embed.ts` | Manual try-finally | `withDatabase()` |
| `src/mcp/tools/search.ts` | Manual try-finally | `withQueryEngine()` |
| `src/mcp/tools/query.ts` | Manual try-finally | `withQueryEngine()` |
| `src/services/*.ts` | Manual try-finally | `withDatabase()` |

### Before/After Example

**Before** (typical command):
```typescript
export async function searchCommand(query: string, options: SearchOptions) {
  const workspace = resolveWorkspace(options.workspace);

  if (!existsSync(workspace.dbPath)) {
    console.error('Database not found. Run supertag sync first.');
    process.exit(1);
  }

  const db = new Database(workspace.dbPath);
  try {
    const engine = new QueryEngine(db);
    const results = engine.search(query, { limit: options.limit });

    // ... format and display results
    return results;
  } finally {
    db.close();
  }
}
```

**After**:
```typescript
export async function searchCommand(query: string, options: SearchOptions) {
  const workspace = resolveWorkspaceContext({ workspace: options.workspace });

  return withQueryEngine({ dbPath: workspace.dbPath }, (ctx) => {
    const results = ctx.engine.search(query, { limit: options.limit });

    // ... format and display results
    return results;
  });
}
```

## Composition with Workspace Resolver

Combining with the Unified Workspace Resolver spec:

```typescript
/**
 * Execute function with resolved workspace and database
 *
 * Combines workspace resolution and database handling.
 */
export async function withWorkspaceDatabase<T>(
  options: { workspace?: string; readonly?: boolean },
  fn: (ctx: DatabaseContext & { workspace: ResolvedWorkspace }) => T | Promise<T>
): Promise<T> {
  const workspace = resolveWorkspaceContext({ workspace: options.workspace });

  return withDatabase(
    { dbPath: workspace.dbPath, readonly: options.readonly },
    (ctx) => fn({ ...ctx, workspace })
  );
}

/**
 * Execute function with resolved workspace and query engine
 */
export async function withWorkspaceQuery<T>(
  options: { workspace?: string },
  fn: (ctx: QueryContext & { workspace: ResolvedWorkspace }) => T | Promise<T>
): Promise<T> {
  const workspace = resolveWorkspaceContext({ workspace: options.workspace });

  return withQueryEngine({ dbPath: workspace.dbPath }, (ctx) =>
    fn({ ...ctx, workspace })
  );
}
```

**Ultra-simplified command**:
```typescript
export async function searchCommand(query: string, options: SearchOptions) {
  return withWorkspaceQuery({ workspace: options.workspace }, (ctx) => {
    return ctx.engine.search(query, { limit: options.limit });
  });
}
```

## Testing Strategy

### Unit Tests

```typescript
describe('withDatabase', () => {
  const testDbPath = '/tmp/test-db.sqlite';

  beforeAll(() => {
    // Create test database
    const db = new Database(testDbPath);
    db.run('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
    db.close();
  });

  afterAll(() => {
    unlinkSync(testDbPath);
  });

  it('should execute function and close database', async () => {
    const result = await withDatabase({ dbPath: testDbPath }, (ctx) => {
      return ctx.db.query('SELECT 1 as value').get();
    });
    expect(result.value).toBe(1);
  });

  it('should close database even on error', async () => {
    let dbRef: Database | null = null;

    await expect(withDatabase({ dbPath: testDbPath }, (ctx) => {
      dbRef = ctx.db;
      throw new Error('Test error');
    })).rejects.toThrow('Test error');

    // Verify database was closed
    expect(() => dbRef!.query('SELECT 1')).toThrow();
  });

  it('should throw DatabaseNotFoundError for missing file', async () => {
    await expect(withDatabase({ dbPath: '/nonexistent/path.db' }, () => {}))
      .rejects.toThrow(DatabaseNotFoundError);
  });

  it('should allow missing database when requireExists is false', async () => {
    const tempPath = '/tmp/new-db.sqlite';
    await withDatabase(
      { dbPath: tempPath, requireExists: false },
      (ctx) => ctx.db.run('CREATE TABLE test (id INTEGER)')
    );
    expect(existsSync(tempPath)).toBe(true);
    unlinkSync(tempPath);
  });
});

describe('withTransaction', () => {
  it('should commit on success', async () => {
    await withTransaction({ dbPath: testDbPath }, (ctx) => {
      ctx.db.run('INSERT INTO test (value) VALUES (?)', 'committed');
    });

    const result = await withDatabase({ dbPath: testDbPath }, (ctx) => {
      return ctx.db.query('SELECT value FROM test WHERE value = ?').get('committed');
    });
    expect(result).toBeDefined();
  });

  it('should rollback on error', async () => {
    try {
      await withTransaction({ dbPath: testDbPath }, (ctx) => {
        ctx.db.run('INSERT INTO test (value) VALUES (?)', 'rollback-test');
        throw new Error('Force rollback');
      });
    } catch {}

    const result = await withDatabase({ dbPath: testDbPath }, (ctx) => {
      return ctx.db.query('SELECT value FROM test WHERE value = ?').get('rollback-test');
    });
    expect(result).toBeUndefined();
  });
});
```

## Success Criteria

1. **Zero resource leaks** - All database connections properly closed
2. **Reduced boilerplate** - ~180 lines of try-finally removed
3. **Consistent error handling** - Same errors across all database operations
4. **Transaction support** - Safe transaction handling with auto-rollback
5. **Composable** - Works with workspace resolver for complete simplification
6. **Testable** - Easy to mock for unit tests

## Out of Scope

- Connection pooling (not needed for SQLite)
- Async database operations (bun:sqlite is synchronous)
- Multi-database transactions (not supported by SQLite)
- Database schema migrations (handled separately)

## Dependencies

- **Unified Workspace Resolver** - For `withWorkspaceDatabase()` composition

## Related Specs

- **Unified Workspace Resolver** - Provides workspace paths for database operations
- **Query Builder Utilities** - Works within `withQueryEngine()` context
