/**
 * Tests for TanaReadBackend interface and canonical types
 * Spec: F-097 Live Read Backend
 * Task: T-1.1
 */
import { describe, test, expect } from "bun:test";

// Import will fail until implementation exists
import type {
  TanaReadBackend,
  ReadBackendType,
  ReadSearchResult,
  ReadNodeContent,
  ReadTagInfo,
  PaginatedResult,
  SearchOptions,
} from "../src/api/read-backend";

describe("F-097 T-1.1: Read Backend Interface & Canonical Types", () => {
  describe("ReadSearchResult", () => {
    test("has required fields: id, name, tags", () => {
      const result: ReadSearchResult = {
        id: "test-id",
        name: "Test Node",
        tags: ["topic", "meeting"],
      };
      expect(result.id).toBe("test-id");
      expect(result.name).toBe("Test Node");
      expect(result.tags).toEqual(["topic", "meeting"]);
    });

    test("supports optional fields: rank, description, created, breadcrumb", () => {
      const result: ReadSearchResult = {
        id: "test-id",
        name: "Test Node",
        tags: [],
        rank: -5.2,
        description: "A test node",
        created: "2026-01-15T10:30:00Z",
        breadcrumb: ["Home", "Projects", "Test Node"],
      };
      expect(result.rank).toBe(-5.2);
      expect(result.description).toBe("A test node");
      expect(result.created).toBe("2026-01-15T10:30:00Z");
      expect(result.breadcrumb).toEqual(["Home", "Projects", "Test Node"]);
    });

    test("rank is omitted for Local API results", () => {
      const result: ReadSearchResult = {
        id: "api-node",
        name: "From API",
        tags: ["task"],
        breadcrumb: ["Home", "Tasks"],
        // rank intentionally omitted — Local API doesn't provide FTS rank
      };
      expect(result.rank).toBeUndefined();
    });
  });

  describe("ReadNodeContent", () => {
    test("has required fields: id, name, markdown", () => {
      const content: ReadNodeContent = {
        id: "node-1",
        name: "Meeting Notes",
        markdown: "# Meeting Notes\n\nDiscussed project timeline.",
      };
      expect(content.id).toBe("node-1");
      expect(content.name).toBe("Meeting Notes");
      expect(content.markdown).toContain("Meeting Notes");
    });

    test("supports optional fields: description, tags, children", () => {
      const content: ReadNodeContent = {
        id: "node-1",
        name: "Parent",
        markdown: "# Parent\n- Child 1\n- Child 2",
        description: "A parent node",
        tags: ["project"],
        children: [
          { id: "child-1", name: "Child 1", markdown: "Child 1 content" },
          { id: "child-2", name: "Child 2", markdown: "Child 2 content" },
        ],
      };
      expect(content.children).toHaveLength(2);
      expect(content.children![0].name).toBe("Child 1");
    });
  });

  describe("ReadTagInfo", () => {
    test("has required fields: id, name", () => {
      const tag: ReadTagInfo = {
        id: "tag-1",
        name: "meeting",
      };
      expect(tag.id).toBe("tag-1");
      expect(tag.name).toBe("meeting");
    });

    test("supports optional fields: color, instanceCount", () => {
      const tag: ReadTagInfo = {
        id: "tag-1",
        name: "meeting",
        color: "blue",
        instanceCount: 42,
      };
      expect(tag.color).toBe("blue");
      expect(tag.instanceCount).toBe(42);
    });
  });

  describe("PaginatedResult", () => {
    test("wraps items with hasMore flag", () => {
      const result: PaginatedResult<ReadNodeContent> = {
        items: [
          { id: "n-1", name: "Node 1", markdown: "content 1" },
          { id: "n-2", name: "Node 2", markdown: "content 2" },
        ],
        hasMore: true,
      };
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    test("total is optional", () => {
      const result: PaginatedResult<ReadTagInfo> = {
        items: [{ id: "t-1", name: "tag1" }],
        total: 100,
        hasMore: true,
      };
      expect(result.total).toBe(100);
    });
  });

  describe("SearchOptions", () => {
    test("all fields are optional", () => {
      const opts: SearchOptions = {};
      expect(opts.limit).toBeUndefined();
    });

    test("supports all filter options", () => {
      const opts: SearchOptions = {
        limit: 20,
        offset: 10,
        createdAfter: 1700000000000,
        createdBefore: 1700100000000,
        updatedAfter: 1700000000000,
        updatedBefore: 1700100000000,
      };
      expect(opts.limit).toBe(20);
      expect(opts.offset).toBe(10);
    });
  });

  describe("ReadBackendType", () => {
    test("accepts local-api and sqlite", () => {
      const localApi: ReadBackendType = "local-api";
      const sqlite: ReadBackendType = "sqlite";
      expect(localApi).toBe("local-api");
      expect(sqlite).toBe("sqlite");
    });
  });

  describe("TanaReadBackend interface contract", () => {
    test("mock implementation satisfies interface", () => {
      // A mock that implements the interface — verifies the contract is usable
      const mockBackend: TanaReadBackend = {
        type: "sqlite" as ReadBackendType,

        async search(query: string, options?: SearchOptions): Promise<ReadSearchResult[]> {
          return [{ id: "1", name: query, tags: [] }];
        },

        async readNode(nodeId: string, depth?: number): Promise<ReadNodeContent> {
          return { id: nodeId, name: "Test", markdown: "# Test" };
        },

        async getChildren(nodeId: string, options?: { limit?: number; offset?: number }): Promise<PaginatedResult<ReadNodeContent>> {
          return { items: [], hasMore: false };
        },

        async listTags(options?: { limit?: number }): Promise<ReadTagInfo[]> {
          return [{ id: "t-1", name: "test" }];
        },

        isLive(): boolean {
          return false;
        },

        close(): void {},
      };

      expect(mockBackend.type).toBe("sqlite");
      expect(mockBackend.isLive()).toBe(false);
    });

    test("search returns ReadSearchResult array", async () => {
      const mockBackend: TanaReadBackend = {
        type: "sqlite",
        async search() { return [{ id: "1", name: "test", tags: ["tag1"] }]; },
        async readNode() { return { id: "1", name: "t", markdown: "" }; },
        async getChildren() { return { items: [], hasMore: false }; },
        async listTags() { return []; },
        isLive() { return false; },
        close() {},
      };

      const results = await mockBackend.search("test query");
      expect(results).toBeArray();
      expect(results[0].id).toBe("1");
      expect(results[0].tags).toEqual(["tag1"]);
    });
  });
});
