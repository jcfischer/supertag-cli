/**
 * DOT Renderer Tests
 *
 * TDD tests for rendering VisualizationData to Graphviz DOT syntax.
 */

import { describe, it, expect } from "bun:test";
import { renderDOT } from "../../../src/visualization/renderers/dot";
import type { VisualizationData } from "../../../src/visualization/types";

describe("renderDOT", () => {
  const sampleData: VisualizationData = {
    nodes: [
      { id: "tag_entity", name: "entity", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: false, color: "#E8E8E8" },
      { id: "tag_person", name: "person", fieldCount: 3, usageCount: 804, isOrphan: false, isLeaf: true, color: "#B5D8FF" },
      { id: "tag_event", name: "event", fieldCount: 1, usageCount: 100, isOrphan: false, isLeaf: false, color: "#FFE4B5" },
      { id: "tag_meeting", name: "meeting", fieldCount: 4, usageCount: 2245, isOrphan: false, isLeaf: true, color: "#FFD700" },
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

  it("should render valid DOT digraph", () => {
    const result = renderDOT(sampleData);

    // Should start with digraph declaration
    expect(result).toContain("digraph supertags {");

    // Should have rankdir
    expect(result).toContain("rankdir=BT");

    // Should contain all node declarations
    expect(result).toContain("tag_entity");
    expect(result).toContain("tag_person");
    expect(result).toContain("tag_event");
    expect(result).toContain("tag_meeting");

    // Should contain all edges
    expect(result).toContain("tag_person -> tag_entity");
    expect(result).toContain("tag_event -> tag_entity");
    expect(result).toContain("tag_meeting -> tag_event");

    // Should close properly
    expect(result).toContain("}");
  });

  it("should support different rankdir options", () => {
    const tb = renderDOT(sampleData, { rankdir: "TB" });
    expect(tb).toContain("rankdir=TB");

    const lr = renderDOT(sampleData, { rankdir: "LR" });
    expect(lr).toContain("rankdir=LR");

    const rl = renderDOT(sampleData, { rankdir: "RL" });
    expect(rl).toContain("rankdir=RL");
  });

  it("should use colors when enabled", () => {
    const result = renderDOT(sampleData, { useColors: true });

    // Should include fillcolor for nodes with colors
    expect(result).toContain('fillcolor="#E8E8E8"');
    expect(result).toContain('fillcolor="#B5D8FF"');
    expect(result).toContain('fillcolor="#FFE4B5"');
    expect(result).toContain('fillcolor="#FFD700"');
  });

  it("should show field counts when enabled", () => {
    const result = renderDOT(sampleData, { showFieldCount: true });

    // Node labels should include field count
    expect(result).toMatch(/person.*3 fields/);
    expect(result).toMatch(/meeting.*4 fields/);
    expect(result).toMatch(/entity.*0 fields/);
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

    const result = renderDOT(empty);
    expect(result).toContain("digraph supertags {");
    // Should have a comment about empty graph
    expect(result).toContain("empty");
    expect(result).toContain("}");
  });

  it("should escape special characters in labels", () => {
    const dataWithSpecialChars: VisualizationData = {
      nodes: [
        { id: "tag_special", name: 'node"with"quotes', fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: true },
        { id: "tag_newline", name: "node\\nwith\\nslash", fieldCount: 0, usageCount: 0, isOrphan: true, isLeaf: true },
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

    const result = renderDOT(dataWithSpecialChars);
    // Should escape quotes in labels
    expect(result).not.toContain('label="#node"with"quotes"');
    // Should produce valid DOT
    expect(result).toContain("digraph supertags {");
  });

  it("should set node shape to box with rounded style", () => {
    const result = renderDOT(sampleData);

    expect(result).toContain("shape=box");
    expect(result).toContain("rounded");
  });

  it("should include default node style", () => {
    const result = renderDOT(sampleData);

    // Should have node defaults
    expect(result).toContain("node [");
    expect(result).toContain("fontname=");
  });
});
