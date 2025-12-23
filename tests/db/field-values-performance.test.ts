/**
 * Field Values Performance Tests
 *
 * Tests for O(1) parent lookup using pre-computed parentMap
 * instead of O(n) findTupleParent search.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import type { NodeDump } from "../../src/types/tana-dump";
import {
  extractFieldValuesFromNodes,
  isTupleWithSourceId,
  isFieldTuple,
} from "../../src/db/field-values";
import { Database } from "bun:sqlite";

describe("Field Values Performance", () => {
  let db: Database;
  let nodes: Map<string, NodeDump>;
  let parentMap: Map<string, string>;

  beforeAll(() => {
    // Create in-memory DB with required table
    db = new Database(":memory:");
    db.run("CREATE TABLE field_exclusions (field_name TEXT PRIMARY KEY)");

    // Create test nodes:
    // parent1 -> tuple1 -> [fieldLabel1, value1]
    // parent2 -> tuple2 -> [fieldLabel2, value2]
    nodes = new Map<string, NodeDump>([
      [
        "parent1",
        {
          id: "parent1",
          props: { name: "Parent Node 1", created: Date.now() },
          children: ["tuple1"],
        } as NodeDump,
      ],
      [
        "tuple1",
        {
          id: "tuple1",
          props: {
            _docType: "tuple",
            _sourceId: "fieldDef1",
            created: Date.now(),
          },
          children: ["fieldLabel1", "value1"],
        } as NodeDump,
      ],
      [
        "fieldLabel1",
        {
          id: "fieldLabel1",
          props: { name: "Summary", created: Date.now() },
        } as NodeDump,
      ],
      [
        "value1",
        {
          id: "value1",
          props: { name: "This is the summary text", created: Date.now() },
        } as NodeDump,
      ],
      [
        "parent2",
        {
          id: "parent2",
          props: { name: "Parent Node 2", created: Date.now() },
          children: ["tuple2"],
        } as NodeDump,
      ],
      [
        "tuple2",
        {
          id: "tuple2",
          props: {
            _docType: "tuple",
            _sourceId: "fieldDef2",
            created: Date.now(),
          },
          children: ["fieldLabel2", "value2"],
        } as NodeDump,
      ],
      [
        "fieldLabel2",
        {
          id: "fieldLabel2",
          props: { name: "Action Items", created: Date.now() },
        } as NodeDump,
      ],
      [
        "value2",
        {
          id: "value2",
          props: { name: "Review PRs", created: Date.now() },
        } as NodeDump,
      ],
    ]);

    // Pre-compute parent map (child -> parent)
    parentMap = new Map<string, string>();
    for (const [nodeId, node] of nodes) {
      if (node.children) {
        for (const childId of node.children) {
          parentMap.set(childId, nodeId);
        }
      }
    }
  });

  describe("extractFieldValuesFromNodes with parentMap", () => {
    it("should accept optional parentMap parameter", () => {
      // This test verifies the function signature accepts parentMap
      const result = extractFieldValuesFromNodes(nodes, db, { parentMap });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should extract field values using parentMap for O(1) lookup", () => {
      const result = extractFieldValuesFromNodes(nodes, db, { parentMap });

      expect(result.length).toBe(2);

      const summaryField = result.find((v) => v.fieldName === "Summary");
      expect(summaryField).toBeDefined();
      expect(summaryField!.parentId).toBe("parent1");
      expect(summaryField!.valueText).toBe("This is the summary text");

      const actionField = result.find((v) => v.fieldName === "Action Items");
      expect(actionField).toBeDefined();
      expect(actionField!.parentId).toBe("parent2");
      expect(actionField!.valueText).toBe("Review PRs");
    });

    it("should still work without parentMap (backwards compatible)", () => {
      // Without parentMap, falls back to O(n) search
      const result = extractFieldValuesFromNodes(nodes, db, {});
      expect(result.length).toBe(2);
    });

    it("should handle nested tuples correctly with parentMap", () => {
      // Create nodes with nested tuple structure
      // grandparent -> parentTuple -> tuple -> [label, value]
      const nestedNodes = new Map<string, NodeDump>([
        [
          "grandparent",
          {
            id: "grandparent",
            props: { name: "Grandparent", created: Date.now() },
            children: ["parentTuple"],
          } as NodeDump,
        ],
        [
          "parentTuple",
          {
            id: "parentTuple",
            props: { _docType: "tuple", created: Date.now() },
            children: ["nestedTuple"],
          } as NodeDump,
        ],
        [
          "nestedTuple",
          {
            id: "nestedTuple",
            props: {
              _docType: "tuple",
              _sourceId: "fieldDef",
              created: Date.now(),
            },
            children: ["nestedLabel", "nestedValue"],
          } as NodeDump,
        ],
        [
          "nestedLabel",
          {
            id: "nestedLabel",
            props: { name: "Nested Field", created: Date.now() },
          } as NodeDump,
        ],
        [
          "nestedValue",
          {
            id: "nestedValue",
            props: { name: "Nested Value", created: Date.now() },
          } as NodeDump,
        ],
      ]);

      // Build parent map
      const nestedParentMap = new Map<string, string>();
      for (const [nodeId, node] of nestedNodes) {
        if (node.children) {
          for (const childId of node.children) {
            nestedParentMap.set(childId, nodeId);
          }
        }
      }

      const result = extractFieldValuesFromNodes(nestedNodes, db, {
        parentMap: nestedParentMap,
      });

      expect(result.length).toBe(1);
      // Should resolve to grandparent, not parentTuple
      expect(result[0].parentId).toBe("grandparent");
    });
  });

  describe("Performance comparison", () => {
    it("should be significantly faster with parentMap on larger datasets", () => {
      // Create a larger test dataset: 10,000 nodes with 500 tuples
      // At this scale, O(n) vs O(1) becomes noticeable
      const largeNodes = new Map<string, NodeDump>();
      const largeParentMap = new Map<string, string>();

      // Add 10,000 regular nodes
      for (let i = 0; i < 10000; i++) {
        largeNodes.set(`node${i}`, {
          id: `node${i}`,
          props: { name: `Node ${i}`, created: Date.now() },
          children: i < 500 ? [`tuple${i}`] : undefined, // First 500 have tuples
        } as NodeDump);
      }

      // Add 500 tuples with field values
      for (let i = 0; i < 500; i++) {
        largeNodes.set(`tuple${i}`, {
          id: `tuple${i}`,
          props: {
            _docType: "tuple",
            _sourceId: `fieldDef${i}`,
            created: Date.now(),
          },
          children: [`label${i}`, `value${i}`],
        } as NodeDump);
        largeNodes.set(`label${i}`, {
          id: `label${i}`,
          props: { name: `Field ${i}`, created: Date.now() },
        } as NodeDump);
        largeNodes.set(`value${i}`, {
          id: `value${i}`,
          props: { name: `Value ${i}`, created: Date.now() },
        } as NodeDump);
      }

      // Build parent map
      for (const [nodeId, node] of largeNodes) {
        if (node.children) {
          for (const childId of node.children) {
            largeParentMap.set(childId, nodeId);
          }
        }
      }

      // Time with parentMap (should be fast - O(t) where t = tuples)
      const startWith = performance.now();
      const resultWith = extractFieldValuesFromNodes(largeNodes, db, {
        parentMap: largeParentMap,
      });
      const durationWith = performance.now() - startWith;

      // Time without parentMap (O(n*t) where n = nodes, t = tuples)
      const startWithout = performance.now();
      const resultWithout = extractFieldValuesFromNodes(largeNodes, db, {});
      const durationWithout = performance.now() - startWithout;

      console.log(`With parentMap: ${durationWith.toFixed(2)}ms`);
      console.log(`Without parentMap: ${durationWithout.toFixed(2)}ms`);
      console.log(`Speedup: ${(durationWithout / durationWith).toFixed(1)}x`);

      // Both should return same results
      expect(resultWith.length).toBe(resultWithout.length);
      expect(resultWith.length).toBe(500);

      // With parentMap should be faster
      // Note: At 10k nodes and 500 tuples, speedup should be significant
      expect(durationWith).toBeLessThan(durationWithout);
    });
  });

  describe("isFieldTuple - tuples without _sourceId", () => {
    let nodesWithoutSourceId: Map<string, NodeDump>;

    beforeAll(() => {
      // Create test nodes with tuples WITHOUT _sourceId
      nodesWithoutSourceId = new Map<string, NodeDump>([
        [
          "parent1",
          {
            id: "parent1",
            props: { name: "Parent Node 1", created: Date.now() },
            children: ["tuple_no_sourceId"],
          } as NodeDump,
        ],
        [
          "tuple_no_sourceId",
          {
            id: "tuple_no_sourceId",
            props: {
              _docType: "tuple",
              // NO _sourceId!
              created: Date.now(),
            },
            children: ["label1", "value1"],
          } as NodeDump,
        ],
        [
          "label1",
          {
            id: "label1",
            props: { name: "Location", created: Date.now() },
          } as NodeDump,
        ],
        [
          "value1",
          {
            id: "value1",
            props: { name: "Zürich", created: Date.now() },
          } as NodeDump,
        ],
      ]);
    });

    it("should identify tuples WITHOUT _sourceId as valid field tuples", () => {
      const tuple = nodesWithoutSourceId.get("tuple_no_sourceId")!;
      expect(isFieldTuple(tuple, nodesWithoutSourceId)).toBe(true);
    });

    it("should still identify tuples WITH _sourceId as valid", () => {
      const tupleWithSourceId = nodes.get("tuple1")!;
      expect(isFieldTuple(tupleWithSourceId, nodes)).toBe(true);
    });

    it("should extract field values from tuples WITHOUT _sourceId", () => {
      const result = extractFieldValuesFromNodes(nodesWithoutSourceId, db, {});

      expect(result.length).toBe(1);
      expect(result[0].fieldName).toBe("Location");
      expect(result[0].valueText).toBe("Zürich");
    });

    it("should skip mega-tuples with 50+ children", () => {
      // Create a mega-tuple with 60 children
      const megaNodes = new Map<string, NodeDump>();
      const childIds: string[] = [];
      for (let i = 0; i < 60; i++) {
        const childId = `child${i}`;
        childIds.push(childId);
        megaNodes.set(childId, {
          id: childId,
          props: { name: `Child ${i}`, created: Date.now() },
        } as NodeDump);
      }

      megaNodes.set("mega_tuple", {
        id: "mega_tuple",
        props: { _docType: "tuple", created: Date.now() },
        children: childIds,
      } as NodeDump);

      const megaTuple = megaNodes.get("mega_tuple")!;
      expect(isFieldTuple(megaTuple, megaNodes)).toBe(false);
    });

    it("should skip tuples with indented field labels", () => {
      const indentedNodes = new Map<string, NodeDump>([
        [
          "indented_tuple",
          {
            id: "indented_tuple",
            props: { _docType: "tuple", created: Date.now() },
            children: ["indented_label", "indented_value"],
          } as NodeDump,
        ],
        [
          "indented_label",
          {
            id: "indented_label",
            props: { name: "  - Gestern war gut weil:", created: Date.now() },
          } as NodeDump,
        ],
        [
          "indented_value",
          {
            id: "indented_value",
            props: { name: "    - Good thing", created: Date.now() },
          } as NodeDump,
        ],
      ]);

      const indentedTuple = indentedNodes.get("indented_tuple")!;
      expect(isFieldTuple(indentedTuple, indentedNodes)).toBe(false);
    });

    it("should reject non-tuple nodes", () => {
      const regularNode: NodeDump = {
        id: "regular",
        props: { name: "Regular Node", created: Date.now() },
        children: ["child1", "child2"],
      } as NodeDump;
      const testNodes = new Map<string, NodeDump>([["regular", regularNode]]);
      expect(isFieldTuple(regularNode, testNodes)).toBe(false);
    });

    it("should reject tuples with only one child", () => {
      const singleChildNodes = new Map<string, NodeDump>([
        [
          "single_child_tuple",
          {
            id: "single_child_tuple",
            props: { _docType: "tuple", created: Date.now() },
            children: ["only_child"],
          } as NodeDump,
        ],
        [
          "only_child",
          {
            id: "only_child",
            props: { name: "Only Child", created: Date.now() },
          } as NodeDump,
        ],
      ]);

      const singleChildTuple = singleChildNodes.get("single_child_tuple")!;
      expect(isFieldTuple(singleChildTuple, singleChildNodes)).toBe(false);
    });
  });
});
