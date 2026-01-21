/**
 * Tests for Aggregate CLI Command
 * Spec 064: Aggregation Queries
 *
 * Tests the CLI command integration with the aggregation service
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("Aggregate Command", () => {
  const testDir = "/tmp/supertag-aggregate-test";
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

    // Insert test data: 5 todos with different statuses
    const now = Date.now();
    const todos = [
      { id: "t1", name: "Todo 1", status: "Done" },
      { id: "t2", name: "Todo 2", status: "Done" },
      { id: "t3", name: "Todo 3", status: "In Progress" },
      { id: "t4", name: "Todo 4", status: "In Progress" },
      { id: "t5", name: "Todo 5", status: "Backlog" },
    ];

    for (const todo of todos) {
      db.run(
        "INSERT INTO nodes (id, name, created, updated) VALUES (?, ?, ?, ?)",
        [todo.id, todo.name, now, now]
      );
      db.run(
        "INSERT INTO tag_applications (data_node_id, tag_id, tag_name) VALUES (?, ?, ?)",
        [todo.id, "tag-todo", "todo"]
      );
      db.run(
        "INSERT INTO field_values (parent_id, field_name, value_text) VALUES (?, ?, ?)",
        [todo.id, "Status", todo.status]
      );
    }

    db.close();
  });

  afterAll(() => {
    // Clean up
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("without --group-by (total count only)", () => {
    it("returns total count in JSON format", async () => {
      const result = await $`bun run src/index.ts aggregate --tag todo --db-path ${dbPath} --json`.text();
      const data = JSON.parse(result);

      expect(data.total).toBe(5);
      expect(data.groupCount).toBe(0);
      expect(data.groups).toEqual({});
    });

    it("returns total count in table format with --pretty", async () => {
      const result = await $`bun run src/index.ts aggregate --tag todo --db-path ${dbPath} --pretty`.text();

      expect(result).toContain("5");
      expect(result).toContain("Total Count");
    });

    it("returns total count in TSV format", async () => {
      const result = await $`bun run src/index.ts aggregate --tag todo --db-path ${dbPath} --format table`.text();

      // TSV format: tag\tcount
      expect(result.trim()).toBe("todo\t5");
    });

    it("returns total count in CSV format", async () => {
      const result = await $`bun run src/index.ts aggregate --tag todo --db-path ${dbPath} --format csv`.text();

      // CSV format with header
      expect(result.trim()).toBe('tag,total\n"todo",5');
    });

    it("returns total count in JSONL format", async () => {
      const result = await $`bun run src/index.ts aggregate --tag todo --db-path ${dbPath} --format jsonl`.text();

      const data = JSON.parse(result.trim());
      expect(data.tag).toBe("todo");
      expect(data.total).toBe(5);
    });
  });

  describe("with --group-by", () => {
    it("groups by field in JSON format", async () => {
      const result = await $`bun run src/index.ts aggregate --tag todo --group-by Status --db-path ${dbPath} --json`.text();
      const data = JSON.parse(result);

      expect(data.total).toBe(5);
      expect(data.groupCount).toBe(3);
      expect(data.groups["Done"]).toBe(2);
      expect(data.groups["In Progress"]).toBe(2);
      expect(data.groups["Backlog"]).toBe(1);
    });
  });
});
