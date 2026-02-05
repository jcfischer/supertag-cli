/**
 * Tests for LocalApiReadBackend
 * Spec: F-097 Live Read Backend
 * Task: T-2.1
 *
 * Tests the LocalApiReadBackend implementation which wraps LocalApiClient
 * and normalizes responses to canonical TanaReadBackend types.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { LocalApiReadBackend } from "../src/api/local-api-read-backend";
import type { LocalApiClient } from "../src/api/local-api-client";
import type { SearchResultNode, ReadNodeResponse, GetChildrenResponse, TagInfo } from "../src/types/local-api";

// =============================================================================
// Mock Factory
// =============================================================================

/**
 * Create a mock LocalApiClient with configurable return values.
 * All methods are stubs that can be individually overridden.
 */
function createMockClient(overrides: Partial<{
  searchNodes: LocalApiClient["searchNodes"];
  readNode: LocalApiClient["readNode"];
  getChildren: LocalApiClient["getChildren"];
  listTags: LocalApiClient["listTags"];
}> = {}): LocalApiClient {
  return {
    searchNodes: overrides.searchNodes ?? (async () => []),
    readNode: overrides.readNode ?? (async () => ({ markdown: "", name: "Untitled" })),
    getChildren: overrides.getChildren ?? (async () => ({ children: [], total: 0, hasMore: false })),
    listTags: overrides.listTags ?? (async () => []),
    // Stubs for methods not used by read backend
    health: async () => true,
    importTanaPaste: async () => ({ parentNodeId: "", targetNodeId: "", createdNodes: [], message: "" }),
    updateNode: async () => ({ nodeId: "", name: null, description: null, message: "" }),
    addTags: async () => ({ nodeId: "", results: [], message: "" }),
    removeTags: async () => ({ nodeId: "", results: [], message: "" }),
    setFieldContent: async () => ({ nodeId: "", attributeId: "", content: "", message: "" }),
    setFieldOption: async () => ({ nodeId: "", attributeId: "", optionId: "", message: "" }),
    checkNode: async () => ({ nodeId: "", name: "", done: true, message: "" }),
    uncheckNode: async () => ({ nodeId: "", name: "", done: false, message: "" }),
    trashNode: async () => ({ nodeId: "", name: "", message: "" }),
    createTag: async () => ({ tagId: "", name: "", message: "" }),
    getTagSchema: async () => ({ tagId: "", markdown: "" }),
    listWorkspaces: async () => [],
    getCalendarNode: async () => ({ nodeId: "" }),
  } as unknown as LocalApiClient;
}

/**
 * Create a SearchResultNode for testing.
 */
