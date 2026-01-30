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
  // Insert a full sync record so delta-sync can proceed
  db.run(
    "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'export.json', ?, 1000)",
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
