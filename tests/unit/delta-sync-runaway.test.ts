/**
 * Delta-Sync Runaway Pagination Tests (#105)
 *
 * When Tana's Local API ignores `edited.since`, every delta returns the whole
 * workspace and the pagination loop never ends. These tests pin the guards:
 * - a probe catches an API that ignores `since` before anything is merged
 * - a page cap scaled from sync_metadata.total_nodes aborts runaway paging
 * - aborts throw and leave the watermark untouched
 * - progress is logged so a long delta is visibly alive
 *
 * Credit: page cap and progress logging ported from PR #85 by @lavarius.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "fs";
import { DeltaSyncService } from "../../src/services/delta-sync";
import type { DeltaSyncOptions, SearchResultNode } from "../../src/types/local-api";

const PAGE_SIZE = 100;
/** Fail instead of hanging when a guard is missing. */
const CALL_LIMIT = 200;
/** Each merged page is 100 single-row writes; slow under machine load. */
const MERGE_TIMEOUT_MS = 30_000;

function createTestNode(id: string): SearchResultNode {
  return {
    id,
    name: `Node ${id}`,
    breadcrumb: ["Home"],
    tags: [],
    tagIds: [],
    workspaceId: "ws-001",
    docType: "node",
    created: "2025-01-15T10:00:00.000Z",
    inTrash: false,
  };
}

function fullPage(prefix: string): SearchResultNode[] {
  return Array.from({ length: PAGE_SIZE }, (_, i) => createTestNode(`${prefix}-${i}`));
}

