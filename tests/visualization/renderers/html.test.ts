/**
 * HTML Renderer Tests
 *
 * TDD tests for the interactive HTML visualization renderer.
 */

import { describe, it, expect } from "bun:test";
import { renderHTML } from "../../../src/visualization/renderers/html";
import type { VisualizationData, HTMLRenderOptions } from "../../../src/visualization/types";

describe("renderHTML", () => {
  const sampleData: VisualizationData = {
    nodes: [
      {
        id: "tag_entity",
        name: "entity",
        fieldCount: 0,
        usageCount: 0,
        isOrphan: true,
        isLeaf: false,
      },
      {
        id: "tag_person",
        name: "person",
        fieldCount: 3,
        usageCount: 804,
        isOrphan: false,
        isLeaf: true,
        color: "#B5D8FF",
        fields: [
          { name: "Email", dataType: "text", inherited: false },
          { name: "Phone", dataType: "text", inherited: false },
          { name: "Name", dataType: "text", inherited: true, originTag: "entity" },
        ],
      },
    ],
    links: [{ source: "tag_person", target: "tag_entity" }],
    metadata: {
      totalTags: 2,
      totalLinks: 1,
      maxDepth: 1,
      generatedAt: "2025-12-24T10:00:00Z",
      workspace: "main",
    },
  };

  describe("basic HTML structure", () => {
    it("should return valid HTML document", () => {
      const html = renderHTML(sampleData);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
    });

    it("should be self-contained (no external dependencies)", () => {
      const html = renderHTML(sampleData);

      // Should not have external script or CSS links
      expect(html).not.toMatch(/<script[^>]+src=["']http/i);
      expect(html).not.toMatch(/<link[^>]+href=["']http/i);
    });

    it("should include embedded JavaScript for layout", () => {
      const html = renderHTML(sampleData);

      // Should have inline script with Dagre layout logic
      expect(html).toContain("<script>");
      expect(html).toContain("</script>");
    });

    it("should include embedded CSS styles", () => {
      const html = renderHTML(sampleData);

      expect(html).toContain("<style>");
      expect(html).toContain("</style>");
    });
  });

  describe("SVG generation", () => {
    it("should include SVG container", () => {
      const html = renderHTML(sampleData);

      expect(html).toContain("<svg");
      expect(html).toContain("</svg>");
    });

    it("should render node data as JSON for JavaScript processing", () => {
      const html = renderHTML(sampleData);

      // Data should be embedded for client-side rendering
      expect(html).toContain("tag_entity");
      expect(html).toContain("tag_person");
      expect(html).toContain("person");
    });
  });

  describe("UML-style nodes", () => {
    it("should include field information when showFields is true", () => {
      const html = renderHTML(sampleData, { showFields: true });

      expect(html).toContain("Email");
      expect(html).toContain("Phone");
    });

    it("should include inherited fields when showInheritedFields is true", () => {
      const html = renderHTML(sampleData, {
        showFields: true,
        showInheritedFields: true,
      });

      expect(html).toContain("Name");
      expect(html).toContain("entity"); // origin tag
    });
  });

  describe("render options", () => {
    it("should support dark theme", () => {
      const html = renderHTML(sampleData, { theme: "dark" });

      expect(html).toContain("dark");
    });

    it("should support light theme (default)", () => {
      const html = renderHTML(sampleData, { theme: "light" });

      expect(html).toContain("light");
    });

    it("should include direction in graph config", () => {
      const html = renderHTML(sampleData, { direction: "LR" });

      expect(html).toContain("LR");
    });
  });

  describe("interactive features", () => {
    it("should include pan and zoom handling", () => {
      const html = renderHTML(sampleData);

      // Should have zoom/pan related code
      expect(html).toContain("wheel");
      expect(html).toContain("mousedown");
    });

    it("should include click-to-highlight functionality", () => {
      const html = renderHTML(sampleData);

      expect(html).toContain("click");
    });
  });

  describe("metadata display", () => {
    it("should include workspace name", () => {
      const html = renderHTML(sampleData);

      expect(html).toContain("main");
    });

    it("should include generation timestamp", () => {
      const html = renderHTML(sampleData);

      expect(html).toContain("2025-12-24");
    });
  });

  describe("edge cases", () => {
    it("should handle empty graph", () => {
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

      const html = renderHTML(emptyData);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("empty");
    });

    it("should escape special characters in tag names", () => {
      const dataWithSpecialChars: VisualizationData = {
        ...sampleData,
        nodes: [
          {
            id: "tag_special",
            name: '<script>alert("xss")</script>',
            fieldCount: 0,
            usageCount: 0,
            isOrphan: true,
            isLeaf: true,
          },
        ],
        links: [],
      };

      const html = renderHTML(dataWithSpecialChars);
      // Should escape < and > to prevent XSS
      expect(html).not.toContain('<script>alert("xss")</script>');
    });
  });
});
