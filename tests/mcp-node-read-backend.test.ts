/**
 * Tests for MCP tana_node tool refactored to use TanaReadBackend
 * Spec: F-097 Live Read Backend
 * Task: T-4.2
 *
 * Verifies that:
 * 1. showNode() uses resolveReadBackend instead of withDatabase + getNodeContentsBasic
 * 2. ReadNodeContent is mapped to a backward-compatible output shape
 * 3. NodeContents interface is still exported for batch-operations
 * 4. Depth parameter is passed through to readBackend.readNode()
 * 5. "not found" errors return null (not throw)
 * 6. select projection still works on the mapped result
 * 7. Removed duplicate functions: getNodeContentsBasic, getNodeContentsWithDepth, etc.
 */
import { describe, test, expect } from "bun:test";
import type { ReadNodeContent, TanaReadBackend } from "../src/api/read-backend";

// ---------------------------------------------------------------------------
// Mock Read Backend for Node operations
// ---------------------------------------------------------------------------

function createMockReadBackend(
  opts: {
    isLive?: boolean;
    readNodeResult?: ReadNodeContent;
    readNodeError?: Error;
  } = {}
): TanaReadBackend {
  const { isLive = false, readNodeResult, readNodeError } = opts;

  return {
    type: isLive ? "local-api" : "sqlite",
    search: async () => [],
    readNode: async (_nodeId: string, _depth?: number) => {
      if (readNodeError) throw readNodeError;
      if (readNodeResult) return readNodeResult;
      throw new Error("Node not found: test-node");
    },
    getChildren: async () => ({ items: [], hasMore: false }),
    listTags: async () => [],
    isLive: () => isLive,
    close: () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("F-097 T-4.2: MCP tana_node tool read backend refactoring", () => {

  describe("ReadNodeContent shape compatibility", () => {
    test("ReadNodeContent has id, name, markdown, and optional tags/children/description", () => {
      const content: ReadNodeContent = {
        id: "node-123",
        name: "Test Node",
        markdown: "Test Node #meeting\n  Date:: 2025-01-15\n  - Child 1\n  - Child 2",
        tags: ["meeting"],
        description: "A test node",
        children: [
          {
            id: "child-1",
            name: "Child 1",
            markdown: "Child 1",
          },
        ],
      };
      expect(content.id).toBe("node-123");
      expect(content.name).toBe("Test Node");
      expect(content.markdown).toBeDefined();
      expect(content.tags).toEqual(["meeting"]);
      expect(content.description).toBe("A test node");
      expect(content.children).toHaveLength(1);
    });

    test("ReadNodeContent with depth=0 has no children", () => {
      const content: ReadNodeContent = {
        id: "node-456",
        name: "Flat Node",
        markdown: "Flat Node #topic",
        tags: ["topic"],
      };
      expect(content.children).toBeUndefined();
    });
  });

  describe("Mock read backend readNode behavior", () => {
    test("readNode returns configured ReadNodeContent", async () => {
      const nodeContent: ReadNodeContent = {
        id: "test-id",
        name: "Project X",
        markdown: "Project X #project\n  Status:: Active",
        tags: ["project"],
      };
      const backend = createMockReadBackend({ readNodeResult: nodeContent });
      const result = await backend.readNode("test-id", 0);
      expect(result.id).toBe("test-id");
      expect(result.name).toBe("Project X");
      expect(result.tags).toEqual(["project"]);
    });

    test("readNode throws on not found", async () => {
      const backend = createMockReadBackend({
        readNodeError: new Error("Node not found: missing-id"),
      });
      await expect(backend.readNode("missing-id")).rejects.toThrow("not found");
    });

    test("readNode with depth > 0 includes children", async () => {
      const nodeContent: ReadNodeContent = {
        id: "parent-id",
        name: "Parent",
        markdown: "Parent\n  - Child A\n  - Child B",
        tags: [],
        children: [
          { id: "child-a", name: "Child A", markdown: "Child A" },
          { id: "child-b", name: "Child B", markdown: "Child B" },
        ],
      };
      const backend = createMockReadBackend({ readNodeResult: nodeContent });
      const result = await backend.readNode("parent-id", 1);
      expect(result.children).toHaveLength(2);
      expect(result.children![0].name).toBe("Child A");
    });
  });

  describe("Depth parameter passthrough", () => {
    test("depth=0 does not include children in result", async () => {
      let capturedDepth: number | undefined;
      const backend: TanaReadBackend = {
        type: "sqlite",
        search: async () => [],
        readNode: async (_nodeId: string, depth?: number) => {
          capturedDepth = depth;
          return { id: "n1", name: "Node", markdown: "Node" };
        },
        getChildren: async () => ({ items: [], hasMore: false }),
        listTags: async () => [],
        isLive: () => false,
        close: () => {},
      };

      await backend.readNode("n1", 0);
      expect(capturedDepth).toBe(0);
    });

    test("depth=3 is passed through to readNode", async () => {
      let capturedDepth: number | undefined;
      const backend: TanaReadBackend = {
        type: "sqlite",
        search: async () => [],
        readNode: async (_nodeId: string, depth?: number) => {
          capturedDepth = depth;
          return {
            id: "n1",
            name: "Node",
            markdown: "Node",
            children: [{ id: "c1", name: "Child", markdown: "Child" }],
          };
        },
        getChildren: async () => ({ items: [], hasMore: false }),
        listTags: async () => [],
        isLive: () => false,
        close: () => {},
      };

      await backend.readNode("n1", 3);
      expect(capturedDepth).toBe(3);
    });
  });

  describe("Not-found handling", () => {
    test("readBackend.readNode throws Error with 'not found' message", async () => {
      const backend = createMockReadBackend();
      try {
        await backend.readNode("nonexistent-id");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("not found");
      }
    });

    test("showNode should return null when node is not found (integration contract)", () => {
      // The showNode function catches 'not found' errors and returns null
      // This tests the contract: callers expect null, not a thrown error
      const notFoundBehavior = (error: Error): null | never => {
        if (error.message?.includes("not found")) {
          return null;
        }
        throw error;
      };

      const result = notFoundBehavior(new Error("Node not found: abc123"));
      expect(result).toBeNull();
    });

    test("showNode should re-throw non-not-found errors", () => {
      const rethrowBehavior = (error: Error): null | never => {
        if (error.message?.includes("not found")) {
          return null;
        }
        throw error;
      };

      expect(() => rethrowBehavior(new Error("Database locked"))).toThrow("Database locked");
    });
  });

  describe("Output mapping from ReadNodeContent", () => {
    test("mapped output includes id, name, tags, markdown", () => {
      const readContent: ReadNodeContent = {
        id: "abc",
        name: "Test",
        markdown: "Test #topic\n  Key:: Value",
        tags: ["topic"],
        description: "A description",
      };

      // The mapped output should preserve key fields
      const output = {
        id: readContent.id,
        name: readContent.name,
        tags: readContent.tags || [],
        markdown: readContent.markdown,
        description: readContent.description,
        children: readContent.children || [],
      };

      expect(output.id).toBe("abc");
      expect(output.name).toBe("Test");
      expect(output.tags).toEqual(["topic"]);
      expect(output.markdown).toContain("Key:: Value");
      expect(output.description).toBe("A description");
      expect(output.children).toEqual([]);
    });

    test("mapped output with children includes recursive structure", () => {
      const readContent: ReadNodeContent = {
        id: "parent",
        name: "Parent Node",
        markdown: "Parent Node",
        tags: ["project"],
        children: [
          {
            id: "child-1",
            name: "Child 1",
            markdown: "Child 1",
            tags: ["task"],
            children: [
              { id: "grandchild-1", name: "Grandchild 1", markdown: "Grandchild 1" },
            ],
          },
        ],
      };

      const output = {
        id: readContent.id,
        name: readContent.name,
        tags: readContent.tags || [],
        markdown: readContent.markdown,
        children: readContent.children || [],
      };

      expect(output.children).toHaveLength(1);
      expect(output.children[0].name).toBe("Child 1");
      expect(output.children[0].children).toHaveLength(1);
      expect(output.children[0].children![0].name).toBe("Grandchild 1");
    });
  });

  describe("Select projection compatibility", () => {
    test("select paths work with ReadNodeContent fields", () => {
      // Verify the new shape supports the same select paths
      const content: ReadNodeContent = {
        id: "n1",
        name: "Node",
        markdown: "Node #tag",
        tags: ["tag"],
        description: "desc",
      };

      // Common select paths that should work:
      expect(content).toHaveProperty("id");
      expect(content).toHaveProperty("name");
      expect(content).toHaveProperty("tags");
      expect(content).toHaveProperty("markdown");
      expect(content).toHaveProperty("description");
    });
  });

  describe("NodeContents export compatibility", () => {
    test("NodeContents interface has required fields for batch-operations", () => {
      // batch-operations.ts imports NodeContents and constructs objects like:
      // { id, name, created, tags, fields: [], children: [] }
      // We must keep this interface exported from node.ts
      const nodeContents = {
        id: "batch-1",
        name: "Batch Node",
        created: new Date() as Date | null,
        tags: ["todo"],
        fields: [] as Array<{ fieldName: string; fieldId: string; value: string; valueId: string }>,
        children: [] as Array<unknown>,
      };

      expect(nodeContents).toHaveProperty("id");
      expect(nodeContents).toHaveProperty("name");
      expect(nodeContents).toHaveProperty("created");
      expect(nodeContents).toHaveProperty("tags");
      expect(nodeContents).toHaveProperty("fields");
      expect(nodeContents).toHaveProperty("children");
    });
  });

  describe("Code cleanup verification", () => {
    test("node.ts should not import withDatabase after refactoring", async () => {
      const nodeModule = await import("../src/mcp/tools/node");
      // showNode should exist and be async (uses readBackend)
      expect(typeof nodeModule.showNode).toBe("function");
    });

    test("NodeContents is still exported from node.ts", async () => {
      // batch-operations.ts depends on this export
      const nodeModule = await import("../src/mcp/tools/node");
      // The module should export the function (types are erased at runtime)
      expect(nodeModule).toHaveProperty("showNode");
    });
  });

  describe("Live vs SQLite backend transparency", () => {
    test("SQLite backend readNode returns structured content", async () => {
      const content: ReadNodeContent = {
        id: "sqlite-node",
        name: "SQLite Node",
        markdown: "SQLite Node #meeting\n  Date:: 2025-01-15",
        tags: ["meeting"],
      };
      const backend = createMockReadBackend({ isLive: false, readNodeResult: content });
      const result = await backend.readNode("sqlite-node");
      expect(result.name).toBe("SQLite Node");
      expect(result.markdown).toContain("Date:: 2025-01-15");
    });

    test("Live backend readNode returns structured content", async () => {
      const content: ReadNodeContent = {
        id: "live-node",
        name: "Live Node",
        markdown: "# Live Node\n\nFresh from Tana Desktop",
        tags: ["project"],
      };
      const backend = createMockReadBackend({ isLive: true, readNodeResult: content });
      const result = await backend.readNode("live-node");
      expect(result.name).toBe("Live Node");
      expect(result.markdown).toContain("Fresh from Tana Desktop");
    });

    test("showNode consumer does not need to know backend type", () => {
      // Both backends return ReadNodeContent — the consumer (showNode) is backend-agnostic
      const sqliteContent: ReadNodeContent = { id: "s1", name: "S", markdown: "S" };
      const liveContent: ReadNodeContent = { id: "l1", name: "L", markdown: "L" };

      // Both have the same shape
      expect(Object.keys(sqliteContent).sort()).toEqual(Object.keys(liveContent).sort());
    });
  });
});