function makeSearchResult(overrides: Partial<SearchResultNode> = {}): SearchResultNode {
  return {
    id: "node-1",
    name: "Test Node",
    breadcrumb: ["Home", "Projects"],
    tags: [{ id: "tag-1", name: "meeting" }],
    tagIds: ["tag-1"],
    workspaceId: "ws-1",
    docType: "node",
    created: "2026-01-15T10:00:00.000Z",
    inTrash: false,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("F-097 T-2.1: LocalApiReadBackend", () => {
  const WORKSPACE_ID = "ws-test-123";

  describe("constructor and type", () => {
    test("type is local-api", () => {
      const client = createMockClient();
      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      expect(backend.type).toBe("local-api");
    });
  });

  describe("isLive()", () => {
    test("returns true", () => {
      const client = createMockClient();
      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      expect(backend.isLive()).toBe(true);
    });
  });

  describe("close()", () => {
    test("is a no-op and does not throw", () => {
      const client = createMockClient();
      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      expect(() => backend.close()).not.toThrow();
    });
  });

  // ===========================================================================
  // search()
  // ===========================================================================

  describe("search()", () => {
    test("calls searchNodes with textContains query", async () => {
      let capturedQuery: Record<string, unknown> | undefined;
      let capturedOptions: { limit?: number; offset?: number } | undefined;

      const client = createMockClient({
        searchNodes: async (query, options) => {
          capturedQuery = query;
          capturedOptions = options;
          return [];
        },
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      await backend.search("meeting notes");

      expect(capturedQuery).toEqual({ textContains: "meeting notes" });
    });

    test("passes limit and offset to searchNodes", async () => {
      let capturedOptions: { limit?: number; offset?: number } | undefined;

      const client = createMockClient({
        searchNodes: async (_query, options) => {
          capturedOptions = options;
          return [];
        },
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      await backend.search("test", { limit: 10, offset: 5 });

      expect(capturedOptions).toEqual({ limit: 10, offset: 5 });
    });

    test("normalizes SearchResultNode to ReadSearchResult", async () => {
      const client = createMockClient({
        searchNodes: async () => [
          makeSearchResult({
            id: "n-abc",
            name: "Q1 Planning",
            tags: [
              { id: "t-1", name: "meeting" },
              { id: "t-2", name: "project" },
            ],
            breadcrumb: ["Home", "Work", "Q1 Planning"],
            description: "Quarterly planning session",
            created: "2026-01-20T14:30:00.000Z",
          }),
        ],
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const results = await backend.search("planning");

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.id).toBe("n-abc");
      expect(result.name).toBe("Q1 Planning");
      expect(result.tags).toEqual(["meeting", "project"]);
      expect(result.breadcrumb).toEqual(["Home", "Work", "Q1 Planning"]);
      expect(result.description).toBe("Quarterly planning session");
      expect(result.created).toBe("2026-01-20T14:30:00.000Z");
      expect(result.rank).toBeUndefined(); // Local API does not provide FTS rank
    });

    test("handles nodes with no tags", async () => {
      const client = createMockClient({
        searchNodes: async () => [
          makeSearchResult({ tags: [], tagIds: [] }),
        ],
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const results = await backend.search("test");

      expect(results[0].tags).toEqual([]);
    });

    test("handles nodes with no description", async () => {
      const client = createMockClient({
        searchNodes: async () => [
          makeSearchResult({ description: undefined }),
        ],
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const results = await backend.search("test");

      expect(results[0].description).toBeUndefined();
    });

    test("returns empty array when no results", async () => {
      const client = createMockClient({
        searchNodes: async () => [],
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const results = await backend.search("nonexistent");

      expect(results).toEqual([]);
    });

    test("normalizes multiple results", async () => {
      const client = createMockClient({
        searchNodes: async () => [
          makeSearchResult({ id: "n-1", name: "First", tags: [{ id: "t-a", name: "alpha" }] }),
          makeSearchResult({ id: "n-2", name: "Second", tags: [{ id: "t-b", name: "beta" }] }),
          makeSearchResult({ id: "n-3", name: "Third", tags: [] }),
        ],
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const results = await backend.search("test");

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("n-1");
      expect(results[0].tags).toEqual(["alpha"]);
      expect(results[1].id).toBe("n-2");
      expect(results[1].tags).toEqual(["beta"]);
      expect(results[2].id).toBe("n-3");
      expect(results[2].tags).toEqual([]);
    });
  });

  // ===========================================================================
  // readNode()
  // ===========================================================================

  describe("readNode()", () => {
    test("calls client.readNode with nodeId and depth", async () => {
      let capturedNodeId: string | undefined;
      let capturedDepth: number | undefined;

      const client = createMockClient({
        readNode: async (nodeId, maxDepth) => {
          capturedNodeId = nodeId;
          capturedDepth = maxDepth;
          return { markdown: "# Test", name: "Test" };
        },
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      await backend.readNode("node-xyz", 3);

      expect(capturedNodeId).toBe("node-xyz");
      expect(capturedDepth).toBe(3);
    });

    test("maps ReadNodeResponse to ReadNodeContent", async () => {
      const client = createMockClient({
        readNode: async () => ({
          markdown: "# Meeting Notes\n\n- Item 1\n- Item 2",
          name: "Meeting Notes",
          description: "Weekly standup",
        }),
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const result = await backend.readNode("node-1");

      expect(result.id).toBe("node-1");
      expect(result.name).toBe("Meeting Notes");
      expect(result.markdown).toBe("# Meeting Notes\n\n- Item 1\n- Item 2");
      expect(result.description).toBe("Weekly standup");
    });

    test("handles missing name in response", async () => {
      const client = createMockClient({
        readNode: async () => ({
          markdown: "Some content",
          // name is optional in ReadNodeResponse
        }),
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const result = await backend.readNode("node-2");

      expect(result.id).toBe("node-2");
      expect(result.name).toBe(""); // Default to empty string when missing
      expect(result.markdown).toBe("Some content");
    });

    test("handles null description in response", async () => {
      const client = createMockClient({
        readNode: async () => ({
          markdown: "Content",
          name: "Test",
          description: null,
        }),
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const result = await backend.readNode("node-3");

      expect(result.description).toBeUndefined(); // null normalized to undefined
    });

    test("passes undefined depth when not specified", async () => {
      let capturedDepth: number | undefined = 999; // sentinel

      const client = createMockClient({
        readNode: async (_nodeId, maxDepth) => {
          capturedDepth = maxDepth;
          return { markdown: "", name: "Test" };
        },
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      await backend.readNode("node-1");

      expect(capturedDepth).toBeUndefined();
    });
  });

  // ===========================================================================
  // getChildren()
  // ===========================================================================

  describe("getChildren()", () => {
    test("calls client.getChildren with nodeId and options", async () => {
      let capturedNodeId: string | undefined;
      let capturedOptions: { limit?: number; offset?: number } | undefined;

      const client = createMockClient({
        getChildren: async (nodeId, options) => {
          capturedNodeId = nodeId;
          capturedOptions = options;
          return { children: [], total: 0, hasMore: false };
        },
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      await backend.getChildren("parent-1", { limit: 25, offset: 10 });

      expect(capturedNodeId).toBe("parent-1");
      expect(capturedOptions).toEqual({ limit: 25, offset: 10 });
    });

    test("normalizes children to ReadNodeContent[]", async () => {
      const client = createMockClient({
        getChildren: async () => ({
          children: [
            {
              id: "child-1",
              name: "First Child",
              tags: [{ id: "t-1", name: "task" }],
              tagIds: ["t-1"],
              childCount: 3,
              docType: "node",
              created: "2026-01-10T08:00:00.000Z",
              inTrash: false,
            },
            {
              id: "child-2",
              name: "Second Child",
              tags: [],
              tagIds: [],
              childCount: 0,
              docType: "node",
              created: "2026-01-11T09:00:00.000Z",
              inTrash: false,
            },
          ],
          total: 5,
          hasMore: true,
        }),
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const result = await backend.getChildren("parent-1");

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(true);

      // First child
      expect(result.items[0].id).toBe("child-1");
      expect(result.items[0].name).toBe("First Child");
      expect(result.items[0].markdown).toBe(""); // Children don't have markdown content
      expect(result.items[0].tags).toEqual(["task"]);

      // Second child
      expect(result.items[1].id).toBe("child-2");
      expect(result.items[1].name).toBe("Second Child");
      expect(result.items[1].tags).toEqual([]);
    });

    test("returns empty items when no children", async () => {
      const client = createMockClient({
        getChildren: async () => ({
          children: [],
          total: 0,
          hasMore: false,
        }),
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const result = await backend.getChildren("empty-node");

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    test("passes through description from children", async () => {
      const client = createMockClient({
        getChildren: async () => ({
          children: [
            {
              id: "child-desc",
              name: "With Description",
              tags: [],
              tagIds: [],
              childCount: 0,
              docType: "node",
              description: "A child with a description",
              created: "2026-01-12T10:00:00.000Z",
              inTrash: false,
            },
          ],
          total: 1,
          hasMore: false,
        }),
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const result = await backend.getChildren("parent-1");

      expect(result.items[0].description).toBe("A child with a description");
    });
  });

  // ===========================================================================
  // listTags()
  // ===========================================================================

  describe("listTags()", () => {
    test("calls client.listTags with workspaceId", async () => {
      let capturedWorkspaceId: string | undefined;
      let capturedLimit: number | undefined;

      const client = createMockClient({
        listTags: async (workspaceId, limit) => {
          capturedWorkspaceId = workspaceId;
          capturedLimit = limit;
          return [];
        },
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      await backend.listTags();

      expect(capturedWorkspaceId).toBe(WORKSPACE_ID);
    });

    test("passes limit option to client", async () => {
      let capturedLimit: number | undefined;

      const client = createMockClient({
        listTags: async (_ws, limit) => {
          capturedLimit = limit;
          return [];
        },
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      await backend.listTags({ limit: 50 });

      expect(capturedLimit).toBe(50);
    });

    test("normalizes TagInfo to ReadTagInfo", async () => {
      const client = createMockClient({
        listTags: async () => [
          { id: "tag-1", name: "meeting", color: "blue" },
          { id: "tag-2", name: "task", color: "red" },
          { id: "tag-3", name: "note" },
        ] as TagInfo[],
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const tags = await backend.listTags();

      expect(tags).toHaveLength(3);

      expect(tags[0].id).toBe("tag-1");
      expect(tags[0].name).toBe("meeting");
      expect(tags[0].color).toBe("blue");
      expect(tags[0].instanceCount).toBeUndefined(); // Local API doesn't provide instance count

      expect(tags[1].id).toBe("tag-2");
      expect(tags[1].name).toBe("task");
      expect(tags[1].color).toBe("red");

      expect(tags[2].id).toBe("tag-3");
      expect(tags[2].name).toBe("note");
      expect(tags[2].color).toBeUndefined();
    });

    test("returns empty array when no tags", async () => {
      const client = createMockClient({
        listTags: async () => [],
      });

      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);
      const tags = await backend.listTags();

      expect(tags).toEqual([]);
    });
  });

  // ===========================================================================
  // Interface compliance
  // ===========================================================================

  describe("TanaReadBackend interface compliance", () => {
    test("implements all required methods", () => {
      const client = createMockClient();
      const backend = new LocalApiReadBackend(client, WORKSPACE_ID);

      expect(typeof backend.search).toBe("function");
      expect(typeof backend.readNode).toBe("function");
      expect(typeof backend.getChildren).toBe("function");
      expect(typeof backend.listTags).toBe("function");
      expect(typeof backend.isLive).toBe("function");
      expect(typeof backend.close).toBe("function");
      expect(backend.type).toBe("local-api");
    });
  });
});
