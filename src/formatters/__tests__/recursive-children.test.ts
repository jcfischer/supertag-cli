/**
 * Test recursive children conversion for API
 */
import { describe, it, expect } from "bun:test";
import { tanaNodeToApiNode } from "../json";
import type { TanaNode } from "../../types";

describe("tanaNodeToApiNode - Recursive Children", () => {
  it("should recursively convert 3-level nested children", () => {
    const node: TanaNode = {
      name: "Project",
      children: [
        {
          name: "Phase 1",
          children: [
            {
              name: "Task 1.1",
              children: [
                { name: "Subtask 1.1.1" },
                { name: "Subtask 1.1.2" },
              ],
            },
          ],
        },
      ],
    };

    const apiNode = tanaNodeToApiNode(node);

    expect(apiNode.name).toBe("Project");
    expect(apiNode.children).toHaveLength(1);

    // Level 1
    const phase1 = apiNode.children![0] as any;
    expect(phase1.name).toBe("Phase 1");
    expect(phase1.children).toHaveLength(1);

    // Level 2
    const task11 = phase1.children![0] as any;
    expect(task11.name).toBe("Task 1.1");
    expect(task11.children).toHaveLength(2);

    // Level 3
    expect(task11.children![0].name).toBe("Subtask 1.1.1");
    expect(task11.children![1].name).toBe("Subtask 1.1.2");
  });

  it("should handle 4-level nesting", () => {
    const node: TanaNode = {
      name: "Root",
      children: [
        {
          name: "L1",
          children: [
            {
              name: "L2",
              children: [
                {
                  name: "L3",
                  children: [{ name: "L4" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const apiNode = tanaNodeToApiNode(node);

    // Navigate down 4 levels
    const l1 = (apiNode.children![0] as any);
    const l2 = (l1.children![0] as any);
    const l3 = (l2.children![0] as any);
    const l4 = (l3.children![0] as any);

    expect(l4.name).toBe("L4");
    expect(l4.children).toBeUndefined();
  });

  it("should preserve fields at all levels", () => {
    const node: TanaNode = {
      name: "Parent",
      fields: { Status: "Active" },
      children: [
        {
          name: "Child",
          fields: { Priority: "High" },
          children: [
            {
              name: "Grandchild",
              fields: { Tags: ["important"] },
            },
          ],
        },
      ],
    };

    const apiNode = tanaNodeToApiNode(node);

    expect(apiNode.description).toContain("Status: Active");

    const child = (apiNode.children![0] as any);
    expect(child.description).toContain("Priority: High");

    const grandchild = (child.children![0] as any);
    expect(grandchild.description).toContain("Tags: important");
  });
});
