/**
 * WAL growth guards (#107)
 *
 * Many long-lived supertag-mcp readers starved the PASSIVE checkpoint and let
 * tana-index.db-wal grow to 20 GB+. These tests pin the guards: a bounded
 * journal_size_limit, a TRUNCATE checkpoint that shrinks the WAL to zero, and
 * a checkpoint that reports (never throws) when a reader blocks it.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { TanaExportWatcher } from "../../src/monitors/tana-export-monitor";
import { tmpdir } from "os";
import { join } from "path";
import { configureDbForConcurrency, JOURNAL_SIZE_LIMIT_BYTES } from "../../src/db/retry";
import {
  checkpointWalTruncate,
  getWalSizeBytes,
  WAL_WARN_BYTES,
  walSizeWarning,
} from "../../src/db/wal";

let dir: string;
let dbPath: string;

function writeRows(db: Database, count: number): void {
  db.run("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, payload TEXT)");
  const insert = db.prepare("INSERT INTO t (payload) VALUES (?)");
  db.transaction(() => {
    for (let i = 0; i < count; i++) insert.run("x".repeat(500));
  })();
}

/** A writer in WAL mode with autocheckpoint off, so frames stay in the WAL. */
function openWriter(): Database {
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA wal_autocheckpoint = 0");
  return db;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "supertag-wal-"));
  dbPath = join(dir, "test.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("configureDbForConcurrency", () => {
  it("bounds the WAL with journal_size_limit", () => {
    const db = new Database(dbPath);
    configureDbForConcurrency(db);
    const row = db.query("PRAGMA journal_size_limit").get() as Record<string, number>;
    expect(Object.values(row)[0]).toBe(JOURNAL_SIZE_LIMIT_BYTES);
    db.close();
  });
});

describe("checkpointWalTruncate", () => {
  it("shrinks the WAL to zero bytes", async () => {
    const writer = openWriter();
    writeRows(writer, 2000);
    expect(getWalSizeBytes(dbPath)).toBeGreaterThan(100_000);

    const result = await checkpointWalTruncate(dbPath);

    expect(result.ok).toBe(true);
    expect(getWalSizeBytes(dbPath)).toBe(0);
    writer.close();
  });

  it("reports a reader-blocked checkpoint without throwing, then succeeds once the reader leaves", async () => {
    const writer = openWriter();
    writeRows(writer, 200);

    // A reader pinning a snapshot older than the latest write
    const reader = new Database(dbPath, { readonly: true });
    reader.run("BEGIN");
    reader.query("SELECT COUNT(*) FROM t").get();
    writeRows(writer, 200);

    const warnings: string[] = [];
    const blocked = await checkpointWalTruncate(dbPath, {
      attempts: 2,
      baseDelayMs: 1,
      logger: { warn: (msg) => warnings.push(msg) },
    });

    expect(blocked.ok).toBe(false);
    expect(blocked.attempts).toBe(2);
    expect(warnings.length).toBe(1);
    expect(getWalSizeBytes(dbPath)).toBeGreaterThan(0);

    reader.run("COMMIT");
    reader.close();

    const freed = await checkpointWalTruncate(dbPath);
    expect(freed.ok).toBe(true);
    expect(getWalSizeBytes(dbPath)).toBe(0);
    writer.close();
  });

  it("returns ok:false instead of throwing when the database is missing", async () => {
    const result = await checkpointWalTruncate(join(dir, "missing", "nope.db"));
    expect(result.ok).toBe(false);
  });
});

describe("getWalSizeBytes", () => {
  it("returns 0 when there is no WAL file", () => {
    expect(getWalSizeBytes(dbPath)).toBe(0);
  });
});

describe("full index", () => {
  it("leaves a zero-byte WAL after indexLatest()", async () => {
    const exportDir = join(dir, "exports");
    mkdirSync(exportDir);
    const docs = Array.from({ length: 500 }, (_, i) => ({
      id: `wal_node_${i}`,
      props: { created: Date.now(), name: `Node ${i} ${"y".repeat(300)}` },
      children: [],
    }));
    writeFileSync(
      join(exportDir, "ws@2025-11-30.json"),
      JSON.stringify({ formatVersion: 1, docs, editors: [], workspaces: {} })
    );
    const watcher = new TanaExportWatcher({ exportDir, dbPath });
    // Another process's idle connection: stops SQLite deleting the WAL when
    // the indexer's connection is the last to close
    const other = new Database(dbPath);

    const result = await watcher.indexLatest();

    expect(result.success).toBe(true);
    expect(existsSync(`${dbPath}-wal`)).toBe(true);
    expect(getWalSizeBytes(dbPath)).toBe(0);
    watcher.close();
    other.close();
  });
});

describe("walSizeWarning", () => {
  it("is null below the threshold", () => {
    expect(walSizeWarning(WAL_WARN_BYTES)).toBeNull();
  });

  it("names the recovery steps above the threshold", () => {
    const warning = walSizeWarning(WAL_WARN_BYTES + 1);
    expect(warning).toContain("pkill -f supertag-mcp");
    expect(warning).toContain("wal_checkpoint(TRUNCATE)");
  });
});
