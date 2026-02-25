/**
 * Tests for Graph Query Planner
 * F-102: Graph Query DSL
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { GraphQueryPlanner, GraphPlanError } from "../src/query/graph-planner";
import type { GraphQueryAST } from "../src/query/graph-types";

describe("Graph Query Planner", () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(":memory:");

    // Create tables matching the real schema
    db.run(`
      CREATE TABLE supertags (
        tag_name TEXT NOT NULL,
        tag_id TEXT,
        description TEXT
      )
    `);
    db.run(`
      CREATE TABLE supertag_fields (
        tag_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_type TEXT
      )
    `);

    // Seed test data
    db.run("INSERT INTO supertags (tag_name) VALUES ('meeting'), ('person'), ('project')");
    db.run("INSERT INTO supertag_fields (tag_name, field_name) VALUES ('meeting', 'Date'), ('meeting', 'Attendees'), ('person', 'Email')");
  });

  afterAll(() => {
    db.close();
  });

  describe("Tag validation", () => {
    it("should validate an existing tag name (case-insensitive)", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "Meeting",
        connected: [],
        return: [{ fieldName: "*" }],
      };
      const plan = await planner.plan(ast);
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("should throw GraphPlanError for unknown tags", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "nonexistent",
        connected: [],
        return: [{ fieldName: "*" }],
      };
      await expect(planner.plan(ast)).rejects.toThrow(GraphPlanError);
    });

    it("should suggest similar tag names in error", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meet",
        connected: [],
        return: [{ fieldName: "*" }],
      };
      try {
        await planner.plan(ast);
      } catch (e) {
        expect((e as GraphPlanError).suggestion).toContain("meeting");
      }
    });

    it("should validate connected clause tags", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        connected: [{ toTag: "unknown_tag" }],
        return: [{ fieldName: "*" }],
      };
      await expect(planner.plan(ast)).rejects.toThrow(GraphPlanError);
    });
  });

  describe("Field validation", () => {
    it("should allow built-in fields (name, id, created)", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        where: [{ field: "name", operator: "~", value: "sync" }],
        connected: [],
        return: [{ fieldName: "*" }],
      };
      const plan = await planner.plan(ast);
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("should validate defined fields on a tag", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        where: [{ field: "Date", operator: "=", value: "2026-01-01" }],
        connected: [],
        return: [{ fieldName: "*" }],
      };
      const plan = await planner.plan(ast);
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("should throw GraphPlanError for unknown fields when tag has defined fields", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        where: [{ field: "NonExistentField", operator: "=", value: "x" }],
        connected: [],
        return: [{ fieldName: "*" }],
      };
      await expect(planner.plan(ast)).rejects.toThrow(GraphPlanError);
    });
  });

  describe("Plan building", () => {
    it("should produce find_by_tag step for primary FIND", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        connected: [],
        return: [{ fieldName: "name" }],
      };
      const plan = await planner.plan(ast);
      expect(plan.steps[0].type).toBe("find_by_tag");
    });

    it("should produce traverse step for CONNECTED TO", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        connected: [{ toTag: "person" }],
        return: [{ fieldName: "name" }],
      };
      const plan = await planner.plan(ast);
      expect(plan.steps.some((s) => s.type === "traverse")).toBe(true);
      expect(plan.estimatedHops).toBe(1);
    });

    it("should produce project step at the end", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        connected: [],
        return: [{ fieldName: "name" }],
      };
      const plan = await planner.plan(ast);
      const lastStep = plan.steps[plan.steps.length - 1];
      expect(lastStep.type).toBe("project");
    });

    it("should add filter step when connected clause has WHERE", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        connected: [{ toTag: "person", where: [{ field: "name", operator: "~", value: "John" }] }],
        return: [{ fieldName: "*" }],
      };
      const plan = await planner.plan(ast);
      expect(plan.steps.some((s) => s.type === "filter")).toBe(true);
    });
  });

  describe("formatExplain", () => {
    it("should produce human-readable execution plan text", async () => {
      const planner = new GraphQueryPlanner(db);
      const ast: GraphQueryAST = {
        find: "meeting",
        connected: [{ toTag: "person", viaField: "Attendees" }],
        return: [{ fieldName: "name" }, { typeAlias: "person", fieldName: "name" }],
      };
      const plan = await planner.plan(ast);
      const text = planner.formatExplain(plan);
      expect(text).toContain("Execution Plan:");
      expect(text).toContain("#meeting");
      expect(text).toContain("#person");
      expect(text).toContain("Attendees");
    });
  });
});
