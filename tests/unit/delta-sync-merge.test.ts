/**
 * Delta-Sync Merge Logic Tests (T-2.1)
 *
 * Tests for DeltaSyncService core merge operations:
 * - ensureSchema()
 * - getWatermark()
 * - hasFullSync()
 * - mergeNode()
 * - reconcileTags()
 * - updateWatermark()
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DeltaSyncService } from "../../src/services/delta-sync";
import type { SearchResultNode } from "../../src/types/local-api";

// Helper to create a minimal in-memory database with the full schema
function createTestDb(): Database {
  const db = new Database(":memory:");

  // Create the nodes table (matching TanaIndexer schema)
  db.run(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      parent_id TEXT,
      node_type TEXT,
      created INTEGER,
      updated INTEGER,
      done_at INTEGER,
      raw_data TEXT
    )
  `);

  // Create the tag_applications table
  db.run(`
    CREATE TABLE IF NOT EXISTS tag_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_node_id TEXT NOT NULL,
      data_node_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      tag_name TEXT NOT NULL
    )
  `);

  // Create sync_metadata table (base version without delta columns)
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_export_file TEXT NOT NULL DEFAULT '',
      last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
      total_nodes INTEGER NOT NULL DEFAULT 0
    )
  `);

  return db;
}

function createMockClient() {
  return {
    searchNodes: async () => [] as SearchResultNode[],
    health: async () => true,
  };
}

function createTestNode(overrides: Partial<SearchResultNode> = {}): SearchResultNode {
  return {
    id: "node-001",
    name: "Test Node",
    breadcrumb: ["Home", "Projects"],
    tags: [{ id: "tag-001", name: "project" }],
    tagIds: ["tag-001"],
    workspaceId: "ws-001",
    docType: "node",
    created: "2025-01-15T10:00:00.000Z",
    inTrash: false,
    ...overrides,
  };
}

describe("DeltaSyncService - Core Merge Logic (T-2.1)", () => {
  let db: Database;
  let service: DeltaSyncService;
  let dbPath: string;

  beforeEach(() => {
    db = createTestDb();
    // Write the in-memory db to a temp file so DeltaSyncService can open it
    dbPath = `/tmp/delta-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    const fileDb = new Database(dbPath);

    // Replicate schema in the file db
    fileDb.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        parent_id TEXT,
        node_type TEXT,
        created INTEGER,
        updated INTEGER,
        done_at INTEGER,
        raw_data TEXT
      )
    `);
    fileDb.run(`
      CREATE TABLE IF NOT EXISTS tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_node_id TEXT NOT NULL,
        data_node_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL
      )
    `);
    fileDb.run(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_export_file TEXT NOT NULL DEFAULT '',
        last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
        total_nodes INTEGER NOT NULL DEFAULT 0
      )
    `);
    fileDb.close();

    service = new DeltaSyncService({
      dbPath,
      localApiClient: createMockClient(),
    });
  });

  afterEach(() => {
    service.close();
    // Clean up temp file
    try {
      require("fs").unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  describe("ensureSchema", () => {
    it("adds delta-sync columns to sync_metadata", () => {
      service.ensureSchema();

      // Verify by opening the db and checking columns
      const checkDb = new Database(dbPath);
      const columns = checkDb
        .query("PRAGMA table_info(sync_metadata)")
        .all() as Array<{ name: string }>;
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain("delta_sync_timestamp");
      expect(colNames).toContain("delta_nodes_synced");
      checkDb.close();
    });

    it("is idempotent - calling twice does not throw", () => {
      service.ensureSchema();
      expect(() => service.ensureSchema()).not.toThrow();
    });
  });

  describe("getWatermark", () => {
    it("returns null when no sync_metadata row exists", () => {
      service.ensureSchema();
      const watermark = service.getWatermark();
      expect(watermark).toBeNull();
    });

    it("returns delta_sync_timestamp when available", () => {
      service.ensureSchema();
      const checkDb = new Database(dbPath);
      checkDb.run(
        "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes, delta_sync_timestamp) VALUES (1, '', 1000, 0, 2000)"
      );
      checkDb.close();

      // Re-create service to pick up changes
      service.close();
      service = new DeltaSyncService({
        dbPath,
        localApiClient: createMockClient(),
      });

      const watermark = service.getWatermark();
      expect(watermark).toBe(2000);
    });

    it("falls back to last_sync_timestamp when delta_sync_timestamp is null", () => {
      service.ensureSchema();
      const checkDb = new Database(dbPath);
      checkDb.run(
        "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'test.json', 1500, 100)"
      );
      checkDb.close();

      service.close();
      service = new DeltaSyncService({
        dbPath,
        localApiClient: createMockClient(),
      });

      const watermark = service.getWatermark();
      expect(watermark).toBe(1500);
    });

    it("returns null when last_sync_timestamp is 0 and no delta_sync_timestamp", () => {
      service.ensureSchema();
      const checkDb = new Database(dbPath);
      checkDb.run(
        "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, '', 0, 0)"
      );
      checkDb.close();

      service.close();
      service = new DeltaSyncService({
        dbPath,
        localApiClient: createMockClient(),
      });

      const watermark = service.getWatermark();
      expect(watermark).toBeNull();
    });
  });

  describe("hasFullSync", () => {
    it("returns false when no sync_metadata row exists", () => {
      service.ensureSchema();
      expect(service.hasFullSync()).toBe(false);
    });

    it("returns false when last_sync_timestamp is 0", () => {
      service.ensureSchema();
      const checkDb = new Database(dbPath);
      checkDb.run(
        "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, '', 0, 0)"
      );
      checkDb.close();

      service.close();
      service = new DeltaSyncService({
        dbPath,
        localApiClient: createMockClient(),
      });

      expect(service.hasFullSync()).toBe(false);
    });

    it("returns true when last_sync_timestamp is non-zero", () => {
      service.ensureSchema();
      const checkDb = new Database(dbPath);
      checkDb.run(
        "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'export.json', 1700000000000, 5000)"
      );
      checkDb.close();

      service.close();
      service = new DeltaSyncService({
        dbPath,
        localApiClient: createMockClient(),
      });

      expect(service.hasFullSync()).toBe(true);
    });
  });

  describe("mergeNode", () => {
    it("inserts a new node when it does not exist", () => {
      service.ensureSchema();

      const node = createTestNode({
        id: "new-node-001",
        name: "Brand New Node",
        docType: "node",
        created: "2025-01-15T10:00:00.000Z",
      });

      const result = service.mergeNode(node);
      expect(result.inserted).toBe(true);
      expect(result.updated).toBe(false);

      // Verify in database
      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.query("SELECT * FROM nodes WHERE id = ?").get("new-node-001") as Record<string, unknown>;
      expect(row).not.toBeNull();
      expect(row.name).toBe("Brand New Node");
      expect(row.node_type).toBe("node");
      expect(row.created).toBe(Date.parse("2025-01-15T10:00:00.000Z"));
      expect(row.updated).toBeGreaterThan(0);
      checkDb.close();
    });

    it("updates an existing node", () => {
      service.ensureSchema();

      // Insert an existing node first
      const setupDb = new Database(dbPath);
      setupDb.run(
        "INSERT INTO nodes (id, name, parent_id, node_type, created, updated, done_at, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["existing-001", "Old Name", "parent-001", "node", 1700000000000, 1700000000000, 1700000100000, '{"old":"data"}']
      );
      setupDb.close();

      const node = createTestNode({
        id: "existing-001",
        name: "Updated Name",
        docType: "tuple",
      });

      const result = service.mergeNode(node);
      expect(result.inserted).toBe(false);
      expect(result.updated).toBe(true);

      // Verify update
      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.query("SELECT * FROM nodes WHERE id = ?").get("existing-001") as Record<string, unknown>;
      expect(row.name).toBe("Updated Name");
      expect(row.node_type).toBe("tuple");
      // Preserved fields should remain unchanged
      expect(row.parent_id).toBe("parent-001");
      expect(row.done_at).toBe(1700000100000);
      expect(row.raw_data).toBe('{"old":"data"}');
      checkDb.close();
    });

    it("preserves parent_id, done_at, and raw_data on update", () => {
      service.ensureSchema();

      const setupDb = new Database(dbPath);
      setupDb.run(
        "INSERT INTO nodes (id, name, parent_id, node_type, created, updated, done_at, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["preserve-001", "Original", "my-parent", "node", 1000, 2000, 3000, '{"preserved":true}']
      );
      setupDb.close();

      const node = createTestNode({
        id: "preserve-001",
        name: "Changed Name",
        docType: "node",
      });

      service.mergeNode(node);

      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.query("SELECT * FROM nodes WHERE id = ?").get("preserve-001") as Record<string, unknown>;
      expect(row.parent_id).toBe("my-parent");
      expect(row.done_at).toBe(3000);
      expect(row.raw_data).toBe('{"preserved":true}');
      checkDb.close();
    });

    it("parses ISO created date correctly for new nodes", () => {
      service.ensureSchema();

      const node = createTestNode({
        id: "date-node-001",
        created: "2025-06-15T14:30:00.000Z",
      });

      service.mergeNode(node);

      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.query("SELECT created FROM nodes WHERE id = ?").get("date-node-001") as { created: number };
      expect(row.created).toBe(Date.parse("2025-06-15T14:30:00.000Z"));
      checkDb.close();
    });

    it("sets updated timestamp to current time", () => {
      service.ensureSchema();
      const before = Date.now();

      const node = createTestNode({ id: "time-node-001" });
      service.mergeNode(node);

      const after = Date.now();

      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.query("SELECT updated FROM nodes WHERE id = ?").get("time-node-001") as { updated: number };
      expect(row.updated).toBeGreaterThanOrEqual(before);
      expect(row.updated).toBeLessThanOrEqual(after);
      checkDb.close();
    });
  });

  describe("reconcileTags", () => {
    it("inserts tag applications for a node", () => {
      service.ensureSchema();

      const tags = [
        { id: "tag-001", name: "project" },
        { id: "tag-002", name: "active" },
      ];

      service.reconcileTags("node-001", tags);

      const checkDb = new Database(dbPath, { readonly: true });
      const rows = checkDb
        .query("SELECT * FROM tag_applications WHERE data_node_id = ? ORDER BY tag_id")
        .all("node-001") as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(2);
      expect(rows[0].tag_id).toBe("tag-001");
      expect(rows[0].tag_name).toBe("project");
      expect(rows[0].tuple_node_id).toBe("");
      expect(rows[1].tag_id).toBe("tag-002");
      expect(rows[1].tag_name).toBe("active");
      checkDb.close();
    });

    it("replaces existing tags for a node", () => {
      service.ensureSchema();

      // Insert initial tags
      const setupDb = new Database(dbPath);
      setupDb.run(
        "INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('', 'node-001', 'old-tag', 'old-name')"
      );
      setupDb.close();

      // Reconcile with new tags
      service.reconcileTags("node-001", [{ id: "new-tag", name: "new-name" }]);

      const checkDb = new Database(dbPath, { readonly: true });
      const rows = checkDb
        .query("SELECT * FROM tag_applications WHERE data_node_id = ?")
        .all("node-001") as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(1);
      expect(rows[0].tag_id).toBe("new-tag");
      expect(rows[0].tag_name).toBe("new-name");
      checkDb.close();
    });

    it("removes all tags when given empty array", () => {
      service.ensureSchema();

      const setupDb = new Database(dbPath);
      setupDb.run(
        "INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('', 'node-001', 'tag-001', 'some-tag')"
      );
      setupDb.close();

      service.reconcileTags("node-001", []);

      const checkDb = new Database(dbPath, { readonly: true });
      const rows = checkDb
        .query("SELECT * FROM tag_applications WHERE data_node_id = ?")
        .all("node-001") as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(0);
      checkDb.close();
    });

    it("does not affect tags for other nodes", () => {
      service.ensureSchema();

      const setupDb = new Database(dbPath);
      setupDb.run(
        "INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('', 'other-node', 'tag-x', 'other-tag')"
      );
      setupDb.close();

      service.reconcileTags("node-001", [{ id: "tag-001", name: "my-tag" }]);

      const checkDb = new Database(dbPath, { readonly: true });
      const otherRows = checkDb
        .query("SELECT * FROM tag_applications WHERE data_node_id = ?")
        .all("other-node") as Array<Record<string, unknown>>;

      expect(otherRows).toHaveLength(1);
      expect(otherRows[0].tag_name).toBe("other-tag");
      checkDb.close();
    });
  });

  describe("updateWatermark", () => {
    it("inserts watermark when no sync_metadata row exists", () => {
      service.ensureSchema();

      service.updateWatermark(1700000500000, 42);

      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.query("SELECT * FROM sync_metadata WHERE id = 1").get() as Record<string, unknown>;
      expect(row).not.toBeNull();
      expect(row.delta_sync_timestamp).toBe(1700000500000);
      expect(row.delta_nodes_synced).toBe(42);
      checkDb.close();
    });

    it("updates watermark when sync_metadata row exists", () => {
      service.ensureSchema();

      const setupDb = new Database(dbPath);
      setupDb.run(
        "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'test.json', 1700000000000, 5000)"
      );
      setupDb.close();

      service.updateWatermark(1700000600000, 15);

      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.query("SELECT * FROM sync_metadata WHERE id = 1").get() as Record<string, unknown>;
      expect(row.delta_sync_timestamp).toBe(1700000600000);
      expect(row.delta_nodes_synced).toBe(15);
      // Existing fields preserved
      expect(row.last_export_file).toBe("test.json");
      expect(row.last_sync_timestamp).toBe(1700000000000);
      checkDb.close();
    });
  });
});
