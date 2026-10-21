/**
 * WAL size guards (#107)
 *
 * Many long-lived supertag-mcp readers starve PASSIVE checkpoints, letting the
 * index WAL grow without bound. These helpers truncate the WAL and report its
 * size.
 */

import { Database } from "bun:sqlite";
import { statSync } from "fs";
import { isDbLockError, sleep } from "./retry";

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

/** Manual recovery when readers keep the WAL from being truncated. */
export const WAL_RECOVERY_HINT =
  "pkill -f supertag-mcp && sqlite3 <db> 'PRAGMA wal_checkpoint(TRUNCATE);'";

/**
 * Warning text when the WAL is large enough that checkpoints are being
 * starved by long-lived readers, null otherwise.
 */
export function walSizeWarning(walBytes: number): string | null {
  if (walBytes <= WAL_WARN_BYTES) return null;
  const gb = (walBytes / 1024 ** 3).toFixed(1);
  return (
    `WAL is ${gb} GB: checkpoints are being blocked by long-lived readers. ` +
    `Recover with: ${WAL_RECOVERY_HINT}`
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
 * The PASSIVE checkpoint on close never shrinks the WAL file and stops at
 * the oldest snapshot an open read transaction holds, so with many
 * supertag-mcp processes the WAL could grow without bound (#107). This runs
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
        `If it keeps growing, recover with: ${WAL_RECOVERY_HINT}`,
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
