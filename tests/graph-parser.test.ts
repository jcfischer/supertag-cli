/**
 * Tests for Graph Query Parser
 * F-102: Graph Query DSL
 */

import { describe, it, expect } from "bun:test";
import { parseGraphQuery, GraphParseError } from "../src/query/graph-parser";

describe("Graph Query Parser", () => {
  describe("Basic FIND + RETURN", () => {
    it("should parse simple FIND ... RETURN *", () => {
      const ast = parseGraphQuery("FIND meeting RETURN *");
      expect(ast.find).toBe("meeting");
      expect(ast.return).toHaveLength(1);
      expect(ast.return[0].fieldName).toBe("*");
    });

    it("should parse FIND with RETURN specific fields", () => {
      const ast = parseGraphQuery("FIND person RETURN name, id");
      expect(ast.find).toBe("person");
      expect(ast.return).toHaveLength(2);
      expect(ast.return[0].fieldName).toBe("name");
      expect(ast.return[1].fieldName).toBe("id");
    });

    it("should be case-insensitive for keywords", () => {
      const ast = parseGraphQuery("find task return name");
      expect(ast.find).toBe("task");
      expect(ast.return[0].fieldName).toBe("name");
    });
  });

  describe("WHERE clause", () => {
    it("should parse WHERE with = operator", () => {
      const ast = parseGraphQuery('FIND task WHERE Status = "Done" RETURN name');
      expect(ast.where).toHaveLength(1);
      expect(ast.where![0]).toEqual({ field: "Status", operator: "=", value: "Done" });
    });

    it("should parse WHERE with CONTAINS keyword", () => {
      const ast = parseGraphQuery('FIND person WHERE name CONTAINS "John" RETURN name');
      expect(ast.where![0]).toEqual({ field: "name", operator: "contains", value: "John" });
    });

    it("should parse WHERE with LIKE keyword", () => {
      const ast = parseGraphQuery('FIND task WHERE name LIKE "review" RETURN name');
      expect(ast.where![0]).toEqual({ field: "name", operator: "~", value: "review" });
    });

    it("should parse multiple WHERE conditions with AND", () => {
      const ast = parseGraphQuery('FIND task WHERE Status = "Done" AND Priority > 2 RETURN name');
      expect(ast.where).toHaveLength(2);
    });

    it("should parse numeric values in WHERE", () => {
      const ast = parseGraphQuery("FIND task WHERE Priority > 3 RETURN name");
      expect(ast.where![0].value).toBe(3);
    });
  });

  describe("CONNECTED TO clause", () => {
    it("should parse single CONNECTED TO", () => {
      const ast = parseGraphQuery("FIND meeting CONNECTED TO person RETURN name");
      expect(ast.connected).toHaveLength(1);
      expect(ast.connected[0].toTag).toBe("person");
    });

    it("should parse CONNECTED TO with VIA", () => {
      const ast = parseGraphQuery("FIND meeting CONNECTED TO person VIA Attendees RETURN name");
      expect(ast.connected[0].toTag).toBe("person");
      expect(ast.connected[0].viaField).toBe("Attendees");
    });

    it("should parse CONNECTED TO with WHERE", () => {
      const ast = parseGraphQuery('FIND meeting CONNECTED TO person WHERE name ~ "John" RETURN name');
      expect(ast.connected[0].toTag).toBe("person");
      expect(ast.connected[0].where).toHaveLength(1);
    });

    it("should parse chained CONNECTED TO clauses", () => {
      const ast = parseGraphQuery("FIND meeting CONNECTED TO person CONNECTED TO project RETURN name");
      expect(ast.connected).toHaveLength(2);
      expect(ast.connected[0].toTag).toBe("person");
      expect(ast.connected[1].toTag).toBe("project");
    });
  });

  describe("DEPTH clause", () => {
    it("should parse DEPTH", () => {
      const ast = parseGraphQuery("FIND meeting CONNECTED TO person DEPTH 3 RETURN name");
      expect(ast.depth).toBe(3);
    });

    it("should default to undefined when no DEPTH", () => {
      const ast = parseGraphQuery("FIND meeting RETURN name");
      expect(ast.depth).toBeUndefined();
    });
  });

  describe("LIMIT clause", () => {
    it("should parse LIMIT before RETURN", () => {
      const ast = parseGraphQuery("FIND task LIMIT 50 RETURN name");
      expect(ast.limit).toBe(50);
    });

    it("should parse LIMIT after RETURN", () => {
      const ast = parseGraphQuery("FIND task RETURN name LIMIT 25");
      expect(ast.limit).toBe(25);
    });
  });

  describe("RETURN clause projections", () => {
    it("should parse dot notation (type.field)", () => {
      const ast = parseGraphQuery("FIND meeting CONNECTED TO person RETURN name, person.name");
      expect(ast.return).toHaveLength(2);
      expect(ast.return[1].typeAlias).toBe("person");
      expect(ast.return[1].fieldName).toBe("name");
    });

    it("should parse aggregate COUNT(...) AS alias", () => {
      const ast = parseGraphQuery("FIND person CONNECTED TO meeting RETURN name, COUNT(meeting) AS meeting_count");
      expect(ast.return[1].aggregateFn).toBe("COUNT");
      expect(ast.return[1].fieldName).toBe("meeting");
      expect(ast.return[1].alias).toBe("meeting_count");
    });
  });

  describe("Error handling", () => {
    it("should throw GraphParseError on empty query", () => {
      expect(() => parseGraphQuery("")).toThrow(GraphParseError);
    });

    it("should throw GraphParseError when FIND is missing", () => {
      expect(() => parseGraphQuery("meeting RETURN name")).toThrow(GraphParseError);
    });

    it("should throw GraphParseError when RETURN is missing", () => {
      expect(() => parseGraphQuery("FIND meeting")).toThrow(GraphParseError);
    });

    it("should include syntax reference in error message", () => {
      try {
        parseGraphQuery("");
      } catch (e) {
        expect((e as GraphParseError).message).toContain("FIND <supertag>");
      }
    });
  });
});
