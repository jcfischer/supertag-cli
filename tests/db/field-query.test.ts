/**
 * Field Query Engine Tests
 * Tasks T-4.1 to T-4.6: Field value query capabilities
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateFieldValuesSchema } from "../../src/db/migrate";
import {
  queryFieldValues,
  queryFieldValuesByFieldName,
  queryFieldValuesFTS,
  getAvailableFieldNames,
  countFieldValuesByFieldName,
} from "../../src/db/field-query";

describe("Field Query Engine", () => {
  let db: Database;

  // Setup test data
  function setupTestData(): void {
    // Insert sample field values
    const insert = db.prepare(`
      INSERT INTO field_values
      (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Gratitude journal entries
    insert.run("t1", "day1", "f1", "Gestern war gut weil", "v1", "Theater war toll", 0, 1702900800000);
    insert.run("t2", "day1", "f1", "Gestern war gut weil", "v2", "Schön geprobt", 1, 1702900800000);
    insert.run("t3", "day2", "f1", "Gestern war gut weil", "v3", "Gutes Meeting", 0, 1702987200000);
    insert.run("t4", "day3", "f1", "Gestern war gut weil", "v4", "Projekt abgeschlossen", 0, 1703073600000);

    // Different field
    insert.run("t5", "meeting1", "f2", "Notes", "v5", "Important discussion about performance", 0, 1702900800000);
    insert.run("t6", "meeting2", "f2", "Notes", "v6", "Follow up on theater project", 0, 1702987200000);

    // Another field
    insert.run("t7", "task1", "f3", "Status", "v7", "Done", 0, 1702900800000);
  }

  beforeEach(() => {
    db = new Database(":memory:");
    migrateFieldValuesSchema(db);
    setupTestData();
  });

  afterEach(() => {
    db.close();
  });

  describe("getAvailableFieldNames (T-4.1)", () => {
    it("should list all unique field names with counts", () => {
      const fields = getAvailableFieldNames(db);

      expect(fields.length).toBe(3);

      // Sort by count descending
      const gestern = fields.find(f => f.fieldName === "Gestern war gut weil");
      const notes = fields.find(f => f.fieldName === "Notes");
      const status = fields.find(f => f.fieldName === "Status");

      expect(gestern?.count).toBe(4);
      expect(notes?.count).toBe(2);
      expect(status?.count).toBe(1);
    });

    it("should return empty array for empty database", () => {
      db.run("DELETE FROM field_values");
      const fields = getAvailableFieldNames(db);
      expect(fields).toEqual([]);
    });
  });

  describe("queryFieldValuesByFieldName (T-4.2)", () => {
    it("should return all values for a specific field", () => {
      const results = queryFieldValuesByFieldName(db, "Gestern war gut weil");

      expect(results.length).toBe(4);
      expect(results[0].valueText).toBeDefined();
      expect(results[0].parentId).toBeDefined();
    });

    it("should support limit and offset pagination", () => {
      const page1 = queryFieldValuesByFieldName(db, "Gestern war gut weil", { limit: 2 });
      const page2 = queryFieldValuesByFieldName(db, "Gestern war gut weil", { limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      // Values should be different
      expect(page1[0].valueText).not.toBe(page2[0].valueText);
    });

    it("should support date range filtering", () => {
      const results = queryFieldValuesByFieldName(db, "Gestern war gut weil", {
        createdAfter: 1702950000000, // After first day
        createdBefore: 1703000000000, // Before third day
      });

      expect(results.length).toBe(1);
      expect(results[0].valueText).toBe("Gutes Meeting");
    });

    it("should order by created descending by default", () => {
      const results = queryFieldValuesByFieldName(db, "Gestern war gut weil");

      // Most recent first
      expect(results[0].created).toBeGreaterThan(results[results.length - 1].created!);
    });
  });

  describe("queryFieldValuesFTS (T-4.3)", () => {
    it("should search across all field values", () => {
      const results = queryFieldValuesFTS(db, "Theater");

      expect(results.length).toBe(2);
      // Should find both theater mentions
      const texts = results.map(r => r.valueText);
      expect(texts.some(t => t.includes("Theater war toll"))).toBe(true);
      expect(texts.some(t => t.includes("theater project"))).toBe(true);
    });

    it("should support field name filtering", () => {
      const results = queryFieldValuesFTS(db, "Theater", { fieldName: "Gestern war gut weil" });

      expect(results.length).toBe(1);
      expect(results[0].valueText).toContain("Theater war toll");
    });

    it("should support limit", () => {
      const results = queryFieldValuesFTS(db, "gut OR Meeting", { limit: 2 });

      expect(results.length).toBe(2);
    });

    it("should handle special FTS characters", () => {
      // Insert value with special chars
      db.run(`
        INSERT INTO field_values
        (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
        VALUES ('t99', 'p99', 'f99', 'Test', 'v99', 'Test with (parentheses) and "quotes"', 0, 1702900800000)
      `);

      // Should not throw
      const results = queryFieldValuesFTS(db, "parentheses");
      expect(results.length).toBe(1);
    });
  });

  describe("queryFieldValues (T-4.4: generic query)", () => {
    it("should query with multiple conditions", () => {
      const results = queryFieldValues(db, {
        fieldName: "Gestern war gut weil",
        limit: 10,
      });

      expect(results.length).toBe(4);
    });

    it("should combine field filter with text search", () => {
      const results = queryFieldValues(db, {
        fieldName: "Notes",
        searchQuery: "performance",
      });

      expect(results.length).toBe(1);
      expect(results[0].valueText).toContain("performance");
    });
  });

  describe("countFieldValuesByFieldName (T-4.5)", () => {
    it("should return count for specific field", () => {
      const count = countFieldValuesByFieldName(db, "Gestern war gut weil");
      expect(count).toBe(4);
    });

    it("should return 0 for non-existent field", () => {
      const count = countFieldValuesByFieldName(db, "NonexistentField");
      expect(count).toBe(0);
    });
  });

  describe("Integration scenarios (T-4.6)", () => {
    it("should support gratitude journal workflow", () => {
      // Get all gratitude entries
      const allEntries = queryFieldValuesByFieldName(db, "Gestern war gut weil");
      expect(allEntries.length).toBe(4);

      // Search for specific topic
      const theaterEntries = queryFieldValuesFTS(db, "Theater", {
        fieldName: "Gestern war gut weil"
      });
      expect(theaterEntries.length).toBe(1);

      // Get recent entries (last 2 days)
      const recentEntries = queryFieldValuesByFieldName(db, "Gestern war gut weil", {
        createdAfter: 1702950000000,
      });
      expect(recentEntries.length).toBe(2);
    });
  });
});
