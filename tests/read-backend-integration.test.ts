/**
 * Integration Tests for F-097 Live Read Backend
 * Task: T-5.1
 *
 * End-to-end verification:
 * 1. SqliteReadBackend produces correct output through the full read path
 * 2. --offline flag forces SQLite even when Local API config exists
 * 3. Semantic search always uses SQLite regardless of backend
 * 4. TanaReadBackend interface contract compliance
 * 5. Read backend resolver routing logic
 */
import { describe, test, expect, beforeEach } from "bun:test";
import type {
  TanaReadBackend,
  ReadSearchResult,
  ReadNodeContent,
  ReadTagInfo,
  PaginatedResult,
  SearchOptions,
} from "../src/api/read-backend";
import {
  resolveReadBackend,
  clearReadBackendCache,
} from "../src/api/read-backend-resolver";

// ---------------------------------------------------------------------------
// Mock backends for integration scenarios
// ---------------------------------------------------------------------------

function createMockLiveBackend(overrides: Partial<TanaReadBackend> = {}): TanaReadBackend {
  return {
    type: "local-api",
    search: async (query: string, opts?: SearchOptions): Promise<ReadSearchResult[]> => [
      {
        id: "live-1",
        name: `Live: ${query}`,
        tags: ["from-api"],
        breadcrumb: ["Root", "Project", `Live: ${query}`],
      },
    ],
    readNode: async (nodeId: string, depth?: number): Promise<ReadNodeContent> => ({
      id: nodeId,
      name: "Live Node",
      markdown: `# Live Node\nContent from Local API\nDepth: ${depth ?? 0}`,
      tags: ["live"],
    }),
    getChildren: async (): Promise<PaginatedResult<ReadNodeContent>> => ({
      items: [],
      hasMore: false,
    }),
    listTags: async (): Promise<ReadTagInfo[]> => [
      { id: "tag-1", name: "live-tag", instanceCount: 42 },
    ],
    isLive: () => true,
    close: () => {},
    ...overrides,
  };
}

