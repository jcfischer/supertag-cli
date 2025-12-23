/**
 * Supertag Metadata Extraction Tests
 *
 * TDD tests for extracting field definitions and inheritance from tagDef nodes.
 *
 * Reference structures from docs/TANA-FIELD-STRUCTURES.md:
 * - tagDef children are tuples where first child = field label
 * - metaNode contains tuples with SYS_A13 marker followed by parent tagDef IDs
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import type { NodeDump } from "../../src/types/tana-dump";
import {
  extractFieldsFromTagDef,
  extractParentsFromTagDef,
  extractSupertagMetadata,
} from "../../src/db/supertag-metadata";
import { migrateSupertagMetadataSchema } from "../../src/db/migrate";

describe("Supertag Metadata Extraction", () => {
  describe("extractFieldsFromTagDef", () => {
    it("should extract field names from tagDef tuple children", () => {
      // Create a tagDef with 2 field definitions
      const nodes = new Map<string, NodeDump>([
        [
          "tagdef1",
          {
            id: "tagdef1",
            props: { name: "meeting", _docType: "tagDef", created: 1000 },
            children: ["tuple1", "tuple2"],
          } as NodeDump,
        ],
        [
          "tuple1",
          {
            id: "tuple1",
            props: { _docType: "tuple", created: 1001 },
            children: ["label1", "value1"],
          } as NodeDump,
        ],
        [
          "label1",
          {
            id: "label1",
            props: { name: "Location", created: 1002 },
          } as NodeDump,
        ],
        [
          "value1",
          {
            id: "value1",
            props: { name: "", created: 1003 },
          } as NodeDump,
        ],
        [
          "tuple2",
          {
            id: "tuple2",
            props: { _docType: "tuple", created: 1004 },
            children: ["label2", "value2"],
          } as NodeDump,
        ],
        [
          "label2",
          {
            id: "label2",
            props: { name: "Duration", created: 1005 },
          } as NodeDump,
        ],
        [
          "value2",
          {
            id: "value2",
            props: { name: "", created: 1006 },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("tagdef1")!;
      const fields = extractFieldsFromTagDef(tagDef, nodes);

      expect(fields.length).toBe(2);
      expect(fields[0].fieldName).toBe("Location");
      expect(fields[0].fieldLabelId).toBe("label1");
      expect(fields[0].fieldOrder).toBe(0);
      expect(fields[1].fieldName).toBe("Duration");
      expect(fields[1].fieldLabelId).toBe("label2");
      expect(fields[1].fieldOrder).toBe(1);
    });

    it("should skip non-tuple children", () => {
      const nodes = new Map<string, NodeDump>([
        [
          "tagdef1",
          {
            id: "tagdef1",
            props: { name: "test", _docType: "tagDef", created: 1000 },
            children: ["tuple1", "regular_node"],
          } as NodeDump,
        ],
        [
          "tuple1",
          {
            id: "tuple1",
            props: { _docType: "tuple", created: 1001 },
            children: ["label1", "value1"],
          } as NodeDump,
        ],
        [
          "label1",
          {
            id: "label1",
            props: { name: "Field1", created: 1002 },
          } as NodeDump,
        ],
        [
          "value1",
          {
            id: "value1",
            props: { name: "", created: 1003 },
          } as NodeDump,
        ],
        [
          "regular_node",
          {
            id: "regular_node",
            props: { name: "Not a tuple", created: 1004 },
            // No _docType: "tuple"
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("tagdef1")!;
      const fields = extractFieldsFromTagDef(tagDef, nodes);

      expect(fields.length).toBe(1);
      expect(fields[0].fieldName).toBe("Field1");
    });

    it("should skip tuples without first child name", () => {
      const nodes = new Map<string, NodeDump>([
        [
          "tagdef1",
          {
            id: "tagdef1",
            props: { name: "test", _docType: "tagDef", created: 1000 },
            children: ["tuple1"],
          } as NodeDump,
        ],
        [
          "tuple1",
          {
            id: "tuple1",
            props: { _docType: "tuple", created: 1001 },
            children: ["label_no_name", "value1"],
          } as NodeDump,
        ],
        [
          "label_no_name",
          {
            id: "label_no_name",
            props: { created: 1002 },
            // No name property
          } as NodeDump,
        ],
        [
          "value1",
          {
            id: "value1",
            props: { name: "", created: 1003 },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("tagdef1")!;
      const fields = extractFieldsFromTagDef(tagDef, nodes);

      expect(fields.length).toBe(0);
    });

    it("should return empty array for tagDef without children", () => {
      const nodes = new Map<string, NodeDump>([
        [
          "tagdef1",
          {
            id: "tagdef1",
            props: { name: "test", _docType: "tagDef", created: 1000 },
            // No children property
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("tagdef1")!;
      const fields = extractFieldsFromTagDef(tagDef, nodes);

      expect(fields.length).toBe(0);
    });

    it("should extract SYS_A90 as Date system field", () => {
      // Real Tana exports have SYS_A90 as first child of tuple for Date field
      // SYS_A90 is a raw string marker, NOT a node ID
      const nodes = new Map<string, NodeDump>([
        [
          "meeting-tagdef",
          {
            id: "meeting-tagdef",
            props: { name: "meeting", _docType: "tagDef", created: 1000 },
            children: ["date-tuple", "regular-tuple"],
          } as NodeDump,
        ],
        [
          "date-tuple",
          {
            id: "date-tuple",
            props: { _docType: "tuple", created: 1001 },
            // SYS_A90 is a raw string marker for Date field
            children: ["SYS_A90", "date-value"],
          } as NodeDump,
        ],
        // NOTE: NO node with id="SYS_A90" exists - it's a raw string!
        [
          "date-value",
          {
            id: "date-value",
            props: {
              name: '<span data-inlineref-date="..."></span>',
              created: 1002,
            },
          } as NodeDump,
        ],
        [
          "regular-tuple",
          {
            id: "regular-tuple",
            props: { _docType: "tuple", created: 1003 },
            children: ["location-label", "location-value"],
          } as NodeDump,
        ],
        [
          "location-label",
          {
            id: "location-label",
            props: { name: "Location", created: 1004 },
          } as NodeDump,
        ],
        [
          "location-value",
          {
            id: "location-value",
            props: { name: "", created: 1005 },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("meeting-tagdef")!;
      const fields = extractFieldsFromTagDef(tagDef, nodes);

      expect(fields.length).toBe(2);
      expect(fields[0].fieldName).toBe("Date");
      expect(fields[0].fieldLabelId).toBe("SYS_A90"); // System field marker
      expect(fields[1].fieldName).toBe("Location");
      expect(fields[1].fieldLabelId).toBe("location-label");
    });

    it("should extract Mp2A7_2PQw as Attendees system field", () => {
      // Real Tana exports use Mp2A7_2PQw marker for Attendees field
      const nodes = new Map<string, NodeDump>([
        [
          "meeting-tagdef",
          {
            id: "meeting-tagdef",
            props: { name: "meeting", _docType: "tagDef", created: 1000 },
            children: ["attendees-tuple"],
          } as NodeDump,
        ],
        [
          "attendees-tuple",
          {
            id: "attendees-tuple",
            props: { _docType: "tuple", created: 1001 },
            // Mp2A7_2PQw is a raw string marker for Attendees field
            children: ["Mp2A7_2PQw", "attendee-value"],
          } as NodeDump,
        ],
        // NOTE: NO node with id="Mp2A7_2PQw" exists - it's a raw string!
        [
          "attendee-value",
          {
            id: "attendee-value",
            props: { name: "", created: 1002 },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("meeting-tagdef")!;
      const fields = extractFieldsFromTagDef(tagDef, nodes);

      expect(fields.length).toBe(1);
      expect(fields[0].fieldName).toBe("Attendees");
      expect(fields[0].fieldLabelId).toBe("Mp2A7_2PQw");
    });

    it("should extract SYS_A61 as Due Date system field", () => {
      // SYS_A61 appears on task/todo supertags
      const nodes = new Map<string, NodeDump>([
        [
          "task-tagdef",
          {
            id: "task-tagdef",
            props: { name: "task", _docType: "tagDef", created: 1000 },
            children: ["due-tuple"],
          } as NodeDump,
        ],
        [
          "due-tuple",
          {
            id: "due-tuple",
            props: { _docType: "tuple", created: 1001 },
            children: ["SYS_A61", "due-value"],
          } as NodeDump,
        ],
        [
          "due-value",
          {
            id: "due-value",
            props: {
              name: '<span data-inlineref-date="..."></span>',
              created: 1002,
            },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("task-tagdef")!;
      const fields = extractFieldsFromTagDef(tagDef, nodes);

      expect(fields.length).toBe(1);
      expect(fields[0].fieldName).toBe("Due Date");
      expect(fields[0].fieldLabelId).toBe("SYS_A61");
    });

    it("should handle real-world bp-room pattern with 4 fields", () => {
      // Simulating bp-room supertag structure from Tana
      const nodes = new Map<string, NodeDump>([
        [
          "bp-room-tagdef",
          {
            id: "bp-room-tagdef",
            props: { name: "bp-room", _docType: "tagDef", created: 1000 },
            children: ["t1", "t2", "t3", "t4"],
          } as NodeDump,
        ],
        [
          "t1",
          {
            id: "t1",
            props: { _docType: "tuple", created: 1001 },
            children: ["l1", "v1"],
          } as NodeDump,
        ],
        [
          "l1",
          { id: "l1", props: { name: "Word Paintings", created: 1 } } as NodeDump,
        ],
        ["v1", { id: "v1", props: { name: "", created: 1 } } as NodeDump],
        [
          "t2",
          {
            id: "t2",
            props: { _docType: "tuple", created: 1002 },
            children: ["l2", "v2"],
          } as NodeDump,
        ],
        [
          "l2",
          { id: "l2", props: { name: "Chess Piece", created: 1 } } as NodeDump,
        ],
        ["v2", { id: "v2", props: { name: "", created: 1 } } as NodeDump],
        [
          "t3",
          {
            id: "t3",
            props: { _docType: "tuple", created: 1003 },
            children: ["l3", "v3"],
          } as NodeDump,
        ],
        [
          "l3",
          { id: "l3", props: { name: "Items", created: 1 } } as NodeDump,
        ],
        ["v3", { id: "v3", props: { name: "", created: 1 } } as NodeDump],
        [
          "t4",
          {
            id: "t4",
            props: { _docType: "tuple", created: 1004 },
            children: ["l4", "v4"],
          } as NodeDump,
        ],
        [
          "l4",
          { id: "l4", props: { name: "Room Number", created: 1 } } as NodeDump,
        ],
        ["v4", { id: "v4", props: { name: "", created: 1 } } as NodeDump],
      ]);

      const tagDef = nodes.get("bp-room-tagdef")!;
      const fields = extractFieldsFromTagDef(tagDef, nodes);

      expect(fields.length).toBe(4);
      expect(fields.map((f) => f.fieldName)).toEqual([
        "Word Paintings",
        "Chess Piece",
        "Items",
        "Room Number",
      ]);
    });
  });

  describe("extractParentsFromTagDef", () => {
    it("should extract parent tagDef IDs from metaNode tuples", () => {
      // Structure: tagDef -> _metaNodeId -> metaNode -> tuple with SYS_A13 -> parent IDs
      const nodes = new Map<string, NodeDump>([
        [
          "child-tagdef",
          {
            id: "child-tagdef",
            props: {
              name: "outcome-goal",
              _docType: "tagDef",
              _metaNodeId: "meta1",
              created: 1000,
            },
          } as NodeDump,
        ],
        [
          "meta1",
          {
            id: "meta1",
            props: { _docType: "metaNode", created: 1001 },
            children: ["meta-tuple1"],
          } as NodeDump,
        ],
        [
          "meta-tuple1",
          {
            id: "meta-tuple1",
            props: { _docType: "tuple", created: 1002 },
            children: ["SYS_A13", "parent1", "parent2"],
          } as NodeDump,
        ],
        [
          "SYS_A13",
          {
            id: "SYS_A13",
            props: { name: "SYS_A13", created: 1003 },
          } as NodeDump,
        ],
        [
          "parent1",
          {
            id: "parent1",
            props: { name: "goal-base", _docType: "tagDef", created: 1004 },
          } as NodeDump,
        ],
        [
          "parent2",
          {
            id: "parent2",
            props: {
              name: "#Stream | Objectives",
              _docType: "tagDef",
              created: 1005,
            },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("child-tagdef")!;
      const parents = extractParentsFromTagDef(tagDef, nodes);

      expect(parents.length).toBe(2);
      expect(parents).toContain("parent1");
      expect(parents).toContain("parent2");
    });

    it("should return empty array for tagDef without metaNode", () => {
      const nodes = new Map<string, NodeDump>([
        [
          "tagdef1",
          {
            id: "tagdef1",
            props: { name: "test", _docType: "tagDef", created: 1000 },
            // No _metaNodeId
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("tagdef1")!;
      const parents = extractParentsFromTagDef(tagDef, nodes);

      expect(parents.length).toBe(0);
    });

    it("should return empty array for metaNode without SYS_A13 tuple", () => {
      const nodes = new Map<string, NodeDump>([
        [
          "tagdef1",
          {
            id: "tagdef1",
            props: {
              name: "test",
              _docType: "tagDef",
              _metaNodeId: "meta1",
              created: 1000,
            },
          } as NodeDump,
        ],
        [
          "meta1",
          {
            id: "meta1",
            props: { _docType: "metaNode", created: 1001 },
            children: ["other-tuple"],
          } as NodeDump,
        ],
        [
          "other-tuple",
          {
            id: "other-tuple",
            props: { _docType: "tuple", created: 1002 },
            children: ["not_sys_a13", "some_node"],
          } as NodeDump,
        ],
        [
          "not_sys_a13",
          {
            id: "not_sys_a13",
            props: { name: "other_marker", created: 1003 },
          } as NodeDump,
        ],
        [
          "some_node",
          {
            id: "some_node",
            props: { name: "node", created: 1004 },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("tagdef1")!;
      const parents = extractParentsFromTagDef(tagDef, nodes);

      expect(parents.length).toBe(0);
    });

    it("should only include children that are tagDef nodes", () => {
      // SYS_A13 tuple might contain non-tagDef nodes
      const nodes = new Map<string, NodeDump>([
        [
          "child-tagdef",
          {
            id: "child-tagdef",
            props: {
              name: "test",
              _docType: "tagDef",
              _metaNodeId: "meta1",
              created: 1000,
            },
          } as NodeDump,
        ],
        [
          "meta1",
          {
            id: "meta1",
            props: { _docType: "metaNode", created: 1001 },
            children: ["meta-tuple1"],
          } as NodeDump,
        ],
        [
          "meta-tuple1",
          {
            id: "meta-tuple1",
            props: { _docType: "tuple", created: 1002 },
            children: ["SYS_A13", "parent1", "not_tagdef"],
          } as NodeDump,
        ],
        [
          "SYS_A13",
          {
            id: "SYS_A13",
            props: { name: "SYS_A13", created: 1003 },
          } as NodeDump,
        ],
        [
          "parent1",
          {
            id: "parent1",
            props: { name: "real-parent", _docType: "tagDef", created: 1004 },
          } as NodeDump,
        ],
        [
          "not_tagdef",
          {
            id: "not_tagdef",
            props: { name: "regular node", created: 1005 },
            // Not a tagDef
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("child-tagdef")!;
      const parents = extractParentsFromTagDef(tagDef, nodes);

      expect(parents.length).toBe(1);
      expect(parents[0]).toBe("parent1");
    });

    it("should handle multiple inheritance (diamond pattern)", () => {
      // meeting inherits from calendar-item, entity, and collaboratable
      const nodes = new Map<string, NodeDump>([
        [
          "meeting-tagdef",
          {
            id: "meeting-tagdef",
            props: {
              name: "meeting",
              _docType: "tagDef",
              _metaNodeId: "meeting-meta",
              created: 1000,
            },
          } as NodeDump,
        ],
        [
          "meeting-meta",
          {
            id: "meeting-meta",
            props: { _docType: "metaNode", created: 1001 },
            children: ["extends-tuple"],
          } as NodeDump,
        ],
        [
          "extends-tuple",
          {
            id: "extends-tuple",
            props: { _docType: "tuple", created: 1002 },
            children: ["SYS_A13", "calendar-item", "entity", "collaboratable"],
          } as NodeDump,
        ],
        [
          "SYS_A13",
          { id: "SYS_A13", props: { name: "SYS_A13", created: 1 } } as NodeDump,
        ],
        [
          "calendar-item",
          {
            id: "calendar-item",
            props: { name: "calendar-item", _docType: "tagDef", created: 1 },
          } as NodeDump,
        ],
        [
          "entity",
          {
            id: "entity",
            props: { name: "entity", _docType: "tagDef", created: 1 },
          } as NodeDump,
        ],
        [
          "collaboratable",
          {
            id: "collaboratable",
            props: { name: "collaboratable", _docType: "tagDef", created: 1 },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("meeting-tagdef")!;
      const parents = extractParentsFromTagDef(tagDef, nodes);

      expect(parents.length).toBe(3);
      expect(parents).toContain("calendar-item");
      expect(parents).toContain("entity");
      expect(parents).toContain("collaboratable");
    });

    it("should handle raw string SYS_A13 marker (real Tana export format)", () => {
      // In REAL Tana exports, SYS_A13 is a raw string in children[], NOT a node ID
      // The tuple.children is like: ["SYS_A13", "SYS_T01", "BpyXUrxqwJ3Q"]
      // where SYS_A13 and SYS_T01 are raw strings (no corresponding nodes),
      // and BpyXUrxqwJ3Q is an actual tagDef node ID
      const nodes = new Map<string, NodeDump>([
        [
          "meeting-tagdef",
          {
            id: "meeting-tagdef",
            props: {
              name: "meeting",
              _docType: "tagDef",
              _metaNodeId: "meeting-meta",
              created: 1000,
            },
          } as NodeDump,
        ],
        [
          "meeting-meta",
          {
            id: "meeting-meta",
            props: { _docType: "metaNode", created: 1001 },
            children: ["extends-tuple"],
          } as NodeDump,
        ],
        [
          "extends-tuple",
          {
            id: "extends-tuple",
            props: { _docType: "tuple", created: 1002 },
            // Real Tana structure: raw string markers + actual tagDef IDs
            // SYS_A13 = inheritance marker (raw string, NOT a node)
            // SYS_T01, SYS_T98 = system tag refs (raw strings, NOT nodes)
            // parent-tagdef = actual parent tagDef node ID
            children: ["SYS_A13", "SYS_T01", "SYS_T98", "parent-tagdef"],
          } as NodeDump,
        ],
        // NOTE: NO node with id="SYS_A13" exists - it's a raw string marker!
        // NOTE: NO nodes for SYS_T01, SYS_T98 exist - they're system refs!
        [
          "parent-tagdef",
          {
            id: "parent-tagdef",
            props: {
              name: "Stream | Professional",
              _docType: "tagDef",
              created: 1,
            },
          } as NodeDump,
        ],
      ]);

      const tagDef = nodes.get("meeting-tagdef")!;
      const parents = extractParentsFromTagDef(tagDef, nodes);

      // Should find the one real parent tagDef
      // SYS_T01 and SYS_T98 are system refs that don't resolve to nodes
      expect(parents.length).toBe(1);
      expect(parents[0]).toBe("parent-tagdef");
    });

    it("should skip system references that do not resolve to nodes", () => {
      // Real exports have system refs like SYS_T01, SYS_T98 in SYS_A13 tuple
      // These are NOT node IDs - they're built-in Tana system tag references
      const nodes = new Map<string, NodeDump>([
        [
          "child-tagdef",
          {
            id: "child-tagdef",
            props: {
              name: "child-tag",
              _docType: "tagDef",
              _metaNodeId: "meta1",
              created: 1000,
            },
          } as NodeDump,
        ],
        [
          "meta1",
          {
            id: "meta1",
            props: { _docType: "metaNode", created: 1001 },
            children: ["inherit-tuple"],
          } as NodeDump,
        ],
        [
          "inherit-tuple",
          {
            id: "inherit-tuple",
            props: { _docType: "tuple", created: 1002 },
            // Only system refs, no real parent tagDefs
            children: ["SYS_A13", "SYS_T01", "SYS_T98"],
          } as NodeDump,
        ],
        // No nodes for any of these IDs - they're all raw strings
      ]);

      const tagDef = nodes.get("child-tagdef")!;
      const parents = extractParentsFromTagDef(tagDef, nodes);

      // No real parent tagDefs found (only system refs)
      expect(parents.length).toBe(0);
    });
  });

  describe("extractSupertagMetadata", () => {
    let db: Database;

    beforeAll(() => {
      db = new Database(":memory:");
      migrateSupertagMetadataSchema(db);
    });

    afterAll(() => {
      db.close();
    });

    it("should extract and store fields and parents from all tagDefs", () => {
      // Create node set with 2 tagDefs - one with fields, one with parents
      const nodes = new Map<string, NodeDump>([
        // tagDef with fields
        [
          "tagdef1",
          {
            id: "tagdef1",
            props: { name: "contact", _docType: "tagDef", created: 1000 },
            children: ["field-tuple1", "field-tuple2"],
          } as NodeDump,
        ],
        [
          "field-tuple1",
          {
            id: "field-tuple1",
            props: { _docType: "tuple", created: 1001 },
            children: ["label1", "val1"],
          } as NodeDump,
        ],
        [
          "label1",
          { id: "label1", props: { name: "Email", created: 1 } } as NodeDump,
        ],
        ["val1", { id: "val1", props: { name: "", created: 1 } } as NodeDump],
        [
          "field-tuple2",
          {
            id: "field-tuple2",
            props: { _docType: "tuple", created: 1002 },
            children: ["label2", "val2"],
          } as NodeDump,
        ],
        [
          "label2",
          { id: "label2", props: { name: "Phone", created: 1 } } as NodeDump,
        ],
        ["val2", { id: "val2", props: { name: "", created: 1 } } as NodeDump],

        // tagDef with parent inheritance
        [
          "tagdef2",
          {
            id: "tagdef2",
            props: {
              name: "employee",
              _docType: "tagDef",
              _metaNodeId: "meta2",
              created: 2000,
            },
          } as NodeDump,
        ],
        [
          "meta2",
          {
            id: "meta2",
            props: { _docType: "metaNode", created: 2001 },
            children: ["extends-tuple2"],
          } as NodeDump,
        ],
        [
          "extends-tuple2",
          {
            id: "extends-tuple2",
            props: { _docType: "tuple", created: 2002 },
            children: ["SYS_A13", "tagdef1"],
          } as NodeDump,
        ],
        [
          "SYS_A13",
          { id: "SYS_A13", props: { name: "SYS_A13", created: 1 } } as NodeDump,
        ],

        // Regular node (not a tagDef)
        [
          "regular-node",
          {
            id: "regular-node",
            props: { name: "Just a note", created: 3000 },
          } as NodeDump,
        ],
      ]);

      // Clear any previous data
      db.run("DELETE FROM supertag_fields");
      db.run("DELETE FROM supertag_parents");

      const result = extractSupertagMetadata(nodes, db);

      // Should have processed 2 tagDefs
      expect(result.tagDefsProcessed).toBe(2);

      // Should have extracted 2 fields from contact
      expect(result.fieldsExtracted).toBe(2);

      // Should have extracted 1 parent relationship (employee -> contact)
      expect(result.parentsExtracted).toBe(1);

      // Verify fields in database
      const fieldRows = db
        .query("SELECT * FROM supertag_fields ORDER BY tag_name, field_order")
        .all() as Array<{
        tag_id: string;
        tag_name: string;
        field_name: string;
      }>;

      expect(fieldRows.length).toBe(2);
      expect(fieldRows[0].tag_name).toBe("contact");
      expect(fieldRows[0].field_name).toBe("Email");
      expect(fieldRows[1].field_name).toBe("Phone");

      // Verify parents in database
      const parentRows = db
        .query("SELECT * FROM supertag_parents")
        .all() as Array<{ child_tag_id: string; parent_tag_id: string }>;

      expect(parentRows.length).toBe(1);
      expect(parentRows[0].child_tag_id).toBe("tagdef2");
      expect(parentRows[0].parent_tag_id).toBe("tagdef1");
    });

    it("should handle duplicate extraction gracefully (UPSERT)", () => {
      const nodes = new Map<string, NodeDump>([
        [
          "tagdef1",
          {
            id: "tagdef1",
            props: { name: "test", _docType: "tagDef", created: 1000 },
            children: ["tuple1"],
          } as NodeDump,
        ],
        [
          "tuple1",
          {
            id: "tuple1",
            props: { _docType: "tuple", created: 1001 },
            children: ["label1", "val1"],
          } as NodeDump,
        ],
        [
          "label1",
          { id: "label1", props: { name: "Field1", created: 1 } } as NodeDump,
        ],
        ["val1", { id: "val1", props: { name: "", created: 1 } } as NodeDump],
      ]);

      // Clear and run twice
      db.run("DELETE FROM supertag_fields");
      db.run("DELETE FROM supertag_parents");

      extractSupertagMetadata(nodes, db);
      extractSupertagMetadata(nodes, db); // Should not throw

      // Should still have only 1 field (not duplicated)
      const count = db
        .query("SELECT COUNT(*) as count FROM supertag_fields")
        .get() as { count: number };
      expect(count.count).toBe(1);
    });

    it("should return zero counts for empty node map", () => {
      const nodes = new Map<string, NodeDump>();

      db.run("DELETE FROM supertag_fields");
      db.run("DELETE FROM supertag_parents");

      const result = extractSupertagMetadata(nodes, db);

      expect(result.tagDefsProcessed).toBe(0);
      expect(result.fieldsExtracted).toBe(0);
      expect(result.parentsExtracted).toBe(0);
    });
  });
});
