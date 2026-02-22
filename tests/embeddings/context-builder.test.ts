/**
 * Context Builder Tests (T-7.1)
 *
 * Tests for building embedding text with field values included.
 * Format: existing contextText + "\n[FieldName]: value"
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DIR = join(tmpdir(), `supertag-context-builder-test-${Date.now()}`);
const TEST_DB = join(TEST_DIR, "tana-index.db");

describe("Context Builder (T-7.1)", () => {
  let db: Database;

  beforeAll(() => {
    // Create test directory and database
    mkdirSync(TEST_DIR, { recursive: true });
    db = new Database(TEST_DB);

    // Create required tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        doc_type TEXT
      );

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

      CREATE INDEX IF NOT EXISTS idx_field_values_parent ON field_values(parent_id);
    `);

    // Insert test nodes
    db.exec(`
      INSERT INTO nodes (id, name, doc_type) VALUES
        ('node1', 'Daily Reflection', 'node'),
        ('node2', 'Meeting Notes', 'node'),
        ('node3', 'No fields node', 'node');
    `);

    // Insert test field values
    db.exec(`
      INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created) VALUES
        ('tuple1', 'node1', 'def1', 'Gestern war gut weil', 'val1', 'Ich habe gut geschlafen', 0, ${Date.now()}),
        ('tuple2', 'node1', 'def2', 'Heute habe ich gelernt', 'val2', 'TypeScript generics sind mächtig', 0, ${Date.now()}),
        ('tuple3', 'node2', 'def3', 'Action Items', 'val3', 'Review PR, Update docs', 0, ${Date.now()});
    `);
  });

  afterAll(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("getFieldValuesForNode", () => {
    it("should return field values for a node", async () => {
      const { getFieldValuesForNode } = await import(
        "../../src/embeddings/context-builder"
      );

      const fields = getFieldValuesForNode(db, "node1");

      expect(fields.length).toBe(2);
      expect(fields[0].fieldName).toBe("Gestern war gut weil");
      expect(fields[0].valueText).toBe("Ich habe gut geschlafen");
    });

    it("should return empty array for node without fields", async () => {
      const { getFieldValuesForNode } = await import(
        "../../src/embeddings/context-builder"
      );

      const fields = getFieldValuesForNode(db, "node3");

      expect(fields.length).toBe(0);
    });

    it("should return empty array for non-existent node", async () => {
      const { getFieldValuesForNode } = await import(
        "../../src/embeddings/context-builder"
      );

      const fields = getFieldValuesForNode(db, "nonexistent");

      expect(fields.length).toBe(0);
    });
  });

  describe("buildFieldContext", () => {
    it("should format field values as [FieldName]: value", async () => {
      const { buildFieldContext } = await import(
        "../../src/embeddings/context-builder"
      );

      const fields = [
        { fieldName: "Status", valueText: "Done" },
        { fieldName: "Priority", valueText: "High" },
      ];

      const context = buildFieldContext(fields);

      expect(context).toBe("[Status]: Done\n[Priority]: High");
    });

    it("should return empty string for no fields", async () => {
      const { buildFieldContext } = await import(
        "../../src/embeddings/context-builder"
      );

      const context = buildFieldContext([]);

      expect(context).toBe("");
    });

    it("should handle multi-value fields", async () => {
      const { buildFieldContext } = await import(
        "../../src/embeddings/context-builder"
      );

      const fields = [
        { fieldName: "Tags", valueText: "urgent" },
        { fieldName: "Tags", valueText: "follow-up" },
      ];

      const context = buildFieldContext(fields);

      expect(context).toBe("[Tags]: urgent\n[Tags]: follow-up");
    });
  });

  describe("enrichContextWithFields", () => {
    it("should append field context to existing context text", async () => {
      const { enrichContextWithFields } = await import(
        "../../src/embeddings/context-builder"
      );

      const result = enrichContextWithFields(
        db,
        "node1",
        "Daily Reflection"
      );

      expect(result).toContain("Daily Reflection");
      expect(result).toContain("[Gestern war gut weil]: Ich habe gut geschlafen");
      expect(result).toContain("[Heute habe ich gelernt]: TypeScript generics sind mächtig");
    });

    it("should return original context if no fields", async () => {
      const { enrichContextWithFields } = await import(
        "../../src/embeddings/context-builder"
      );

      const result = enrichContextWithFields(
        db,
        "node3",
        "No fields node"
      );

      expect(result).toBe("No fields node");
    });

    it("should handle empty context text", async () => {
      const { enrichContextWithFields } = await import(
        "../../src/embeddings/context-builder"
      );

      const result = enrichContextWithFields(db, "node1", "");

      expect(result).toContain("[Gestern war gut weil]:");
    });
  });

  describe("batchEnrichWithFields", () => {
    it("should enrich multiple nodes efficiently", async () => {
      const { batchEnrichWithFields } = await import(
        "../../src/embeddings/context-builder"
      );

      const nodes = [
        { nodeId: "node1", contextText: "Daily Reflection" },
        { nodeId: "node2", contextText: "Meeting Notes" },
        { nodeId: "node3", contextText: "No fields node" },
      ];

      const results = batchEnrichWithFields(db, nodes);

      expect(results.length).toBe(3);
      expect(results[0].contextText).toContain("[Gestern war gut weil]:");
      expect(results[1].contextText).toContain("[Action Items]:");
      expect(results[2].contextText).toBe("No fields node");
    });

    it("should preserve node ID in results", async () => {
      const { batchEnrichWithFields } = await import(
        "../../src/embeddings/context-builder"
      );

      const nodes = [{ nodeId: "node1", contextText: "Test" }];

      const results = batchEnrichWithFields(db, nodes);

      expect(results[0].nodeId).toBe("node1");
    });

    it("should handle more nodes than SQLite variable limit via chunking", async () => {
      const { batchEnrichWithFields } = await import(
        "../../src/embeddings/context-builder"
      );

      // Create 1500 nodes (exceeds the 900 chunk size)
      const bulkNodes: Array<{ nodeId: string; contextText: string }> = [];
      for (let i = 0; i < 1500; i++) {
        bulkNodes.push({ nodeId: `bulk-${i}`, contextText: `Node ${i}` });
      }

      // Insert field values for a few of these nodes across chunk boundaries
      db.exec(`
        INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created) VALUES
          ('bulk-t1', 'bulk-100', 'def1', 'Status', 'bv1', 'Active', 0, ${Date.now()}),
          ('bulk-t2', 'bulk-950', 'def1', 'Status', 'bv2', 'Done', 0, ${Date.now()}),
          ('bulk-t3', 'bulk-1400', 'def1', 'Priority', 'bv3', 'High', 0, ${Date.now()});
      `);

      // Should not throw (previously would crash with "expected N values, received M")
      const results = batchEnrichWithFields(db, bulkNodes);

      expect(results.length).toBe(1500);
      // Node in first chunk (index 100)
      expect(results[100].contextText).toContain("[Status]: Active");
      // Node in second chunk (index 950, crosses the 900 boundary)
      expect(results[950].contextText).toContain("[Status]: Done");
      // Node in second chunk (index 1400)
      expect(results[1400].contextText).toContain("[Priority]: High");
      // Nodes without fields are unchanged
      expect(results[0].contextText).toBe("Node 0");
    });
  });
});
