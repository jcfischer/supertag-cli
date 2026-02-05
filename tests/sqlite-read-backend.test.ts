/**
 * Tests for SqliteReadBackend
 * Spec: F-097 Live Read Backend
 * Task: T-2.2
 *
 * Tests the SQLite implementation of TanaReadBackend interface.
 * Uses temporary file-based databases (TanaQueryEngine requires a file path).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteReadBackend } from "../src/api/sqlite-read-backend";
import type {
  ReadSearchResult,
  ReadNodeContent,
  ReadTagInfo,
  PaginatedResult,
} from "../src/api/read-backend";
import { getUniqueTestDbPath, cleanupSqliteDatabase } from "./test-utils";

// =============================================================================
// Test Database Setup
// =============================================================================

/**
 * Create a temporary test database with tables matching the production schema.
 * Populates with enough data to exercise search, readNode, getChildren, listTags.
 */
function createTestDatabase(): { dbPath: string; cleanup: () => void } {
  const dbPath = getUniqueTestDbPath("sqlite-read-backend");
  const db = new Database(dbPath);

  // Create tables matching production schema
  db.exec(`
    -- Core nodes table
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      parent_id TEXT,
      node_type TEXT,
      created INTEGER,
      updated INTEGER,
      done_at INTEGER,
      raw_data TEXT
    );

    -- FTS5 index for search
    CREATE VIRTUAL TABLE nodes_fts USING fts5(
      id UNINDEXED,
      name,
      content='nodes',
      content_rowid='rowid'
    );

    -- Tag applications (node -> supertag assignments)
    CREATE TABLE tag_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_node_id TEXT NOT NULL,
      data_node_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      tag_name TEXT NOT NULL
    );

    CREATE INDEX idx_tag_apps_data_node ON tag_applications(data_node_id);
    CREATE INDEX idx_tag_apps_tag_name ON tag_applications(tag_name);

    -- Supertag metadata
    CREATE TABLE supertag_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id TEXT NOT NULL UNIQUE,
      tag_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at INTEGER
    );

    -- Field values
    CREATE TABLE field_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      field_def_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      value_node_id TEXT NOT NULL,
      value_text TEXT NOT NULL,
      value_order INTEGER DEFAULT 0,
      created INTEGER
    );

    -- Field names (for resolving field IDs)
    CREATE TABLE field_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_id TEXT NOT NULL UNIQUE,
      field_name TEXT NOT NULL,
      supertags TEXT
    );

    -- Supertags table (for drizzle ORM compatibility)
    CREATE TABLE supertags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      color TEXT
    );

    -- Fields table
    CREATE TABLE fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_id TEXT NOT NULL
    );

    -- References table
    CREATE TABLE "references" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_node TEXT NOT NULL,
      to_node TEXT NOT NULL,
      reference_type TEXT NOT NULL
    );
  `);

  // Insert test nodes
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const insertNode = db.prepare(
    `INSERT INTO nodes (id, name, parent_id, node_type, created, updated, raw_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  // Parent node with children
  insertNode.run(
    "node-1",
    "Project Alpha",
    null,
    null,
    now - 30 * day,
    now - 5 * day,
    JSON.stringify({ children: ["child-1", "child-2", "child-3"] })
  );

  // Children of node-1
  insertNode.run(
    "child-1",
    "Task: Design UI",
    "node-1",
    null,
    now - 25 * day,
    now - 10 * day,
    JSON.stringify({ children: [] })
  );
  insertNode.run(
    "child-2",
    "Task: Build API",
    "node-1",
    null,
    now - 20 * day,
    now - 8 * day,
    JSON.stringify({ children: [] })
  );
  insertNode.run(
    "child-3",
    "Task: Write Tests",
    "node-1",
    null,
    now - 15 * day,
    now - 3 * day,
    JSON.stringify({ children: [] })
  );

  // Node with description field
  insertNode.run(
    "node-2",
    "Meeting Notes",
    null,
    null,
    now - 10 * day,
    now - 2 * day,
    JSON.stringify({ children: ["tuple-desc"] })
  );

  // Tuple child for description (should be filtered as tuple)
  insertNode.run(
    "tuple-desc",
    null,
    "node-2",
    null,
    now - 10 * day,
    null,
    JSON.stringify({ children: [], props: { _docType: "tuple" } })
  );

  // Node with no children
  insertNode.run(
    "node-3",
    "Quick Note",
    null,
    null,
    now - 5 * day,
    null,
    JSON.stringify({ children: [] })
  );

  // Trashed node (should be excluded)
  insertNode.run(
    "node-trash",
    "Deleted Item",
    null,
    "trash",
    now - 40 * day,
    null,
    JSON.stringify({ children: [] })
  );

  // Additional nodes for search testing
  insertNode.run(
    "node-4",
    "Architecture Review Document",
    null,
    null,
    now - 8 * day,
    now - 1 * day,
    JSON.stringify({ children: [] })
  );

  insertNode.run(
    "node-5",
    "Design Review Session",
    null,
    null,
    now - 3 * day,
    now,
    JSON.stringify({ children: [] })
  );

  // Populate FTS index
  db.exec(`
    INSERT INTO nodes_fts(rowid, id, name)
    SELECT rowid, id, name FROM nodes WHERE name IS NOT NULL
  `);

  // Insert tag applications
  const insertTag = db.prepare(
    `INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES (?, ?, ?, ?)`
  );
  insertTag.run("t1", "node-1", "tag-project", "project");
  insertTag.run("t2", "node-1", "tag-active", "active");
  insertTag.run("t3", "child-1", "tag-task", "task");
  insertTag.run("t4", "child-2", "tag-task", "task");
  insertTag.run("t5", "child-3", "tag-task", "task");
  insertTag.run("t6", "node-2", "tag-meeting", "meeting");
  insertTag.run("t7", "node-4", "tag-doc", "document");
  insertTag.run("t8", "node-5", "tag-meeting", "meeting");

  // Insert supertag metadata
  const insertMeta = db.prepare(
    `INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertMeta.run("tag-project", "project", "project", "Project tracking", "blue");
  insertMeta.run("tag-task", "task", "task", "Task items", "green");
  insertMeta.run("tag-meeting", "meeting", "meeting", "Meeting notes", "red");
  insertMeta.run("tag-doc", "document", "document", null, null);
  insertMeta.run("tag-active", "active", "active", null, "yellow");

  // Insert field values (Description for node-2)
  const insertField = db.prepare(
    `INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertField.run("tuple-desc", "node-2", "field-desc", "Description", "val-1", "Weekly team sync meeting", 0);

  db.close();

  return {
    dbPath,
    cleanup: () => cleanupSqliteDatabase(dbPath),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("F-097 T-2.2: SqliteReadBackend", () => {
  let dbPath: string;
  let cleanup: () => void;
  let backend: SqliteReadBackend;

  beforeAll(() => {
    const db = createTestDatabase();
    dbPath = db.dbPath;
    cleanup = db.cleanup;
    backend = new SqliteReadBackend(dbPath);
  });

  afterAll(() => {
    backend.close();
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // type
  // ---------------------------------------------------------------------------
  describe("type", () => {
    test("returns sqlite", () => {
      expect(backend.type).toBe("sqlite");
    });
  });

  // ---------------------------------------------------------------------------
  // isLive
  // ---------------------------------------------------------------------------
  describe("isLive", () => {
    test("returns false", () => {
      expect(backend.isLive()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------
  describe("search", () => {
    test("returns matching results for a query", async () => {
      const results = await backend.search("Project");
      expect(results.length).toBeGreaterThanOrEqual(1);

      const projectResult = results.find((r) => r.id === "node-1");
      expect(projectResult).toBeDefined();
      expect(projectResult!.name).toBe("Project Alpha");
    });

    test("returns tags for each result", async () => {
      const results = await backend.search("Project Alpha");
      const projectResult = results.find((r) => r.id === "node-1");
      expect(projectResult).toBeDefined();
      expect(projectResult!.tags).toContain("project");
      expect(projectResult!.tags).toContain("active");
    });

    test("includes rank from FTS5", async () => {
      const results = await backend.search("Review");
      expect(results.length).toBeGreaterThanOrEqual(1);
      // FTS5 rank is typically a negative float
      for (const result of results) {
        expect(result.rank).toBeDefined();
        expect(typeof result.rank).toBe("number");
      }
    });

    test("respects limit option", async () => {
      const results = await backend.search("Task", { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    test("returns empty array for no matches", async () => {
      const results = await backend.search("xyznonexistent");
      expect(results).toEqual([]);
    });

    test("includes created timestamp as ISO string", async () => {
      const results = await backend.search("Project Alpha");
      const projectResult = results.find((r) => r.id === "node-1");
      expect(projectResult).toBeDefined();
      expect(projectResult!.created).toBeDefined();
      // Should be an ISO date string
      expect(typeof projectResult!.created).toBe("string");
      expect(new Date(projectResult!.created!).getTime()).toBeGreaterThan(0);
    });

    test("does not include breadcrumb (SQLite-only)", async () => {
      const results = await backend.search("Project");
      for (const result of results) {
        expect(result.breadcrumb).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // readNode
  // ---------------------------------------------------------------------------
  describe("readNode", () => {
    test("returns node content with markdown", async () => {
      const content = await backend.readNode("node-1");
      expect(content.id).toBe("node-1");
      expect(content.name).toBe("Project Alpha");
      expect(content.markdown).toBeDefined();
      expect(content.markdown.length).toBeGreaterThan(0);
      // The formatted output should contain the node name
      expect(content.markdown).toContain("Project Alpha");
    });

    test("includes tags", async () => {
      const content = await backend.readNode("node-1");
      expect(content.tags).toBeDefined();
      expect(content.tags).toContain("project");
      expect(content.tags).toContain("active");
    });

    test("includes description from Description field", async () => {
      const content = await backend.readNode("node-2");
      expect(content.description).toBe("Weekly team sync meeting");
    });

    test("throws for non-existent node", async () => {
      await expect(backend.readNode("nonexistent-id")).rejects.toThrow();
    });

    test("returns children array when depth > 0", async () => {
      const content = await backend.readNode("node-1", 1);
      expect(content.children).toBeDefined();
      expect(content.children!.length).toBeGreaterThan(0);

      // Each child should have id, name, markdown
      const firstChild = content.children![0];
      expect(firstChild.id).toBeDefined();
      expect(firstChild.name).toBeDefined();
      expect(firstChild.markdown).toBeDefined();
    });

    test("returns no children array when depth is 0", async () => {
      const content = await backend.readNode("node-1", 0);
      // With depth 0, children should not be populated recursively
      // The markdown will list children but the children array won't have ReadNodeContent items
      // (the default behavior without depth doesn't recurse)
      expect(content.children === undefined || content.children!.length === 0).toBe(true);
    });

    test("excludes trashed nodes", async () => {
      await expect(backend.readNode("node-trash")).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // getChildren
  // ---------------------------------------------------------------------------
  describe("getChildren", () => {
    test("returns paginated children of a node", async () => {
      const result = await backend.getChildren("node-1");
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.hasMore).toBeDefined();
    });

    test("each child has id, name, and markdown", async () => {
      const result = await backend.getChildren("node-1");
      for (const child of result.items) {
        expect(child.id).toBeDefined();
        expect(child.name).toBeDefined();
        expect(child.markdown).toBeDefined();
        expect(typeof child.markdown).toBe("string");
      }
    });

    test("respects limit option", async () => {
      const result = await backend.getChildren("node-1", { limit: 1 });
      expect(result.items.length).toBeLessThanOrEqual(1);
      expect(result.hasMore).toBe(true);
    });

    test("supports offset pagination", async () => {
      const first = await backend.getChildren("node-1", { limit: 1, offset: 0 });
      const second = await backend.getChildren("node-1", { limit: 1, offset: 1 });

      expect(first.items.length).toBe(1);
      expect(second.items.length).toBe(1);
      expect(first.items[0].id).not.toBe(second.items[0].id);
    });

    test("returns total count", async () => {
      const result = await backend.getChildren("node-1");
      expect(result.total).toBe(3); // child-1, child-2, child-3
    });

    test("excludes trashed children", async () => {
      // node-trash has node_type='trash' and should not appear as a child
      const result = await backend.getChildren("node-1");
      const trashedChild = result.items.find((c) => c.id === "node-trash");
      expect(trashedChild).toBeUndefined();
    });

    test("returns empty items for node with no children", async () => {
      const result = await backend.getChildren("node-3");
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    test("hasMore is false when all children returned", async () => {
      const result = await backend.getChildren("node-1", { limit: 100 });
      expect(result.hasMore).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // listTags
  // ---------------------------------------------------------------------------
  describe("listTags", () => {
    test("returns tags with id and name", async () => {
      const tags = await backend.listTags();
      expect(tags.length).toBeGreaterThan(0);

      for (const tag of tags) {
        expect(tag.id).toBeDefined();
        expect(tag.name).toBeDefined();
        expect(typeof tag.id).toBe("string");
        expect(typeof tag.name).toBe("string");
      }
    });

    test("includes instance counts from tag_applications", async () => {
      const tags = await backend.listTags();
      // task tag has 3 applications (child-1, child-2, child-3)
      const taskTag = tags.find((t) => t.name === "task");
      expect(taskTag).toBeDefined();
      expect(taskTag!.instanceCount).toBe(3);

      // meeting tag has 2 applications (node-2, node-5)
      const meetingTag = tags.find((t) => t.name === "meeting");
      expect(meetingTag).toBeDefined();
      expect(meetingTag!.instanceCount).toBe(2);
    });

    test("includes color from metadata", async () => {
      const tags = await backend.listTags();
      const projectTag = tags.find((t) => t.name === "project");
      expect(projectTag).toBeDefined();
      expect(projectTag!.color).toBe("blue");
    });

    test("respects limit option", async () => {
      const tags = await backend.listTags({ limit: 2 });
      expect(tags.length).toBeLessThanOrEqual(2);
    });

    test("orders by instance count descending", async () => {
      const tags = await backend.listTags();
      // task (3) should come before meeting (2)
      const taskIdx = tags.findIndex((t) => t.name === "task");
      const meetingIdx = tags.findIndex((t) => t.name === "meeting");
      expect(taskIdx).toBeLessThan(meetingIdx);
    });
  });

  // ---------------------------------------------------------------------------
  // close
  // ---------------------------------------------------------------------------
  describe("close", () => {
    test("does not throw", () => {
      // Create a separate backend to test close
      const closableBackend = new SqliteReadBackend(dbPath);
      expect(() => closableBackend.close()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // ReadSearchResult contract
  // ---------------------------------------------------------------------------
  describe("search result contract", () => {
    test("results conform to ReadSearchResult interface", async () => {
      const results = await backend.search("Task");
      expect(results.length).toBeGreaterThan(0);

      const result = results[0];
      // Required fields
      expect(typeof result.id).toBe("string");
      expect(typeof result.name).toBe("string");
      expect(Array.isArray(result.tags)).toBe(true);

      // Optional SQLite fields should be present
      expect(typeof result.rank).toBe("number");
    });
  });
});
