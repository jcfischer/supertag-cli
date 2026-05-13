/**
 * Delta-Sync Pagination + Sync Orchestration Tests (T-2.2)
 *
 * Tests for DeltaSyncService pagination and sync orchestration:
 * - fetchChangedNodes() async generator
 * - sync() full cycle orchestration
 * - Embedding integration (skipped when not configured)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DeltaSyncService } from "../../src/services/delta-sync";
import type { SearchResultNode, DeltaSyncResult } from "../../src/types/local-api";

function createTestNode(id: string, name: string, overrides: Partial<SearchResultNode> = {}): SearchResultNode {
  return {
    id,
    name,
    breadcrumb: ["Home"],
    tags: [],
    tagIds: [],
    workspaceId: "ws-001",
    docType: "node",
    created: "2025-01-15T10:00:00.000Z",
    inTrash: false,
    ...overrides,
  };
}

function createDbWithFullSync(dbPath: string): void {
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, node_type TEXT,
      created INTEGER, updated INTEGER, done_at INTEGER, raw_data TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tag_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_node_id TEXT NOT NULL, data_node_id TEXT NOT NULL,
      tag_id TEXT NOT NULL, tag_name TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_export_file TEXT NOT NULL DEFAULT '',
      last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
      total_nodes INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Insert a full sync record so delta-sync can proceed. total_nodes is set high
  // enough that the auto-scaled abort cap (25% * total / PAGE_SIZE) doesn't trip
  // unrelated tests that happen to page through dozens of results.
  db.run(
    "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'export.json', ?, 1000000)",
    [Date.now() - 60000]
  );
  db.close();
}

describe("DeltaSyncService - Pagination + Sync Orchestration (T-2.2)", () => {
  let dbPath: string;
  let service: DeltaSyncService;

  beforeEach(() => {
    dbPath = `/tmp/delta-sync-pagination-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    createDbWithFullSync(dbPath);
  });

  afterEach(() => {
    if (service) service.close();
    try {
      require("fs").unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  describe("fetchChangedNodes", () => {
    it("yields pages of results from the API", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => createTestNode(`n-${i}`, `Node ${i}`));
      const page2 = Array.from({ length: 50 }, (_, i) => createTestNode(`n-${100 + i}`, `Node ${100 + i}`));
      let callCount = 0;

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async (_query, options) => {
            callCount++;
            const offset = options?.offset ?? 0;
            if (offset === 0) return page1;
            if (offset === 100) return page2;
            return [];
          },
          health: async () => true,
        },
      });

      const pages: SearchResultNode[][] = [];
      for await (const page of service.fetchChangedNodes(1000)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(100);
      expect(pages[1]).toHaveLength(50);
      expect(callCount).toBe(2); // stops after page2.length < 100
    });

    it("stops on empty page", async () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
      });

      const pages: SearchResultNode[][] = [];
      for await (const page of service.fetchChangedNodes(1000)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(0);
    });

    it("passes edited.since as seconds, not milliseconds (v2.5.6 fix E1)", async () => {
      // Regression test: Tana Local API interprets edited.since as seconds.
      // Prior to v2.5.6 this was passed as ms, which the API resolved to a
      // far-future timestamp (~year 58,000), making delta-sync a no-op.
      const capturedQueries: Array<Record<string, unknown>> = [];

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async (query) => {
            capturedQueries.push(query);
            return [];
          },
          health: async () => true,
        },
      });

      // Pass an ms watermark equivalent to 2026-04-16
      const watermarkMs = 1_776_371_000_000;
      const expectedSec = Math.floor(watermarkMs / 1000);

      const pages: SearchResultNode[][] = [];
      for await (const page of service.fetchChangedNodes(watermarkMs)) {
        pages.push(page);
      }

      expect(capturedQueries).toHaveLength(1);
      const q = capturedQueries[0] as { edited: { since: number } };
      expect(q.edited.since).toBe(expectedSec);

      // Hard guard: the value must look like "seconds since epoch around now",
      // not "milliseconds" (which would be ~1e12).
      expect(q.edited.since).toBeLessThan(10_000_000_000); // 10 billion = year 2286 as seconds
      expect(q.edited.since).toBeGreaterThan(1_000_000_000); // 1 billion = year 2001 as seconds
    });

    it("clamps edited.since to minimum 1 (API rejects since=0)", async () => {
      const capturedQueries: Array<Record<string, unknown>> = [];

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async (query) => {
            capturedQueries.push(query);
            return [];
          },
          health: async () => true,
        },
      });

      const pages: SearchResultNode[][] = [];
      for await (const page of service.fetchChangedNodes(0)) {
        pages.push(page);
      }

      expect(capturedQueries).toHaveLength(1);
      const q = capturedQueries[0] as { edited: { since: number } };
      expect(q.edited.since).toBe(1);
    });

    it("handles single partial page", async () => {
      const nodes = [createTestNode("n-1", "Node 1"), createTestNode("n-2", "Node 2")];

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => nodes,
          health: async () => true,
        },
      });

      const pages: SearchResultNode[][] = [];
      for await (const page of service.fetchChangedNodes(1000)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0]).toHaveLength(2);
    });
  });

  describe("sync", () => {
    it("throws when no full sync exists", async () => {
      // Create db without full sync
      const emptyDbPath = `/tmp/delta-sync-empty-${Date.now()}.db`;
      const emptyDb = new Database(emptyDbPath);
      emptyDb.run(`
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, node_type TEXT,
          created INTEGER, updated INTEGER, done_at INTEGER, raw_data TEXT
        )
      `);
      emptyDb.run(`
        CREATE TABLE IF NOT EXISTS tag_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tuple_node_id TEXT NOT NULL, data_node_id TEXT NOT NULL,
          tag_id TEXT NOT NULL, tag_name TEXT NOT NULL
        )
      `);
      emptyDb.run(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_export_file TEXT NOT NULL DEFAULT '',
          last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
          total_nodes INTEGER NOT NULL DEFAULT 0
        )
      `);
      emptyDb.close();

      const emptyService = new DeltaSyncService({
        dbPath: emptyDbPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
      });

      try {
        await expect(emptyService.sync()).rejects.toThrow("No full sync found");
      } finally {
        emptyService.close();
        try { require("fs").unlinkSync(emptyDbPath); } catch { /* ignore */ }
      }
    });

    it("completes a full sync cycle with nodes", async () => {
      const testNodes = [
        createTestNode("sync-1", "Sync Node 1", { tags: [{ id: "t-1", name: "task" }], tagIds: ["t-1"] }),
        createTestNode("sync-2", "Sync Node 2", { tags: [{ id: "t-2", name: "project" }], tagIds: ["t-2"] }),
      ];

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => testNodes,
          health: async () => true,
        },
      });

      const result: DeltaSyncResult = await service.sync();

      expect(result.nodesFound).toBe(2);
      expect(result.nodesInserted).toBe(2);
      expect(result.nodesUpdated).toBe(0);
      expect(result.pages).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.watermarkAfter).toBeGreaterThan(result.watermarkBefore);
      expect(result.embeddingsSkipped).toBe(true); // no embedding config

      // Verify nodes in database
      const checkDb = new Database(dbPath, { readonly: true });
      const nodeCount = checkDb.query("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number };
      expect(nodeCount.cnt).toBe(2);

      // Verify tags
      const tagCount = checkDb.query("SELECT COUNT(*) as cnt FROM tag_applications").get() as { cnt: number };
      expect(tagCount.cnt).toBe(2);
      checkDb.close();
    });

    it("reports nodesUpdated for existing nodes", async () => {
      // Pre-insert a node
      const setupDb = new Database(dbPath);
      setupDb.run(
        "INSERT INTO nodes (id, name, node_type, created, updated) VALUES ('existing-1', 'Old Name', 'node', 1000, 2000)"
      );
      setupDb.close();

      const testNodes = [
        createTestNode("existing-1", "Updated Name"),
        createTestNode("brand-new-1", "New Node"),
      ];

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => testNodes,
          health: async () => true,
        },
      });

      const result = await service.sync();

      expect(result.nodesFound).toBe(2);
      expect(result.nodesInserted).toBe(1);
      expect(result.nodesUpdated).toBe(1);
    });

    it("updates watermark after successful sync", async () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [createTestNode("n-1", "Node 1")],
          health: async () => true,
        },
      });

      const before = Date.now();
      await service.sync();
      const after = Date.now();

      // Verify watermark was updated
      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.query("SELECT delta_sync_timestamp, delta_nodes_synced FROM sync_metadata WHERE id = 1").get() as Record<string, number>;
      expect(row.delta_sync_timestamp).toBeGreaterThanOrEqual(before);
      expect(row.delta_sync_timestamp).toBeLessThanOrEqual(after);
      expect(row.delta_nodes_synced).toBe(1);
      checkDb.close();
    });

    it("handles empty result set gracefully", async () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
      });

      const result = await service.sync();

      expect(result.nodesFound).toBe(0);
      expect(result.nodesInserted).toBe(0);
      expect(result.nodesUpdated).toBe(0);
      expect(result.pages).toBe(0);
    });

    it("tracks duration in milliseconds", async () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
      });

      const result = await service.sync();

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe("number");
    });

    it("sets embeddingsSkipped to true when no embeddingConfig", async () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
        // No embeddingConfig provided
      });

      const result = await service.sync();
      expect(result.embeddingsSkipped).toBe(true);
      expect(result.embeddingsGenerated).toBe(0);
    });

    it("logs a progress line on page 1 (Bug 6)", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => createTestNode(`p1-${i}`, `Page1 Node ${i}`));
      const page2 = Array.from({ length: 50 }, (_, i) => createTestNode(`p2-${i}`, `Page2 Node ${i}`));
      const logs: string[] = [];

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async (_query, options) => {
            const offset = options?.offset ?? 0;
            if (offset === 0) return page1;
            if (offset === 100) return page2;
            return [];
          },
          health: async () => true,
        },
        logger: {
          info: (msg) => logs.push(msg),
          warn: () => {},
          error: () => {},
        },
      });

      await service.sync();

      const progress = logs.filter((m) => m.startsWith("delta-sync progress:"));
      // 2 pages total: page 1 logs, page 2 does not (< interval).
      expect(progress).toHaveLength(1);
      expect(progress[0]).toContain("1 page(s)");
      expect(progress[0]).toContain("100 nodes");
    });

    it("emits a progress line every 10 pages (Bug 6)", async () => {
      const logs: string[] = [];
      let calls = 0;
      const TOTAL_PAGES = 25;

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => {
            calls++;
            if (calls > TOTAL_PAGES) return [];
            // Distinct ids per call so DB doesn't collide
            return Array.from({ length: 100 }, (_, i) => createTestNode(`hb-${calls}-${i}`, `Heartbeat ${calls}-${i}`));
          },
          health: async () => true,
        },
        logger: {
          info: (msg) => logs.push(msg),
          warn: () => {},
          error: () => {},
        },
      });

      await service.sync();

      const progress = logs.filter((m) => m.startsWith("delta-sync progress:"));
      // Pages 1, 10, 20 — page 25 doesn't hit the interval.
      expect(progress).toHaveLength(3);
      expect(progress[0]).toContain("1 page(s)");
      expect(progress[1]).toContain("10 page(s)");
      expect(progress[2]).toContain("20 page(s)");
    });

    it("auto-scales the abort cap from total_nodes when no override is given (Bug 6)", async () => {
      // total_nodes = 24000 → cap = ceil(24000 * 0.25 / 100) = 60 pages.
      const reseedDb = new Database(dbPath);
      reseedDb.run("UPDATE sync_metadata SET total_nodes = 24000 WHERE id = 1");
      reseedDb.close();

      let calls = 0;
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => {
            calls++;
            return Array.from({ length: 100 }, (_, i) =>
              createTestNode(`scale-${calls}-${i}`, `Scale ${calls}-${i}`),
            );
          },
          health: async () => true,
        },
        // no maxPages — let it auto-scale
      });

      await expect(service.sync()).rejects.toThrow(/aborted after 60 pages/);
    });

    it("auto-scaled cap scales down to small workspaces without a floor (Bug 6)", async () => {
      // Small workspace: total_nodes = 4000 → cap = ceil(4000 * 0.25 / 100) = 10 pages.
      // Critically the cap stays proportional rather than being raised to a floor;
      // the broken-API failure mode (whole-workspace return = 40 pages here) trips.
      const reseedDb = new Database(dbPath);
      reseedDb.run("UPDATE sync_metadata SET total_nodes = 4000 WHERE id = 1");
      reseedDb.close();

      let calls = 0;
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => {
            calls++;
            return Array.from({ length: 100 }, (_, i) =>
              createTestNode(`tiny-${calls}-${i}`, `Tiny ${calls}-${i}`),
            );
          },
          health: async () => true,
        },
      });

      await expect(service.sync()).rejects.toThrow(/aborted after 10 pages/);
    });

    it("explicit maxPages overrides the auto-scaled cap (Bug 6)", async () => {
      // Even with total_nodes=24000 (auto-scaled cap would be 60), the explicit override wins.
      const reseedDb = new Database(dbPath);
      reseedDb.run("UPDATE sync_metadata SET total_nodes = 24000 WHERE id = 1");
      reseedDb.close();

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => {
            return Array.from({ length: 100 }, (_, i) =>
              createTestNode(`ov-${i}`, `Override ${i}`),
            );
          },
          health: async () => true,
        },
        maxPages: 3,
      });

      await expect(service.sync()).rejects.toThrow(/aborted after 3 pages/);
    });

    it("aborts with a clear error when maxPages is hit and leaves watermark unchanged (Bug 6)", async () => {
      // Capture watermark from the test-db seed so we can assert it is NOT advanced on abort.
      const seedDb = new Database(dbPath);
      const watermarkBefore = (seedDb.query(
        "SELECT last_sync_timestamp FROM sync_metadata WHERE id = 1",
      ).get() as { last_sync_timestamp: number }).last_sync_timestamp;
      seedDb.close();

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async (_q, options) => {
            const offset = options?.offset ?? 0;
            // Always return a full page → loop never stops naturally
            return Array.from({ length: 100 }, (_, i) =>
              createTestNode(`cap-${offset}-${i}`, `Cap ${offset}-${i}`),
            );
          },
          health: async () => true,
        },
        maxPages: 3,
      });

      await expect(service.sync()).rejects.toThrow(
        /Delta-sync aborted after 3 pages.*watermark NOT advanced.*supertag sync index/s,
      );

      // Watermark must NOT have advanced — next delta should replay from the same point.
      const verifyDb = new Database(dbPath);
      const watermarkAfter = (verifyDb.query(
        "SELECT last_sync_timestamp FROM sync_metadata WHERE id = 1",
      ).get() as { last_sync_timestamp: number }).last_sync_timestamp;
      verifyDb.close();
      expect(watermarkAfter).toBe(watermarkBefore);

      // And rows from the pages that did complete should have been merged (idempotently replayable).
      const verifyDb2 = new Database(dbPath);
      const rowCount = (verifyDb2.query("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
      verifyDb2.close();
      expect(rowCount).toBeGreaterThan(0);
    });

    it("paginates through multiple pages", async () => {
      let callIndex = 0;
      const page1 = Array.from({ length: 100 }, (_, i) => createTestNode(`p1-${i}`, `Page1 Node ${i}`));
      const page2 = Array.from({ length: 30 }, (_, i) => createTestNode(`p2-${i}`, `Page2 Node ${i}`));

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async (_query, options) => {
            callIndex++;
            const offset = options?.offset ?? 0;
            if (offset === 0) return page1;
            if (offset === 100) return page2;
            return [];
          },
          health: async () => true,
        },
      });

      const result = await service.sync();

      expect(result.nodesFound).toBe(130);
      expect(result.nodesInserted).toBe(130);
      expect(result.pages).toBe(2);
    });
  });
});
