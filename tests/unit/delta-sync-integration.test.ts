/**
 * Delta-Sync Integration Tests (T-6.1, F-095)
 *
 * End-to-end tests for the full delta-sync cycle:
 * - Creates a temp SQLite database with the full schema
 * - Ensures delta-sync schema extensions are applied
 * - Mocks LocalApiClient with realistic SearchResultNode[] data
 * - Verifies the complete sync() flow: insert, update, tags, watermark
 * - Verifies idempotent sync (second run with no changes)
 * - Verifies incremental sync (second run with new/changed nodes)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DeltaSyncService } from "../../src/services/delta-sync";
import { ensureDeltaSyncSchema } from "../../src/db/delta-sync-schema";
import type { SearchResultNode } from "../../src/types/local-api";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temp file-based SQLite database with the base schema
 * (nodes, tag_applications, sync_metadata) and a pre-existing full sync record.
 * This simulates the state after `supertag sync index` has run.
 */
function createTestDbWithFullSync(): { dbPath: string; cleanup: () => void } {
  const dbPath = `/tmp/delta-sync-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const db = new Database(dbPath);

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

  db.run(`
    CREATE TABLE IF NOT EXISTS tag_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_node_id TEXT NOT NULL,
      data_node_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      tag_name TEXT NOT NULL
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

  // Insert a full sync record (required for delta-sync to proceed)
  db.run(
    "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'export-2025-01-15.json', ?, 5000)",
    [Date.now() - 3600000] // 1 hour ago
  );

  db.close();

  return {
    dbPath,
    cleanup: () => {
      try {
        require("fs").unlinkSync(dbPath);
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

/**
 * Create a realistic SearchResultNode for testing.
 */
function makeNode(overrides: Partial<SearchResultNode> = {}): SearchResultNode {
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    name: "Test Node",
    breadcrumb: ["Home", "Projects"],
    tags: [{ id: "tag-project", name: "project" }],
    tagIds: ["tag-project"],
    workspaceId: "ws-main-001",
    docType: "node",
    created: "2025-01-15T10:00:00.000Z",
    inTrash: false,
    ...overrides,
  };
}

/**
 * Create a mock LocalApiClient that returns specific pages of nodes.
 * Each call to searchNodes returns the next page in sequence, then empty.
 */
function createMockClient(pages: SearchResultNode[][]) {
  let callIndex = 0;
  return {
    searchNodes: async (
      _query: Record<string, unknown>,
      options?: { limit?: number; offset?: number }
    ): Promise<SearchResultNode[]> => {
      const offset = options?.offset ?? 0;
      // Map offset to page index (PAGE_SIZE=100)
      const pageIndex = Math.floor(offset / 100);
      if (pageIndex < pages.length) {
        callIndex++;
        return pages[pageIndex];
      }
      return [];
    },
    health: async () => true,
    calls: () => callIndex,
  };
}

/**
 * Read a row from the database for verification.
 */
function readDb(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  return {
    nodeCount: () => {
      const row = db.query("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number };
      return row.cnt;
    },
    tagCount: () => {
      const row = db.query("SELECT COUNT(*) as cnt FROM tag_applications").get() as { cnt: number };
      return row.cnt;
    },
    getNode: (id: string) => {
      return db.query("SELECT * FROM nodes WHERE id = ?").get(id) as Record<string, unknown> | null;
    },
    getTagsForNode: (nodeId: string) => {
      return db
        .query("SELECT * FROM tag_applications WHERE data_node_id = ? ORDER BY tag_id")
        .all(nodeId) as Array<Record<string, unknown>>;
    },
    getSyncMetadata: () => {
      return db.query("SELECT * FROM sync_metadata WHERE id = 1").get() as Record<string, unknown> | null;
    },
    close: () => db.close(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Delta-Sync Integration (T-6.1)", () => {
  let dbPath: string;
  let cleanup: () => void;
  let service: DeltaSyncService;

  beforeEach(() => {
    const testDb = createTestDbWithFullSync();
    dbPath = testDb.dbPath;
    cleanup = testDb.cleanup;
  });

  afterEach(() => {
    if (service) service.close();
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Schema setup
  // ---------------------------------------------------------------------------

  describe("schema setup", () => {
    it("ensureDeltaSyncSchema adds delta columns to sync_metadata", () => {
      const db = new Database(dbPath);
      ensureDeltaSyncSchema(db);

      const columns = db.query("PRAGMA table_info(sync_metadata)").all() as Array<{ name: string }>;
      const colNames = columns.map((c) => c.name);

      expect(colNames).toContain("delta_sync_timestamp");
      expect(colNames).toContain("delta_nodes_synced");
      db.close();
    });

    it("service.ensureSchema is idempotent", () => {
      const client = createMockClient([]);
      service = new DeltaSyncService({ dbPath, localApiClient: client });

      service.ensureSchema();
      expect(() => service.ensureSchema()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Full end-to-end sync cycle
  // ---------------------------------------------------------------------------

  describe("full sync cycle", () => {
    it("inserts new nodes with correct fields into the database", async () => {
      const nodes = [
        makeNode({
          id: "e2e-node-1",
          name: "Meeting with Alice",
          docType: "node",
          tags: [{ id: "tag-meeting", name: "meeting" }],
          tagIds: ["tag-meeting"],
          created: "2025-06-01T09:00:00.000Z",
        }),
        makeNode({
          id: "e2e-node-2",
          name: "Quarterly Report",
          docType: "node",
          tags: [
            { id: "tag-project", name: "project" },
            { id: "tag-active", name: "active" },
          ],
          tagIds: ["tag-project", "tag-active"],
          created: "2025-06-02T14:30:00.000Z",
        }),
        makeNode({
          id: "e2e-node-3",
          name: "Buy groceries",
          docType: "node",
          tags: [{ id: "tag-todo", name: "todo" }],
          tagIds: ["tag-todo"],
          created: "2025-06-03T08:15:00.000Z",
        }),
      ];

      const client = createMockClient([nodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: client });

      const result = await service.sync();

      // Verify result stats
      expect(result.nodesFound).toBe(3);
      expect(result.nodesInserted).toBe(3);
      expect(result.nodesUpdated).toBe(0);
      expect(result.nodesSkipped).toBe(0);
      expect(result.pages).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.watermarkAfter).toBeGreaterThan(result.watermarkBefore);
      expect(result.embeddingsSkipped).toBe(true);

      // Verify nodes in database
      const db = readDb(dbPath);
      expect(db.nodeCount()).toBe(3);

      const node1 = db.getNode("e2e-node-1");
      expect(node1).not.toBeNull();
      expect(node1!.name).toBe("Meeting with Alice");
      expect(node1!.node_type).toBe("node");
      expect(node1!.created).toBe(Date.parse("2025-06-01T09:00:00.000Z"));
      expect(node1!.updated).toBeGreaterThan(0);

      const node2 = db.getNode("e2e-node-2");
      expect(node2).not.toBeNull();
      expect(node2!.name).toBe("Quarterly Report");

      db.close();
    });

    it("reconciles tags into tag_applications table", async () => {
      const nodes = [
        makeNode({
          id: "tag-test-1",
          name: "Tagged Node",
          tags: [
            { id: "tag-a", name: "alpha" },
            { id: "tag-b", name: "beta" },
          ],
          tagIds: ["tag-a", "tag-b"],
        }),
        makeNode({
          id: "tag-test-2",
          name: "Single Tag Node",
          tags: [{ id: "tag-c", name: "gamma" }],
          tagIds: ["tag-c"],
        }),
        makeNode({
          id: "tag-test-3",
          name: "No Tags Node",
          tags: [],
          tagIds: [],
        }),
      ];

      const client = createMockClient([nodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: client });

      await service.sync();

      const db = readDb(dbPath);

      // Node with 2 tags
      const tags1 = db.getTagsForNode("tag-test-1");
      expect(tags1).toHaveLength(2);
      expect(tags1[0].tag_id).toBe("tag-a");
      expect(tags1[0].tag_name).toBe("alpha");
      expect(tags1[0].tuple_node_id).toBe(""); // delta-sync uses empty tuple_node_id
      expect(tags1[1].tag_id).toBe("tag-b");
      expect(tags1[1].tag_name).toBe("beta");

      // Node with 1 tag
      const tags2 = db.getTagsForNode("tag-test-2");
      expect(tags2).toHaveLength(1);
      expect(tags2[0].tag_id).toBe("tag-c");

      // Node with no tags
      const tags3 = db.getTagsForNode("tag-test-3");
      expect(tags3).toHaveLength(0);

      // Total tags: 2 + 1 + 0 = 3
      expect(db.tagCount()).toBe(3);

      db.close();
    });

    it("updates watermark in sync_metadata after sync", async () => {
      const nodes = [makeNode({ id: "wm-node-1", name: "Watermark Test" })];
      const client = createMockClient([nodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: client });

      const beforeSync = Date.now();
      const result = await service.sync();
      const afterSync = Date.now();

      const db = readDb(dbPath);
      const meta = db.getSyncMetadata();
      expect(meta).not.toBeNull();
      expect(meta!.delta_sync_timestamp as number).toBeGreaterThanOrEqual(beforeSync);
      expect(meta!.delta_sync_timestamp as number).toBeLessThanOrEqual(afterSync);
      expect(meta!.delta_nodes_synced).toBe(1);

      // Full sync fields should be preserved
      expect(meta!.last_export_file).toBe("export-2025-01-15.json");
      expect(meta!.last_sync_timestamp as number).toBeGreaterThan(0);

      // Result watermark should match metadata
      expect(result.watermarkAfter).toBe(meta!.delta_sync_timestamp);

      db.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotent sync (no changes on second run)
  // ---------------------------------------------------------------------------

  describe("idempotent sync (no changes)", () => {
    it("second sync with no new changes returns 0 nodes", async () => {
      const nodes = [
        makeNode({ id: "idem-1", name: "First Sync Node" }),
        makeNode({ id: "idem-2", name: "Second Sync Node" }),
      ];

      // First sync delivers nodes
      const firstClient = createMockClient([nodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: firstClient });
      const firstResult = await service.sync();

      expect(firstResult.nodesFound).toBe(2);
      expect(firstResult.nodesInserted).toBe(2);
      service.close();

      // Second sync - API returns empty (no changes since watermark)
      const secondClient = createMockClient([]);
      service = new DeltaSyncService({ dbPath, localApiClient: secondClient });
      const secondResult = await service.sync();

      expect(secondResult.nodesFound).toBe(0);
      expect(secondResult.nodesInserted).toBe(0);
      expect(secondResult.nodesUpdated).toBe(0);
      expect(secondResult.pages).toBe(0);

      // Watermark should not advance when no nodes found
      expect(secondResult.watermarkAfter).toBe(secondResult.watermarkBefore);

      // Database should still have the 2 nodes from first sync
      const db = readDb(dbPath);
      expect(db.nodeCount()).toBe(2);
      db.close();
    });

    it("preserves existing node data on empty second sync", async () => {
      const nodes = [
        makeNode({
          id: "preserve-1",
          name: "Preserved Node",
          tags: [{ id: "tag-keep", name: "keep" }],
          tagIds: ["tag-keep"],
        }),
      ];

      const firstClient = createMockClient([nodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: firstClient });
      await service.sync();
      service.close();

      // Second sync - no changes
      const secondClient = createMockClient([]);
      service = new DeltaSyncService({ dbPath, localApiClient: secondClient });
      await service.sync();

      // Node and tags should still be intact
      const db = readDb(dbPath);
      const node = db.getNode("preserve-1");
      expect(node).not.toBeNull();
      expect(node!.name).toBe("Preserved Node");

      const tags = db.getTagsForNode("preserve-1");
      expect(tags).toHaveLength(1);
      expect(tags[0].tag_name).toBe("keep");

      db.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Incremental sync (new and updated nodes)
  // ---------------------------------------------------------------------------

  describe("incremental sync (changed nodes)", () => {
    it("second sync with updated node returns only the changed node", async () => {
      const initialNodes = [
        makeNode({ id: "inc-1", name: "Original Name", tags: [{ id: "t1", name: "task" }], tagIds: ["t1"] }),
        makeNode({ id: "inc-2", name: "Unchanged Node", tags: [{ id: "t2", name: "note" }], tagIds: ["t2"] }),
      ];

      // First sync
      const firstClient = createMockClient([initialNodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: firstClient });
      const firstResult = await service.sync();
      expect(firstResult.nodesInserted).toBe(2);
      service.close();

      // Second sync - only the changed node is returned by the API
      const changedNodes = [
        makeNode({
          id: "inc-1",
          name: "Updated Name",
          tags: [{ id: "t1", name: "task" }, { id: "t3", name: "urgent" }],
          tagIds: ["t1", "t3"],
        }),
      ];

      const secondClient = createMockClient([changedNodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: secondClient });
      const secondResult = await service.sync();

      expect(secondResult.nodesFound).toBe(1);
      expect(secondResult.nodesInserted).toBe(0);
      expect(secondResult.nodesUpdated).toBe(1);

      // Verify the updated node
      const db = readDb(dbPath);
      const updatedNode = db.getNode("inc-1");
      expect(updatedNode).not.toBeNull();
      expect(updatedNode!.name).toBe("Updated Name");

      // Verify tags were reconciled (old tags replaced with new)
      const updatedTags = db.getTagsForNode("inc-1");
      expect(updatedTags).toHaveLength(2);
      const tagNames = updatedTags.map((t) => t.tag_name);
      expect(tagNames).toContain("task");
      expect(tagNames).toContain("urgent");

      // Unchanged node should still be intact
      const unchangedNode = db.getNode("inc-2");
      expect(unchangedNode).not.toBeNull();
      expect(unchangedNode!.name).toBe("Unchanged Node");

      const unchangedTags = db.getTagsForNode("inc-2");
      expect(unchangedTags).toHaveLength(1);
      expect(unchangedTags[0].tag_name).toBe("note");

      db.close();
    });

    it("second sync with new nodes inserts them alongside existing", async () => {
      const initialNodes = [
        makeNode({ id: "batch-1", name: "First Batch Node" }),
      ];

      // First sync
      const firstClient = createMockClient([initialNodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: firstClient });
      await service.sync();
      service.close();

      // Second sync - new nodes only
      const newNodes = [
        makeNode({ id: "batch-2", name: "Second Batch A" }),
        makeNode({ id: "batch-3", name: "Second Batch B" }),
      ];

      const secondClient = createMockClient([newNodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: secondClient });
      const secondResult = await service.sync();

      expect(secondResult.nodesFound).toBe(2);
      expect(secondResult.nodesInserted).toBe(2);
      expect(secondResult.nodesUpdated).toBe(0);

      // All 3 nodes should exist
      const db = readDb(dbPath);
      expect(db.nodeCount()).toBe(3);
      expect(db.getNode("batch-1")).not.toBeNull();
      expect(db.getNode("batch-2")).not.toBeNull();
      expect(db.getNode("batch-3")).not.toBeNull();

      db.close();
    });

    it("second sync with mix of new and updated nodes reports both", async () => {
      const initialNodes = [
        makeNode({ id: "mix-1", name: "Existing Node", tags: [{ id: "t1", name: "old-tag" }], tagIds: ["t1"] }),
      ];

      // First sync
      const firstClient = createMockClient([initialNodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: firstClient });
      await service.sync();
      service.close();

      // Second sync - one updated, one new
      const changedNodes = [
        makeNode({
          id: "mix-1",
          name: "Existing Node (Updated)",
          tags: [{ id: "t2", name: "new-tag" }],
          tagIds: ["t2"],
        }),
        makeNode({
          id: "mix-2",
          name: "Brand New Node",
          tags: [{ id: "t3", name: "fresh" }],
          tagIds: ["t3"],
        }),
      ];

      const secondClient = createMockClient([changedNodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: secondClient });
      const result = await service.sync();

      expect(result.nodesFound).toBe(2);
      expect(result.nodesInserted).toBe(1);
      expect(result.nodesUpdated).toBe(1);

      // Verify database state
      const db = readDb(dbPath);
      expect(db.nodeCount()).toBe(2);

      const existingNode = db.getNode("mix-1");
      expect(existingNode!.name).toBe("Existing Node (Updated)");

      const existingTags = db.getTagsForNode("mix-1");
      expect(existingTags).toHaveLength(1);
      expect(existingTags[0].tag_name).toBe("new-tag");

      const newNode = db.getNode("mix-2");
      expect(newNode!.name).toBe("Brand New Node");

      db.close();
    });

    it("watermark advances after each sync with changes", async () => {
      // First sync
      const firstClient = createMockClient([[makeNode({ id: "wm-1" })]]);
      service = new DeltaSyncService({ dbPath, localApiClient: firstClient });
      const r1 = await service.sync();
      const wm1 = r1.watermarkAfter;
      service.close();

      // Small delay to ensure time advances
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Second sync with changes
      const secondClient = createMockClient([[makeNode({ id: "wm-2" })]]);
      service = new DeltaSyncService({ dbPath, localApiClient: secondClient });
      const r2 = await service.sync();
      const wm2 = r2.watermarkAfter;

      expect(wm2).toBeGreaterThan(wm1);
      service.close();

      // Third sync with no changes - watermark should NOT advance
      const thirdClient = createMockClient([]);
      service = new DeltaSyncService({ dbPath, localApiClient: thirdClient });
      const r3 = await service.sync();

      expect(r3.watermarkAfter).toBe(r3.watermarkBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // Preserved fields during update
  // ---------------------------------------------------------------------------

  describe("field preservation during update", () => {
    it("preserves parent_id, done_at, and raw_data when updating a node", async () => {
      // Pre-seed a node with all fields populated
      const setupDb = new Database(dbPath);
      setupDb.run(
        "INSERT INTO nodes (id, name, parent_id, node_type, created, updated, done_at, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["pre-seeded-1", "Old Name", "parent-abc", "node", 1700000000000, 1700000000000, 1700000100000, '{"original":"data","nested":true}']
      );
      setupDb.close();

      // Delta-sync returns this node with updated name
      const changedNodes = [
        makeNode({
          id: "pre-seeded-1",
          name: "New Name From API",
          docType: "tuple",
        }),
      ];

      const client = createMockClient([changedNodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: client });
      await service.sync();

      const db = readDb(dbPath);
      const node = db.getNode("pre-seeded-1");
      expect(node).not.toBeNull();

      // Updated fields
      expect(node!.name).toBe("New Name From API");
      expect(node!.node_type).toBe("tuple");

      // Preserved fields (delta-sync never overwrites these)
      expect(node!.parent_id).toBe("parent-abc");
      expect(node!.done_at).toBe(1700000100000);
      expect(node!.raw_data).toBe('{"original":"data","nested":true}');

      db.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-page sync
  // ---------------------------------------------------------------------------

  describe("multi-page sync", () => {
    it("handles pagination across multiple API pages", async () => {
      // Page 1: 100 nodes (full page, triggers next page fetch)
      const page1 = Array.from({ length: 100 }, (_, i) =>
        makeNode({
          id: `page1-${String(i).padStart(3, "0")}`,
          name: `Page 1 Node ${i}`,
        })
      );

      // Page 2: 50 nodes (partial page, pagination stops)
      const page2 = Array.from({ length: 50 }, (_, i) =>
        makeNode({
          id: `page2-${String(i).padStart(3, "0")}`,
          name: `Page 2 Node ${i}`,
        })
      );

      const client = createMockClient([page1, page2]);
      service = new DeltaSyncService({ dbPath, localApiClient: client });

      const result = await service.sync();

      expect(result.nodesFound).toBe(150);
      expect(result.nodesInserted).toBe(150);
      expect(result.pages).toBe(2);

      const db = readDb(dbPath);
      expect(db.nodeCount()).toBe(150);

      // Spot-check nodes from each page
      expect(db.getNode("page1-000")).not.toBeNull();
      expect(db.getNode("page1-099")).not.toBeNull();
      expect(db.getNode("page2-000")).not.toBeNull();
      expect(db.getNode("page2-049")).not.toBeNull();

      db.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    it("throws when no full sync exists in sync_metadata", async () => {
      // Create a database WITHOUT a full sync record
      const emptyDbPath = `/tmp/delta-sync-no-full-${Date.now()}.db`;
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
        localApiClient: createMockClient([]),
      });

      try {
        await expect(emptyService.sync()).rejects.toThrow("No full sync found");
      } finally {
        emptyService.close();
        try {
          require("fs").unlinkSync(emptyDbPath);
        } catch {
          // ignore
        }
      }
    });

    it("releases sync lock after error", async () => {
      // Create a database WITHOUT a full sync record to trigger error
      const errDbPath = `/tmp/delta-sync-lock-err-${Date.now()}.db`;
      const errDb = new Database(errDbPath);
      errDb.run(`
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, node_type TEXT,
          created INTEGER, updated INTEGER, done_at INTEGER, raw_data TEXT
        )
      `);
      errDb.run(`
        CREATE TABLE IF NOT EXISTS tag_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tuple_node_id TEXT NOT NULL, data_node_id TEXT NOT NULL,
          tag_id TEXT NOT NULL, tag_name TEXT NOT NULL
        )
      `);
      errDb.run(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_export_file TEXT NOT NULL DEFAULT '',
          last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
          total_nodes INTEGER NOT NULL DEFAULT 0
        )
      `);
      errDb.close();

      const errService = new DeltaSyncService({
        dbPath: errDbPath,
        localApiClient: createMockClient([]),
      });

      try {
        await errService.sync();
      } catch {
        // Expected error
      }

      // Lock should be released even after error
      expect(errService.isSyncing()).toBe(false);

      errService.close();
      try {
        require("fs").unlinkSync(errDbPath);
      } catch {
        // ignore
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Status reporting
  // ---------------------------------------------------------------------------

  describe("status reporting after sync", () => {
    it("getStatus reflects completed delta-sync", async () => {
      const nodes = [
        makeNode({ id: "status-1", name: "Status Test Node" }),
        makeNode({ id: "status-2", name: "Status Test Node 2" }),
      ];

      const client = createMockClient([nodes]);
      service = new DeltaSyncService({ dbPath, localApiClient: client });

      const beforeSync = Date.now();
      await service.sync();

      const status = service.getStatus();

      expect(status.totalNodes).toBe(2);
      expect(status.lastFullSync).not.toBeNull();
      expect(status.lastFullSync!).toBeGreaterThan(0);
      expect(status.lastDeltaSync).not.toBeNull();
      expect(status.lastDeltaSync!).toBeGreaterThanOrEqual(beforeSync);
      expect(status.lastDeltaNodesCount).toBe(2);
      expect(status.embeddingCoverage).toBe(0); // placeholder
    });
  });
});
