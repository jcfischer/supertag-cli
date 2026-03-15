/**
 * Database Retry Utilities
 *
 * Provides retry logic with exponential backoff for SQLite database operations
 * that may fail due to database locks during concurrent access.
 *
 * Also provides WAL mode configuration for better concurrent access.
 */

import { Database } from "bun:sqlite";

/**
 * Retry configuration for database operations
 */
export const DB_RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 100,
  maxDelayMs: 2000,
};

/**
 * Check if an error is a database lock error
 */
export function isDbLockError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("database is locked") || msg.includes("busy");
  }
  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a database operation with retry on lock errors
 *
 * Uses exponential backoff with jitter to handle concurrent database access.
 * Retries up to 5 times with delays: 100ms → 200ms → 400ms → 800ms → 1600ms
 *
 * @param operation - The database operation to execute
 * @param context - Optional context string for debugging (not currently used)
 * @returns The result of the operation
 * @throws The last error if all retries fail, or immediately for non-lock errors
 */
export async function withDbRetry<T>(
  operation: () => T,
  context?: string
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < DB_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return operation();
    } catch (error) {
      if (isDbLockError(error)) {
        lastError = error;
        // Exponential backoff with jitter
        const delay = Math.min(
          DB_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt) + Math.random() * 100,
          DB_RETRY_CONFIG.maxDelayMs
        );
        if (attempt < DB_RETRY_CONFIG.maxRetries - 1) {
          await sleep(delay);
          continue;
        }
      }
      throw error;
    }
  }

  throw lastError;
}

/**
 * Synchronous version of withDbRetry for operations that can't be async
 *
 * Uses busy-wait retry which is less efficient but works in sync contexts.
 * Prefer withDbRetry when possible.
 */
export function withDbRetrySync<T>(
  operation: () => T,
  context?: string
): T {
  let lastError: unknown;

  for (let attempt = 0; attempt < DB_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return operation();
    } catch (error) {
      if (isDbLockError(error)) {
        lastError = error;
        if (attempt < DB_RETRY_CONFIG.maxRetries - 1) {
          // Busy-wait for sync context (not ideal but necessary)
          const delay = Math.min(
            DB_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
            DB_RETRY_CONFIG.maxDelayMs
          );
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait
          }
          continue;
        }
      }
      throw error;
    }
  }

  throw lastError;
}

/**
 * Check if a database filename is an in-memory database.
 * In-memory databases don't support WAL mode.
 */
export function isInMemoryDb(db: Database): boolean {
  try {
    const result = db.query("PRAGMA database_list").all() as Array<{ file: string }>;
    // In-memory databases have an empty file path or ":memory:"
    return result.length === 0 || result[0]?.file === "" || result[0]?.file === ":memory:";
  } catch {
    return false;
  }
}

/**
 * Enable WAL (Write-Ahead Logging) mode on a database connection.
 *
 * WAL mode provides better concurrent access:
 * - Multiple readers can access the database while a writer is active
 * - Writers don't block readers
 * - Better performance for most workloads
 *
 * This is especially important on Windows where SQLite file locking
 * is stricter than on Unix systems.
 *
 * Note: WAL mode is not supported for in-memory databases.
 *
 * @param db - The database connection to configure
 * @returns The journal mode that was set (should be "wal", or "memory" for in-memory)
 */
export function enableWalMode(db: Database): string {
  // Skip WAL mode for in-memory databases (not supported)
  if (isInMemoryDb(db)) {
    return "memory";
  }

  const result = db.query("PRAGMA journal_mode = WAL").get() as { journal_mode: string } | null;
  return result?.journal_mode ?? "unknown";
}

/**
 * Configure database connection with optimal settings for concurrent access.
 *
 * Sets:
 * - WAL mode for better concurrent read/write access
 * - Busy timeout to wait for locks instead of failing immediately
 *
 * Note: In-memory databases are skipped as they don't support WAL mode
 * and don't need busy timeout (single connection).
 *
 * @param db - The database connection to configure
 */
/**
 * Run a passive WAL checkpoint to keep the WAL file from growing unbounded.
 *
 * PASSIVE mode checkpoints as many frames as possible without waiting for
 * readers or writers — it never blocks and never throws. Safe to call
 * on every connection close.
 *
 * @param db - The database connection to checkpoint
 */
export function walCheckpoint(db: Database): void {
  if (isInMemoryDb(db)) return;
  try {
    db.run("PRAGMA wal_checkpoint(PASSIVE)");
  } catch {
    // Best-effort — checkpoint failure is non-fatal
  }
}

export function configureDbForConcurrency(db: Database): void {
  // Skip configuration for in-memory databases
  if (isInMemoryDb(db)) {
    return;
  }

  try {
    // Enable WAL mode for concurrent access
    enableWalMode(db);

    // Set busy timeout to 5 seconds - wait for locks instead of failing immediately
    // This gives other processes time to complete their transactions
    db.run("PRAGMA busy_timeout = 5000");
  } catch (error) {
    // WAL mode may fail in certain scenarios (temp dirs, network drives, etc.)
    // Log but don't fail - the database will work in rollback journal mode
    // which is less concurrent but still functional
    if (process.env.DEBUG) {
      console.warn("Failed to enable WAL mode:", error);
    }
  }
}
