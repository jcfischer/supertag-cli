/**
 * Schema Migration Tests
 * Tasks T-1.2, T-1.3, T-1.4, T-1.5: Database schema for field values
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/db/schema";
import {
  migrateFieldValuesSchema,
  migrateSchemaConsolidation,
  needsSchemaConsolidationMigration,
} from "../../src/db/migrate";

describe("Field Values Schema", () => {
  let db: Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("field_values table (T-1.2)", () => {
    it("should define fieldValues table in schema", () => {
      expect(schema.fieldValues).toBeDefined();
    });

    it("should have required columns", () => {
      // Verify column definitions exist
      const columns = Object.keys(schema.fieldValues);
      expect(columns).toContain("id");
      expect(columns).toContain("tupleId");
      expect(columns).toContain("parentId");
      expect(columns).toContain("fieldDefId");
      expect(columns).toContain("fieldName");
      expect(columns).toContain("valueNodeId");
      expect(columns).toContain("valueText");
      expect(columns).toContain("valueOrder");
      expect(columns).toContain("created");
    });

    it("should create table via migration", () => {
      migrateFieldValuesSchema(db);

      // Verify table exists
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='field_values'"
        )
        .all();
      expect(tables.length).toBe(1);
    });

    it("should have proper indexes", () => {
      migrateFieldValuesSchema(db);

      // Check indexes
      const indexes = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='field_values'"
        )
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain("idx_field_values_parent");
      expect(indexNames).toContain("idx_field_values_field_name");
      expect(indexNames).toContain("idx_field_values_field_def");
      expect(indexNames).toContain("idx_field_values_created");
    });

    it("should allow inserting field values", () => {
      migrateFieldValuesSchema(db);

      const insertStmt = db.prepare(`
        INSERT INTO field_values
        (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        "tuple123",
        "parent456",
        "zg7pciALsr",
        "Gestern war gut weil",
        "value789",
        "Schön geprobt",
        0,
        1702900800000
      );

      const result = db.query("SELECT * FROM field_values").all() as Array<{
        id: number;
        field_name: string;
        value_text: string;
      }>;
      expect(result.length).toBe(1);
      expect(result[0].field_name).toBe("Gestern war gut weil");
      expect(result[0].value_text).toBe("Schön geprobt");
    });
  });

  describe("field_values_fts virtual table (T-1.3)", () => {
    it("should create FTS5 virtual table", () => {
      migrateFieldValuesSchema(db);

      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='field_values_fts'"
        )
        .all();
      expect(tables.length).toBe(1);
    });

    it("should sync FTS on insert via trigger", () => {
      migrateFieldValuesSchema(db);

      // Insert a field value
      db.run(`
        INSERT INTO field_values
        (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
        VALUES ('t1', 'p1', 'f1', 'Notes', 'v1', 'important meeting', 0, NULL)
      `);

      // Search in FTS
      const ftsResult = db
        .query(
          "SELECT * FROM field_values_fts WHERE field_values_fts MATCH 'important'"
        )
        .all() as Array<{ value_text: string }>;
      expect(ftsResult.length).toBe(1);
      expect(ftsResult[0].value_text).toBe("important meeting");
    });

    it("should sync FTS on delete via trigger", () => {
      migrateFieldValuesSchema(db);

      // Insert then delete
      db.run(`
        INSERT INTO field_values
        (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
        VALUES ('t1', 'p1', 'f1', 'Notes', 'v1', 'delete test', 0, NULL)
      `);
      db.run("DELETE FROM field_values WHERE tuple_id = 't1'");

      // Search should find nothing
      const ftsResult = db
        .query(
          "SELECT * FROM field_values_fts WHERE field_values_fts MATCH 'delete'"
        )
        .all();
      expect(ftsResult.length).toBe(0);
    });

    it("should search by field name", () => {
      migrateFieldValuesSchema(db);

      db.run(`
        INSERT INTO field_values
        (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
        VALUES ('t1', 'p1', 'f1', 'Gestern war gut weil', 'v1', 'Theater', 0, NULL)
      `);
      db.run(`
        INSERT INTO field_values
        (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
        VALUES ('t2', 'p2', 'f2', 'Other Field', 'v2', 'Theater different', 0, NULL)
      `);

      // Search within specific field
      const result = db
        .query(
          `SELECT * FROM field_values_fts WHERE field_values_fts MATCH 'field_name:"Gestern"'`
        )
        .all();
      expect(result.length).toBe(1);
    });
  });

  describe("field_exclusions table (T-1.4)", () => {
    it("should define fieldExclusions table in schema", () => {
      expect(schema.fieldExclusions).toBeDefined();
    });

    it("should create table via migration", () => {
      migrateFieldValuesSchema(db);

      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='field_exclusions'"
        )
        .all();
      expect(tables.length).toBe(1);
    });

    it("should have unique constraint on field_name", () => {
      migrateFieldValuesSchema(db);

      // Insert first
      db.run(
        "INSERT INTO field_exclusions (field_name, reason) VALUES ('System Field', 'Internal use')"
      );

      // Second insert should fail
      expect(() => {
        db.run(
          "INSERT INTO field_exclusions (field_name, reason) VALUES ('System Field', 'Another reason')"
        );
      }).toThrow();
    });

    it("should store exclusion reasons", () => {
      migrateFieldValuesSchema(db);

      db.run(
        "INSERT INTO field_exclusions (field_name, reason) VALUES ('_internalField', 'System metadata')"
      );

      const result = db.query("SELECT * FROM field_exclusions").all() as Array<{
        field_name: string;
        reason: string;
      }>;
      expect(result.length).toBe(1);
      expect(result[0].field_name).toBe("_internalField");
      expect(result[0].reason).toBe("System metadata");
    });
  });

  describe("schema migration detection (T-1.5)", () => {
    it("should be idempotent - running twice should not error", () => {
      // First migration
      migrateFieldValuesSchema(db);

      // Second migration should not throw
      expect(() => migrateFieldValuesSchema(db)).not.toThrow();
    });

    it("should not drop existing data on re-migration", () => {
      migrateFieldValuesSchema(db);

      // Insert data
      db.run(`
        INSERT INTO field_values
        (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
        VALUES ('t1', 'p1', 'f1', 'Test', 'v1', 'Original data', 0, NULL)
      `);

      // Re-run migration
      migrateFieldValuesSchema(db);

      // Data should still exist
      const result = db.query("SELECT * FROM field_values").all();
      expect(result.length).toBe(1);
    });

    it("should detect when field_values table is missing", () => {
      // Don't run migration - tables don't exist
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='field_values'"
        )
        .all();
      expect(tables.length).toBe(0);

      // Now run migration
      migrateFieldValuesSchema(db);

      // Table should now exist
      const tablesAfter = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='field_values'"
        )
        .all();
      expect(tablesAfter.length).toBe(1);
    });
  });
});

describe("Schema Type Exports", () => {
  it("should export FieldValue type", () => {
    // Type inference test - compile-time check
    const _: schema.FieldValue = {
      id: 1,
      tupleId: "t1",
      parentId: "p1",
      fieldDefId: "f1",
      fieldName: "Test",
      valueNodeId: "v1",
      valueText: "Value",
      valueOrder: 0,
      created: null,
    };
    expect(_).toBeDefined();
  });

  it("should export FieldExclusion type", () => {
    const _: schema.FieldExclusion = {
      id: 1,
      fieldName: "test",
      reason: "reason",
    };
    expect(_).toBeDefined();
  });
});

// ============================================================================
// Spec 020: Schema Consolidation Migration Tests (T-1.3)
// ============================================================================

describe("Schema Consolidation Migration (Spec 020 T-1.3)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("migrateSchemaConsolidation", () => {
    it("should create supertag_metadata table if not exists", () => {
      migrateSchemaConsolidation(db);

      // Check table exists
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='supertag_metadata'"
        )
        .all();
      expect(tables.length).toBe(1);
    });

    it("should create supertag_metadata with correct columns", () => {
      migrateSchemaConsolidation(db);

      const columns = db
        .query("PRAGMA table_info(supertag_metadata)")
        .all() as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("tag_id");
      expect(columnNames).toContain("tag_name");
      expect(columnNames).toContain("normalized_name");
      expect(columnNames).toContain("description");
      expect(columnNames).toContain("color");
      expect(columnNames).toContain("created_at");
    });

    it("should add enhanced columns to supertag_fields if table exists", () => {
      // Create old supertag_fields table without new columns
      db.run(`
        CREATE TABLE supertag_fields (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tag_id TEXT NOT NULL,
          tag_name TEXT NOT NULL,
          field_name TEXT NOT NULL,
          field_label_id TEXT NOT NULL,
          field_order INTEGER DEFAULT 0
        )
      `);

      migrateSchemaConsolidation(db);

      const columns = db
        .query("PRAGMA table_info(supertag_fields)")
        .all() as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain("normalized_name");
      expect(columnNames).toContain("description");
      expect(columnNames).toContain("inferred_data_type");
    });

    it("should not fail if enhanced columns already exist", () => {
      // Create table with all columns
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
          inferred_data_type TEXT
        )
      `);

      // Should not throw
      expect(() => migrateSchemaConsolidation(db)).not.toThrow();
    });

    it("should create indexes for new columns", () => {
      migrateSchemaConsolidation(db);

      const indexes = db
        .query("PRAGMA index_list(supertag_fields)")
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames.some((n) => n.includes("normalized"))).toBe(true);
      expect(indexNames.some((n) => n.includes("data_type"))).toBe(true);
    });

    it("should be safe to run multiple times", () => {
      migrateSchemaConsolidation(db);
      migrateSchemaConsolidation(db);
      migrateSchemaConsolidation(db);

      // Should still have correct schema
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='supertag_metadata'"
        )
        .all();
      expect(tables.length).toBe(1);
    });
  });

  describe("needsSchemaConsolidationMigration", () => {
    it("should return true if supertag_metadata table missing", () => {
      expect(needsSchemaConsolidationMigration(db)).toBe(true);
    });

    it("should return true if supertag_fields missing enhanced columns", () => {
      // Create old table without enhanced columns
      db.run(`
        CREATE TABLE supertag_fields (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tag_id TEXT NOT NULL,
          tag_name TEXT NOT NULL,
          field_name TEXT NOT NULL,
          field_label_id TEXT NOT NULL,
          field_order INTEGER DEFAULT 0
        )
      `);
      db.run(`
        CREATE TABLE supertag_metadata (
          id INTEGER PRIMARY KEY,
          tag_id TEXT,
          tag_name TEXT,
          normalized_name TEXT,
          description TEXT,
          color TEXT,
          created_at INTEGER
        )
      `);

      expect(needsSchemaConsolidationMigration(db)).toBe(true);
    });

    it("should return false if all tables and columns exist", () => {
      // Create all tables with all columns
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
          target_supertag_id TEXT,
          target_supertag_name TEXT,
          default_value_id TEXT,
          default_value_text TEXT,
          option_values TEXT
        )
      `);
      db.run(`
        CREATE TABLE supertag_metadata (
          id INTEGER PRIMARY KEY,
          tag_id TEXT,
          tag_name TEXT,
          normalized_name TEXT,
          description TEXT,
          color TEXT,
          created_at INTEGER
        )
      `);

      expect(needsSchemaConsolidationMigration(db)).toBe(false);
    });
  });
});