function createDbWithFullSync(dbPath: string, totalNodes: number, deltaWatermark: number): void {
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, node_type TEXT,
      created INTEGER, updated INTEGER, done_at INTEGER, raw_data TEXT
    )
  `);
  db.run(`
    CREATE TABLE tag_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_node_id TEXT NOT NULL, data_node_id TEXT NOT NULL,
      tag_id TEXT NOT NULL, tag_name TEXT NOT NULL
    )
  `);
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
  db.run(
    "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes, delta_sync_timestamp) VALUES (1, 'export.json', ?, ?, ?)",
    [deltaWatermark - 60_000, totalNodes, deltaWatermark]
  );
  db.close();
}

function readWatermark(dbPath: string): number | null {
  const db = new Database(dbPath);
  const row = db.query("SELECT delta_sync_timestamp FROM sync_metadata WHERE id = 1").get() as {
    delta_sync_timestamp: number | null;
  };
  db.close();
  return row.delta_sync_timestamp;
}

type Client = DeltaSyncOptions["localApiClient"];

/** A Local API that returns full pages forever, whatever `since` says. */
function ignoresSinceClient(): Client & { calls: () => number } {
  let calls = 0;
  return {
    searchNodes: async () => {
      if (++calls > CALL_LIMIT) throw new Error("test guard: pagination never stopped");
      return fullPage(`ignored-${calls}`);
    },
    health: async () => true,
    calls: () => calls,
  };
}

/**
 * A Local API that honors `since` for recent timestamps (the probe sees an
 * empty result) but still pages forever for the watermark query.
 */
function endlessDeltaClient(watermarkSec: number, probeError?: Error): Client {
  let calls = 0;
  return {
    searchNodes: async (query) => {
      if (++calls > CALL_LIMIT) throw new Error("test guard: pagination never stopped");
      const since = (query.edited as { since: number }).since;
      if (since > watermarkSec) {
        if (probeError) throw probeError;
        return [];
      }
      return fullPage(`endless-${calls}`);
    },
    health: async () => true,
  };
}

describe("DeltaSyncService - runaway pagination guards (#105)", () => {
  let dbPath: string;
  let service: DeltaSyncService | undefined;
  const watermarkMs = Date.now() - 3_600_000;
  const watermarkSec = Math.floor(watermarkMs / 1000);

  beforeEach(() => {
    dbPath = `/tmp/delta-sync-runaway-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  });

  afterEach(() => {
    service?.close();
    service = undefined;
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it("aborts before merging when the API ignores edited.since", async () => {
    createDbWithFullSync(dbPath, 1_000_000, watermarkMs);
    const client = ignoresSinceClient();
    service = new DeltaSyncService({ dbPath, localApiClient: client });

    await expect(service.sync()).rejects.toThrow(/not honoring 'edited\.since'/);

    expect(client.calls()).toBe(2); // first page + probe
    expect(readWatermark(dbPath)).toBe(watermarkMs);
    const db = new Database(dbPath);
    const { cnt } = db.query("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number };
    db.close();
    expect(cnt).toBe(0);
  });

  it("aborts at the page cap scaled from total_nodes and keeps the watermark", async () => {
    // total_nodes = 4000 -> cap = ceil(4000 * 0.25 / 100) = 10 pages
    createDbWithFullSync(dbPath, 4_000, watermarkMs);
    service = new DeltaSyncService({ dbPath, localApiClient: endlessDeltaClient(watermarkSec) });

    await expect(service.sync()).rejects.toThrow(/aborted after 10 pages/);
    expect(readWatermark(dbPath)).toBe(watermarkMs);
  }, MERGE_TIMEOUT_MS);

  it("an explicit maxPages overrides the scaled cap", async () => {
    createDbWithFullSync(dbPath, 1_000_000, watermarkMs);
    service = new DeltaSyncService({
      dbPath,
      localApiClient: endlessDeltaClient(watermarkSec),
      maxPages: 5,
    });

    await expect(service.sync()).rejects.toThrow(/aborted after 5 pages/);
  });

  it("keeps the page cap as a backstop when the probe request fails", async () => {
    createDbWithFullSync(dbPath, 4_000, watermarkMs);
    const warnings: string[] = [];
    service = new DeltaSyncService({
      dbPath,
      localApiClient: endlessDeltaClient(watermarkSec, new Error("probe exploded")),
      logger: { info: () => {}, warn: (m) => warnings.push(m), error: () => {} },
    });

    await expect(service.sync()).rejects.toThrow(/aborted after 10 pages/);
    expect(warnings.some((w) => w.includes("probe"))).toBe(true);
  }, MERGE_TIMEOUT_MS);

  it("completes a legitimate multi-page delta under the cap and logs progress", async () => {
    createDbWithFullSync(dbPath, 1_000_000, watermarkMs);
    const TOTAL_PAGES = 12;
    let calls = 0;
    const logs: string[] = [];
    service = new DeltaSyncService({
      dbPath,
      localApiClient: {
        searchNodes: async (query, options) => {
          calls++;
          if ((query.edited as { since: number }).since > watermarkSec) return [];
          const page = Math.floor((options?.offset ?? 0) / PAGE_SIZE);
          return page < TOTAL_PAGES ? fullPage(`legit-${page}`) : [];
        },
        health: async () => true,
      },
      logger: { info: (m) => logs.push(m), warn: () => {}, error: () => {} },
    });

    const result = await service.sync();

    expect(result.pages).toBe(TOTAL_PAGES);
    expect(result.nodesFound).toBe(TOTAL_PAGES * PAGE_SIZE);
    expect(readWatermark(dbPath)).toBeGreaterThan(watermarkMs);
    const progress = logs.filter((m) => m.startsWith("delta-sync progress:"));
    expect(progress.map((m) => m.match(/(\d+) page\(s\)/)?.[1])).toEqual(["1", "10"]);
  }, MERGE_TIMEOUT_MS);

  it("does not probe when the first page is short", async () => {
    createDbWithFullSync(dbPath, 1_000_000, watermarkMs);
    let calls = 0;
    service = new DeltaSyncService({
      dbPath,
      localApiClient: {
        searchNodes: async () => {
          calls++;
          return [createTestNode("only")];
        },
        health: async () => true,
      },
    });

    const result = await service.sync();
    expect(result.nodesFound).toBe(1);
    expect(calls).toBe(1);
  });
});
