/**
 * Supertag Metadata Types Tests
 *
 * TDD tests for TypeScript interfaces used in supertag metadata storage.
 */

import { describe, it, expect } from "bun:test";
import type {
  SupertagField,
  SupertagParent,
  InheritedField,
  InheritanceNode,
  SupertagMetadataResult,
} from "../../src/types/supertag-metadata";

describe("Supertag Metadata Types", () => {
  describe("SupertagField", () => {
    it("should have all required properties for database storage", () => {
      const field: SupertagField = {
        id: 1,
        tagId: "tag123",
        tagName: "meeting",
        fieldName: "Location",
        fieldLabelId: "label456",
        fieldOrder: 0,
      };

      expect(field.id).toBe(1);
      expect(field.tagId).toBe("tag123");
      expect(field.tagName).toBe("meeting");
      expect(field.fieldName).toBe("Location");
      expect(field.fieldLabelId).toBe("label456");
      expect(field.fieldOrder).toBe(0);
    });
  });

  describe("SupertagParent", () => {
    it("should represent direct inheritance relationship", () => {
      const parent: SupertagParent = {
        id: 1,
        childTagId: "child123",
        parentTagId: "parent456",
      };

      expect(parent.id).toBe(1);
      expect(parent.childTagId).toBe("child123");
      expect(parent.parentTagId).toBe("parent456");
    });
  });

  describe("InheritedField", () => {
    it("should track field origin for inherited fields", () => {
      const inheritedField: InheritedField = {
        fieldName: "Status",
        fieldLabelId: "label789",
        originTagId: "parent456",
        originTagName: "base-entity",
        depth: 2,
      };

      expect(inheritedField.fieldName).toBe("Status");
      expect(inheritedField.originTagId).toBe("parent456");
      expect(inheritedField.originTagName).toBe("base-entity");
      expect(inheritedField.depth).toBe(2);
    });

    it("should have depth 0 for own fields", () => {
      const ownField: InheritedField = {
        fieldName: "Location",
        fieldLabelId: "label123",
        originTagId: "meeting123",
        originTagName: "meeting",
        depth: 0,
      };

      expect(ownField.depth).toBe(0);
    });
  });

  describe("InheritanceNode", () => {
    it("should support tree structure with nested parents", () => {
      const leaf: InheritanceNode = {
        tagId: "root123",
        tagName: "root",
        depth: 2,
        parents: [],
      };

      const middle: InheritanceNode = {
        tagId: "middle456",
        tagName: "middle",
        depth: 1,
        parents: [leaf],
      };

      const root: InheritanceNode = {
        tagId: "child789",
        tagName: "meeting",
        depth: 0,
        parents: [middle],
      };

      expect(root.tagName).toBe("meeting");
      expect(root.depth).toBe(0);
      expect(root.parents.length).toBe(1);
      expect(root.parents[0].tagName).toBe("middle");
      expect(root.parents[0].parents[0].tagName).toBe("root");
    });

    it("should support multiple parents (diamond inheritance)", () => {
      const parent1: InheritanceNode = {
        tagId: "p1",
        tagName: "parent1",
        depth: 1,
        parents: [],
      };

      const parent2: InheritanceNode = {
        tagId: "p2",
        tagName: "parent2",
        depth: 1,
        parents: [],
      };

      const child: InheritanceNode = {
        tagId: "child",
        tagName: "child",
        depth: 0,
        parents: [parent1, parent2],
      };

      expect(child.parents.length).toBe(2);
      expect(child.parents[0].tagName).toBe("parent1");
      expect(child.parents[1].tagName).toBe("parent2");
    });
  });

  describe("SupertagMetadataResult", () => {
    it("should aggregate field and inheritance information", () => {
      const result: SupertagMetadataResult = {
        tag: { id: "tag123", name: "meeting" },
        fields: {
          own: [
            { name: "Location", labelId: "loc123" },
            { name: "Duration", labelId: "dur456" },
          ],
          inherited: [
            { name: "Status", origin: "base-entity", depth: 1 },
            { name: "Created", origin: "root", depth: 2 },
          ],
        },
        inheritance: {
          directParents: [
            { id: "p1", name: "calendar-item" },
            { id: "p2", name: "entity" },
          ],
          allAncestors: [
            { id: "p1", name: "calendar-item", depth: 1 },
            { id: "p2", name: "entity", depth: 1 },
            { id: "root", name: "root", depth: 2 },
          ],
        },
      };

      expect(result.tag.name).toBe("meeting");
      expect(result.fields.own.length).toBe(2);
      expect(result.fields.inherited.length).toBe(2);
      expect(result.inheritance.directParents.length).toBe(2);
      expect(result.inheritance.allAncestors.length).toBe(3);
    });
  });
});
