/**
 * TDD Tests for content-filter
 *
 * Tests for the embedding content filtering system.
 * Written FIRST before implementation (RED phase)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildContentFilterQuery,
  getFilterableNodeCount,
  SYSTEM_DOC_TYPES,
  type ContentFilterOptions,
} from "./content-filter";

describe("content-filter", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");

    // Create nodes table matching the real schema
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        parent_id TEXT,
        node_type TEXT,
        created INTEGER,
        updated INTEGER,
        done_at INTEGER,
        raw_data TEXT
      )
    `);

    // Create tag_applications table for entity filter
    db.run(`
      CREATE TABLE tag_applications (
        id INTEGER PRIMARY KEY,
        data_node_id TEXT,
        tag_node_id TEXT,
        tag_name TEXT
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("SYSTEM_DOC_TYPES constant", () => {
    it("should include tuple (field:value pairs)", () => {
      expect(SYSTEM_DOC_TYPES).toContain("tuple");
    });

    it("should include metanode (system metadata)", () => {
      expect(SYSTEM_DOC_TYPES).toContain("metanode");
    });

    it("should include viewDef (view definitions)", () => {
      expect(SYSTEM_DOC_TYPES).toContain("viewDef");
    });

    it("should NOT include content types like chat, url, codeblock", () => {
      expect(SYSTEM_DOC_TYPES).not.toContain("chat");
      expect(SYSTEM_DOC_TYPES).not.toContain("url");
      expect(SYSTEM_DOC_TYPES).not.toContain("codeblock");
    });

    it("should include transcript types (excluded by default)", () => {
      // Transcripts are in SYSTEM_DOC_TYPES to exclude them by default
      // Use --include-transcripts flag to opt-in
      expect(SYSTEM_DOC_TYPES).toContain("transcript");
      expect(SYSTEM_DOC_TYPES).toContain("transcriptLine");
    });
  });

  describe("buildContentFilterQuery", () => {
    it("should return base query with default options", () => {
      const { query, params } = buildContentFilterQuery({});

      expect(query).toContain("SELECT n.id, n.name");
      expect(query).toContain("FROM nodes n");
      expect(query).toContain("name IS NOT NULL");
      expect(params).toEqual([]);
    });

    it("should apply minimum length filter", () => {
      const { query } = buildContentFilterQuery({ minLength: 10 });

      expect(query).toContain("LENGTH(n.name) >= 10");
    });

    it("should exclude timestamp-like names", () => {
      const { query } = buildContentFilterQuery({ excludeTimestamps: true });

      expect(query).toContain("NOT LIKE '1970-01-01%'");
    });

    it("should exclude system docTypes", () => {
      const { query } = buildContentFilterQuery({ excludeSystemTypes: true });

      expect(query).toContain("json_extract");
      expect(query).toContain("_docType");
      expect(query).toContain("tuple");
      expect(query).toContain("metanode");
    });

    it("should apply tag filter", () => {
      const { query, params } = buildContentFilterQuery({ tag: "meeting" });

      expect(query).toContain("tag_applications");
      expect(query).toContain("tag_name = ?");
      expect(params).toContain("meeting");
    });

    it("should apply limit", () => {
      const { query, params } = buildContentFilterQuery({ limit: 100 });

      expect(query).toContain("LIMIT ?");
      expect(params).toContain(100);
    });

    it("should combine all filters", () => {
      const { query, params } = buildContentFilterQuery({
        minLength: 10,
        excludeTimestamps: true,
        excludeSystemTypes: true,
        limit: 500,
      });

      expect(query).toContain("LENGTH(n.name) >= 10");
      expect(query).toContain("NOT LIKE '1970-01-01%'");
      expect(query).toContain("_docType");
      expect(query).toContain("LIMIT ?");
      expect(params).toContain(500);
    });

    it("should allow including all nodes when includeAll is true", () => {
      const { query } = buildContentFilterQuery({ includeAll: true });

      // Should not have length, timestamp, or docType filters
      expect(query).not.toContain("LENGTH(name)");
      expect(query).not.toContain("1970-01-01");
      expect(query).not.toContain("_docType");
    });
  });

  describe("getFilterableNodeCount", () => {
    beforeEach(() => {
      // Insert test nodes with various properties
      const nodes = [
        // Good content nodes (should be included with default filters)
        { id: "1", name: "This is a good content node with enough length", raw_data: '{"props":{}}' },
        { id: "2", name: "Another meaningful node", raw_data: '{"props":{}}' },
        { id: "3", name: "Meeting notes from yesterday", raw_data: '{"props":{"_docType":"transcriptLine"}}' },

        // Short nodes (should be excluded with minLength filter)
        { id: "4", name: "Yes.", raw_data: '{"props":{}}' },
        { id: "5", name: "Mhm.", raw_data: '{"props":{}}' },
        { id: "6", name: "*", raw_data: '{"props":{}}' },

        // Timestamp nodes (should be excluded with excludeTimestamps)
        { id: "7", name: "1970-01-01T00:20:30.787Z", raw_data: '{"props":{}}' },
        { id: "8", name: "1970-01-01T00:00:00.000Z", raw_data: '{"props":{}}' },

        // System type nodes (should be excluded with excludeSystemTypes)
        { id: "9", name: "typeChoice", raw_data: '{"props":{"_docType":"tuple"}}' },
        { id: "10", name: "tuple", raw_data: '{"props":{"_docType":"tuple"}}' },
        { id: "11", name: null, raw_data: '{"props":{"_docType":"metanode"}}' },

        // Edge case: null name
        { id: "12", name: null, raw_data: '{"props":{}}' },
      ];

      for (const node of nodes) {
        db.run(
          "INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)",
          [node.id, node.name, node.raw_data]
        );
      }
    });

    it("should return total named nodes with no filters", () => {
      const count = getFilterableNodeCount(db, { includeAll: true });
      // 10 nodes with names (2 have null names)
      expect(count).toBe(10);
    });

    it("should exclude short nodes with minLength filter", () => {
      const count = getFilterableNodeCount(db, { minLength: 10 });
      // Excludes "Yes.", "Mhm.", "*", "typeChoice", "tuple" (all < 10 chars)
      // But includes timestamps which are > 10 chars
      expect(count).toBeLessThan(10);
    });

    it("should exclude timestamp nodes", () => {
      const countWithTimestamps = getFilterableNodeCount(db, { includeAll: true });
      const countWithoutTimestamps = getFilterableNodeCount(db, { excludeTimestamps: true });

      expect(countWithoutTimestamps).toBeLessThan(countWithTimestamps);
    });

    it("should exclude system docType nodes", () => {
      const countWithSystem = getFilterableNodeCount(db, { includeAll: true });
      const countWithoutSystem = getFilterableNodeCount(db, { excludeSystemTypes: true });

      // Should exclude the tuple nodes
      expect(countWithoutSystem).toBeLessThan(countWithSystem);
    });

    it("should apply all default filters together", () => {
      const defaultCount = getFilterableNodeCount(db, {
        minLength: 10,
        excludeTimestamps: true,
        excludeSystemTypes: true,
      });

      // Should include:
      // - "This is a good content node with enough length" (47 chars, no docType)
      // - "Another meaningful node" (23 chars, no docType)
      // Excludes:
      // - "Yes." (4 chars < 10)
      // - "Mhm." (4 chars < 10)
      // - "*" (1 char < 10)
      // - "1970-01-01T00:20:30.787Z" (timestamp)
      // - "1970-01-01T00:00:00.000Z" (timestamp)
      // - "typeChoice" (10 chars, but tuple docType)
      // - "tuple" (5 chars < 10, also tuple docType)
      // - "Meeting notes from yesterday" (28 chars, but transcriptLine docType - now excluded)
      expect(defaultCount).toBe(2);
    });
  });

  describe("query execution", () => {
    beforeEach(() => {
      // Insert test nodes
      const nodes = [
        { id: "content1", name: "Important meeting about project planning", raw_data: '{"props":{}}' },
        { id: "content2", name: "Technical documentation for API", raw_data: '{"props":{}}' },
        { id: "short1", name: "Ok", raw_data: '{"props":{}}' },
        { id: "tuple1", name: "typeChoice", raw_data: '{"props":{"_docType":"tuple"}}' },
        { id: "timestamp1", name: "1970-01-01T00:00:00.000Z", raw_data: '{"props":{}}' },
      ];

      for (const node of nodes) {
        db.run(
          "INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)",
          [node.id, node.name, node.raw_data]
        );
      }
    });

    it("should return correct nodes with default content filter", () => {
      const { query, params } = buildContentFilterQuery({
        minLength: 10,
        excludeTimestamps: true,
        excludeSystemTypes: true,
      });

      const results = db.query(query).all(...params) as Array<{ id: string; name: string }>;

      // Should only return content1 and content2
      expect(results.length).toBe(2);
      expect(results.map((r) => r.id)).toContain("content1");
      expect(results.map((r) => r.id)).toContain("content2");
      expect(results.map((r) => r.id)).not.toContain("short1");
      expect(results.map((r) => r.id)).not.toContain("tuple1");
      expect(results.map((r) => r.id)).not.toContain("timestamp1");
    });
  });
});
