/**
 * Indexer Field Values Integration Tests
 * Tasks T-3.1 to T-3.5: Integrate field value extraction into indexer
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { TanaIndexer } from "../../src/db/indexer";
import { migrateFieldValuesSchema } from "../../src/db/migrate";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Indexer Field Values Integration", () => {
  let testDir: string;
  let dbPath: string;
  let exportPath: string;

  // Sample Tana export with field values
  const sampleExport = {
    formatVersion: 1,
    docs: [
      // Day node
      {
        id: "day20251218",
        props: {
          created: 1702900800000,
          name: "2025-12-18",
        },
        children: ["fieldTuple1"],
        inbound_refs: [],
        outbound_refs: [],
      },
      // Field value tuple
      {
        id: "fieldTuple1",
        props: {
          created: 1702900800000,
          _docType: "tuple",
          _sourceId: "fieldDef1",
        },
        children: ["labelRef1", "value1"],
        inbound_refs: [],
        outbound_refs: [],
      },
      // Field definition
      {
        id: "fieldDef1",
        props: {
          created: 1702900800000,
          name: "Gestern war gut weil",
        },
        children: [],
        inbound_refs: [],
        outbound_refs: [],
      },
      // Label reference (first tuple child - skipped)
      {
        id: "labelRef1",
        props: {
          created: 1702900800000,
          name: "Gestern war gut weil",
        },
        children: [],
        inbound_refs: [],
        outbound_refs: [],
      },
      // Value node
      {
        id: "value1",
        props: {
          created: 1702900800000,
          name: "Schön geprobt, Theater war toll",
        },
        children: [],
        inbound_refs: [],
        outbound_refs: [],
      },
      // Another day with multiple values
      {
        id: "day20251219",
        props: {
          created: 1702987200000,
          name: "2025-12-19",
        },
        children: ["fieldTuple2"],
        inbound_refs: [],
        outbound_refs: [],
      },
      {
        id: "fieldTuple2",
        props: {
          created: 1702987200000,
          _docType: "tuple",
          _sourceId: "fieldDef1",
        },
        children: ["labelRef2", "value2", "value3"],
        inbound_refs: [],
        outbound_refs: [],
      },
      {
        id: "labelRef2",
        props: {
          created: 1702987200000,
          name: "Gestern war gut weil",
        },
        children: [],
        inbound_refs: [],
        outbound_refs: [],
      },
      {
        id: "value2",
        props: {
          created: 1702987200000,
          name: "Gutes Meeting",
        },
        children: [],
        inbound_refs: [],
        outbound_refs: [],
      },
      {
        id: "value3",
        props: {
          created: 1702987200000,
          name: "Projekt abgeschlossen",
        },
        children: [],
        inbound_refs: [],
        outbound_refs: [],
      },
    ],
    editors: [],
    workspaces: { main: "workspace1" },
  };

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "indexer-fields-test-"));
    dbPath = join(testDir, "test.db");
    exportPath = join(testDir, "export.json");
    await writeFile(exportPath, JSON.stringify(sampleExport));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("field values indexing (T-3.2)", () => {
    it("should index field values during full reindex", async () => {
      const indexer = new TanaIndexer(dbPath);
      await indexer.initializeSchema();

      const result = await indexer.indexExport(exportPath);

      expect(result.nodesIndexed).toBeGreaterThan(0);

      // Check field values were indexed
      const db = new Database(dbPath);
      const fieldValues = db
        .query("SELECT * FROM field_values ORDER BY parent_id")
        .all() as Array<{
        field_name: string;
        value_text: string;
        parent_id: string;
      }>;

      db.close();

      // Should have 3 field values (1 from day1, 2 from day2)
      expect(fieldValues.length).toBe(3);

      // Check first day's value
      const day1Values = fieldValues.filter(
        (v) => v.parent_id === "day20251218"
      );
      expect(day1Values.length).toBe(1);
      expect(day1Values[0].field_name).toBe("Gestern war gut weil");
      expect(day1Values[0].value_text).toBe("Schön geprobt, Theater war toll");

      // Check second day's values
      const day2Values = fieldValues.filter(
        (v) => v.parent_id === "day20251219"
      );
      expect(day2Values.length).toBe(2);
    });

    it("should include field_values_indexed in result", async () => {
      const indexer = new TanaIndexer(dbPath);
      await indexer.initializeSchema();

      const result = await indexer.indexExport(exportPath);

      expect(result.fieldValuesIndexed).toBe(3);
    });
  });

  describe("clear field_values on reindex (T-3.3)", () => {
    it("should clear field_values before full reindex", async () => {
      const indexer = new TanaIndexer(dbPath);
      await indexer.initializeSchema();

      // First index
      await indexer.indexExport(exportPath);

      const db = new Database(dbPath);
      const countBefore = (
        db.query("SELECT COUNT(*) as count FROM field_values").get() as {
          count: number;
        }
      ).count;
      expect(countBefore).toBe(3);

      db.close();

      // Reindex same data
      await indexer.indexExport(exportPath);

      const db2 = new Database(dbPath);
      const countAfter = (
        db2.query("SELECT COUNT(*) as count FROM field_values").get() as {
          count: number;
        }
      ).count;
      db2.close();

      // Should still have 3 (not 6)
      expect(countAfter).toBe(3);
    });
  });

  describe("FTS sync (T-3.2)", () => {
    it("should populate FTS index during indexing", async () => {
      const indexer = new TanaIndexer(dbPath);
      await indexer.initializeSchema();

      await indexer.indexExport(exportPath);

      const db = new Database(dbPath);
      const ftsResults = db
        .query(
          "SELECT * FROM field_values_fts WHERE field_values_fts MATCH 'Theater'"
        )
        .all() as Array<{ value_text: string }>;

      db.close();

      expect(ftsResults.length).toBe(1);
      expect(ftsResults[0].value_text).toContain("Theater");
    });

    it("should allow searching by field name in FTS", async () => {
      const indexer = new TanaIndexer(dbPath);
      await indexer.initializeSchema();

      await indexer.indexExport(exportPath);

      const db = new Database(dbPath);
      const ftsResults = db
        .query(
          `SELECT * FROM field_values_fts WHERE field_values_fts MATCH 'field_name:"Gestern"'`
        )
        .all();

      db.close();

      expect(ftsResults.length).toBe(3); // All 3 values have this field name
    });
  });

  describe("stats output (T-3.5)", () => {
    it("should report field values count in sync output", async () => {
      const indexer = new TanaIndexer(dbPath);
      await indexer.initializeSchema();

      const result = await indexer.indexExport(exportPath);

      // Result should include fieldValuesIndexed
      expect(result.fieldValuesIndexed).toBeDefined();
      expect(result.fieldValuesIndexed).toBe(3);
    });
  });
});
