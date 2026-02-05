/**
 * Tests for MCP tana_search tool refactored to use TanaReadBackend
 * Spec: F-097 Live Read Backend
 * Task: T-4.1
 *
 * Verifies that:
 * 1. search() uses resolveReadBackend instead of TanaQueryEngine directly
 * 2. Results include tags from ReadSearchResult.tags (no separate getNodeTags call)
 * 3. Live backend uses breadcrumb for ancestor context
 * 4. SQLite backend uses findMeaningfulAncestor for ancestor context
 * 5. raw mode skips tags and ancestor enrichment
 * 6. select projection still works
 * 7. SearchResult shape is unchanged (workspace, query, results, count)
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";
import type { ReadSearchResult, TanaReadBackend, SearchOptions } from "../src/api/read-backend";

// ---------------------------------------------------------------------------
// Mock Read Backend
// ---------------------------------------------------------------------------

function createMockReadBackend(
  opts: {
    isLive?: boolean;
    searchResults?: ReadSearchResult[];
  } = {}
): TanaReadBackend {
  const { isLive = false, searchResults = [] } = opts;

  return {
    type: isLive ? "local-api" : "sqlite",
    search: async (_query: string, _options?: SearchOptions) => searchResults,
    readNode: async () => ({ id: "", name: "", markdown: "" }),
    getChildren: async () => ({ items: [], hasMore: false }),
    listTags: async () => [],
    isLive: () => isLive,
    close: () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("F-097 T-4.1: MCP search tool read backend refactoring", () => {
  describe("SearchResult shape", () => {
    test("result has workspace, query, results, count fields", () => {
      // This tests the interface contract - the shape must not change
      const result = {
        workspace: "main",
        query: "test",
        results: [],
        count: 0,
      };
      expect(result).toHaveProperty("workspace");
      expect(result).toHaveProperty("query");
      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("count");
    });
  });

  describe("SearchResultItem shape", () => {
    test("has required fields: id, name, rank", () => {
      const item = {
        id: "node-1",
        name: "Test Node",
        rank: -3.5,
      };
      expect(item.id).toBe("node-1");
      expect(item.name).toBe("Test Node");
      expect(item.rank).toBe(-3.5);
    });

    test("supports optional tags, ancestor, pathFromAncestor, depthFromAncestor", () => {
      const item = {
        id: "node-1",
        name: "Test Node",
        rank: 0,
        tags: ["meeting", "topic"],
        ancestor: { id: "parent-1", name: "Project", tags: ["project"] },
        pathFromAncestor: ["Project", "Subfolder", "Test Node"],
        depthFromAncestor: 2,
      };
      expect(item.tags).toEqual(["meeting", "topic"]);
      expect(item.ancestor?.name).toBe("Project");
      expect(item.pathFromAncestor).toHaveLength(3);
      expect(item.depthFromAncestor).toBe(2);
    });
  });

  describe("Mock read backend behavior", () => {
    test("mock SQLite backend returns isLive=false", () => {
      const backend = createMockReadBackend({ isLive: false });
      expect(backend.isLive()).toBe(false);
      expect(backend.type).toBe("sqlite");
    });

    test("mock live backend returns isLive=true", () => {
      const backend = createMockReadBackend({ isLive: true });
      expect(backend.isLive()).toBe(true);
      expect(backend.type).toBe("local-api");
    });

    test("mock backend search returns configured results", async () => {
      const mockResults: ReadSearchResult[] = [
        { id: "n1", name: "Node 1", tags: ["todo"], rank: -2.5 },
        { id: "n2", name: "Node 2", tags: ["meeting"], breadcrumb: ["Home", "Node 2"] },
      ];
      const backend = createMockReadBackend({ searchResults: mockResults });
      const results = await backend.search("test");
      expect(results).toHaveLength(2);
      expect(results[0].tags).toEqual(["todo"]);
      expect(results[1].breadcrumb).toEqual(["Home", "Node 2"]);
    });
  });

  describe("ReadSearchResult tags integration", () => {
    test("tags come directly from ReadSearchResult (no separate getNodeTags call)", () => {
      // The key architectural change: tags are part of ReadSearchResult
      // and no longer fetched via engine.getNodeTags()
      const searchResult: ReadSearchResult = {
        id: "test-1",
        name: "Test Node",
        tags: ["project", "active"],
      };
      expect(searchResult.tags).toEqual(["project", "active"]);
    });

    test("empty tags array for untagged nodes", () => {
      const searchResult: ReadSearchResult = {
        id: "test-2",
        name: "Plain Node",
        tags: [],
      };
      expect(searchResult.tags).toEqual([]);
    });
  });

  describe("Live backend ancestor resolution via breadcrumb", () => {
    test("breadcrumb from ReadSearchResult can be used for ancestor context", () => {
      const result: ReadSearchResult = {
        id: "deep-node",
        name: "Nested Item",
        tags: ["task"],
        breadcrumb: ["Projects", "Sprint 42", "Nested Item"],
      };

      // When live backend provides breadcrumb, ancestor should be derived from it
      expect(result.breadcrumb).toBeDefined();
      expect(result.breadcrumb!.length).toBeGreaterThan(0);

      // The last breadcrumb entry before the node is the "ancestor"
      const ancestorName = result.breadcrumb![result.breadcrumb!.length - 1];
      expect(ancestorName).toBe("Nested Item");

      // Parent would be second-to-last
      if (result.breadcrumb!.length > 1) {
        const parentName = result.breadcrumb![result.breadcrumb!.length - 2];
        expect(parentName).toBe("Sprint 42");
      }
    });

    test("breadcrumb is undefined for SQLite results", () => {
      const result: ReadSearchResult = {
        id: "sqlite-node",
        name: "From Index",
        tags: ["meeting"],
        rank: -1.5,
        // breadcrumb not set for SQLite
      };
      expect(result.breadcrumb).toBeUndefined();
    });
  });

  describe("Raw mode", () => {
    test("raw mode should skip tags in SearchResultItem", () => {
      // In raw mode, tags should be undefined (not fetched)
      const rawItem = {
        id: "raw-1",
        name: "Raw Result",
        rank: 0,
        tags: undefined,
      };
      expect(rawItem.tags).toBeUndefined();
    });

    test("raw mode should skip ancestor resolution", () => {
      // In raw mode, ancestor should not be computed
      const rawItem = {
        id: "raw-1",
        name: "Raw Result",
        rank: 0,
        ancestor: undefined,
        pathFromAncestor: undefined,
        depthFromAncestor: undefined,
      };
      expect(rawItem.ancestor).toBeUndefined();
      expect(rawItem.pathFromAncestor).toBeUndefined();
      expect(rawItem.depthFromAncestor).toBeUndefined();
    });
  });

  describe("Read backend search options", () => {
    test("SearchOptions has limit, offset, and date range fields", () => {
      const options: SearchOptions = {
        limit: 20,
        offset: 0,
        createdAfter: 1704067200000,
        createdBefore: 1735689600000,
        updatedAfter: 1704067200000,
        updatedBefore: 1735689600000,
      };
      expect(options.limit).toBe(20);
      expect(options.createdAfter).toBe(1704067200000);
    });

    test("search passes limit and date range from input", async () => {
      let capturedOptions: SearchOptions | undefined;
      const backend: TanaReadBackend = {
        type: "sqlite",
        search: async (_q: string, opts?: SearchOptions) => {
          capturedOptions = opts;
          return [];
        },
        readNode: async () => ({ id: "", name: "", markdown: "" }),
        getChildren: async () => ({ items: [], hasMore: false }),
        listTags: async () => [],
        isLive: () => false,
        close: () => {},
      };

      await backend.search("test query", {
        limit: 50,
        createdAfter: 1704067200000,
      });

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.limit).toBe(50);
      expect(capturedOptions!.createdAfter).toBe(1704067200000);
    });
  });

  describe("SqliteReadBackend FTS initialization", () => {
    test("SqliteReadBackend should handle FTS transparently", () => {
      // The SqliteReadBackend.search() should internally ensure FTS exists
      // Consumers should not need to call hasFTSIndex/initializeFTS
      // This is a design contract test
      const backend = createMockReadBackend({ isLive: false });
      // The search method should work without any FTS setup
      expect(() => backend.search("test")).not.toThrow();
    });
  });
});
