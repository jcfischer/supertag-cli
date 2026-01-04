/**
 * Value-Based Type Inference Tests
 *
 * TDD tests for inferring field data types from actual field values
 * instead of just field names (which is brittle).
 *
 * Key insight: Tana exports include indicators in the value nodes:
 * - _metaNodeId in props → reference type
 * - Date patterns in value text → date type
 * - true/false values → checkbox type
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { inferTypeFromValues, updateFieldTypesFromValues } from "../../src/db/value-type-inference";

describe("Value-Based Type Inference", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");

    // Create required tables
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        raw_data TEXT
      )
    `);

    db.run(`
      CREATE TABLE field_values (
        id INTEGER PRIMARY KEY,
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

    db.run(`
      CREATE TABLE supertag_fields (
        id INTEGER PRIMARY KEY,
        tag_id TEXT,
        tag_name TEXT,
        field_name TEXT,
        field_label_id TEXT,
        field_order INTEGER,
        normalized_name TEXT,
        description TEXT,
        inferred_data_type TEXT,
        target_supertag_id TEXT,
        target_supertag_name TEXT
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("inferTypeFromValues", () => {
    it("should infer reference type when values have _metaNodeId", () => {
      // Insert a field value node with _metaNodeId (reference indicator)
      db.run(`
        INSERT INTO nodes (id, name, raw_data)
        VALUES ('value1', 'John Doe', '{"props": {"_metaNodeId": "person123"}}')
      `);

      db.run(`
        INSERT INTO field_values (field_name, value_node_id, value_text, field_def_id, tuple_id, parent_id, value_order)
        VALUES ('Attendee', 'value1', 'John Doe', 'def1', 't1', 'p1', 0)
      `);

      const result = inferTypeFromValues(db, "Attendee", "def1");
      expect(result).toBe("reference");
    });

    it("should infer date type from date patterns in value text", () => {
      // ISO date format
      db.run(`
        INSERT INTO nodes (id, name, raw_data)
        VALUES ('value1', '2024-12-27', '{}')
      `);

      db.run(`
        INSERT INTO field_values (field_name, value_node_id, value_text, field_def_id, tuple_id, parent_id, value_order)
        VALUES ('Scheduled', 'value1', '2024-12-27', 'def1', 't1', 'p1', 0)
      `);

      const result = inferTypeFromValues(db, "Scheduled", "def1");
      expect(result).toBe("date");
    });

    it("should infer date type from PARENT patterns", () => {
      // Tana uses PARENT+1, PARENT-1, PARENT for relative dates
      db.run(`
        INSERT INTO nodes (id, name, raw_data)
        VALUES ('value1', 'PARENT+1', '{}')
      `);

      db.run(`
        INSERT INTO field_values (field_name, value_node_id, value_text, field_def_id, tuple_id, parent_id, value_order)
        VALUES ('Due Date', 'value1', 'PARENT+1', 'def1', 't1', 'p1', 0)
      `);

      const result = inferTypeFromValues(db, "Due Date", "def1");
      expect(result).toBe("date");
    });

    it("should infer checkbox type from true/false values", () => {
      db.run(`
        INSERT INTO nodes (id, name, raw_data)
        VALUES ('value1', 'true', '{}')
      `);

      db.run(`
        INSERT INTO field_values (field_name, value_node_id, value_text, field_def_id, tuple_id, parent_id, value_order)
        VALUES ('Is Active', 'value1', 'true', 'def1', 't1', 'p1', 0)
      `);

      const result = inferTypeFromValues(db, "Is Active", "def1");
      expect(result).toBe("checkbox");
    });

    it("should return null when no type can be inferred from values", () => {
      db.run(`
        INSERT INTO nodes (id, name, raw_data)
        VALUES ('value1', 'Some text value', '{}')
      `);

      db.run(`
        INSERT INTO field_values (field_name, value_node_id, value_text, field_def_id, tuple_id, parent_id, value_order)
        VALUES ('Description', 'value1', 'Some text value', 'def1', 't1', 'p1', 0)
      `);

      const result = inferTypeFromValues(db, "Description", "def1");
      expect(result).toBeNull();
    });

    it("should handle multiple values and infer from majority", () => {
      // 3 reference values
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
          ('v1', 'John', '{"props": {"_metaNodeId": "p1"}}'),
          ('v2', 'Jane', '{"props": {"_metaNodeId": "p2"}}'),
          ('v3', 'Bob', '{"props": {"_metaNodeId": "p3"}}')
      `);

      db.run(`
        INSERT INTO field_values (field_name, value_node_id, value_text, field_def_id, tuple_id, parent_id, value_order) VALUES
          ('Assignee', 'v1', 'John', 'def1', 't1', 'p1', 0),
          ('Assignee', 'v2', 'Jane', 'def1', 't2', 'p2', 0),
          ('Assignee', 'v3', 'Bob', 'def1', 't3', 'p3', 0)
      `);

      const result = inferTypeFromValues(db, "Assignee", "def1");
      expect(result).toBe("reference");
    });
  });

  describe("updateFieldTypesFromValues", () => {
    it("should update field types based on value analysis", () => {
      // Insert a field with name-based type "text"
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
        VALUES ('tag1', 'task', 'Horizon', 'def1', 0, 'text')
      `);

      // Insert reference values for this field
      db.run(`
        INSERT INTO nodes (id, name, raw_data)
        VALUES ('v1', 'Now', '{"props": {"_metaNodeId": "horizon1"}}')
      `);

      db.run(`
        INSERT INTO field_values (field_name, value_node_id, value_text, field_def_id, tuple_id, parent_id, value_order)
        VALUES ('Horizon', 'v1', 'Now', 'def1', 't1', 'p1', 0)
      `);

      // Run the update
      const updated = updateFieldTypesFromValues(db);

      // Verify the type was updated
      const field = db.query("SELECT inferred_data_type FROM supertag_fields WHERE field_name = 'Horizon'").get() as any;
      expect(field.inferred_data_type).toBe("reference");
      expect(updated).toBe(1);
    });

    it("should not downgrade specific types to text", () => {
      // Insert a field already inferred as 'date' from name
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
        VALUES ('tag1', 'task', 'Due Date', 'def1', 0, 'date')
      `);

      // No field values to analyze
      const updated = updateFieldTypesFromValues(db);

      // Type should remain 'date'
      const field = db.query("SELECT inferred_data_type FROM supertag_fields WHERE field_name = 'Due Date'").get() as any;
      expect(field.inferred_data_type).toBe("date");
      expect(updated).toBe(0);
    });

    it("should update text type to reference when values indicate reference", () => {
      // Field with generic name that defaults to 'text'
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
        VALUES ('tag1', 'task', 'Owner', 'def1', 0, 'text')
      `);

      // Insert reference value
      db.run(`
        INSERT INTO nodes (id, name, raw_data)
        VALUES ('v1', 'Alice', '{"props": {"_metaNodeId": "user1"}}')
      `);

      db.run(`
        INSERT INTO field_values (field_name, value_node_id, value_text, field_def_id, tuple_id, parent_id, value_order)
        VALUES ('Owner', 'v1', 'Alice', 'def1', 't1', 'p1', 0)
      `);

      const updated = updateFieldTypesFromValues(db);

      const field = db.query("SELECT inferred_data_type FROM supertag_fields WHERE field_name = 'Owner'").get() as any;
      expect(field.inferred_data_type).toBe("reference");
      expect(updated).toBe(1);
    });
  });
});
