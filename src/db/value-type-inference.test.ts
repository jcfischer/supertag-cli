/**
 * Value-Based Type Inference - Tests
 *
 * Tests for field type inference from actual values in the database.
 * Key scenario: field_values stores tuple node ID (field_def_id) while
 * supertag_fields stores the child field label ID (field_label_id).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { inferTypeFromValues, updateFieldTypesFromValues } from "./value-type-inference";

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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        field_def_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        value_node_id TEXT NOT NULL,
        value_text TEXT NOT NULL,
        value_order INTEGER DEFAULT 0,
        created INTEGER
      )
    `);

    db.run(`
      CREATE TABLE supertag_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_label_id TEXT NOT NULL,
        field_order INTEGER DEFAULT 0,
        normalized_name TEXT,
        description TEXT,
        inferred_data_type TEXT,
        UNIQUE(tag_id, field_name)
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("inferTypeFromValues", () => {
    it("should return null when no values exist", () => {
      const result = inferTypeFromValues(db, "NonExistentField");
      expect(result).toBeNull();
    });

    it("should infer reference type from _metaNodeId in value props", () => {
      // Value node with _metaNodeId indicates reference type
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('value1', 'Company A', '{"id":"value1","props":{"name":"Company A","_metaNodeId":"companyTagId"}}')
      `);

      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
        VALUES ('t1', 'parent1', 'fieldDef1', 'Company', 'value1', 'Company A')
      `);

      const result = inferTypeFromValues(db, "Company");
      expect(result).toBe("reference");
    });

    it("should infer checkbox type from true/false values", () => {
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('value1', 'true', '{"id":"value1","props":{"name":"true"}}')
      `);

      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
        VALUES ('t1', 'parent1', 'fieldDef1', 'IsActive', 'value1', 'true')
      `);

      const result = inferTypeFromValues(db, "IsActive");
      expect(result).toBe("checkbox");
    });

    it("should infer date type from ISO date format", () => {
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('value1', '2024-12-27', '{"id":"value1","props":{"name":"2024-12-27"}}')
      `);

      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
        VALUES ('t1', 'parent1', 'fieldDef1', 'DueDate', 'value1', '2024-12-27')
      `);

      const result = inferTypeFromValues(db, "DueDate");
      expect(result).toBe("date");
    });

    it("should infer date type from PARENT relative dates", () => {
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('value1', 'PARENT+1', '{"id":"value1","props":{"name":"PARENT+1"}}')
      `);

      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
        VALUES ('t1', 'parent1', 'fieldDef1', 'NextDay', 'value1', 'PARENT+1')
      `);

      const result = inferTypeFromValues(db, "NextDay");
      expect(result).toBe("date");
    });

    it("should return null for plain text values", () => {
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('value1', 'Some text', '{"id":"value1","props":{"name":"Some text"}}')
      `);

      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
        VALUES ('t1', 'parent1', 'fieldDef1', 'Description', 'value1', 'Some text')
      `);

      const result = inferTypeFromValues(db, "Description");
      expect(result).toBeNull();
    });

    describe("tuple node to field label matching", () => {
      it("should match values when field_def_id is parent tuple of field_label_id", () => {
        // This tests the key fix: field_values uses the tuple node ID (field_def_id)
        // while supertag_fields uses the child field label ID (field_label_id).
        // The tuple node's children array contains the field_label_id.

        // Tuple node (parent) with children including the field label
        db.run(`
          INSERT INTO nodes (id, name, raw_data) VALUES
          ('tupleNode1', NULL, '{"id":"tupleNode1","props":{"_docType":"tuple"},"children":["fieldLabel1","otherChild"]}')
        `);

        // Value node with reference indicator
        db.run(`
          INSERT INTO nodes (id, name, raw_data) VALUES
          ('companyValue', 'Acme Corp', '{"id":"companyValue","props":{"name":"Acme Corp","_metaNodeId":"companyTagDef"}}')
        `);

        // Field value uses tuple node ID (tupleNode1) as field_def_id
        db.run(`
          INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
          VALUES ('t1', 'personNode', 'tupleNode1', 'Company', 'companyValue', 'Acme Corp')
        `);

        // Query using field_label_id (child of tuple) should still find the value
        const result = inferTypeFromValues(db, "Company", "fieldLabel1");
        expect(result).toBe("reference");
      });

      it("should match values when field_def_id matches field_label_id directly", () => {
        // Direct match case (backwards compatibility)
        db.run(`
          INSERT INTO nodes (id, name, raw_data) VALUES
          ('companyValue', 'Acme Corp', '{"id":"companyValue","props":{"name":"Acme Corp","_metaNodeId":"companyTagDef"}}')
        `);

        db.run(`
          INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
          VALUES ('t1', 'personNode', 'fieldLabel1', 'Company', 'companyValue', 'Acme Corp')
        `);

        const result = inferTypeFromValues(db, "Company", "fieldLabel1");
        expect(result).toBe("reference");
      });

      it("should not match values when field_label_id is not in tuple children", () => {
        // Tuple node without the field label in children
        db.run(`
          INSERT INTO nodes (id, name, raw_data) VALUES
          ('tupleNode1', NULL, '{"id":"tupleNode1","props":{"_docType":"tuple"},"children":["otherField1","otherField2"]}')
        `);

        db.run(`
          INSERT INTO nodes (id, name, raw_data) VALUES
          ('companyValue', 'Acme Corp', '{"id":"companyValue","props":{"name":"Acme Corp","_metaNodeId":"companyTagDef"}}')
        `);

        db.run(`
          INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
          VALUES ('t1', 'personNode', 'tupleNode1', 'Company', 'companyValue', 'Acme Corp')
        `);

        // Query with unrelated field_label_id should not find the value
        const result = inferTypeFromValues(db, "Company", "unrelatedFieldId");
        expect(result).toBeNull();
      });
    });

    it("should use majority voting when multiple values have different types", () => {
      // 2 reference values, 1 date value - should return reference
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('ref1', 'Company A', '{"id":"ref1","props":{"_metaNodeId":"tag1"}}'),
        ('ref2', 'Company B', '{"id":"ref2","props":{"_metaNodeId":"tag2"}}'),
        ('date1', '2024-01-01', '{"id":"date1","props":{}}')
      `);

      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text) VALUES
        ('t1', 'p1', 'f1', 'Mixed', 'ref1', 'Company A'),
        ('t2', 'p2', 'f1', 'Mixed', 'ref2', 'Company B'),
        ('t3', 'p3', 'f1', 'Mixed', 'date1', '2024-01-01')
      `);

      const result = inferTypeFromValues(db, "Mixed");
      expect(result).toBe("reference");
    });
  });

  describe("updateFieldTypesFromValues", () => {
    it("should update text fields to reference when values have _metaNodeId", () => {
      // Set up supertag_fields with text type
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, inferred_data_type)
        VALUES ('personTag', 'person', 'Company', 'fieldLabel1', 'text')
      `);

      // Tuple node containing the field label
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('tupleNode1', NULL, '{"id":"tupleNode1","children":["fieldLabel1"]}'),
        ('companyValue', 'Acme', '{"id":"companyValue","props":{"_metaNodeId":"companyTag"}}')
      `);

      // Field value with tuple node as field_def_id
      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
        VALUES ('t1', 'person1', 'tupleNode1', 'Company', 'companyValue', 'Acme')
      `);

      const updatedCount = updateFieldTypesFromValues(db);
      expect(updatedCount).toBe(1);

      const field = db
        .query("SELECT inferred_data_type FROM supertag_fields WHERE field_name = 'Company'")
        .get() as { inferred_data_type: string };
      expect(field.inferred_data_type).toBe("reference");
    });

    it("should not downgrade specific types to text", () => {
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, inferred_data_type)
        VALUES ('tag1', 'test', 'DueDate', 'field1', 'date')
      `);

      // Add text values - should not change the date type
      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('textValue', 'random text', '{"id":"textValue","props":{}}')
      `);

      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
        VALUES ('t1', 'p1', 'field1', 'DueDate', 'textValue', 'random text')
      `);

      const updatedCount = updateFieldTypesFromValues(db);
      expect(updatedCount).toBe(0);

      const field = db
        .query("SELECT inferred_data_type FROM supertag_fields WHERE field_name = 'DueDate'")
        .get() as { inferred_data_type: string };
      expect(field.inferred_data_type).toBe("date");
    });

    it("should update NULL types", () => {
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, inferred_data_type)
        VALUES ('tag1', 'test', 'IsActive', 'field1', NULL)
      `);

      db.run(`
        INSERT INTO nodes (id, name, raw_data) VALUES
        ('boolValue', 'true', '{"id":"boolValue","props":{}}')
      `);

      db.run(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text)
        VALUES ('t1', 'p1', 'field1', 'IsActive', 'boolValue', 'true')
      `);

      const updatedCount = updateFieldTypesFromValues(db);
      expect(updatedCount).toBe(1);

      const field = db
        .query("SELECT inferred_data_type FROM supertag_fields WHERE field_name = 'IsActive'")
        .get() as { inferred_data_type: string };
      expect(field.inferred_data_type).toBe("checkbox");
    });
  });
});