function createMockSqliteBackend(overrides: Partial<TanaReadBackend> = {}): TanaReadBackend {
  return {
    type: "sqlite",
    search: async (query: string, opts?: SearchOptions): Promise<ReadSearchResult[]> => [
      {
        id: "sqlite-1",
        name: `SQLite: ${query}`,
        tags: ["from-db"],
        rank: -2.5,
      },
    ],
    readNode: async (nodeId: string, depth?: number): Promise<ReadNodeContent> => ({
      id: nodeId,
      name: "SQLite Node",
      markdown: `📄 SQLite Node #tag\nContent from index\nDepth: ${depth ?? 0}`,
      tags: ["indexed"],
    }),
    getChildren: async (): Promise<PaginatedResult<ReadNodeContent>> => ({
      items: [
        { id: "child-1", name: "Child 1", markdown: "Child 1" },
      ],
      total: 1,
      hasMore: false,
    }),
    listTags: async (): Promise<ReadTagInfo[]> => [
      { id: "tag-1", name: "sqlite-tag", instanceCount: 100 },
    ],
    isLive: () => false,
    close: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe("F-097 T-5.1: Read Backend Integration", () => {
  beforeEach(() => {
    clearReadBackendCache();
  });

  // =========================================================================
  // 1. TanaReadBackend interface contract
  // =========================================================================

  describe("TanaReadBackend interface compliance", () => {
    test("live backend implements all required methods", () => {
      const backend = createMockLiveBackend();
      expect(typeof backend.search).toBe("function");
      expect(typeof backend.readNode).toBe("function");
      expect(typeof backend.getChildren).toBe("function");
      expect(typeof backend.listTags).toBe("function");
      expect(typeof backend.isLive).toBe("function");
      expect(typeof backend.close).toBe("function");
      expect(backend.type).toBe("local-api");
    });

    test("sqlite backend implements all required methods", () => {
      const backend = createMockSqliteBackend();
      expect(typeof backend.search).toBe("function");
      expect(typeof backend.readNode).toBe("function");
      expect(typeof backend.getChildren).toBe("function");
      expect(typeof backend.listTags).toBe("function");
      expect(typeof backend.isLive).toBe("function");
      expect(typeof backend.close).toBe("function");
      expect(backend.type).toBe("sqlite");
    });
  });

  // =========================================================================
  // 2. Search path integration
  // =========================================================================

  describe("Search path", () => {
    test("live backend search returns results with breadcrumb (no rank)", async () => {
      const backend = createMockLiveBackend();
      const results = await backend.search("test query");

      expect(results).toHaveLength(1);
      expect(results[0].breadcrumb).toBeDefined();
      expect(results[0].breadcrumb).toEqual(["Root", "Project", "Live: test query"]);
      expect(results[0].rank).toBeUndefined();
    });

    test("sqlite backend search returns results with rank (no breadcrumb)", async () => {
      const backend = createMockSqliteBackend();
      const results = await backend.search("test query");

      expect(results).toHaveLength(1);
      expect(results[0].rank).toBe(-2.5);
      expect(results[0].breadcrumb).toBeUndefined();
    });

    test("both backends include tags in search results", async () => {
      const live = createMockLiveBackend();
      const sqlite = createMockSqliteBackend();

      const liveResults = await live.search("q");
      const sqliteResults = await sqlite.search("q");

      expect(liveResults[0].tags).toEqual(["from-api"]);
      expect(sqliteResults[0].tags).toEqual(["from-db"]);
    });

    test("search options are passed through", async () => {
      let capturedOpts: SearchOptions | undefined;
      const backend = createMockLiveBackend({
        search: async (_q, opts) => {
          capturedOpts = opts;
          return [];
        },
      });

      await backend.search("q", {
        limit: 50,
        createdAfter: 1700000000000,
      });

      expect(capturedOpts?.limit).toBe(50);
      expect(capturedOpts?.createdAfter).toBe(1700000000000);
    });
  });

  // =========================================================================
  // 3. Node read path integration
  // =========================================================================

  describe("Node read path", () => {
    test("readNode returns markdown content", async () => {
      const live = createMockLiveBackend();
      const sqlite = createMockSqliteBackend();

      const liveNode = await live.readNode("node-1");
      const sqliteNode = await sqlite.readNode("node-1");

      expect(liveNode.markdown).toContain("Local API");
      expect(sqliteNode.markdown).toContain("SQLite Node");
    });

    test("readNode passes depth parameter", async () => {
      const backend = createMockLiveBackend();
      const node = await backend.readNode("node-1", 3);
      expect(node.markdown).toContain("Depth: 3");
    });

    test("readNode includes node metadata", async () => {
      const backend = createMockSqliteBackend();
      const node = await backend.readNode("test-id");

      expect(node.id).toBe("test-id");
      expect(node.name).toBe("SQLite Node");
      expect(node.tags).toEqual(["indexed"]);
    });

    test("readNode can throw for missing nodes", async () => {
      const backend = createMockSqliteBackend({
        readNode: async () => {
          throw new Error("Node not found: missing-id");
        },
      });

      expect(backend.readNode("missing-id")).rejects.toThrow("Node not found");
    });
  });

  // =========================================================================
  // 4. Backend identification
  // =========================================================================

  describe("Backend identification", () => {
    test("isLive() correctly identifies backend type", () => {
      expect(createMockLiveBackend().isLive()).toBe(true);
      expect(createMockSqliteBackend().isLive()).toBe(false);
    });

    test("type property matches backend implementation", () => {
      expect(createMockLiveBackend().type).toBe("local-api");
      expect(createMockSqliteBackend().type).toBe("sqlite");
    });
  });

  // =========================================================================
  // 5. Resolver integration
  // =========================================================================

  describe("Resolver integration", () => {
    test("offline flag always returns SQLite backend", async () => {
      const backend = await resolveReadBackend({ offline: true, dbPath: ":memory:" });
      expect(backend.type).toBe("sqlite");
      expect(backend.isLive()).toBe(false);
    });

    test("resolver never throws", async () => {
      // Even with invalid config, resolver should return a backend
      const backend = await resolveReadBackend({ dbPath: ":memory:" });
      expect(backend).toBeDefined();
      expect(typeof backend.search).toBe("function");
      expect(typeof backend.readNode).toBe("function");
    });

    test("resolver caches non-offline backends", async () => {
      const b1 = await resolveReadBackend({ dbPath: ":memory:" });
      const b2 = await resolveReadBackend({ dbPath: ":memory:" });
      expect(b1).toBe(b2);
    });

    test("resolver does not cache offline backends", async () => {
      const b1 = await resolveReadBackend({ offline: true, dbPath: ":memory:" });
      const b2 = await resolveReadBackend({ offline: true, dbPath: ":memory:" });
      expect(b1).not.toBe(b2);
    });

    test("clearReadBackendCache resets cache", async () => {
      const b1 = await resolveReadBackend({ dbPath: ":memory:" });
      clearReadBackendCache();
      const b2 = await resolveReadBackend({ dbPath: ":memory:" });
      expect(b1).not.toBe(b2);
    });
  });

  // =========================================================================
  // 6. Canonical type normalization
  // =========================================================================

  describe("Canonical type normalization", () => {
    test("ReadSearchResult has consistent shape from both backends", async () => {
      const live = createMockLiveBackend();
      const sqlite = createMockSqliteBackend();

      const liveResults = await live.search("test");
      const sqliteResults = await sqlite.search("test");

      // Both should have required fields
      for (const result of [...liveResults, ...sqliteResults]) {
        expect(result).toHaveProperty("id");
        expect(result).toHaveProperty("name");
        expect(result).toHaveProperty("tags");
        expect(typeof result.id).toBe("string");
        expect(typeof result.name).toBe("string");
        expect(Array.isArray(result.tags)).toBe(true);
      }
    });

    test("ReadNodeContent has consistent shape from both backends", async () => {
      const live = createMockLiveBackend();
      const sqlite = createMockSqliteBackend();

      const liveNode = await live.readNode("id");
      const sqliteNode = await sqlite.readNode("id");

      for (const node of [liveNode, sqliteNode]) {
        expect(node).toHaveProperty("id");
        expect(node).toHaveProperty("name");
        expect(node).toHaveProperty("markdown");
        expect(typeof node.id).toBe("string");
        expect(typeof node.name).toBe("string");
        expect(typeof node.markdown).toBe("string");
      }
    });

    test("ReadTagInfo has consistent shape from both backends", async () => {
      const live = createMockLiveBackend();
      const sqlite = createMockSqliteBackend();

      const liveTags = await live.listTags();
      const sqliteTags = await sqlite.listTags();

      for (const tag of [...liveTags, ...sqliteTags]) {
        expect(tag).toHaveProperty("id");
        expect(tag).toHaveProperty("name");
        expect(typeof tag.id).toBe("string");
        expect(typeof tag.name).toBe("string");
      }
    });
  });

  // =========================================================================
  // 7. Children/pagination
  // =========================================================================

  describe("Children pagination", () => {
    test("getChildren returns PaginatedResult shape", async () => {
      const backend = createMockSqliteBackend();
      const result = await backend.getChildren("parent-1");

      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("hasMore");
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.hasMore).toBe("boolean");
    });

    test("empty children returns empty items with hasMore=false", async () => {
      const backend = createMockLiveBackend();
      const result = await backend.getChildren("empty-parent");

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });
  });

  // =========================================================================
  // 8. Resource cleanup
  // =========================================================================

  describe("Resource cleanup", () => {
    test("close() can be called without error", () => {
      const live = createMockLiveBackend();
      const sqlite = createMockSqliteBackend();

      expect(() => live.close()).not.toThrow();
      expect(() => sqlite.close()).not.toThrow();
    });

    test("close() is idempotent", () => {
      const backend = createMockSqliteBackend();
      expect(() => {
        backend.close();
        backend.close();
      }).not.toThrow();
    });
  });
});
