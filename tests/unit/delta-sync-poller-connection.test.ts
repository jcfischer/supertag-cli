/**
 * DeltaSyncPoller connection lifetime (#107)
 *
 * A poller that keeps its DeltaSyncService connection open for the life of the
 * MCP process is one of N long-lived readers that starve the WAL checkpoint.
 * The poller must open a connection per cycle and close it before going idle.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DeltaSyncPoller } from "../../src/mcp/delta-sync-poller";
import { DeltaSyncService } from "../../src/services/delta-sync";
import { getWalSizeBytes } from "../../src/db/wal";
import type { DeltaSyncOptions, SearchResultNode } from "../../src/types/local-api";

let dir: string;
let dbPath: string;

function seedDb(path: string): void {
  const db = new Database(path);
  db.run(`CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, node_type TEXT,
    created INTEGER, updated INTEGER, done_at INTEGER, raw_data TEXT)`);
  db.run(`CREATE TABLE tag_applications (id INTEGER PRIMARY KEY AUTOINCREMENT, tuple_node_id TEXT NOT NULL,
    data_node_id TEXT NOT NULL, tag_id TEXT NOT NULL, tag_name TEXT NOT NULL)`);
  db.run(`CREATE TABLE sync_metadata (id INTEGER PRIMARY KEY CHECK (id = 1),
    last_export_file TEXT NOT NULL DEFAULT '', last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
    total_nodes INTEGER NOT NULL DEFAULT 0)`);
  db.run(
    "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'test.json', ?, 100)",
    [Date.now()]
  );
  db.close();
}

/** Factory wrapping the real service, counting connections opened and closed. */
function trackingFactory() {
  const counts = { opened: 0, closed: 0 };
  const createService = (options: DeltaSyncOptions) => {
    const service = new DeltaSyncService(options);
    counts.opened++;
    const close = service.close.bind(service);
    service.close = () => {
      counts.closed++;
      close();
    };
    return service;
  };
  return { counts, createService };
}

const apiClient = {
  searchNodes: mock(() => Promise.resolve([] as SearchResultNode[])),
  health: mock(() => Promise.resolve(true)),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "supertag-poller-"));
  dbPath = join(dir, "test.db");
  seedDb(dbPath);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("DeltaSyncPoller connection lifetime", () => {
  it("holds no connection before the first tick", () => {
    const { counts, createService } = trackingFactory();
    const poller = new DeltaSyncPoller({ intervalMinutes: 5, dbPath, localApiClient: apiClient, createService });
    expect(counts.opened).toBe(0);
    poller.stop();
  });

  it("closes the connection it opened after every tick", async () => {
    const { counts, createService } = trackingFactory();
    const poller = new DeltaSyncPoller({ intervalMinutes: 5, dbPath, localApiClient: apiClient, createService });

    await poller.tick();
    expect(counts).toEqual({ opened: 1, closed: 1 });

    await poller.tick();
    expect(counts).toEqual({ opened: 2, closed: 2 });
    poller.stop();
  });

  it("closes the connection after triggerNow()", async () => {
    const { counts, createService } = trackingFactory();
    const poller = new DeltaSyncPoller({ intervalMinutes: 5, dbPath, localApiClient: apiClient, createService });

    await poller.triggerNow();
    expect(counts).toEqual({ opened: 1, closed: 1 });
    poller.stop();
  });

  it("truncates the WAL after a delta-sync write cycle", async () => {
    const db = new Database(dbPath);
    db.run("PRAGMA journal_mode = WAL");
    db.close();

    const nodes: SearchResultNode[] = Array.from({ length: 50 }, (_, i) => ({
      id: `wal-node-${i}`,
      name: `Node ${i} ${"x".repeat(400)}`,
      breadcrumb: ["Home"],
      tags: [{ id: "tag-project", name: "project" }],
      tagIds: ["tag-project"],
      docType: "node",
      created: "2025-01-15T10:00:00.000Z",
      inTrash: false,
    }) as SearchResultNode);
    let served = false;
    const client = {
      searchNodes: mock(() => {
        const page = served ? [] : nodes;
        served = true;
        return Promise.resolve(page);
      }),
      health: mock(() => Promise.resolve(true)),
    };
    const poller = new DeltaSyncPoller({ intervalMinutes: 5, dbPath, localApiClient: client });
    // Another process's idle connection: stops SQLite deleting the WAL when
    // the poller's connection is the last to close
    const other = new Database(dbPath);

    const result = await poller.triggerNow();

    expect(result.nodesInserted).toBe(50);
    expect(existsSync(`${dbPath}-wal`)).toBe(true);
    expect(getWalSizeBytes(dbPath)).toBe(0);
    other.close();
    poller.stop();
  });

  it("closes the connection when the cycle fails", async () => {
    const { counts, createService } = trackingFactory();
    const failing = {
      searchNodes: mock(() => Promise.reject(new Error("HTTP 400"))),
      health: mock(() => Promise.resolve(true)),
    };
    const poller = new DeltaSyncPoller({ intervalMinutes: 5, dbPath, localApiClient: failing, createService });

    await poller.tick();
    expect(counts).toEqual({ opened: 1, closed: 1 });
    poller.stop();
  });
});
