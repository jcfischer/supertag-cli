/**
 * Tests for Unified Query Engine
 * Spec 063: Unified Query Language
 *
 * TDD: Tests for the query engine
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { UnifiedQueryEngine } from "../src/query/unified-query-engine";
import type { QueryAST } from "../src/query/types";

describe("Unified Query Engine", () => {
  let db: Database;
  let engine: UnifiedQueryEngine;

  beforeAll(() => {
    // Create in-memory database with test data
    db = new Database(":memory:");

    // Create schema
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
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Nodes
    db.run("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "task1", "Fix login bug", "project1", "node", weekAgo, now, null, "{}",
    ]);
    db.run("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "task2", "Write tests", "project1", "node", monthAgo, weekAgo, null, "{}",
    ]);
    db.run("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "task3", "Deploy to prod", "project2", "node", now, null, null, "{}",
    ]);
    db.run("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "project1", "Auth Project", null, "node", monthAgo, now, null, "{}",
    ]);
    db.run("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "project2", "Infra Project", null, "node", monthAgo, null, null, "{}",
    ]);
    db.run("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "meeting1", "Standup", null, "node", now, null, null, "{}",
    ]);

    // Tag applications
    db.run("INSERT INTO tag_applications VALUES (?, ?, ?)", ["task1", "tag_task", "task"]);
    db.run("INSERT INTO tag_applications VALUES (?, ?, ?)", ["task2", "tag_task", "task"]);
    db.run("INSERT INTO tag_applications VALUES (?, ?, ?)", ["task3", "tag_task", "task"]);
    db.run("INSERT INTO tag_applications VALUES (?, ?, ?)", ["project1", "tag_project", "project"]);
    db.run("INSERT INTO tag_applications VALUES (?, ?, ?)", ["project2", "tag_project", "project"]);
    db.run("INSERT INTO tag_applications VALUES (?, ?, ?)", ["meeting1", "tag_meeting", "meeting"]);

    // Field values
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_name, value_text, created) VALUES (?, ?, ?, ?, ?)", [
      "tuple1", "task1", "Status", "Active", now,
    ]);
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_name, value_text, created) VALUES (?, ?, ?, ?, ?)", [
      "tuple2", "task2", "Status", "Done", now,
    ]);
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_name, value_text, created) VALUES (?, ?, ?, ?, ?)", [
      "tuple3", "task3", "Status", "Active", now,
    ]);
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_name, value_text, created) VALUES (?, ?, ?, ?, ?)", [
      "tuple4", "task1", "Priority", "3", now,
    ]);
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_name, value_text, created) VALUES (?, ?, ?, ?, ?)", [
      "tuple5", "task2", "Priority", "1", now,
    ]);

    engine = new UnifiedQueryEngine(db);
  });

  afterAll(() => {
    db.close();
  });

  describe("T-3.1: Engine Structure", () => {
    it("should create engine with database", () => {
      expect(engine).toBeDefined();
    });

    it("should execute basic query", async () => {
      const ast: QueryAST = { find: "task" };
      const result = await engine.execute(ast);
      expect(result.results).toBeDefined();
      expect(result.count).toBeGreaterThan(0);
    });

    it("should return hasMore flag", async () => {
      const ast: QueryAST = { find: "task", limit: 1 };
      const result = await engine.execute(ast);
      expect(typeof result.hasMore).toBe("boolean");
    });
  });

  describe("T-3.2: Query Validation", () => {
    it("should validate find is required", async () => {
      const ast = {} as QueryAST;
      await expect(engine.execute(ast)).rejects.toThrow();
    });

    it("should validate limit is positive", async () => {
      const ast: QueryAST = { find: "task", limit: -5 };
      await expect(engine.execute(ast)).rejects.toThrow();
    });

    it("should validate offset is non-negative", async () => {
      const ast: QueryAST = { find: "task", offset: -1 };
      await expect(engine.execute(ast)).rejects.toThrow();
    });
  });

  describe("T-3.3: SQL Generation", () => {
    it("should find nodes by tag", async () => {
      const ast: QueryAST = { find: "task" };
      const result = await engine.execute(ast);
      expect(result.count).toBe(3);
    });

    it("should filter by field equality", async () => {
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "Status", operator: "=", value: "Done" }],
      };
      const result = await engine.execute(ast);
      expect(result.count).toBe(1);
      expect(result.results[0].name).toBe("Write tests");
    });

    it("should filter by created date", async () => {
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "created", operator: ">", value: Date.now() - 8 * 24 * 60 * 60 * 1000 }],
      };
      const result = await engine.execute(ast);
      expect(result.count).toBeGreaterThan(0);
    });

    it("should order by created descending", async () => {
      const ast: QueryAST = {
        find: "task",
        orderBy: { field: "created", desc: true },
      };
      const result = await engine.execute(ast);
      // Most recent first
      const created = result.results.map((r) => r.created) as number[];
      for (let i = 1; i < created.length; i++) {
        expect(created[i - 1]).toBeGreaterThanOrEqual(created[i]);
      }
    });

    it("should limit results", async () => {
      const ast: QueryAST = { find: "task", limit: 2 };
      const result = await engine.execute(ast);
      expect(result.results).toHaveLength(2);
    });

    it("should offset results", async () => {
      const ast1: QueryAST = { find: "task", limit: 10 };
      const ast2: QueryAST = { find: "task", limit: 10, offset: 1 };
      const result1 = await engine.execute(ast1);
      const result2 = await engine.execute(ast2);
      expect(result1.results[1].id).toBe(result2.results[0].id);
    });
  });

  describe("T-3.4: FTS Query Detection", () => {
    // FTS requires the FTS table - skip for now, test with mocked data
    it("should detect name contains pattern", async () => {
      const ast: QueryAST = {
        find: "*",
        where: [{ field: "name", operator: "~", value: "bug" }],
      };
      const result = await engine.execute(ast);
      expect(result.results.some((r) => (r.name as string)?.includes("bug"))).toBe(true);
    });
  });

  describe("T-3.5: Parent Join Handling", () => {
    it("should filter by parent tag", async () => {
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "parent.tags", operator: "~", value: "project" }],
      };
      const result = await engine.execute(ast);
      // All tasks have project parents
      expect(result.count).toBeGreaterThan(0);
    });

    it("should filter by parent name", async () => {
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "parent.name", operator: "=", value: "Auth Project" }],
      };
      const result = await engine.execute(ast);
      expect(result.count).toBe(2); // task1 and task2
    });
  });

  describe("T-3.6: Result Projection", () => {
    it("should return all fields by default", async () => {
      const ast: QueryAST = { find: "task", limit: 1 };
      const result = await engine.execute(ast);
      const node = result.results[0];
      expect(node.id).toBeDefined();
      expect(node.name).toBeDefined();
      expect(node.created).toBeDefined();
    });

    it("should include core fields plus selected custom fields", async () => {
      // select now specifies custom fields to include; core fields are always present
      const ast: QueryAST = {
        find: "task",
        select: ["Status"],
        limit: 1,
      };
      const result = await engine.execute(ast);
      const node = result.results[0] as any;
      // Core fields always present
      expect(node.id).toBeDefined();
      expect(node.name).toBeDefined();
      expect(node.created).toBeDefined();
      // Custom fields in fields property
      expect(node.fields).toBeDefined();
    });
  });

  describe("OR Group Execution", () => {
    it("should handle OR groups", async () => {
      const ast: QueryAST = {
        find: "task",
        where: [
          {
            type: "or",
            clauses: [
              { field: "Status", operator: "=", value: "Done" },
              { field: "Status", operator: "=", value: "Active" },
            ],
          },
        ],
      };
      const result = await engine.execute(ast);
      expect(result.count).toBeGreaterThan(0);
    });
  });

  describe("Is Empty Operator", () => {
    it("should match nodes where field does not exist", async () => {
      // task3 has no Priority field
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "Priority", operator: "is_empty", value: true }],
      };
      const result = await engine.execute(ast);
      expect(result.count).toBe(1);
      expect(result.results[0].name).toBe("Deploy to prod"); // task3
    });

    it("should match nodes where field is empty string", async () => {
      // Add an empty Description field to task1
      db.run(
        "INSERT INTO field_values (tuple_id, parent_id, field_name, value_text, created) VALUES (?, ?, ?, ?, ?)",
        ["tuple6", "task1", "Description", "", Date.now()]
      );

      const ast: QueryAST = {
        find: "task",
        where: [{ field: "Description", operator: "is_empty", value: true }],
      };
      const result = await engine.execute(ast);
      // task1 has empty Description, task2/task3 have no Description
      expect(result.count).toBe(3);
    });

    it("should handle negated is_empty (not is empty)", async () => {
      // Priority exists for task1 and task2, not for task3
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "Priority", operator: "is_empty", value: true, negated: true }],
      };
      const result = await engine.execute(ast);
      expect(result.count).toBe(2);
      // task1 and task2 have Priority
      const names = result.results.map((r) => r.name);
      expect(names).toContain("Fix login bug");
      expect(names).toContain("Write tests");
    });

    it("should exclude nodes with non-empty values", async () => {
      // Status exists and is non-empty for all tasks
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "Status", operator: "is_empty", value: true }],
      };
      const result = await engine.execute(ast);
      expect(result.count).toBe(0);
    });
  });

  describe("Field Output (F-093)", () => {
    it("should include field values when select specifies fields", async () => {
      const ast: QueryAST = {
        find: "task",
        select: ["Status", "Priority"],
      };
      const result = await engine.execute(ast);
      expect(result.fieldNames).toBeDefined();
      expect(result.fieldNames).toContain("Status");
      // Check that results have fields property
      const firstResult = result.results[0] as any;
      expect(firstResult.fields).toBeDefined();
    });

    it("should include all fields when select is *", async () => {
      // First, we need to set up supertag tables
      db.run(`
        CREATE TABLE IF NOT EXISTS supertags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          node_id TEXT NOT NULL,
          tag_name TEXT NOT NULL,
          tag_id TEXT NOT NULL
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS supertag_fields (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tag_id TEXT NOT NULL,
          tag_name TEXT NOT NULL,
          field_name TEXT NOT NULL,
          field_order INTEGER DEFAULT 0,
          UNIQUE(tag_id, field_name)
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS supertag_parents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          child_tag_id TEXT NOT NULL,
          parent_tag_id TEXT NOT NULL,
          UNIQUE(child_tag_id, parent_tag_id)
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS supertag_metadata (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tag_id TEXT NOT NULL UNIQUE,
          tag_name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          description TEXT,
          color TEXT,
          created_at INTEGER
        )
      `);
      db.run("INSERT OR IGNORE INTO supertags (node_id, tag_name, tag_id) VALUES (?, ?, ?)", [
        "tag_task_node", "task", "tag_task",
      ]);
      db.run("INSERT OR IGNORE INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES (?, ?, ?)", [
        "tag_task", "task", "task",
      ]);
      db.run("INSERT OR IGNORE INTO supertag_fields (tag_id, tag_name, field_name, field_order) VALUES (?, ?, ?, ?)", [
        "tag_task", "task", "Status", 1,
      ]);
      db.run("INSERT OR IGNORE INTO supertag_fields (tag_id, tag_name, field_name, field_order) VALUES (?, ?, ?, ?)", [
        "tag_task", "task", "Priority", 2,
      ]);

      const ast: QueryAST = {
        find: "task",
        select: ["*"],
      };
      const result = await engine.execute(ast);
      expect(result.fieldNames).toBeDefined();
      expect(result.fieldNames!.length).toBeGreaterThan(0);
    });

    it("should not include fields when select is not specified", async () => {
      const ast: QueryAST = { find: "task" };
      const result = await engine.execute(ast);
      // fieldNames should be undefined or empty when no select
      expect(result.fieldNames).toBeUndefined();
    });
  });

  describe("Date Field Handling", () => {
    it("should parse ISO date for created field", async () => {
      // Get a task to find its created date
      const allTasks = await engine.execute({ find: "task", limit: 1 });
      expect(allTasks.count).toBeGreaterThan(0);

      // The test data uses relative timestamps, so we'll test with a date far in the past
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "created", operator: ">", value: "2020-01-01" }],
      };
      const result = await engine.execute(ast);
      // All tasks should be after 2020-01-01
      expect(result.count).toBe(3);
    });

    it("should parse ISO date for updated field", async () => {
      const ast: QueryAST = {
        find: "task",
        where: [{ field: "updated", operator: ">", value: "2020-01-01" }],
      };
      const result = await engine.execute(ast);
      // Only tasks with updated set (task1, task2) should match
      expect(result.count).toBeGreaterThanOrEqual(1);
    });

    it("should handle exact ISO date match with date range", async () => {
      // Test that ISO dates are converted to timestamps for comparison
      const ast: QueryAST = {
        find: "task",
        where: [
          { field: "created", operator: ">", value: "2020-01-01" },
          { field: "created", operator: "<", value: "2099-12-31" },
        ],
      };
      const result = await engine.execute(ast);
      expect(result.count).toBe(3);
    });
  });
});
