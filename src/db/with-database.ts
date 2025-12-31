/**
 * Database Resource Management
 *
 * Higher-order functions that wrap database operations with automatic resource cleanup.
 * Provides Rust-style RAII pattern for database connections.
 *
 * Spec: 053-database-resource-management
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { TanaQueryEngine } from "../query/tana-query-engine";
import type { ResolvedWorkspace } from "../config/workspace-resolver";

// =============================================================================
// Types
// =============================================================================

/**
 * Context passed to database callbacks
 */
export interface DatabaseContext {
  /** Open SQLite database connection */
  db: Database;
  /** Path to the database file */
  dbPath: string;
}

/**
 * Context passed to query engine callbacks (extends DatabaseContext)
 */
export interface QueryContext extends DatabaseContext {
  /** Query engine instance */
  engine: TanaQueryEngine;
}

/**
 * Options for database operations
 */
export interface DatabaseOptions {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Open database in readonly mode (default: false) */
  readonly?: boolean;
  /** Require database file to exist (default: true) */
  requireExists?: boolean;
}

/**
 * Options for workspace database operations
 */
export interface WorkspaceDatabaseOptions {
  /** Workspace alias, nodeid, or rootFileId */
  workspace?: string;
  /** Open database in readonly mode (default: false) */
  readonly?: boolean;
}

/**
 * Context for workspace database callbacks
 */
export interface WorkspaceDatabaseContext extends DatabaseContext {
  /** Resolved workspace information */
  workspace: ResolvedWorkspace;
}

/**
 * Context for workspace query callbacks
 */
export interface WorkspaceQueryContext extends QueryContext {
  /** Resolved workspace information */
  workspace: ResolvedWorkspace;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Thrown when database file does not exist and requireExists is true
 */
export class DatabaseNotFoundError extends Error {
  public readonly name = "DatabaseNotFoundError";

  constructor(public readonly dbPath: string) {
    super(`Database not found: ${dbPath}`);
  }
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Execute a function with an auto-closing database connection.
 *
 * Opens a SQLite database, executes the callback, and guarantees the database
 * is closed afterwards (even if an error occurs).
 *
 * @example
 * ```typescript
 * const result = await withDatabase({ dbPath: '/path/to/db' }, (ctx) => {
 *   return ctx.db.query('SELECT * FROM nodes').all();
 * });
 * ```
 *
 * @param options - Database options (path, readonly, requireExists)
 * @param fn - Callback function receiving DatabaseContext
 * @returns Promise resolving to callback's return value
 * @throws DatabaseNotFoundError if database doesn't exist and requireExists is true
 */
export async function withDatabase<T>(
  options: DatabaseOptions,
  fn: (ctx: DatabaseContext) => T | Promise<T>
): Promise<T> {
  const { dbPath, readonly = false, requireExists = true } = options;

  // Check if database exists (unless creating new)
  if (requireExists && !existsSync(dbPath)) {
    throw new DatabaseNotFoundError(dbPath);
  }

  // Open database (only pass readonly option if true)
  const db = readonly ? new Database(dbPath, { readonly: true }) : new Database(dbPath);

  try {
    // Execute callback (may be sync or async)
    const result = await fn({ db, dbPath });
    return result;
  } finally {
    // Always close database
    db.close();
  }
}

/**
 * Execute a function within a database transaction.
 *
 * Opens a database, starts a transaction, executes the callback, and:
 * - COMMIT on success
 * - ROLLBACK on error
 * - Always closes the database
 *
 * @example
 * ```typescript
 * await withTransaction({ dbPath: '/path/to/db' }, (ctx) => {
 *   ctx.db.exec("INSERT INTO nodes ...");
 *   ctx.db.exec("UPDATE references ...");
 * });
 * ```
 *
 * @param options - Database options (path, requireExists)
 * @param fn - Callback function receiving DatabaseContext
 * @returns Promise resolving to callback's return value
 * @throws DatabaseNotFoundError if database doesn't exist and requireExists is true
 */
export async function withTransaction<T>(
  options: Omit<DatabaseOptions, "readonly">,
  fn: (ctx: DatabaseContext) => T | Promise<T>
): Promise<T> {
  const { dbPath, requireExists = true } = options;

  // Check if database exists
  if (requireExists && !existsSync(dbPath)) {
    throw new DatabaseNotFoundError(dbPath);
  }

  const db = new Database(dbPath);

  try {
    db.exec("BEGIN TRANSACTION");
    const result = await fn({ db, dbPath });
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Execute a function with an auto-closing query engine.
 *
 * Creates a TanaQueryEngine, executes the callback, and guarantees it's
 * closed afterwards (even if an error occurs). The engine manages its own
 * database connection internally.
 *
 * @example
 * ```typescript
 * const stats = await withQueryEngine({ dbPath: '/path/to/db' }, (ctx) => {
 *   return ctx.engine.getStatistics();
 * });
 * ```
 *
 * @param options - Database options (path, readonly, requireExists)
 * @param fn - Callback function receiving QueryContext
 * @returns Promise resolving to callback's return value
 * @throws DatabaseNotFoundError if database doesn't exist and requireExists is true
 */
export async function withQueryEngine<T>(
  options: DatabaseOptions,
  fn: (ctx: QueryContext) => T | Promise<T>
): Promise<T> {
  const { dbPath, readonly = false, requireExists = true } = options;

  // Check if database exists (unless creating new)
  if (requireExists && !existsSync(dbPath)) {
    throw new DatabaseNotFoundError(dbPath);
  }

  // Create query engine (it manages its own database connection)
  // Note: TanaQueryEngine opens its own database, so readonly option is not supported
  // If readonly is needed, use withDatabase directly
  const engine = new TanaQueryEngine(dbPath);

  try {
    // Execute callback (may be sync or async)
    // Provide engine's raw db for direct access
    const result = await fn({ db: engine.rawDb, dbPath, engine });
    return result;
  } finally {
    // Always close engine (which closes its internal database)
    engine.close();
  }
}
