/**
 * Select Projection Tests
 * Spec: 059-universal-select-parameter
 * Task: T-1.1
 *
 * TDD tests for SelectPath and SelectProjection types and creation functions.
 */

import { describe, it, expect } from "bun:test";
import {
  type SelectPath,
  type SelectProjection,
  createSelectPath,
  createSelectProjection,
  parseSelectPaths,
  applyProjection,
  applyProjectionToArray,
} from "../../src/utils/select-projection";

describe("SelectPath", () => {
  describe("createSelectPath", () => {
    it("should create a path from a simple field name", () => {
      const path = createSelectPath("id");
      expect(path.raw).toBe("id");
      expect(path.segments).toEqual(["id"]);
    });

    it("should create a path from dot-notation", () => {
      const path = createSelectPath("fields.Status");
      expect(path.raw).toBe("fields.Status");
      expect(path.segments).toEqual(["fields", "Status"]);
    });

    it("should handle deeply nested paths", () => {
      const path = createSelectPath("ancestor.parent.name");
      expect(path.raw).toBe("ancestor.parent.name");
      expect(path.segments).toEqual(["ancestor", "parent", "name"]);
    });

    it("should trim whitespace from path", () => {
      const path = createSelectPath("  name  ");
      expect(path.raw).toBe("name");
      expect(path.segments).toEqual(["name"]);
    });

    it("should trim whitespace from segments", () => {
      const path = createSelectPath("fields . Status");
      expect(path.raw).toBe("fields . Status");
      expect(path.segments).toEqual(["fields", "Status"]);
    });
  });
});

describe("SelectProjection", () => {
  describe("createSelectProjection", () => {
    it("should return includeAll=true for undefined input", () => {
      const projection = createSelectProjection(undefined);
      expect(projection.includeAll).toBe(true);
      expect(projection.paths).toEqual([]);
    });

    it("should return includeAll=true for empty string", () => {
      const projection = createSelectProjection("");
      expect(projection.includeAll).toBe(true);
      expect(projection.paths).toEqual([]);
    });

    it("should return includeAll=true for empty array", () => {
      const projection = createSelectProjection([]);
      expect(projection.includeAll).toBe(true);
      expect(projection.paths).toEqual([]);
    });

    it("should parse comma-separated string", () => {
      const projection = createSelectProjection("id,name,rank");
      expect(projection.includeAll).toBe(false);
      expect(projection.paths).toHaveLength(3);
      expect(projection.paths[0].raw).toBe("id");
      expect(projection.paths[1].raw).toBe("name");
      expect(projection.paths[2].raw).toBe("rank");
    });

    it("should parse string array", () => {
      const projection = createSelectProjection(["id", "name", "fields.Status"]);
      expect(projection.includeAll).toBe(false);
      expect(projection.paths).toHaveLength(3);
      expect(projection.paths[0].segments).toEqual(["id"]);
      expect(projection.paths[1].segments).toEqual(["name"]);
      expect(projection.paths[2].segments).toEqual(["fields", "Status"]);
    });

    it("should handle mixed simple and nested paths", () => {
      const projection = createSelectProjection("id,fields.Status,ancestor.name");
      expect(projection.paths).toHaveLength(3);
      expect(projection.paths[0].segments).toEqual(["id"]);
      expect(projection.paths[1].segments).toEqual(["fields", "Status"]);
      expect(projection.paths[2].segments).toEqual(["ancestor", "name"]);
    });

    it("should filter out empty segments from comma-separated string", () => {
      const projection = createSelectProjection("id,,name,");
      expect(projection.paths).toHaveLength(2);
      expect(projection.paths[0].raw).toBe("id");
      expect(projection.paths[1].raw).toBe("name");
    });

    it("should trim whitespace around commas", () => {
      const projection = createSelectProjection("id , name , rank");
      expect(projection.paths).toHaveLength(3);
      expect(projection.paths[0].raw).toBe("id");
      expect(projection.paths[1].raw).toBe("name");
      expect(projection.paths[2].raw).toBe("rank");
    });
  });

  describe("parseSelectPaths", () => {
    it("should be an alias for createSelectProjection", () => {
      expect(parseSelectPaths).toBe(createSelectProjection);
    });

    it("should work the same as createSelectProjection", () => {
      const p1 = parseSelectPaths("id,name");
      const p2 = createSelectProjection("id,name");
      expect(p1.paths).toHaveLength(p2.paths.length);
      expect(p1.includeAll).toBe(p2.includeAll);
    });
  });
});

