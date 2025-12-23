/**
 * Fields Command Tests (T-6.1 to T-6.6)
 *
 * Tests for the `supertag fields` CLI command group:
 * - fields list - List available field names with counts
 * - fields values <name> - Get values for a specific field
 * - fields search <query> - FTS search in field values
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Test database directory
const TEST_DIR = join(tmpdir(), `supertag-fields-test-${Date.now()}`);
const TEST_DB = join(TEST_DIR, "tana-index.db");

// Test data
const TEST_DATA = {
  fields: [
    { fieldName: "Gestern war gut weil", count: 5 },
    { fieldName: "Heute habe ich gelernt", count: 3 },
    { fieldName: "Status", count: 10 },
  ],
  values: [
    {
      tupleId: "tuple1",
      parentId: "parent1",
      fieldDefId: "fieldDef1",
      fieldName: "Gestern war gut weil",
      valueNodeId: "value1",
      valueText: "Ich habe gut geschlafen",
      valueOrder: 0,
      created: Date.now() - 86400000,
    },
    {
      tupleId: "tuple2",
      parentId: "parent2",
      fieldDefId: "fieldDef1",
      fieldName: "Gestern war gut weil",
      valueNodeId: "value2",
      valueText: "Das Wetter war schön",
      valueOrder: 0,
      created: Date.now(),
    },
  ],
};

describe("Fields CLI Commands", () => {
  let db: Database;

  beforeAll(() => {
    // Create test directory and database
    mkdirSync(TEST_DIR, { recursive: true });
    db = new Database(TEST_DB);

    // Create field_values table
    db.exec(`
      CREATE TABLE IF NOT EXISTS field_values (
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

      CREATE INDEX IF NOT EXISTS idx_field_values_field_name ON field_values(field_name);
      CREATE INDEX IF NOT EXISTS idx_field_values_parent ON field_values(parent_id);

      -- FTS5 virtual table
      CREATE VIRTUAL TABLE IF NOT EXISTS field_values_fts USING fts5(
        value_text,
        content='field_values',
        content_rowid='id'
      );

      -- Sync triggers
      CREATE TRIGGER IF NOT EXISTS field_values_ai AFTER INSERT ON field_values BEGIN
        INSERT INTO field_values_fts(rowid, value_text) VALUES (new.id, new.value_text);
      END;

      CREATE TRIGGER IF NOT EXISTS field_values_ad AFTER DELETE ON field_values BEGIN
        INSERT INTO field_values_fts(field_values_fts, rowid, value_text) VALUES('delete', old.id, old.value_text);
      END;

      CREATE TRIGGER IF NOT EXISTS field_values_au AFTER UPDATE ON field_values BEGIN
        INSERT INTO field_values_fts(field_values_fts, rowid, value_text) VALUES('delete', old.id, old.value_text);
        INSERT INTO field_values_fts(rowid, value_text) VALUES (new.id, new.value_text);
      END;
    `);

    // Insert test data
    const insertStmt = db.prepare(`
      INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const value of TEST_DATA.values) {
      insertStmt.run(
        value.tupleId,
        value.parentId,
        value.fieldDefId,
        value.fieldName,
        value.valueNodeId,
        value.valueText,
        value.valueOrder,
        value.created
      );
    }
  });

  afterAll(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("Unit Tests - Module Structure (T-6.1)", () => {
    it("should export createFieldsCommand function", async () => {
      const { createFieldsCommand } = await import("../../src/commands/fields");
      expect(typeof createFieldsCommand).toBe("function");
    });

    it("should create a command with subcommands", async () => {
      const { createFieldsCommand } = await import("../../src/commands/fields");
      const cmd = createFieldsCommand();
      expect(cmd.name()).toBe("fields");
      expect(cmd.commands.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Query Engine Functions", () => {
    it("should list available field names (T-6.2)", () => {
      const result = db
        .query(`
          SELECT field_name as fieldName, COUNT(*) as count
          FROM field_values
          GROUP BY field_name
          ORDER BY count DESC
        `)
        .all() as { fieldName: string; count: number }[];

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("fieldName");
      expect(result[0]).toHaveProperty("count");
    });

    it("should query values for a specific field (T-6.3)", () => {
      const fieldName = "Gestern war gut weil";
      const result = db
        .query(`
          SELECT value_text as valueText
          FROM field_values
          WHERE field_name = ?
          ORDER BY created DESC
        `)
        .all(fieldName) as { valueText: string }[];

      expect(result.length).toBe(2);
      expect(result[0].valueText).toBe("Das Wetter war schön");
      expect(result[1].valueText).toBe("Ich habe gut geschlafen");
    });

    it("should support FTS search in field values (T-6.4)", () => {
      // Search for "schön"
      const result = db
        .query(`
          SELECT fv.value_text as valueText
          FROM field_values_fts fts
          JOIN field_values fv ON fts.rowid = fv.id
          WHERE field_values_fts MATCH ?
        `)
        .all("schön") as { valueText: string }[];

      expect(result.length).toBe(1);
      expect(result[0].valueText).toContain("schön");
    });

    it("should support limit parameter (T-6.3)", () => {
      const result = db
        .query(`
          SELECT value_text as valueText
          FROM field_values
          WHERE field_name = ?
          ORDER BY created DESC
          LIMIT ?
        `)
        .all("Gestern war gut weil", 1) as { valueText: string }[];

      expect(result.length).toBe(1);
    });
  });

  describe("Integration Tests (with real database)", () => {
    // These tests require a real database with indexed field values
    // Skip if no database exists
    const hasRealDb = existsSync(
      process.env.HOME + "/.local/share/supertag/workspaces/main/tana-index.db"
    );
    const testFn = hasRealDb ? it : it.skip;

    testFn("should list all fields with counts (integration)", async () => {
      const { getAvailableFieldNames } = await import("../../src/db/field-query");
      const realDb = new Database(
        process.env.HOME + "/.local/share/supertag/workspaces/main/tana-index.db",
        { readonly: true }
      );

      try {
        const fields = getAvailableFieldNames(realDb);
        // May have 0 fields if not yet indexed
        expect(Array.isArray(fields)).toBe(true);
        if (fields.length > 0) {
          expect(fields[0]).toHaveProperty("fieldName");
          expect(fields[0]).toHaveProperty("count");
        }
      } finally {
        realDb.close();
      }
    });

    testFn("should query values for a specific field (integration)", async () => {
      const { queryFieldValuesByFieldName } = await import(
        "../../src/db/field-query"
      );
      const { getAvailableFieldNames } = await import("../../src/db/field-query");
      const realDb = new Database(
        process.env.HOME + "/.local/share/supertag/workspaces/main/tana-index.db",
        { readonly: true }
      );

      try {
        const fields = getAvailableFieldNames(realDb);
        if (fields.length > 0) {
          const values = queryFieldValuesByFieldName(
            realDb,
            fields[0].fieldName,
            { limit: 5 }
          );
          expect(values.length).toBeLessThanOrEqual(5);
        }
      } finally {
        realDb.close();
      }
    });

    testFn("should search field values with FTS (integration)", async () => {
      const { queryFieldValuesFTS } = await import("../../src/db/field-query");
      const realDb = new Database(
        process.env.HOME + "/.local/share/supertag/workspaces/main/tana-index.db",
        { readonly: true }
      );

      try {
        // Search for a common German word
        const results = queryFieldValuesFTS(realDb, "gut OR good OR test", {
          limit: 5,
        });
        // May or may not have results depending on data
        expect(Array.isArray(results)).toBe(true);
      } finally {
        realDb.close();
      }
    });
  });
});
