/**
 * Field Values Extraction Tests
 * Tasks T-2.1 to T-2.8: Field value extraction from tuple structures
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import type { NodeDump } from "../../src/types/tana-dump";
import {
  extractFieldValuesFromNodes,
  resolveFieldName,
  isTupleWithSourceId,
  extractValuesFromTupleChildren,
  isExcludedField,
} from "../../src/db/field-values";
import { migrateFieldValuesSchema } from "../../src/db/migrate";

// Helper to create test node
function createNode(
  id: string,
  name: string | null,
  props: Record<string, unknown> = {},
  children: string[] = []
): NodeDump {
  return {
    id,
    props: {
      created: Date.now(),
      name: name ?? undefined,
      ...props,
    },
    children,
    inbound_refs: [],
    outbound_refs: [],
  };
}

describe("Field Values Extraction", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrateFieldValuesSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("isTupleWithSourceId (T-2.2)", () => {
    it("should detect tuple with _sourceId", () => {
      const node = createNode("tuple1", null, {
        _docType: "tuple",
        _sourceId: "zg7pciALsr",
      });

      expect(isTupleWithSourceId(node)).toBe(true);
    });

    it("should return false for node without _docType tuple", () => {
      const node = createNode("node1", "Regular node", {
        _sourceId: "zg7pciALsr",
      });

      expect(isTupleWithSourceId(node)).toBe(false);
    });

    it("should return false for tuple without _sourceId", () => {
      const node = createNode("tuple1", null, {
        _docType: "tuple",
      });

      expect(isTupleWithSourceId(node)).toBe(false);
    });

    it("should return false for regular node", () => {
      const node = createNode("node1", "Regular node");

      expect(isTupleWithSourceId(node)).toBe(false);
    });
  });

  describe("resolveFieldName (T-2.3)", () => {
    it("should resolve field name from definition node", () => {
      const nodes = new Map<string, NodeDump>();

      // Field definition node
      nodes.set("fieldDef123", createNode("fieldDef123", "Gestern war gut weil"));

      // Meta node pointing to field definition
      nodes.set("meta456", createNode("meta456", null, { _ownerId: "fieldDef123" }));

      const name = resolveFieldName("fieldDef123", nodes);
      expect(name).toBe("Gestern war gut weil");
    });

    it("should return null for non-existent field", () => {
      const nodes = new Map<string, NodeDump>();

      const name = resolveFieldName("nonexistent", nodes);
      expect(name).toBeNull();
    });

    it("should return null for node without name", () => {
      const nodes = new Map<string, NodeDump>();
      nodes.set("noName", createNode("noName", null));

      const name = resolveFieldName("noName", nodes);
      expect(name).toBeNull();
    });
  });

  describe("extractValuesFromTupleChildren (T-2.4)", () => {
    it("should extract values from tuple children", () => {
      const nodes = new Map<string, NodeDump>();

      // Value nodes (children of tuple)
      nodes.set("labelRef", createNode("labelRef", "Gestern war gut weil"));
      nodes.set("value1", createNode("value1", "Schön geprobt"));
      nodes.set("value2", createNode("value2", "Eventy hat sich bewährt"));

      // Tuple node with children
      const tuple = createNode(
        "tuple1",
        null,
        {
          _docType: "tuple",
          _sourceId: "fieldDef123",
        },
        ["labelRef", "value1", "value2"]
      );

      const values = extractValuesFromTupleChildren(tuple, nodes);

      // Should extract value1 and value2, skipping labelRef (first child)
      expect(values.length).toBe(2);
      expect(values[0].valueText).toBe("Schön geprobt");
      expect(values[0].valueOrder).toBe(0);
      expect(values[1].valueText).toBe("Eventy hat sich bewährt");
      expect(values[1].valueOrder).toBe(1);
    });

    it("should handle tuple with single value", () => {
      const nodes = new Map<string, NodeDump>();

      nodes.set("labelRef", createNode("labelRef", "Notes"));
      nodes.set("value1", createNode("value1", "Important note"));

      const tuple = createNode(
        "tuple1",
        null,
        { _docType: "tuple", _sourceId: "def1" },
        ["labelRef", "value1"]
      );

      const values = extractValuesFromTupleChildren(tuple, nodes);

      expect(values.length).toBe(1);
      expect(values[0].valueText).toBe("Important note");
    });
  });

  describe("multi-value fields (T-2.5)", () => {
    it("should preserve order for multi-value fields", () => {
      const nodes = new Map<string, NodeDump>();

      nodes.set("label", createNode("label", "Tags"));
      nodes.set("v1", createNode("v1", "First"));
      nodes.set("v2", createNode("v2", "Second"));
      nodes.set("v3", createNode("v3", "Third"));

      const tuple = createNode(
        "tuple1",
        null,
        { _docType: "tuple", _sourceId: "def1" },
        ["label", "v1", "v2", "v3"]
      );

      const values = extractValuesFromTupleChildren(tuple, nodes);

      expect(values.length).toBe(3);
      expect(values[0].valueOrder).toBe(0);
      expect(values[1].valueOrder).toBe(1);
      expect(values[2].valueOrder).toBe(2);
    });
  });

  describe("nested children (T-2.6)", () => {
    it("should concatenate nested children into value text", () => {
      const nodes = new Map<string, NodeDump>();

      // Value node with children (nested content)
      const valueNode = createNode(
        "value1",
        "Main reflection",
        {},
        ["child1", "child2"]
      );
      nodes.set("value1", valueNode);

      // Nested children
      nodes.set("child1", createNode("child1", "Sub-point 1"));
      nodes.set("child2", createNode("child2", "Sub-point 2"));
      nodes.set("label", createNode("label", "Reflection"));

      const tuple = createNode(
        "tuple1",
        null,
        { _docType: "tuple", _sourceId: "def1" },
        ["label", "value1"]
      );

      const values = extractValuesFromTupleChildren(tuple, nodes, { includeNestedChildren: true });

      expect(values.length).toBe(1);
      // Should include nested content
      expect(values[0].valueText).toContain("Main reflection");
      expect(values[0].valueText).toContain("Sub-point 1");
      expect(values[0].valueText).toContain("Sub-point 2");
    });
  });

  describe("field exclusions (T-2.7)", () => {
    it("should exclude system fields", () => {
      // Add exclusion
      db.run("INSERT INTO field_exclusions (field_name, reason) VALUES ('_internal', 'System field')");

      expect(isExcludedField(db, "_internal")).toBe(true);
      expect(isExcludedField(db, "Notes")).toBe(false);
    });
  });

  describe("empty values (T-2.8)", () => {
    it("should skip empty string values", () => {
      const nodes = new Map<string, NodeDump>();

      nodes.set("label", createNode("label", "Notes"));
      nodes.set("empty", createNode("empty", ""));
      nodes.set("value1", createNode("value1", "Has content"));

      const tuple = createNode(
        "tuple1",
        null,
        { _docType: "tuple", _sourceId: "def1" },
        ["label", "empty", "value1"]
      );

      const values = extractValuesFromTupleChildren(tuple, nodes);

      // Should skip empty value
      expect(values.length).toBe(1);
      expect(values[0].valueText).toBe("Has content");
    });

    it("should skip null name values", () => {
      const nodes = new Map<string, NodeDump>();

      nodes.set("label", createNode("label", "Notes"));
      nodes.set("nullValue", createNode("nullValue", null));
      nodes.set("value1", createNode("value1", "Has content"));

      const tuple = createNode(
        "tuple1",
        null,
        { _docType: "tuple", _sourceId: "def1" },
        ["label", "nullValue", "value1"]
      );

      const values = extractValuesFromTupleChildren(tuple, nodes);

      expect(values.length).toBe(1);
      expect(values[0].valueText).toBe("Has content");
    });
  });

  describe("extractFieldValuesFromNodes (full extraction)", () => {
    it("should extract field values from multiple tuples", () => {
      const nodes = new Map<string, NodeDump>();

      // Parent node (day node)
      const dayNode = createNode(
        "day2025-12-18",
        "2025-12-18",
        { created: 1702900800000 },
        ["tuple1"]
      );
      nodes.set("day2025-12-18", dayNode);

      // Field definition
      nodes.set("fieldDef", createNode("fieldDef", "Gestern war gut weil"));

      // Field value tuple
      const tuple = createNode(
        "tuple1",
        null,
        {
          _docType: "tuple",
          _sourceId: "fieldDef",
        },
        ["labelRef", "valueNode"]
      );
      nodes.set("tuple1", tuple);

      // Children of tuple
      nodes.set("labelRef", createNode("labelRef", "Gestern war gut weil"));
      nodes.set("valueNode", createNode("valueNode", "Schön geprobt"));

      const extracted = extractFieldValuesFromNodes(nodes, db);

      expect(extracted.length).toBe(1);
      expect(extracted[0].fieldName).toBe("Gestern war gut weil");
      expect(extracted[0].valueText).toBe("Schön geprobt");
      expect(extracted[0].parentId).toBe("day2025-12-18");
    });
  });
});
