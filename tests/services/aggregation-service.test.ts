/**
 * Tests for AggregationService
 * Spec 064: Aggregation Queries
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { AggregationService } from "../../src/services/aggregation-service";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Create a temporary test database with sample data
 */
function createTestDatabase(): { dbPath: string; cleanup: () => void } {
  const dbPath = path.join(os.tmpdir(), `agg-test-${Date.now()}.db`);
  const db = new Database(dbPath);

  // Create minimal schema
  db.exec(`
    -- Nodes table
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      parent_id TEXT,
      node_type TEXT,
      created INTEGER,
      updated INTEGER,
      done_at INTEGER
    );

    -- Tag applications (supertag assignments)
    CREATE TABLE tag_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_node_id TEXT NOT NULL,
      tag_name TEXT NOT NULL
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
  `);

  // Insert test data: 10 tasks with different statuses
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const tasks = [
    { id: "t1", name: "Task 1", status: "Done", priority: "High", created: now - 30 * day },
    { id: "t2", name: "Task 2", status: "Done", priority: "High", created: now - 25 * day },
    { id: "t3", name: "Task 3", status: "Done", priority: "Medium", created: now - 20 * day },
    { id: "t4", name: "Task 4", status: "Done", priority: "Low", created: now - 15 * day },
    { id: "t5", name: "Task 5", status: "In Progress", priority: "High", created: now - 10 * day },
    { id: "t6", name: "Task 6", status: "In Progress", priority: "Medium", created: now - 8 * day },
    { id: "t7", name: "Task 7", status: "Open", priority: "High", created: now - 5 * day },
    { id: "t8", name: "Task 8", status: "Open", priority: "Medium", created: now - 3 * day },
    { id: "t9", name: "Task 9", status: "Open", priority: "Low", created: now - 1 * day },
    { id: "t10", name: "Task 10", status: null, priority: "Low", created: now }, // No status
  ];

  // Insert nodes
  const insertNode = db.prepare(`
    INSERT INTO nodes (id, name, parent_id, node_type, created, updated)
    VALUES (?, ?, NULL, 'node', ?, ?)
  `);

  const insertTag = db.prepare(`
    INSERT INTO tag_applications (data_node_id, tag_name) VALUES (?, ?)
  `);

  const insertField = db.prepare(`
    INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, created)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const task of tasks) {
    insertNode.run(task.id, task.name, task.created, task.created);
    insertTag.run(task.id, "task");

    // Add Status field value (if exists)
    if (task.status) {
      insertField.run(
        `${task.id}_status_tuple`,
        task.id,
        "status_def",
        "Status",
        `${task.id}_status_value`,
        task.status,
        task.created
      );
    }

    // Add Priority field value
    insertField.run(
      `${task.id}_priority_tuple`,
      task.id,
      "priority_def",
      "Priority",
      `${task.id}_priority_value`,
      task.priority,
      task.created
    );
  }

  db.close();

  return {
    dbPath,
    cleanup: () => {
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // ignore
      }
    },
  };
}

describe("AggregationService", () => {
  describe("constructor", () => {
    it("should instantiate with a database path", () => {
      const service = new AggregationService("/tmp/test.db");
      expect(service).toBeInstanceOf(AggregationService);
    });
  });

  describe("parseGroupBy", () => {
    let service: AggregationService;

    beforeAll(() => {
      service = new AggregationService("/tmp/test.db");
    });

    it("should parse field name as string", () => {
      const result = service.parseGroupBy("Status");
      expect(result).toEqual([{ field: "Status" }]);
    });

    it("should parse time period keywords", () => {
      expect(service.parseGroupBy("day")).toEqual([{ period: "day" }]);
      expect(service.parseGroupBy("week")).toEqual([{ period: "week" }]);
      expect(service.parseGroupBy("month")).toEqual([{ period: "month" }]);
      expect(service.parseGroupBy("quarter")).toEqual([{ period: "quarter" }]);
      expect(service.parseGroupBy("year")).toEqual([{ period: "year" }]);
    });

    it("should parse comma-separated fields", () => {
      const result = service.parseGroupBy("Status,Priority");
      expect(result).toEqual([
        { field: "Status" },
        { field: "Priority" },
      ]);
    });

    it("should parse mixed field and time period", () => {
      const result = service.parseGroupBy("Status,month");
      expect(result).toEqual([
        { field: "Status" },
        { period: "month" },
      ]);
    });

    it("should handle whitespace in comma-separated input", () => {
      const result = service.parseGroupBy("Status, Priority");
      expect(result).toEqual([
        { field: "Status" },
        { field: "Priority" },
      ]);
    });

    it("should return empty array for empty string", () => {
      const result = service.parseGroupBy("");
      expect(result).toEqual([]);
    });
  });

  describe("formatTimePeriod", () => {
    let service: AggregationService;

    beforeAll(() => {
      service = new AggregationService("/tmp/test.db");
    });

    it("should return strftime for day", () => {
      const result = service.formatTimePeriod("day", "created");
      expect(result).toBe("strftime('%Y-%m-%d', created/1000, 'unixepoch')");
    });

    it("should return strftime for week (ISO week)", () => {
      const result = service.formatTimePeriod("week", "created");
      expect(result).toBe("strftime('%Y-W%W', created/1000, 'unixepoch')");
    });

    it("should return strftime for month", () => {
      const result = service.formatTimePeriod("month", "created");
      expect(result).toBe("strftime('%Y-%m', created/1000, 'unixepoch')");
    });

    it("should return strftime for quarter", () => {
      const result = service.formatTimePeriod("quarter", "created");
      // Quarter requires calculation: YYYY-Q1, YYYY-Q2, etc.
      expect(result).toContain("strftime");
      expect(result).toContain("created");
    });

    it("should return strftime for year", () => {
      const result = service.formatTimePeriod("year", "created");
      expect(result).toBe("strftime('%Y', created/1000, 'unixepoch')");
    });

    it("should use updated field when specified", () => {
      const result = service.formatTimePeriod("month", "updated");
      expect(result).toBe("strftime('%Y-%m', updated/1000, 'unixepoch')");
    });
  });

  describe("aggregate - single field", () => {
    let testDb: { dbPath: string; cleanup: () => void };
    let service: AggregationService;

    beforeEach(() => {
      testDb = createTestDatabase();
      service = new AggregationService(testDb.dbPath);
    });

    afterEach(() => {
      service.close();
      testDb.cleanup();
    });

    it("should count tasks by Status field", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
      });

      expect(result.total).toBe(10);
      expect(result.groupCount).toBe(4); // Done, In Progress, Open, (none)
      expect(result.groups["Done"]).toBe(4);
      expect(result.groups["In Progress"]).toBe(2);
      expect(result.groups["Open"]).toBe(3);
      expect(result.groups["(none)"]).toBe(1);
    });

    it("should count tasks by Priority field", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Priority" }],
        aggregate: [{ fn: "count" }],
      });

      expect(result.total).toBe(10);
      expect(result.groupCount).toBe(3); // High, Medium, Low
      expect(result.groups["High"]).toBe(4);
      expect(result.groups["Medium"]).toBe(3);
      expect(result.groups["Low"]).toBe(3);
    });

    it("should count tasks by month (time-based grouping)", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ period: "month" }],
        aggregate: [{ fn: "count" }],
      });

      expect(result.total).toBe(10);
      // All tasks are within ~30 days, so expect 1-2 months
      expect(result.groupCount).toBeGreaterThanOrEqual(1);

      // Each group should have the YYYY-MM format
      for (const key of Object.keys(result.groups)) {
        expect(key).toMatch(/^\d{4}-\d{2}$/);
      }
    });

    it("should count all nodes with wildcard find", () => {
      const result = service.aggregate({
        find: "*",
        groupBy: [{ period: "year" }],
        aggregate: [{ fn: "count" }],
      });

      expect(result.total).toBe(10);
    });

    it("should respect limit option", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        limit: 2,
      });

      expect(result.groupCount).toBe(2);
      expect(Object.keys(result.groups).length).toBe(2);
    });

    it("should handle field with no matching values gracefully", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "NonExistentField" }],
        aggregate: [{ fn: "count" }],
      });

      // All nodes should be in "(none)" group since no field matches
      expect(result.total).toBe(10);
      expect(result.groups["(none)"]).toBe(10);
    });
  });

  describe("aggregate - two-field nested", () => {
    let testDb: { dbPath: string; cleanup: () => void };
    let service: AggregationService;

    beforeEach(() => {
      testDb = createTestDatabase();
      service = new AggregationService(testDb.dbPath);
    });

    afterEach(() => {
      service.close();
      testDb.cleanup();
    });

    it("should count tasks by Status and Priority (nested)", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Status" }, { field: "Priority" }],
        aggregate: [{ fn: "count" }],
      });

      expect(result.total).toBe(10);
      expect(result.groupCount).toBe(4); // Done, In Progress, Open, (none)

      // Check nested structure
      const doneGroup = result.groups["Done"] as Record<string, number>;
      expect(doneGroup).toBeDefined();
      expect(typeof doneGroup).toBe("object");
      expect(doneGroup["High"]).toBe(2);
      expect(doneGroup["Medium"]).toBe(1);
      expect(doneGroup["Low"]).toBe(1);

      const inProgressGroup = result.groups["In Progress"] as Record<string, number>;
      expect(inProgressGroup["High"]).toBe(1);
      expect(inProgressGroup["Medium"]).toBe(1);

      const openGroup = result.groups["Open"] as Record<string, number>;
      expect(openGroup["High"]).toBe(1);
      expect(openGroup["Medium"]).toBe(1);
      expect(openGroup["Low"]).toBe(1);
    });

    it("should count tasks by Status and time period", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Status" }, { period: "month" }],
        aggregate: [{ fn: "count" }],
      });

      expect(result.total).toBe(10);

      // Check nested structure has YYYY-MM keys
      const doneGroup = result.groups["Done"] as Record<string, number>;
      expect(doneGroup).toBeDefined();
      for (const key of Object.keys(doneGroup)) {
        expect(key).toMatch(/^\d{4}-\d{2}$/);
      }
    });

    it("should count tasks by time period and field", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ period: "month" }, { field: "Status" }],
        aggregate: [{ fn: "count" }],
      });

      expect(result.total).toBe(10);

      // Top level should be YYYY-MM keys
      for (const key of Object.keys(result.groups)) {
        expect(key).toMatch(/^\d{4}-\d{2}$/);
        // Nested should have Status values
        const nested = result.groups[key] as Record<string, number>;
        expect(typeof nested).toBe("object");
      }
    });
  });

  describe("aggregate - showPercent and top options", () => {
    let testDb: { dbPath: string; cleanup: () => void };
    let service: AggregationService;

    beforeEach(() => {
      testDb = createTestDatabase();
      service = new AggregationService(testDb.dbPath);
    });

    afterEach(() => {
      service.close();
      testDb.cleanup();
    });

    it("should include percentages when showPercent is true", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        showPercent: true,
      });

      expect(result.percentages).toBeDefined();
      expect(result.percentages!["Done"]).toBe(40); // 4/10 = 40%
      expect(result.percentages!["In Progress"]).toBe(20); // 2/10 = 20%
      expect(result.percentages!["Open"]).toBe(30); // 3/10 = 30%
      expect(result.percentages!["(none)"]).toBe(10); // 1/10 = 10%

      // Sum should be ~100%
      const sum = Object.values(result.percentages!).reduce(
        (a, b) => (a as number) + (b as number),
        0
      );
      expect(sum).toBe(100);
    });

    it("should return only top N groups when top is specified", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        top: 2,
      });

      expect(result.groupCount).toBe(2);
      expect(Object.keys(result.groups).length).toBe(2);

      // Should have the top 2 by count (Done: 4, Open: 3)
      expect(result.groups["Done"]).toBe(4);
      expect(result.groups["Open"]).toBe(3);
      expect(result.groups["In Progress"]).toBeUndefined();
    });

    it("should include percentages for top N groups", () => {
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        top: 2,
        showPercent: true,
      });

      expect(result.percentages).toBeDefined();
      // Percentages should reflect the full total, not just top N
      expect(result.percentages!["Done"]).toBe(40);
      expect(result.percentages!["Open"]).toBe(30);
    });

    it("should add warning when groups exceed default limit", () => {
      // Create more unique field values than the default limit
      // For this test, we verify warning behavior with limit
      const result = service.aggregate({
        find: "task",
        groupBy: [{ field: "Priority" }],
        aggregate: [{ fn: "count" }],
        limit: 2,
      });

      // With limit of 2, we should only get 2 groups but have a warning if there were more
      expect(result.groupCount).toBe(2);
      // Warning should indicate results were capped
      // (In our test data we have 3 priorities, so warning should appear)
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("capped");
    });
  });
});
