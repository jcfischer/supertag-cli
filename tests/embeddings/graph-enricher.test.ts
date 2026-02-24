/**
 * Graph Enricher Tests (F-104 T-2.1, T-2.2)
 *
 * Tests for single-node and batch graph enrichment.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  enrichNodeWithGraphContext,
  batchEnrichNodesWithGraphContext,
} from "../../src/embeddings/graph-enricher";
import {
  DEFAULT_ENRICHMENT_CONFIG,
  type GraphAwareEnrichmentConfig,
} from "../../src/types/enrichment";

const TEST_DIR = join(tmpdir(), `supertag-graph-enricher-test-${Date.now()}`);
const TEST_DB = join(TEST_DIR, "tana-index.db");

describe("Graph Enricher (F-104)", () => {
  let db: Database;

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = new Database(TEST_DB);

    // Create required tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        doc_type TEXT
      );

      CREATE TABLE IF NOT EXISTS tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_node_id TEXT NOT NULL,
        tag_node_id TEXT,
        tag_name TEXT NOT NULL
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

    // Insert test data
    db.exec(`
      INSERT INTO nodes (id, name, doc_type) VALUES
        ('node1', 'Weekly sync meeting', NULL),
        ('node2', 'AI Research Overview', NULL),
        ('node3', 'Simple text node', NULL),
        ('node4', 'Multi-tag node', NULL),
        ('node5', 'Node with long field', NULL);

      INSERT INTO tag_applications (data_node_id, tag_node_id, tag_name) VALUES
        ('node1', 'tag1', 'meeting'),
        ('node2', 'tag2', 'project'),
        ('node4', 'tag3', 'topic'),
        ('node4', 'tag4', 'research'),
        ('node5', 'tag5', 'article');

      INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order) VALUES
        ('t1', 'node1', 'fd1', 'Date', 'v1', '2026-02-20', 0),
        ('t2', 'node1', 'fd2', 'Attendees', 'v2', 'Daniel, Sarah', 0),
        ('t3', 'node1', 'fd3', 'Status', 'v3', 'completed', 0),
        ('t4', 'node2', 'fd4', 'Category', 'v4', 'Machine Learning', 0),
        ('t5', 'node5', 'fd5', 'Abstract', 'v5', '${'A'.repeat(100)}', 0);
    `);
  });

  afterAll(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("enrichNodeWithGraphContext", () => {
    it("enriches a node with single tag and fields", () => {
      const result = enrichNodeWithGraphContext(
        db,
        "node1",
        "Weekly sync meeting",
        DEFAULT_ENRICHMENT_CONFIG
      );

      expect(result.enriched).toBe(true);
      expect(result.enrichmentTags).toEqual(["meeting"]);
      expect(result.enrichmentFields.length).toBeGreaterThan(0);
      expect(result.contextText).toMatch(/^\[Type: #meeting\]/);
      expect(result.contextText).toContain("Weekly sync meeting");
      expect(result.contextText).toContain("[Date: 2026-02-20]");
    });

    it("returns plain text for nodes without tags", () => {
      const result = enrichNodeWithGraphContext(
        db,
        "node3",
        "Simple text node",
        DEFAULT_ENRICHMENT_CONFIG
      );

      expect(result.enriched).toBe(false);
      expect(result.contextText).toBe("Simple text node");
      expect(result.enrichmentTags).toEqual([]);
      expect(result.enrichmentFields).toEqual([]);
    });

    it("includes all type names for multi-tag nodes", () => {
      const result = enrichNodeWithGraphContext(
        db,
        "node4",
        "Multi-tag node",
        DEFAULT_ENRICHMENT_CONFIG
      );

      expect(result.enriched).toBe(true);
      expect(result.enrichmentTags).toContain("topic");
      expect(result.enrichmentTags).toContain("research");
      expect(result.contextText).toContain("#topic");
      expect(result.contextText).toContain("#research");
    });

    it("truncates long field values to 50 chars", () => {
      const result = enrichNodeWithGraphContext(
        db,
        "node5",
        "Node with long field",
        DEFAULT_ENRICHMENT_CONFIG
      );

      expect(result.enriched).toBe(true);
      // The field value should be truncated
      for (const field of result.enrichmentFields) {
        expect(field.value.length).toBeLessThanOrEqual(51); // 50 + ellipsis char
      }
    });

    it("respects maxFieldsPerTag config", () => {
      const config: GraphAwareEnrichmentConfig = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        defaults: {
          ...DEFAULT_ENRICHMENT_CONFIG.defaults,
          maxFieldsPerTag: 1,
        },
      };

      const result = enrichNodeWithGraphContext(
        db,
        "node1",
        "Weekly sync meeting",
        config
      );

      expect(result.enrichmentFields.length).toBe(1);
    });

    it("respects disabled tag in config", () => {
      const config: GraphAwareEnrichmentConfig = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        overrides: {
          meeting: { disabled: true },
        },
      };

      const result = enrichNodeWithGraphContext(
        db,
        "node1",
        "Weekly sync meeting",
        config
      );

      expect(result.enriched).toBe(false);
      expect(result.contextText).toBe("Weekly sync meeting");
    });

    it("filters fields when override specifies includeFields", () => {
      const config: GraphAwareEnrichmentConfig = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        overrides: {
          meeting: {
            includeFields: ["Date"],
            maxFieldsPerTag: 5,
          },
        },
      };

      const result = enrichNodeWithGraphContext(
        db,
        "node1",
        "Weekly sync meeting",
        config
      );

      expect(result.enrichmentFields.length).toBe(1);
      expect(result.enrichmentFields[0].name).toBe("Date");
    });
  });

  describe("batchEnrichNodesWithGraphContext", () => {
    it("batch enriches multiple nodes", () => {
      const nodes = [
        { id: "node1", name: "Weekly sync meeting" },
        { id: "node2", name: "AI Research Overview" },
        { id: "node3", name: "Simple text node" },
      ];

      const results = batchEnrichNodesWithGraphContext(
        db,
        nodes,
        DEFAULT_ENRICHMENT_CONFIG
      );

      expect(results.length).toBe(3);

      // node1: has tag + fields
      expect(results[0].enriched).toBe(true);
      expect(results[0].contextText).toMatch(/^\[Type: #meeting\]/);

      // node2: has tag + field
      expect(results[1].enriched).toBe(true);
      expect(results[1].contextText).toMatch(/^\[Type: #project\]/);

      // node3: no tag
      expect(results[2].enriched).toBe(false);
      expect(results[2].contextText).toBe("Simple text node");
    });

    it("preserves input order", () => {
      const nodes = [
        { id: "node3", name: "Simple text node" },
        { id: "node1", name: "Weekly sync meeting" },
      ];

      const results = batchEnrichNodesWithGraphContext(
        db,
        nodes,
        DEFAULT_ENRICHMENT_CONFIG
      );

      expect(results[0].nodeId).toBe("node3");
      expect(results[1].nodeId).toBe("node1");
    });

    it("handles empty input", () => {
      const results = batchEnrichNodesWithGraphContext(
        db,
        [],
        DEFAULT_ENRICHMENT_CONFIG
      );
      expect(results).toEqual([]);
    });
  });
});
