/**
 * TDD Test Suite for Tana Export Parser
 *
 * Uses synthetic test fixtures for reproducible testing
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { TanaExportParser } from "../src/parsers/tana-export";
import type { TanaDump, TanaGraph } from "../src/types/tana-dump";
import { TanaDumpSchema } from "../src/types/tana-dump";
import { join } from "path";

const FIXTURE_PATH = join(__dirname, "fixtures/sample-workspace.json");

describe("TanaExportParser - parseFile", () => {
  let parser: TanaExportParser;

  beforeAll(() => {
    parser = new TanaExportParser();
  });

  test("should parse valid Tana JSON export file", async () => {
    const dump = await parser.parseFile(FIXTURE_PATH);

    expect(dump.formatVersion).toBe(1);
    expect(dump.docs).toBeDefined();
    expect(Array.isArray(dump.docs)).toBe(true);
    expect(dump.docs.length).toBeGreaterThan(0);
  });

  test("should validate parsed data against schema", async () => {
    const dump = await parser.parseFile(FIXTURE_PATH);
    const result = TanaDumpSchema.safeParse(dump);
    expect(result.success).toBe(true);
  });

  test("should throw error for non-existent file", async () => {
    expect(async () => {
      await parser.parseFile("nonexistent.json");
    }).toThrow();
  });
});

describe("TanaExportParser - Supertag Detection", () => {
  let parser: TanaExportParser;
  let dump: TanaDump;
  let graph: TanaGraph;

  beforeAll(async () => {
    parser = new TanaExportParser();
    dump = await parser.parseFile(FIXTURE_PATH);
    graph = parser.buildGraph(dump);
  });

  test("should build TanaGraph with all components", () => {
    expect(graph.nodes).toBeDefined();
    expect(graph.trash).toBeDefined();
    expect(graph.supertags).toBeDefined();
    expect(graph.fields).toBeDefined();
    expect(graph.inlineRefs).toBeDefined();
    expect(graph.tagColors).toBeDefined();
  });

  test("should identify trashed nodes separately", () => {
    expect(graph.trash.size).toBeGreaterThan(0);
    console.log(`Found ${graph.trash.size} trashed nodes`);
  });

  test("should detect supertag tuples (SYS_A13 + SYS_T01)", () => {
    expect(graph.supertags.size).toBeGreaterThan(0);

    for (const [tagId, tuple] of graph.supertags) {
      expect(tuple.nodeId).toBeDefined();
      expect(tuple.tagId).toBe(tagId);
      expect(Array.isArray(tuple.superclasses)).toBe(true);
    }
  });

  test("should extract supertag names correctly", () => {
    const tagNames = Array.from(graph.supertags.values()).map((t) => t.tagName);
    expect(tagNames.length).toBeGreaterThan(0);

    for (const tagName of tagNames) {
      expect(typeof tagName).toBe("string");
      expect(tagName.length).toBeGreaterThan(0);
    }
  });

  test("should capture tag colors", () => {
    for (const tuple of graph.supertags.values()) {
      if (tuple.color) {
        expect(graph.tagColors.has(tuple.tagName)).toBe(true);
      }
    }
  });

  test("should not include trashed supertags", () => {
    for (const [_, tuple] of graph.supertags) {
      expect(graph.trash.has(tuple.nodeId)).toBe(false);
      expect(graph.trash.has(tuple.tagId)).toBe(false);
    }
  });
});

describe("TanaExportParser - Field Detection", () => {
  let parser: TanaExportParser;
  let dump: TanaDump;
  let graph: TanaGraph;

  beforeAll(async () => {
    parser = new TanaExportParser();
    dump = await parser.parseFile(FIXTURE_PATH);
    graph = parser.buildGraph(dump);
  });

  test("should detect field tuples (SYS_A13 + SYS_T02)", () => {
    expect(graph.fields.size).toBeGreaterThan(0);

    for (const [fieldName, tuple] of graph.fields) {
      expect(tuple.nodeId).toBeDefined();
      expect(tuple.fieldName).toBe(fieldName);
      expect(tuple.fieldId).toBeDefined();
    }
  });

  test("should extract field names correctly", () => {
    const fieldNames = Array.from(graph.fields.keys());
    expect(fieldNames.length).toBeGreaterThan(0);

    for (const fieldName of fieldNames) {
      expect(typeof fieldName).toBe("string");
      expect(fieldName.length).toBeGreaterThan(0);
    }

    console.log(`Found ${graph.fields.size} fields: ${fieldNames.join(", ")}`);
  });

  test("should not include trashed fields", () => {
    for (const [_, tuple] of graph.fields) {
      expect(graph.trash.has(tuple.nodeId)).toBe(false);
      expect(graph.trash.has(tuple.fieldId)).toBe(false);
    }
  });
});

describe("TanaExportParser - Inline Reference Extraction", () => {
  let parser: TanaExportParser;
  let dump: TanaDump;
  let graph: TanaGraph;

  beforeAll(async () => {
    parser = new TanaExportParser();
    dump = await parser.parseFile(FIXTURE_PATH);
    graph = parser.buildGraph(dump);
  });

  test("should extract inline references from node names", () => {
    expect(graph.inlineRefs.length).toBeGreaterThan(0);

    for (const ref of graph.inlineRefs) {
      expect(ref.sourceNodeId).toBeDefined();
      expect(Array.isArray(ref.targetNodeIds)).toBe(true);
      expect(ref.targetNodeIds.length).toBeGreaterThan(0);
      expect(ref.type).toBe('inline_ref');
    }
  });

  test("should extract multiple inline refs from single node", () => {
    const refWithMultiple = graph.inlineRefs.find(ref =>
      ref.targetNodeIds.length > 1
    );

    if (refWithMultiple) {
      expect(refWithMultiple.targetNodeIds.length).toBeGreaterThan(1);
      console.log(`Found node ${refWithMultiple.sourceNodeId} with ${refWithMultiple.targetNodeIds.length} inline refs`);
    }
  });

  test("should only include valid target node IDs", () => {
    for (const ref of graph.inlineRefs) {
      for (const targetId of ref.targetNodeIds) {
        expect(graph.nodes.has(targetId)).toBe(true);
      }
    }
  });

  test("should not extract inline refs from trashed nodes", () => {
    for (const ref of graph.inlineRefs) {
      expect(graph.trash.has(ref.sourceNodeId)).toBe(false);
    }
  });
});

describe("TanaExportParser - Graph Statistics", () => {
  let parser: TanaExportParser;
  let dump: TanaDump;
  let graph: TanaGraph;

  beforeAll(async () => {
    parser = new TanaExportParser();
    dump = await parser.parseFile(FIXTURE_PATH);
    graph = parser.buildGraph(dump);
  });

  test("should provide graph statistics", () => {
    console.log(`
Graph Statistics:
- Total docs in dump: ${dump.docs.length}
- Nodes in index: ${graph.nodes.size}
- Trashed nodes: ${graph.trash.size}
- Supertags detected: ${graph.supertags.size}
- Fields detected: ${graph.fields.size}
- Inline references: ${graph.inlineRefs.length}
- Tag colors: ${graph.tagColors.size}
    `);

    expect(graph.nodes.size).toBeLessThanOrEqual(dump.docs.length);
    expect(graph.supertags.size).toBeGreaterThan(0);
    expect(graph.fields.size).toBeGreaterThan(0);
    expect(graph.inlineRefs.length).toBeGreaterThan(0);
  });
});
