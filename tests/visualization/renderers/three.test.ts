/**
 * Three.js 3D Renderer Tests
 *
 * TDD tests for the 3D visualization renderer.
 */

import { describe, it, expect } from "bun:test";
import type { VisualizationData } from "../../../src/visualization/types";

// Sample test data
const sampleData: VisualizationData = {
  nodes: [
    {
      id: "tag_entity",
      name: "entity",
      fieldCount: 2,
      usageCount: 1000,
      color: "#3498db",
      isOrphan: true,
      isLeaf: false,
    },
    {
      id: "tag_person",
      name: "person",
      fieldCount: 3,
      usageCount: 500,
      color: "#e74c3c",
      isOrphan: false,
      isLeaf: true,
      fields: [
        { name: "Email", dataType: "text", inherited: false },
        { name: "Name", dataType: "text", inherited: true, originTag: "entity" },
      ],
    },
    {
      id: "tag_meeting",
      name: "meeting",
      fieldCount: 4,
      usageCount: 200,
      isOrphan: false,
      isLeaf: true,
    },
  ],
  links: [
    { source: "tag_person", target: "tag_entity" },
    { source: "tag_meeting", target: "tag_entity" },
  ],
  metadata: {
    totalTags: 3,
    totalLinks: 2,
    maxDepth: 1,
    generatedAt: "2025-12-24T10:00:00Z",
    workspace: "main",
  },
};

const emptyData: VisualizationData = {
  nodes: [],
  links: [],
  metadata: {
    totalTags: 0,
    totalLinks: 0,
    maxDepth: 0,
    generatedAt: "2025-12-24T10:00:00Z",
    workspace: "main",
  },
};

describe("render3D", () => {
  // Dynamic import to allow TDD approach
  const getRender3D = async () => {
    const mod = await import("../../../src/visualization/renderers/three");
    return mod.render3D;
  };

  it("should return valid HTML document", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("<html");
    expect(result).toContain("</html>");
    expect(result).toContain("<head>");
    expect(result).toContain("<body>");
  });

  it("should include title with workspace name", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    expect(result).toContain("<title>");
    expect(result).toContain("main");
  });

  it("should include canvas or container element", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    // Should have a container for Three.js
    expect(result).toMatch(/<div[^>]*id=["']?graph/i);
  });

  it("should serialize nodes data into JavaScript", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    // Should contain JSON-serialized node data
    expect(result).toContain("tag_entity");
    expect(result).toContain("tag_person");
    expect(result).toContain("tag_meeting");
    expect(result).toContain("entity");
    expect(result).toContain("person");
  });

  it("should serialize links data into JavaScript", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    // Links should be embedded
    expect(result).toContain("source");
    expect(result).toContain("target");
  });

  it("should include Three.js library code or reference", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    // Should have Three.js code (bundled) or reference
    expect(result).toMatch(/three|THREE|ForceGraph3D/i);
  });

  it("should handle empty data gracefully", async () => {
    const render3D = await getRender3D();
    const result = render3D(emptyData);

    expect(result).toContain("<!DOCTYPE html>");
    // Should still be valid HTML even with no nodes
    expect(result).toContain("</html>");
  });

  it("should apply light theme by default", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    // Light theme should be default (light background)
    expect(result).toMatch(/background[^;]*#f/i);
  });

  it("should apply dark theme when specified", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData, { theme: "dark" });

    // Dark theme should have dark background
    expect(result).toMatch(/background[^;]*#[012]/i);
  });

  it("should include metadata info panel", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    // Should display workspace and stats
    expect(result).toContain("main");
    expect(result).toContain("3"); // totalTags
    expect(result).toContain("2"); // totalLinks
  });

  it("should escape HTML in node names", async () => {
    const dataWithHtml: VisualizationData = {
      ...sampleData,
      nodes: [
        {
          id: "test",
          name: "<script>alert('xss')</script>",
          fieldCount: 0,
          usageCount: 0,
          isOrphan: true,
          isLeaf: true,
        },
      ],
      links: [],
    };

    const render3D = await getRender3D();
    const result = render3D(dataWithHtml);

    // Should not contain raw script tags
    expect(result).not.toContain("<script>alert");
    // Should be escaped
    expect(result).toMatch(/&lt;script&gt;|\\u003c|<\\\/script>/);
  });

  it("should set layout mode when specified", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData, { layout: "hierarchical" });

    // Should indicate hierarchical mode
    expect(result).toMatch(/hierarchical|dagMode|td/i);
  });

  it("should include force layout by default", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData);

    // Default is force-directed, should not have dagMode
    expect(result).toMatch(/force|forceEngine|d3/i);
  });
});

describe("render3D options", () => {
  const getRender3D = async () => {
    const mod = await import("../../../src/visualization/renderers/three");
    return mod.render3D;
  };

  it("should pass showFields option to tooltip handler", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData, { showFields: true });

    // When showFields is true, field data should be included
    expect(result).toContain("showFields");
  });

  it("should pass sizeByUsage option", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData, { sizeByUsage: true });

    expect(result).toContain("sizeByUsage");
  });

  it("should pass cameraDistance option", async () => {
    const render3D = await getRender3D();
    const result = render3D(sampleData, { cameraDistance: 2.5 });

    expect(result).toContain("2.5");
  });
});
