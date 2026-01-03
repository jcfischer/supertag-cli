/**
 * Tests for Query CLI Command
 * Spec 063: Unified Query Language
 *
 * Tests the CLI command integration with the query engine
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("Query Command", () => {
  const testDir = "/tmp/supertag-query-test";
  const dbPath = join(testDir, "test.db");

  beforeAll(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Create test database
    const db = new Database(dbPath);

    db.run(`
      CREATE TABLE nodes (
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
      CREATE TABLE tag_applications (
        data_node_id TEXT,
        tag_id TEXT,
        tag_name TEXT,
        PRIMARY KEY (data_node_id, tag_id)
      )
    `);

    db.run(`
      CREATE TABLE field_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_id TEXT,
        parent_id TEXT,
        field_def_id TEXT,
        field_name TEXT,
        value_node_id TEXT,
        value_text TEXT,
        value_order INTEGER,
        created INTEGER
      )
    `);

    // Insert test data
    const now = Date.now();
    db.run("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "task1", "Fix bug", null, "node", now, null, null, "{}",
    ]);
    db.run("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "task2", "Write tests", null, "node", now - 86400000, null, null, "{}",
    ]);
    db.run("INSERT INTO tag_applications VALUES (?, ?, ?)", ["task1", "tag_task", "task"]);
    db.run("INSERT INTO tag_applications VALUES (?, ?, ?)", ["task2", "tag_task", "task"]);
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_name, value_text, created) VALUES (?, ?, ?, ?, ?)", [
      "t1", "task1", "Status", "Active", now,
    ]);
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_name, value_text, created) VALUES (?, ?, ?, ?, ?)", [
      "t2", "task2", "Status", "Done", now,
    ]);

    db.close();
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("CLI Parsing", () => {
    it("should parse basic query string", async () => {
      // Use parseQuery directly to test parsing
      const { parseQuery } = await import("../src/query/parser");
      const ast = parseQuery("find task");
      expect(ast.find).toBe("task");
    });

    it("should parse query with where clause", async () => {
      const { parseQuery } = await import("../src/query/parser");
      const ast = parseQuery("find task where Status = Done");
      expect(ast.find).toBe("task");
      expect(ast.where).toHaveLength(1);
    });

    it("should parse query with all options", async () => {
      const { parseQuery } = await import("../src/query/parser");
      const ast = parseQuery("find task where Status = Active order by -created limit 10");
      expect(ast.find).toBe("task");
      expect(ast.where).toHaveLength(1);
      expect(ast.orderBy?.desc).toBe(true);
      expect(ast.limit).toBe(10);
    });
  });

  describe("Engine Integration", () => {
    it("should execute query against database", async () => {
      const { UnifiedQueryEngine } = await import("../src/query/unified-query-engine");
      const db = new Database(dbPath);
      const engine = new UnifiedQueryEngine(db);

      const result = await engine.execute({ find: "task" });
      expect(result.count).toBe(2);

      db.close();
    });

    it("should filter by field value", async () => {
      const { UnifiedQueryEngine } = await import("../src/query/unified-query-engine");
      const db = new Database(dbPath);
      const engine = new UnifiedQueryEngine(db);

      const result = await engine.execute({
        find: "task",
        where: [{ field: "Status", operator: "=", value: "Done" }],
      });
      expect(result.count).toBe(1);
      expect(result.results[0].name).toBe("Write tests");

      db.close();
    });
  });
});
