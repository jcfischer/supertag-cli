/**
 * Tests for aggregate --where clause (F-095)
 *
 * TDD: Write tests first, then implement.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { AggregationService } from "../src/services/aggregation-service";

describe("Aggregate --where clause (F-095)", () => {
  let db: Database;
  let service: AggregationService;
  let dbPath: string;

  beforeAll(() => {
    // Create temp database with test data
    dbPath = `/tmp/aggregate-where-test-${Date.now()}.db`;
    db = new Database(dbPath);

    // Create required tables
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        created INTEGER,
        updated INTEGER,
        raw_data TEXT
      )
    `);

    db.run(`
      CREATE TABLE tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_node_id TEXT,
        tag_id TEXT,
        tag_name TEXT
      )
    `);

    db.run(`
      CREATE TABLE field_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id TEXT,
        field_name TEXT,
        value_text TEXT,
        value_ref_id TEXT
      )
    `);

    // Insert test todos with different statuses
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Active todos
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('todo1', 'Active Todo 1', ${now})`);
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('todo2', 'Active Todo 2', ${now - day})`);
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('todo3', 'Active Todo 3', ${now - 2 * day})`);

    // Complete todos
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('todo4', 'Complete Todo 1', ${now})`);
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('todo5', 'Complete Todo 2', ${now - 10 * day})`);

    // Cancelled todos
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('todo6', 'Cancelled Todo 1', ${now - 30 * day})`);

    // Tag all as todo
    for (const id of ['todo1', 'todo2', 'todo3', 'todo4', 'todo5', 'todo6']) {
      db.run(`INSERT INTO tag_applications (data_node_id, tag_name) VALUES ('${id}', 'todo')`);
    }

    // Add Status field values
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo1', 'Status', 'Active')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo2', 'Status', 'Active')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo3', 'Status', 'Active')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo4', 'Status', 'Complete')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo5', 'Status', 'Complete')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo6', 'Status', 'Cancelled')`);

    // Add Priority field values
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo1', 'Priority', 'High')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo2', 'Priority', 'High')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo3', 'Priority', 'Low')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo4', 'Priority', 'High')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text) VALUES ('todo5', 'Priority', 'Low')`);

    db.close();
    service = new AggregationService(dbPath);
  });

  afterAll(() => {
    service.close();
    // Clean up temp file
    try {
      require("fs").unlinkSync(dbPath);
    } catch {}
  });

  describe("basic where filtering", () => {
    test("filter by field equals value", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Priority" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "Status", operator: "=", value: "Active" }],
      });

      // Should only count the 3 Active todos
      expect(result.total).toBe(3);
      expect(result.groups["High"]).toBe(2);
      expect(result.groups["Low"]).toBe(1);
    });

    test("filter by field not equals value", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "Status", operator: "!=", value: "Cancelled" }],
      });

      // Should count Active (3) + Complete (2) = 5 todos
      expect(result.total).toBe(5);
      expect(result.groups["Active"]).toBe(3);
      expect(result.groups["Complete"]).toBe(2);
      expect(result.groups["Cancelled"]).toBeUndefined();
    });

    test("filter with contains operator", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "Status", operator: "contains", value: "Act" }],
      });

      // Should only match "Active"
      expect(result.total).toBe(3);
      expect(result.groups["Active"]).toBe(3);
    });
  });

  describe("multiple where conditions", () => {
    test("AND multiple conditions", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Priority" }],
        aggregate: [{ fn: "count" }],
        where: [
          { field: "Status", operator: "=", value: "Active" },
          { field: "Priority", operator: "=", value: "High" },
        ],
      });

      // Should only count Active + High priority todos
      expect(result.total).toBe(2);
      expect(result.groups["High"]).toBe(2);
    });
  });

  describe("where with time-based grouping", () => {
    test("filter then group by time", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ period: "day" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "Status", operator: "=", value: "Active" }],
      });

      // Should have 3 Active todos grouped by day
      expect(result.total).toBe(3);
      expect(result.groupCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("where with nested grouping", () => {
    test("filter then group by two fields", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Status" }, { field: "Priority" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "Status", operator: "!=", value: "Cancelled" }],
      });

      // Should have nested groups for Active and Complete
      expect(result.total).toBe(5);
      expect(result.groups["Active"]).toBeDefined();
      expect(result.groups["Complete"]).toBeDefined();
      expect(result.groups["Cancelled"]).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    test("where with no matching results", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "Status", operator: "=", value: "NonExistent" }],
      });

      expect(result.total).toBe(0);
      expect(result.groupCount).toBe(0);
    });

    test("where with empty field value", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "Priority", operator: "is_empty", value: "" }],
      });

      // todo6 has no Priority field
      expect(result.total).toBe(1);
    });
  });

  describe("core node field filtering", () => {
    test("filter by name contains", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "name", operator: "contains", value: "Active" }],
      });

      // Should match todos with "Active" in name: Active Todo 1, Active Todo 2, Active Todo 3
      expect(result.total).toBe(3);
    });

    test("filter by name equals", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Status" }],
        aggregate: [{ fn: "count" }],
        where: [{ field: "name", operator: "=", value: "Active Todo 1" }],
      });

      expect(result.total).toBe(1);
    });

    test("combine name filter with field filter", () => {
      const result = service.aggregate({
        find: "todo",
        groupBy: [{ field: "Priority" }],
        aggregate: [{ fn: "count" }],
        where: [
          { field: "name", operator: "contains", value: "Active" },
          { field: "Priority", operator: "=", value: "High" },
        ],
      });

      // Active todos with High priority: Active Todo 1, Active Todo 2
      expect(result.total).toBe(2);
      expect(result.groups["High"]).toBe(2);
    });
  });
});
