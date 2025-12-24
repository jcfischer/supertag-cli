/**
 * Mermaid Renderer Tests
 *
 * TDD tests for rendering VisualizationData to Mermaid flowchart syntax.
 */

import { describe, it, expect } from "bun:test";
import { renderMermaid } from "../../../src/visualization/renderers/mermaid";
import type { VisualizationData } from "../../../src/visualization/types";

describe("renderMermaid", () => {
  const sampleData: VisualizationData = {
    nodes: [
      { id: "tag_entity", name: "entity", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: false },
      { id: "tag_person", name: "person", fieldCount: 3, usageCount: 804, isOrphan: false, isLeaf: true, color: "#B5D8FF" },
      { id: "tag_event", name: "event", fieldCount: 1, usageCount: 100, isOrphan: false, isLeaf: false },
      { id: "tag_meeting", name: "meeting", fieldCount: 4, usageCount: 2245, isOrphan: false, isLeaf: true },
    ],
    links: [
      { source: "tag_person", target: "tag_entity" },
      { source: "tag_event", target: "tag_entity" },
      { source: "tag_meeting", target: "tag_event" },
    ],
    metadata: {
      totalTags: 4,
      totalLinks: 3,
      maxDepth: 2,
      generatedAt: "2025-12-24T08:30:00Z",
      workspace: "main",
    },
  };

  it("should render valid Mermaid flowchart", () => {
    const result = renderMermaid(sampleData);

    // Should start with flowchart declaration
    expect(result).toContain("flowchart BT");

    // Should contain all node declarations
    expect(result).toContain("tag_entity");
    expect(result).toContain("tag_person");
    expect(result).toContain("tag_event");
    expect(result).toContain("tag_meeting");

    // Should contain all links
    expect(result).toContain("tag_person --> tag_entity");
    expect(result).toContain("tag_event --> tag_entity");
    expect(result).toContain("tag_meeting --> tag_event");
  });

  it("should support different directions", () => {
    const td = renderMermaid(sampleData, { direction: "TD" });
    expect(td).toContain("flowchart TD");

    const lr = renderMermaid(sampleData, { direction: "LR" });
    expect(lr).toContain("flowchart LR");

    const rl = renderMermaid(sampleData, { direction: "RL" });
    expect(rl).toContain("flowchart RL");
  });

  it("should show field count fallback when no field details available", () => {
    const result = renderMermaid(sampleData, { showFields: true });

    // Node labels should include field count (fallback since no fields array)
    expect(result).toMatch(/person.*3 fields/);
    expect(result).toMatch(/meeting.*4 fields/);
  });

  it("should show actual field names when fields array is available", () => {
    const dataWithFields = {
      ...sampleData,
      nodes: sampleData.nodes.map(n => n.id === "tag_person" ? {
        ...n,
        fields: [
          { name: "Name", dataType: "text", inherited: false },
          { name: "Email", dataType: "text", inherited: false },
          { name: "Company", dataType: "reference", inherited: true, originTag: "entity" },
        ]
      } : n),
    };

    const result = renderMermaid(dataWithFields, { showFields: true });

    // Should show own fields (Name, Email) but not inherited (Company) by default
    expect(result).toContain("Name: text");
    expect(result).toContain("Email: text");
    expect(result).not.toContain("Company");
  });

  it("should show inherited fields when showInheritedFields is true", () => {
    const dataWithFields = {
      ...sampleData,
      nodes: sampleData.nodes.map(n => n.id === "tag_person" ? {
        ...n,
        fields: [
          { name: "Name", dataType: "text", inherited: false },
          { name: "Company", dataType: "reference", inherited: true, originTag: "entity" },
        ]
      } : n),
    };

    const result = renderMermaid(dataWithFields, { showFields: true, showInheritedFields: true });

    // Should show both own and inherited fields
    expect(result).toContain("Name: text");
    expect(result).toContain("Company: reference (entity)");
  });

  it("should show usage counts when enabled", () => {
    const result = renderMermaid(sampleData, { showUsageCount: true });

    // Node labels should include usage count
    expect(result).toMatch(/person.*804/);
    expect(result).toMatch(/meeting.*2245/);
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

    const result = renderMermaid(empty);
    expect(result).toContain("flowchart BT");
    // Should have comment about empty graph
    expect(result).toContain("empty");
  });

  it("should escape special characters in node names", () => {
    const dataWithSpecialChars: VisualizationData = {
      nodes: [
        { id: "tag_special", name: "node-with-dash", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: true },
        { id: "tag_quote", name: "node'quote", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: true },
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

    const result = renderMermaid(dataWithSpecialChars);
    // Should not throw and should produce valid Mermaid
    expect(result).toContain("flowchart BT");
    expect(result).toContain("tag_special");
  });

  it("should use node name with # prefix in labels", () => {
    const result = renderMermaid(sampleData);

    // Labels should show #tagname format
    expect(result).toContain("#entity");
    expect(result).toContain("#person");
  });
});
