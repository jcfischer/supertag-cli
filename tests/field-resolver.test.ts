/**
 * Tests for FieldResolver Service
 * F-093: Query Field Output
 *
 * TDD: RED phase - write tests first
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { FieldResolver } from "../src/services/field-resolver";

describe("FieldResolver", () => {
  let db: Database;
  let resolver: FieldResolver;

  beforeAll(() => {
    // Create in-memory database with test data
    db = new Database(":memory:");

    // Create schema
    db.run(`
      CREATE TABLE supertags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        tag_id TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE supertag_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_order INTEGER DEFAULT 0,
        UNIQUE(tag_id, field_name)
      )
    `);

    db.run(`
      CREATE TABLE supertag_parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_tag_id TEXT NOT NULL,
        parent_tag_id TEXT NOT NULL,
        UNIQUE(child_tag_id, parent_tag_id)
      )
    `);

    // Create supertag_metadata table (Spec 020)
    db.run(`
      CREATE TABLE supertag_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL UNIQUE,
        tag_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        created_at INTEGER
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

    // Insert test supertags
    db.run("INSERT INTO supertags (node_id, tag_name, tag_id) VALUES (?, ?, ?)", [
      "tag_person_node", "person", "tag_person",
    ]);
    db.run("INSERT INTO supertags (node_id, tag_name, tag_id) VALUES (?, ?, ?)", [
      "tag_employee_node", "employee", "tag_employee",
    ]);

    // Insert supertag_metadata (needed by FieldResolver.getSupertagFields)
    db.run("INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES (?, ?, ?)", [
      "tag_person", "person", "person",
    ]);
    db.run("INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES (?, ?, ?)", [
      "tag_employee", "employee", "employee",
    ]);

    // Insert supertag fields for "person"
    db.run("INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_order) VALUES (?, ?, ?, ?)", [
      "tag_person", "person", "Email", 1,
    ]);
    db.run("INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_order) VALUES (?, ?, ?, ?)", [
      "tag_person", "person", "Phone", 2,
    ]);
    db.run("INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_order) VALUES (?, ?, ?, ?)", [
      "tag_person", "person", "Company", 3,
    ]);

    // Insert supertag fields for "employee" (extends person)
    db.run("INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_order) VALUES (?, ?, ?, ?)", [
      "tag_employee", "employee", "Department", 1,
    ]);
    db.run("INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_order) VALUES (?, ?, ?, ?)", [
      "tag_employee", "employee", "Title", 2,
    ]);

    // Set up inheritance: employee extends person
    db.run("INSERT INTO supertag_parents (child_tag_id, parent_tag_id) VALUES (?, ?)", [
      "tag_employee", "tag_person",
    ]);

    // Insert field values for test nodes
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "tuple1", "person1", "fdef1", "Email", "val1", "john@example.com", 0,
    ]);
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "tuple2", "person1", "fdef2", "Phone", "val2", "+1-555-1234", 0,
    ]);
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "tuple3", "person2", "fdef1", "Email", "val3", "jane@example.com", 0,
    ]);
    // person2 has two emails (multi-value)
    db.run("INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "tuple4", "person2", "fdef1", "Email", "val4", "jane.work@company.com", 1,
    ]);

    resolver = new FieldResolver(db);
  });

  afterAll(() => {
    db.close();
  });

  describe("getSupertagFields", () => {
    it("should return field names for a supertag", () => {
      const fields = resolver.getSupertagFields("person");
      expect(fields).toContain("Email");
      expect(fields).toContain("Phone");
      expect(fields).toContain("Company");
    });

    it("should return fields in order", () => {
      const fields = resolver.getSupertagFields("person");
      expect(fields).toEqual(["Email", "Phone", "Company"]);
    });

    it("should include inherited fields", () => {
      const fields = resolver.getSupertagFields("employee");
      // Own fields
      expect(fields).toContain("Department");
      expect(fields).toContain("Title");
      // Inherited from person
      expect(fields).toContain("Email");
      expect(fields).toContain("Phone");
      expect(fields).toContain("Company");
    });

    it("should return own fields before inherited fields", () => {
      const fields = resolver.getSupertagFields("employee");
      const deptIndex = fields.indexOf("Department");
      const emailIndex = fields.indexOf("Email");
      expect(deptIndex).toBeLessThan(emailIndex);
    });

    it("should return empty array for unknown supertag", () => {
      const fields = resolver.getSupertagFields("nonexistent");
      expect(fields).toEqual([]);
    });
  });

  describe("resolveFields", () => {
    it("should return field values for nodes", () => {
      const result = resolver.resolveFields(["person1"], ["Email", "Phone"]);
      expect(result.get("person1")).toBeDefined();
      expect(result.get("person1")?.Email).toBe("john@example.com");
      expect(result.get("person1")?.Phone).toBe("+1-555-1234");
    });

    it("should handle multiple nodes", () => {
      const result = resolver.resolveFields(["person1", "person2"], ["Email"]);
      expect(result.get("person1")?.Email).toBe("john@example.com");
      expect(result.get("person2")?.Email).toContain("jane@example.com");
    });

    it("should comma-join multi-value fields", () => {
      const result = resolver.resolveFields(["person2"], ["Email"]);
      // person2 has two emails
      expect(result.get("person2")?.Email).toBe("jane@example.com, jane.work@company.com");
    });

    it("should return empty object for node with no field values", () => {
      const result = resolver.resolveFields(["nonexistent"], ["Email"]);
      expect(result.get("nonexistent")).toEqual({});
    });

    it("should handle wildcard field list", () => {
      const result = resolver.resolveFields(["person1"], "*");
      expect(result.get("person1")?.Email).toBe("john@example.com");
      expect(result.get("person1")?.Phone).toBe("+1-555-1234");
    });

    it("should return empty fields for fields that don't exist on node", () => {
      const result = resolver.resolveFields(["person1"], ["Email", "Company"]);
      expect(result.get("person1")?.Email).toBe("john@example.com");
      expect(result.get("person1")?.Company).toBeUndefined();
    });
  });
});
