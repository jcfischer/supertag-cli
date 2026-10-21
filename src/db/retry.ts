/**
 * Database Retry Utilities
 *
 * Provides retry logic with exponential backoff for SQLite database operations
 * that may fail due to database locks during concurrent access.
 *
 * Also provides WAL mode configuration for better concurrent access.
 */

import { Database } from "bun:sqlite";
import { statSync } from "fs";

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

/**
 * Size SQLite truncates the WAL back to after a checkpoint resets it (#107).
 * Bounds a WAL that can be checkpointed; a WAL pinned by readers needs
 * checkpointWalTruncate().
 */
export const JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

/** WAL size above which status output warns that checkpoints are starved (#107). */
export const WAL_WARN_BYTES = 1024 * 1024 * 1024;

/**
 * Size of the database's -wal file in bytes, 0 when there is none.
 */
export function getWalSizeBytes(dbPath: string): number {
  try {
    return statSync(`${dbPath}-wal`).size;
  } catch {
    return 0;
  }
}

/**
 * Warning text when the WAL is large enough that checkpoints are being
 * starved by long-lived readers, null otherwise.
 */
export function walSizeWarning(walBytes: number): string | null {
  if (walBytes <= WAL_WARN_BYTES) return null;
  const gb = (walBytes / 1024 ** 3).toFixed(1);
  return (
    `WAL is ${gb} GB: checkpoints are being blocked by long-lived readers. ` +
    "Recover with: pkill -f supertag-mcp && sqlite3 <db> 'PRAGMA wal_checkpoint(TRUNCATE);'"
  );
}

export interface WalCheckpointResult {
  /** True when the WAL was fully checkpointed and truncated */
  ok: boolean;
  /** Checkpoint attempts made */
  attempts: number;
  /** WAL size after the last attempt */
  walBytes: number;
  /** Error message when the checkpoint could not run at all */
  error?: string;
}

export interface WalCheckpointOptions {
  /** Attempts before giving up (default 5) */
  attempts?: number;
  /** First backoff delay; doubles per attempt (default 100ms) */
  baseDelayMs?: number;
  /** Backoff cap (default 2000ms) */
  maxDelayMs?: number;
  logger?: { warn(message: string, data?: Record<string, unknown>): void };
}

/**
 * Checkpoint the whole WAL into the database and truncate it to zero bytes.
 *
 * PASSIVE checkpoints give up whenever a reader is active, so with many
 * long-lived supertag-mcp processes the WAL never shrinks (#107). This runs
 * TRUNCATE on a fresh connection with busy_timeout 0 and retries with async
 * backoff, so it never blocks the event loop on another process's lock.
 * If readers still block it after the last attempt it logs a warning.
 * Never throws.
 */
export async function checkpointWalTruncate(
  dbPath: string,
  options: WalCheckpointOptions = {}
): Promise<WalCheckpointResult> {
  const attempts = options.attempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 2000;

  let db: Database;
  try {
    db = new Database(dbPath, { readwrite: true });
  } catch (error) {
    return { ok: false, attempts: 0, walBytes: getWalSizeBytes(dbPath), error: String(error) };
  }

  try {
    db.run("PRAGMA busy_timeout = 0");
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const row = db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number } | null;
        if (row?.busy === 0) {
          return { ok: true, attempts: attempt, walBytes: getWalSizeBytes(dbPath) };
        }
      } catch (error) {
        if (!isDbLockError(error)) {
          return { ok: false, attempts: attempt, walBytes: getWalSizeBytes(dbPath), error: String(error) };
        }
      }
      if (attempt < attempts) {
        await sleep(Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs));
      }
    }

    const walBytes = getWalSizeBytes(dbPath);
    options.logger?.warn(
      "WAL checkpoint blocked by active readers; the WAL could not be truncated. " +
        "If it keeps growing, stop idle supertag-mcp processes (pkill -f supertag-mcp).",
      { dbPath, attempts, walBytes }
    );
    return { ok: false, attempts, walBytes };
  } finally {
    try {
      db.close();
    } catch {
      // Already closed - ignore
    }
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

    // Truncate the WAL back to a bounded size after each checkpoint reset (#107)
    db.run(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
  } catch (error) {
    // WAL mode may fail in certain scenarios (temp dirs, network drives, etc.)
    // Log but don't fail - the database will work in rollback journal mode
    // which is less concurrent but still functional
    if (process.env.DEBUG) {
      console.warn("Failed to enable WAL mode:", error);
    }
  }
}
