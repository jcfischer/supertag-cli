/**
 * Visualization Types Tests
 *
 * TDD tests for visualization type definitions and Zod schemas.
 */

import { describe, it, expect } from "bun:test";
import {
  VisualizationNodeSchema,
  VisualizationLinkSchema,
  VisualizationMetadataSchema,
  VisualizationDataSchema,
  VisualizationOptionsSchema,
  type VisualizationNode,
  type VisualizationLink,
  type VisualizationMetadata,
  type VisualizationData,
  type VisualizationOptions,
} from "../../src/visualization/types";

describe("VisualizationNode", () => {
  it("should validate a complete node", () => {
    const node: VisualizationNode = {
      id: "abc123xyz",
      name: "meeting",
      fieldCount: 4,
      usageCount: 2245,
      color: "#FF5733",
      isOrphan: false,
      isLeaf: true,
    };

    const result = VisualizationNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("meeting");
      expect(result.data.fieldCount).toBe(4);
    }
  });

  it("should validate a node without optional color", () => {
    const node = {
      id: "def456",
      name: "person",
      fieldCount: 3,
      usageCount: 804,
      isOrphan: false,
      isLeaf: true,
    };

    const result = VisualizationNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.color).toBeUndefined();
    }
  });

  it("should reject a node with missing required fields", () => {
    const incomplete = {
      id: "xyz789",
      name: "todo",
      // missing fieldCount, usageCount, isOrphan, isLeaf
    };

    const result = VisualizationNodeSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("should reject negative field counts", () => {
    const invalid = {
      id: "abc",
      name: "test",
      fieldCount: -1,
      usageCount: 10,
      isOrphan: false,
      isLeaf: false,
    };

    const result = VisualizationNodeSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("VisualizationLink", () => {
  it("should validate a valid link", () => {
    const link: VisualizationLink = {
      source: "child123",
      target: "parent456",
    };

    const result = VisualizationLinkSchema.safeParse(link);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe("child123");
      expect(result.data.target).toBe("parent456");
    }
  });

  it("should reject empty source or target", () => {
    const invalid = {
      source: "",
      target: "parent",
    };

    const result = VisualizationLinkSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("VisualizationMetadata", () => {
  it("should validate complete metadata", () => {
    const metadata: VisualizationMetadata = {
      totalTags: 576,
      totalLinks: 89,
      maxDepth: 4,
      generatedAt: "2025-12-24T08:30:00Z",
      workspace: "main",
    };

    const result = VisualizationMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
  });

  it("should validate metadata with optional rootTag", () => {
    const metadata = {
      totalTags: 100,
      totalLinks: 50,
      maxDepth: 3,
      rootTag: "entity",
      generatedAt: "2025-12-24T08:30:00Z",
      workspace: "main",
    };

    const result = VisualizationMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rootTag).toBe("entity");
    }
  });
});

describe("VisualizationData", () => {
  it("should validate complete visualization data", () => {
    const data: VisualizationData = {
      nodes: [
        { id: "a", name: "entity", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: false },
        { id: "b", name: "person", fieldCount: 3, usageCount: 804, isOrphan: false, isLeaf: true },
      ],
      links: [
        { source: "b", target: "a" },
      ],
      metadata: {
        totalTags: 2,
        totalLinks: 1,
        maxDepth: 1,
        generatedAt: "2025-12-24T08:30:00Z",
        workspace: "main",
      },
    };

    const result = VisualizationDataSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes).toHaveLength(2);
      expect(result.data.links).toHaveLength(1);
    }
  });

  it("should validate empty graph", () => {
    const empty: VisualizationData = {
      nodes: [],
      links: [],
      metadata: {
        totalTags: 0,
        totalLinks: 0,
        maxDepth: 0,
        generatedAt: "2025-12-24T08:30:00Z",
        workspace: "main",
      },
    };

    const result = VisualizationDataSchema.safeParse(empty);
    expect(result.success).toBe(true);
  });
});

describe("VisualizationOptions", () => {
  it("should validate default options (all optional)", () => {
    const options: VisualizationOptions = {};

    const result = VisualizationOptionsSchema.safeParse(options);
    expect(result.success).toBe(true);
  });

  it("should validate complete options", () => {
    const options: VisualizationOptions = {
      root: "entity",
      depth: 3,
      minUsage: 10,
      includeOrphans: true,
      workspace: "main",
    };

    const result = VisualizationOptionsSchema.safeParse(options);
    expect(result.success).toBe(true);
  });

  it("should reject negative depth", () => {
    const invalid = {
      depth: -1,
    };

    const result = VisualizationOptionsSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("should reject negative minUsage", () => {
    const invalid = {
      minUsage: -5,
    };

    const result = VisualizationOptionsSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