describe("applyProjection", () => {
  const testObj = {
    id: "abc123",
    name: "Test Node",
    rank: 0.95,
    tags: ["topic", "important"],
    fields: {
      Status: "Active",
      Priority: "High",
    },
    ancestor: {
      id: "parent1",
      name: "Parent Node",
      parent: {
        id: "grandparent1",
        name: "Grandparent Node",
      },
    },
  };

  it("should return original object when includeAll is true", () => {
    const projection = createSelectProjection(undefined);
    const result = applyProjection(testObj, projection);
    expect(result).toEqual(testObj);
  });

  it("should select simple top-level fields", () => {
    const projection = createSelectProjection("id,name");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({ id: "abc123", name: "Test Node" });
  });

  it("should select nested fields with dot notation", () => {
    const projection = createSelectProjection("fields.Status");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({ fields: { Status: "Active" } });
  });

  it("should select multiple nested fields from same parent", () => {
    const projection = createSelectProjection("fields.Status,fields.Priority");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({ fields: { Status: "Active", Priority: "High" } });
  });

  it("should select deeply nested fields", () => {
    const projection = createSelectProjection("ancestor.parent.name");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({
      ancestor: { parent: { name: "Grandparent Node" } },
    });
  });

  it("should mix simple and nested fields", () => {
    const projection = createSelectProjection("id,fields.Status,ancestor.name");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({
      id: "abc123",
      fields: { Status: "Active" },
      ancestor: { name: "Parent Node" },
    });
  });

  it("should return null for missing fields", () => {
    const projection = createSelectProjection("nonexistent");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({ nonexistent: null });
  });

  it("should return null for missing nested fields", () => {
    const projection = createSelectProjection("fields.NonExistent");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({ fields: { NonExistent: null } });
  });

  it("should return null when intermediate path is missing", () => {
    const projection = createSelectProjection("missing.nested.field");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({ missing: { nested: { field: null } } });
  });

  it("should preserve arrays in selection", () => {
    const projection = createSelectProjection("tags");
    const result = applyProjection(testObj, projection);
    expect(result).toEqual({ tags: ["topic", "important"] });
  });

  it("should handle empty object input", () => {
    const projection = createSelectProjection("id,name");
    const result = applyProjection({}, projection);
    expect(result).toEqual({ id: null, name: null });
  });

  it("should handle null values in object", () => {
    const objWithNull = { id: "1", value: null };
    const projection = createSelectProjection("id,value");
    const result = applyProjection(objWithNull, projection);
    expect(result).toEqual({ id: "1", value: null });
  });
});

describe("applyProjectionToArray", () => {
  const testArray = [
    { id: "1", name: "First", rank: 0.9, extra: true },
    { id: "2", name: "Second", rank: 0.8, extra: false },
    { id: "3", name: "Third", rank: 0.7, extra: true },
  ];

  it("should return original array when includeAll is true", () => {
    const projection = createSelectProjection(undefined);
    const result = applyProjectionToArray(testArray, projection);
    expect(result).toEqual(testArray);
  });

  it("should apply projection to each element", () => {
    const projection = createSelectProjection("id,name");
    const result = applyProjectionToArray(testArray, projection);
    expect(result).toEqual([
      { id: "1", name: "First" },
      { id: "2", name: "Second" },
      { id: "3", name: "Third" },
    ]);
  });

  it("should handle empty array", () => {
    const projection = createSelectProjection("id,name");
    const result = applyProjectionToArray([], projection);
    expect(result).toEqual([]);
  });

  it("should handle single element array", () => {
    const projection = createSelectProjection("id");
    const result = applyProjectionToArray([{ id: "only", name: "One" }], projection);
    expect(result).toEqual([{ id: "only" }]);
  });

  it("should handle nested fields in array elements", () => {
    const arrayWithNested = [
      { id: "1", fields: { Status: "Active" } },
      { id: "2", fields: { Status: "Pending" } },
    ];
    const projection = createSelectProjection("id,fields.Status");
    const result = applyProjectionToArray(arrayWithNested, projection);
    expect(result).toEqual([
      { id: "1", fields: { Status: "Active" } },
      { id: "2", fields: { Status: "Pending" } },
    ]);
  });

  it("should handle missing fields across elements", () => {
    const mixedArray = [
      { id: "1", name: "HasName" },
      { id: "2" }, // missing name
      { id: "3", name: "AlsoHasName" },
    ];
    const projection = createSelectProjection("id,name");
    const result = applyProjectionToArray(mixedArray, projection);
    expect(result).toEqual([
      { id: "1", name: "HasName" },
      { id: "2", name: null },
      { id: "3", name: "AlsoHasName" },
    ]);
  });
});
