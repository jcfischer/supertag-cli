/**
 * JSON Renderer Tests
 *
 * TDD tests for rendering VisualizationData to JSON format.
 */

import { describe, it, expect } from "bun:test";
import { renderJSON } from "../../../src/visualization/renderers/json";
import type { VisualizationData } from "../../../src/visualization/types";

describe("renderJSON", () => {
  const sampleData: VisualizationData = {
    nodes: [
      { id: "tag_entity", name: "entity", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: false },
      { id: "tag_person", name: "person", fieldCount: 3, usageCount: 804, isOrphan: false, isLeaf: true },
    ],
    links: [
      { source: "tag_person", target: "tag_entity" },
    ],
    metadata: {
      totalTags: 2,
      totalLinks: 1,
      maxDepth: 1,
      generatedAt: "2025-12-24T08:30:00Z",
      workspace: "main",
    },
  };

  it("should render valid JSON", () => {
    const result = renderJSON(sampleData);

    // Should be parseable JSON
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
    expect(parsed.nodes).toBeDefined();
    expect(parsed.links).toBeDefined();
    expect(parsed.metadata).toBeDefined();
  });

  it("should preserve all data in output", () => {
    const result = renderJSON(sampleData);
    const parsed = JSON.parse(result);

    // Check nodes
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0].id).toBe("tag_entity");
    expect(parsed.nodes[0].name).toBe("entity");
    expect(parsed.nodes[0].fieldCount).toBe(0);

    // Check links
    expect(parsed.links).toHaveLength(1);
    expect(parsed.links[0].source).toBe("tag_person");
    expect(parsed.links[0].target).toBe("tag_entity");

    // Check metadata
    expect(parsed.metadata.totalTags).toBe(2);
    expect(parsed.metadata.totalLinks).toBe(1);
    expect(parsed.metadata.workspace).toBe("main");
  });

  it("should pretty-print when enabled", () => {
    const pretty = renderJSON(sampleData, { pretty: true });
    const compact = renderJSON(sampleData, { pretty: false });

    // Pretty should have newlines and indentation
    expect(pretty).toContain("\n");
    expect(pretty.length).toBeGreaterThan(compact.length);

    // Both should be valid JSON
    expect(() => JSON.parse(pretty)).not.toThrow();
    expect(() => JSON.parse(compact)).not.toThrow();
  });

  it("should default to pretty printing", () => {
    const result = renderJSON(sampleData);

    // Default should be pretty
    expect(result).toContain("\n");
  });

  it("should handle empty graph", () => {
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

    const result = renderJSON(empty);
    const parsed = JSON.parse(result);

    expect(parsed.nodes).toHaveLength(0);
    expect(parsed.links).toHaveLength(0);
    expect(parsed.metadata.totalTags).toBe(0);
  });

  it("should handle special characters in names", () => {
    const dataWithSpecial: VisualizationData = {
      nodes: [
        { id: "tag_special", name: 'tag"with"quotes', fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: true },
        { id: "tag_unicode", name: "tag-mit-ümläuts", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: true },
      ],
      links: [],
      metadata: {
        totalTags: 2,
        totalLinks: 0,
        maxDepth: 0,
        generatedAt: "2025-12-24T08:30:00Z",
        workspace: "main",
      },
    };

    const result = renderJSON(dataWithSpecial);
    const parsed = JSON.parse(result);

    // Special characters should be preserved
    expect(parsed.nodes[0].name).toBe('tag"with"quotes');
    expect(parsed.nodes[1].name).toBe("tag-mit-ümläuts");
  });

  it("should include optional color field when present", () => {
    const dataWithColor: VisualizationData = {
      nodes: [
        { id: "tag_colored", name: "colored", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: true, color: "#FF5733" },
        { id: "tag_nocolor", name: "nocolor", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: true },
      ],
      links: [],
      metadata: {
        totalTags: 2,
        totalLinks: 0,
        maxDepth: 0,
        generatedAt: "2025-12-24T08:30:00Z",
        workspace: "main",
      },
    };

    const result = renderJSON(dataWithColor);
    const parsed = JSON.parse(result);

    expect(parsed.nodes[0].color).toBe("#FF5733");
    expect(parsed.nodes[1].color).toBeUndefined();
  });
});
