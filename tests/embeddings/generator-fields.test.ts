/**
 * Generator Fields Integration Tests (T-7.2)
 *
 * Tests for integrating field values into embedding generation.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DIR = join(tmpdir(), `supertag-generator-fields-test-${Date.now()}`);
const TEST_DB = join(TEST_DIR, "tana-index.db");

describe("Generator Fields Integration (T-7.2)", () => {
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
        doc_type TEXT,
        owner_id TEXT,
        parent_id TEXT
      );

      CREATE TABLE IF NOT EXISTS tag_applications (
        data_node_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        PRIMARY KEY (data_node_id, tag_name)
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
      CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
    `);

    // Insert test nodes
    db.exec(`
      INSERT INTO nodes (id, name, doc_type, owner_id) VALUES
        ('node1', 'Daily Reflection', 'node', 'user123'),
        ('node2', 'Meeting Notes', 'node', 'user123'),
        ('node3', 'No fields node', 'node', 'user123');
    `);

    // Insert test field values
    db.exec(`
      INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created) VALUES
        ('tuple1', 'node1', 'def1', 'Gestern war gut weil', 'val1', 'Ich habe gut geschlafen', 0, ${Date.now()}),
        ('tuple2', 'node1', 'def2', 'Heute habe ich gelernt', 'val2', 'TypeScript generics', 0, ${Date.now()});
    `);
  });

  afterAll(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("contextualizeNodesWithFields", () => {
    it("should add field values to contextualized nodes", async () => {
      const { contextualizeNodesWithFields } = await import(
        "../../src/embeddings/contextualize"
      );

      const nodes = [{ id: "node1", name: "Daily Reflection" }];

      const result = contextualizeNodesWithFields(db, nodes, {
        includeFields: true,
      });

      expect(result.length).toBe(1);
      expect(result[0].contextText).toContain("Daily Reflection");
      expect(result[0].contextText).toContain("[Gestern war gut weil]: Ich habe gut geschlafen");
      expect(result[0].contextText).toContain("[Heute habe ich gelernt]: TypeScript generics");
    });

    it("should not add fields when includeFields is false", async () => {
      const { contextualizeNodesWithFields } = await import(
        "../../src/embeddings/contextualize"
      );

      const nodes = [{ id: "node1", name: "Daily Reflection" }];

      const result = contextualizeNodesWithFields(db, nodes, {
        includeFields: false,
      });

      expect(result.length).toBe(1);
      expect(result[0].contextText).toBe("Daily Reflection");
      expect(result[0].contextText).not.toContain("[Gestern war gut weil]");
    });

    it("should handle nodes without fields", async () => {
      const { contextualizeNodesWithFields } = await import(
        "../../src/embeddings/contextualize"
      );

      const nodes = [{ id: "node3", name: "No fields node" }];

      const result = contextualizeNodesWithFields(db, nodes, {
        includeFields: true,
      });

      expect(result.length).toBe(1);
      expect(result[0].contextText).toBe("No fields node");
    });

    it("should handle mixed nodes efficiently", async () => {
      const { contextualizeNodesWithFields } = await import(
        "../../src/embeddings/contextualize"
      );

      const nodes = [
        { id: "node1", name: "Daily Reflection" },
        { id: "node2", name: "Meeting Notes" },
        { id: "node3", name: "No fields node" },
      ];

      const result = contextualizeNodesWithFields(db, nodes, {
        includeFields: true,
      });

      expect(result.length).toBe(3);
      expect(result[0].contextText).toContain("[Gestern war gut weil]:");
      expect(result[2].contextText).toBe("No fields node");
    });
  });
});
