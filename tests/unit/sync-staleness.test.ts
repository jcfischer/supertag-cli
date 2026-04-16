/**
 * Sync staleness helper tests (v2.5.5 fix B/C)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSyncStaleness } from "../../src/utils/sync-staleness";

function makeDb(dir: string): string {
  const dbPath = join(dir, "test.db");
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE sync_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_export_file TEXT NOT NULL DEFAULT '',
      last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
      total_nodes INTEGER NOT NULL DEFAULT 0,
      delta_sync_timestamp INTEGER,
      delta_nodes_synced INTEGER DEFAULT 0
    )
  `);
  db.close();
  return dbPath;
}

describe("getSyncStaleness", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "supertag-stale-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SUPERTAG_STALE_DELTA_MINUTES;
    delete process.env.SUPERTAG_STALE_FULL_HOURS;
  });

  it("returns isStale=true with no-sync reason when DB is missing", () => {
    const result = getSyncStaleness(join(dir, "nonexistent.db"));
    expect(result.isStale).toBe(true);
    expect(result.lastFullSync).toBeNull();
    expect(result.lastDeltaSync).toBeNull();
    expect(result.secondsSinceLastSync).toBeNull();
    expect(result.staleReason).toMatch(/No sync/);
  });

  it("returns isStale=true when sync_metadata has only zero timestamps", () => {
    const dbPath = makeDb(dir);
    const db = new Database(dbPath);
    db.run("INSERT INTO sync_metadata (id) VALUES (1)");
    db.close();

    const result = getSyncStaleness(dbPath);
    expect(result.isStale).toBe(true);
    expect(result.lastFullSync).toBeNull();
    expect(result.lastDeltaSync).toBeNull();
  });

  it("returns fresh when last sync is within threshold", () => {
    const dbPath = makeDb(dir);
    const db = new Database(dbPath);
    db.run(
      "INSERT INTO sync_metadata (id, last_sync_timestamp, delta_sync_timestamp) VALUES (1, ?, ?)",
      [Date.now() - 1000, Date.now() - 500]
    );
    db.close();

    const result = getSyncStaleness(dbPath);
    expect(result.isStale).toBe(false);
    expect(result.lastFullSync).not.toBeNull();
    expect(result.lastDeltaSync).not.toBeNull();
    expect(result.secondsSinceLastSync).toBeLessThan(5);
  });

  it("reports stale when newest sync exceeds delta threshold", () => {
    process.env.SUPERTAG_STALE_DELTA_MINUTES = "5";
    const dbPath = makeDb(dir);
    const db = new Database(dbPath);
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    db.run(
      "INSERT INTO sync_metadata (id, last_sync_timestamp, delta_sync_timestamp) VALUES (1, ?, ?)",
      [tenMinAgo, tenMinAgo]
    );
    db.close();

    const result = getSyncStaleness(dbPath);
    expect(result.isStale).toBe(true);
    expect(result.staleReason).toMatch(/last synced/);
  });

  it("reports stale when full sync older than full threshold but delta is recent", () => {
    process.env.SUPERTAG_STALE_DELTA_MINUTES = "60";
    process.env.SUPERTAG_STALE_FULL_HOURS = "24";
    const dbPath = makeDb(dir);
    const db = new Database(dbPath);
    const twoDaysAgo = Date.now() - 2 * 24 * 3600 * 1000;
    const recent = Date.now() - 1000;
    db.run(
      "INSERT INTO sync_metadata (id, last_sync_timestamp, delta_sync_timestamp) VALUES (1, ?, ?)",
      [twoDaysAgo, recent]
    );
    db.close();

    const result = getSyncStaleness(dbPath);
    expect(result.isStale).toBe(true);
    expect(result.staleReason).toMatch(/Delta-sync cannot repopulate field values/);
  });

  it("warns when full sync is old even if delta sync is fresh (regression: field_values drift)", () => {
    // Previously the full-sync check was gated behind `else if`, so a fresh
    // delta-sync masked a stale full-sync — exactly the bug that breaks
    // field-filtered queries. Both checks must run independently.
    process.env.SUPERTAG_STALE_DELTA_MINUTES = "60";
    process.env.SUPERTAG_STALE_FULL_HOURS = "24";
    const dbPath = makeDb(dir);
    const db = new Database(dbPath);
    const threeDaysAgo = Date.now() - 3 * 24 * 3600 * 1000;
    const oneMinAgo = Date.now() - 60 * 1000;
    db.run(
      "INSERT INTO sync_metadata (id, last_sync_timestamp, delta_sync_timestamp) VALUES (1, ?, ?)",
      [threeDaysAgo, oneMinAgo]
    );
    db.close();

    const result = getSyncStaleness(dbPath);
    expect(result.isStale).toBe(true);
    expect(result.staleReason).toMatch(/Delta-sync cannot repopulate field values/);
    // Delta sync itself is fresh, so the delta-age warning should NOT fire.
    expect(result.staleReason).not.toMatch(/threshold: 60m/);
  });

  it("warns when no full sync has run but delta sync has", () => {
    const dbPath = makeDb(dir);
    const db = new Database(dbPath);
    db.run(
      "INSERT INTO sync_metadata (id, last_sync_timestamp, delta_sync_timestamp) VALUES (1, 0, ?)",
      [Date.now() - 1000]
    );
    db.close();

    const result = getSyncStaleness(dbPath);
    expect(result.isStale).toBe(true);
    expect(result.lastFullSync).toBeNull();
    expect(result.lastDeltaSync).not.toBeNull();
    expect(result.staleReason).toMatch(/Full sync has never run/);
  });

  it("ignores invalid env thresholds (0, negative, non-numeric) and uses defaults", () => {
    const dbPath = makeDb(dir);
    const db = new Database(dbPath);
    const oneSecondAgo = Date.now() - 1000;
    db.run(
      "INSERT INTO sync_metadata (id, last_sync_timestamp, delta_sync_timestamp) VALUES (1, ?, ?)",
      [oneSecondAgo, oneSecondAgo]
    );
    db.close();

    // Each of these would make everything stale if the parser accepted them.
    const badValues = ["0", "-1", "abc", "Infinity", "NaN", ""];
    for (const bad of badValues) {
      process.env.SUPERTAG_STALE_DELTA_MINUTES = bad;
      const result = getSyncStaleness(dbPath);
      expect(result.isStale).toBe(false);
    }
  });

  it("handles missing sync_metadata table gracefully", () => {
    const dbPath = join(dir, "empty.db");
    const db = new Database(dbPath);
    db.run("CREATE TABLE nodes (id TEXT PRIMARY KEY)");
    db.close();

    const result = getSyncStaleness(dbPath);
    expect(result.isStale).toBe(true);
    expect(result.lastFullSync).toBeNull();
  });
});
