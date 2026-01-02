/**
 * Tests for Query MCP Input Schema
 * Spec 063: Unified Query Language
 *
 * TDD: RED phase - write tests first
 */

import { describe, it, expect } from "bun:test";
import { querySchema, type QueryInput } from "../src/mcp/schemas";

describe("Query MCP Schema", () => {
  describe("Basic Validation", () => {
    it("should accept minimal query with just find", () => {
      const input = { find: "task" };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.find).toBe("task");
      }
    });

    it("should accept wildcard find", () => {
      const input = { find: "*" };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject empty find", () => {
      const input = { find: "" };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing find", () => {
      const input = {};
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("Where Clause Validation", () => {
    it("should accept simple string equality", () => {
      const input = {
        find: "task",
        where: { Status: "Done" },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept structured condition with eq", () => {
      const input = {
        find: "task",
        where: { Status: { eq: "Done" } },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept contains condition", () => {
      const input = {
        find: "meeting",
        where: { Attendees: { contains: "John" } },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept date comparisons", () => {
      const input = {
        find: "task",
        where: {
          created: { after: "2025-01-01" },
          "Due Date": { before: "today" },
        },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept exists condition", () => {
      const input = {
        find: "task",
        where: { Due: { exists: true } },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept negated condition", () => {
      const input = {
        find: "task",
        where: { Status: { neq: "Done" } },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept greater/less than conditions", () => {
      const input = {
        find: "task",
        where: {
          Priority: { gt: 2 },
          Score: { lte: 100 },
        },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept parent path fields", () => {
      const input = {
        find: "task",
        where: {
          "parent.tags": { contains: "project" },
          "parent.name": { eq: "Q4 Planning" },
        },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept multiple conditions", () => {
      const input = {
        find: "task",
        where: {
          Status: "Active",
          Priority: { gt: 3 },
          created: { after: "7d" },
        },
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("Select Validation", () => {
    it("should accept array of fields", () => {
      const input = {
        find: "task",
        select: ["name", "created", "fields.Status"],
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.select).toEqual(["name", "created", "fields.Status"]);
      }
    });

    it("should accept empty select (means all fields)", () => {
      const input = { find: "task" };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("OrderBy Validation", () => {
    it("should accept ascending sort", () => {
      const input = {
        find: "task",
        orderBy: "created",
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orderBy).toBe("created");
      }
    });

    it("should accept descending sort with minus prefix", () => {
      const input = {
        find: "task",
        orderBy: "-created",
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept field path sort", () => {
      const input = {
        find: "task",
        orderBy: "fields.Priority",
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("Pagination Validation", () => {
    it("should accept limit", () => {
      const input = {
        find: "task",
        limit: 50,
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
      }
    });

    it("should have default limit", () => {
      const input = { find: "task" };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBeDefined();
      }
    });

    it("should reject limit over 1000", () => {
      const input = {
        find: "task",
        limit: 5000,
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should accept offset", () => {
      const input = {
        find: "task",
        limit: 20,
        offset: 40,
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.offset).toBe(40);
      }
    });

    it("should reject negative offset", () => {
      const input = {
        find: "task",
        offset: -10,
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("Workspace Validation", () => {
    it("should accept workspace alias", () => {
      const input = {
        find: "task",
        workspace: "books",
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept null workspace (uses default)", () => {
      const input = {
        find: "task",
        workspace: null,
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workspace).toBeUndefined();
      }
    });
  });

  describe("Full Query Examples", () => {
    it("should accept complex query", () => {
      const input: QueryInput = {
        find: "meeting",
        where: {
          Attendees: { contains: "John" },
          created: { after: "2025-12-01" },
          "fields.Status": "Active",
        },
        select: ["name", "created", "fields.Status"],
        orderBy: "-created",
        limit: 20,
        offset: 0,
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should handle AI agent typical query", () => {
      // Query for "active projects with overdue tasks"
      const input = {
        find: "task",
        where: {
          "parent.tags": { contains: "project" },
          "Due Date": { before: "today" },
        },
        limit: 50,
      };
      const result = querySchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});
