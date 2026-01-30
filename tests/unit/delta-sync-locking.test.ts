/**
 * Delta-Sync Locking + Status Tests (T-2.3)
 *
 * Tests for DeltaSyncService locking and status reporting:
 * - isSyncing() lock state
 * - Concurrent sync protection
 * - getStatus() status reporting
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DeltaSyncService } from "../../src/services/delta-sync";
import type { SearchResultNode, DeltaSyncStatus } from "../../src/types/local-api";

function createTestNode(id: string, name: string): SearchResultNode {
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
  db.run(
    "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'export.json', ?, 1000)",
    [Date.now() - 60000]
  );
  db.close();
}

describe("DeltaSyncService - Locking + Status (T-2.3)", () => {
  let dbPath: string;
  let service: DeltaSyncService;

  beforeEach(() => {
    dbPath = `/tmp/delta-sync-locking-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
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

  describe("isSyncing", () => {
    it("returns false initially", () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
      });

      expect(service.isSyncing()).toBe(false);
    });

    it("returns true during sync and false after", async () => {
      let syncingDuringExecution = false;
      let resolveSearch: (() => void) | null = null;

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => {
            syncingDuringExecution = service.isSyncing();
            // Return empty to end pagination
            return [];
          },
          health: async () => true,
        },
      });

      await service.sync();

      expect(syncingDuringExecution).toBe(true);
      expect(service.isSyncing()).toBe(false);
    });

    it("releases lock even on error", async () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => {
            throw new Error("API failure");
          },
          health: async () => true,
        },
      });

      try {
        await service.sync();
      } catch {
        // Expected error
      }

      expect(service.isSyncing()).toBe(false);
    });
  });

  describe("concurrent sync protection", () => {
    it("returns immediately with nodesFound:0 when already syncing", async () => {
      let resolveFirstSync: (() => void) | null = null;
      const firstSyncStarted = new Promise<void>((resolve) => {
        resolveFirstSync = null; // will be set in searchNodes
      });
      let firstCallResolve: (() => void) | null = null;
      const firstCallPromise = new Promise<void>((resolve) => {
        firstCallResolve = resolve;
      });
      let searchNodesCalled = false;

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => {
            if (!searchNodesCalled) {
              searchNodesCalled = true;
              firstCallResolve?.();
              // Block the first sync
              await new Promise<void>((resolve) => {
                resolveFirstSync = resolve;
              });
              return [createTestNode("n-1", "Node 1")];
            }
            return [];
          },
          health: async () => true,
        },
      });

      // Start first sync (will block)
      const firstSync = service.sync();

      // Wait until the first sync has entered searchNodes
      await firstCallPromise;

      // Second sync should return immediately
      const secondResult = await service.sync();
      expect(secondResult.nodesFound).toBe(0);

      // Unblock first sync
      resolveFirstSync?.();
      const firstResult = await firstSync;
      expect(firstResult.nodesFound).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getStatus", () => {
    it("returns status with full sync data", () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
      });
      service.ensureSchema();

      const status: DeltaSyncStatus = service.getStatus();

      expect(status.lastFullSync).toBeGreaterThan(0);
      expect(status.lastDeltaSync).toBeNull();
      expect(status.lastDeltaNodesCount).toBe(0);
      expect(status.totalNodes).toBe(0);
      expect(status.embeddingCoverage).toBe(0);
    });

    it("returns status with delta sync data", async () => {
      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [
            createTestNode("s-1", "Status Node 1"),
            createTestNode("s-2", "Status Node 2"),
          ],
          health: async () => true,
        },
      });

      await service.sync();

      const status = service.getStatus();

      expect(status.lastFullSync).toBeGreaterThan(0);
      expect(status.lastDeltaSync).toBeGreaterThan(0);
      expect(status.lastDeltaNodesCount).toBe(2);
      expect(status.totalNodes).toBe(2);
      expect(status.embeddingCoverage).toBe(0); // placeholder
    });

    it("returns null timestamps when no syncs have occurred", () => {
      // Create a fresh db without sync metadata row
      const freshPath = `/tmp/delta-sync-fresh-${Date.now()}.db`;
      const freshDb = new Database(freshPath);
      freshDb.run(`
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, node_type TEXT,
          created INTEGER, updated INTEGER, done_at INTEGER, raw_data TEXT
        )
      `);
      freshDb.run(`
        CREATE TABLE IF NOT EXISTS tag_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tuple_node_id TEXT NOT NULL, data_node_id TEXT NOT NULL,
          tag_id TEXT NOT NULL, tag_name TEXT NOT NULL
        )
      `);
      freshDb.run(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_export_file TEXT NOT NULL DEFAULT '',
          last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
          total_nodes INTEGER NOT NULL DEFAULT 0
        )
      `);
      freshDb.close();

      const freshService = new DeltaSyncService({
        dbPath: freshPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
      });
      freshService.ensureSchema();

      try {
        const status = freshService.getStatus();
        expect(status.lastFullSync).toBeNull();
        expect(status.lastDeltaSync).toBeNull();
        expect(status.lastDeltaNodesCount).toBe(0);
        expect(status.totalNodes).toBe(0);
      } finally {
        freshService.close();
        try { require("fs").unlinkSync(freshPath); } catch { /* ignore */ }
      }
    });

    it("counts total nodes correctly", async () => {
      // Pre-insert some nodes
      const setupDb = new Database(dbPath);
      setupDb.run("INSERT INTO nodes (id, name, node_type, created, updated) VALUES ('pre-1', 'Pre 1', 'node', 1000, 2000)");
      setupDb.run("INSERT INTO nodes (id, name, node_type, created, updated) VALUES ('pre-2', 'Pre 2', 'node', 1000, 2000)");
      setupDb.run("INSERT INTO nodes (id, name, node_type, created, updated) VALUES ('pre-3', 'Pre 3', 'node', 1000, 2000)");
      setupDb.close();

      service = new DeltaSyncService({
        dbPath,
        localApiClient: {
          searchNodes: async () => [],
          health: async () => true,
        },
      });
      service.ensureSchema();

      const status = service.getStatus();
      expect(status.totalNodes).toBe(3);
    });
  });
});
