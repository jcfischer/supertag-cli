/**
 * Tests for Graph Query Executor
 * F-102: Graph Query DSL
 *
 * Integration tests that exercise the full executor pipeline with a real
 * in-memory database: find_by_tag → traverse → project → buildResult.
 * Specifically covers the join map refactor for proper per-row source→target association.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { GraphQueryExecutor } from "../src/query/graph-executor";
import type {
  GraphQueryAST,
  QueryPlan,
  GraphQueryResult,
} from "../src/query/graph-types";
import { unlinkSync } from "fs";

describe("Graph Query Executor", () => {
  const testDbPath = "/tmp/test-graph-executor.db";
  let executor: GraphQueryExecutor;

  /**
   * Test graph:
   *
   *   meeting1 (#meeting) --Attendees--> alice (#person)
   *   meeting1 (#meeting) --Attendees--> bob (#person)
   *   meeting2 (#meeting) --Attendees--> bob (#person)
   *   meeting2 (#meeting) --Attendees--> carol (#person)
   *   meeting3 (#meeting) — no attendees
   *
   *   alice (#person) --ref--> project1 (#project)
   *   bob (#person) --ref--> project1 (#project)
   *
   * This lets us test:
   * - Basic FIND by tag
   * - CONNECTED TO with join maps (which meetings connect to which persons)
   * - Dot-notation projection (meeting.name + person.name per row)
   * - R0 filtering: meeting3 should be excluded when CONNECTED TO person
   * - Multi-source same-target: bob appears in both meeting1 and meeting2
   */
  beforeAll(() => {
    const db = new Database(testDbPath);
    const now = Date.now();

    // Create tables
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        parent_id TEXT,
        node_type TEXT,
        created INTEGER,
        updated INTEGER,
        done_at INTEGER,
        raw_data TEXT
      )
    `);
    db.run(`
      CREATE TABLE "references" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        reference_type TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE tag_applications (
        data_node_id TEXT,
        tag_id TEXT,
        tag_name TEXT
      )
    `);
    db.run(`
      CREATE TABLE field_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        field_def_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        value_node_id TEXT NOT NULL,
        value_text TEXT NOT NULL,
        value_order INTEGER DEFAULT 0,
        created INTEGER
      )
    `);
    db.run(`
      CREATE TABLE supertag_fields (
        tag_id TEXT,
        tag_name TEXT,
        field_id TEXT,
        field_name TEXT,
        field_order INTEGER,
        source TEXT DEFAULT 'own'
      )
    `);

    // Insert nodes
    const insertNode = db.prepare(
      "INSERT INTO nodes (id, name, created, updated) VALUES (?, ?, ?, ?)"
    );
    insertNode.run("meeting1", "Weekly Standup", now, now);
    insertNode.run("meeting2", "Sprint Review", now, now);
    insertNode.run("meeting3", "Solo Planning", now, now);
    insertNode.run("alice", "Alice Smith", now, now);
    insertNode.run("bob", "Bob Jones", now, now);
    insertNode.run("carol", "Carol White", now, now);
    insertNode.run("project1", "Project Alpha", now, now);

    // Tag applications
    const insertTag = db.prepare(
      "INSERT INTO tag_applications (data_node_id, tag_id, tag_name) VALUES (?, ?, ?)"
    );
    insertTag.run("meeting1", "tag-meeting", "meeting");
    insertTag.run("meeting2", "tag-meeting", "meeting");
    insertTag.run("meeting3", "tag-meeting", "meeting");
    insertTag.run("alice", "tag-person", "person");
    insertTag.run("bob", "tag-person", "person");
    insertTag.run("carol", "tag-person", "person");
    insertTag.run("project1", "tag-project", "project");

    // Field values: meeting → person via "Attendees" field
    const insertField = db.prepare(
      "INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, created) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    insertField.run("t1", "meeting1", "fd-attendees", "Attendees", "alice", "Alice Smith", now);
    insertField.run("t2", "meeting1", "fd-attendees", "Attendees", "bob", "Bob Jones", now);
    insertField.run("t3", "meeting2", "fd-attendees", "Attendees", "bob", "Bob Jones", now);
    insertField.run("t4", "meeting2", "fd-attendees", "Attendees", "carol", "Carol White", now);

    // References: person → project (inline ref)
    const insertRef = db.prepare(
      'INSERT INTO "references" (from_node, to_node, reference_type) VALUES (?, ?, ?)'
    );
    insertRef.run("alice", "project1", "inline_ref");
    insertRef.run("bob", "project1", "inline_ref");

    db.close();
  });

  afterAll(() => {
    try {
      executor?.close();
    } catch {
      // already closed
    }
    try {
      unlinkSync(testDbPath);
    } catch {
      // already removed
    }
  });

  function createExecutor(): GraphQueryExecutor {
    const db = new Database(testDbPath);
    return new GraphQueryExecutor(db, testDbPath, "main");
  }

  // ---------------------------------------------------------------------------
  // Basic FIND by tag
  // ---------------------------------------------------------------------------

  describe("FIND by tag (find_by_tag step)", () => {
    it("should find all nodes with a given tag", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "meeting", filters: [], resultSet: "R0" },
            { type: "project", fields: [{ fieldName: "name" }] },
          ],
          estimatedHops: 0,
        };
        const ast: GraphQueryAST = {
          find: "meeting",
          connected: [],
          return: [{ fieldName: "name" }],
        };

        const result = await exec.execute(plan, ast, 100);
        expect(result.count).toBe(3);
        const names = result.rows.map((r) => r.name);
        expect(names).toContain("Weekly Standup");
        expect(names).toContain("Sprint Review");
        expect(names).toContain("Solo Planning");
      } finally {
        exec.close();
      }
    });

    it("should find persons", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "person", filters: [], resultSet: "R0" },
            { type: "project", fields: [{ fieldName: "name" }] },
          ],
          estimatedHops: 0,
        };
        const ast: GraphQueryAST = {
          find: "person",
          connected: [],
          return: [{ fieldName: "name" }],
        };

        const result = await exec.execute(plan, ast, 100);
        expect(result.count).toBe(3);
        const names = result.rows.map((r) => r.name);
        expect(names).toContain("Alice Smith");
        expect(names).toContain("Bob Jones");
        expect(names).toContain("Carol White");
      } finally {
        exec.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // CONNECTED TO with join maps
  // ---------------------------------------------------------------------------

  describe("CONNECTED TO (traverse step with join maps)", () => {
    it("should find meetings connected to persons", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "meeting", filters: [], resultSet: "R0" },
            { type: "traverse", fromSet: "R0", toTag: "person", resultSet: "R1" },
            { type: "project", fields: [{ fieldName: "name" }] },
          ],
          estimatedHops: 1,
        };
        const ast: GraphQueryAST = {
          find: "meeting",
          connected: [{ toTag: "person" }],
          return: [{ fieldName: "name" }],
        };

        const result = await exec.execute(plan, ast, 100);
        // meeting3 has no attendees → should be filtered out by join map
        expect(result.count).toBe(2);
        const names = result.rows.map((r) => r.name);
        expect(names).toContain("Weekly Standup");
        expect(names).toContain("Sprint Review");
        expect(names).not.toContain("Solo Planning");
      } finally {
        exec.close();
      }
    });

    it("should resolve dot-notation projections per row via join map", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "meeting", filters: [], resultSet: "R0" },
            { type: "traverse", fromSet: "R0", toTag: "person", resultSet: "R1" },
            { type: "project", fields: [{ fieldName: "name" }, { typeAlias: "person", fieldName: "name" }] },
          ],
          estimatedHops: 1,
        };
        const ast: GraphQueryAST = {
          find: "meeting",
          connected: [{ toTag: "person" }],
          return: [
            { fieldName: "name" },
            { typeAlias: "person", fieldName: "name" },
          ],
        };

        const result = await exec.execute(plan, ast, 100);

        // Each meeting row should have person.name associated with THAT meeting
        const standup = result.rows.find((r) => r.name === "Weekly Standup");
        expect(standup).toBeDefined();
        const standupPersons = Array.isArray(standup!["person.name"])
          ? standup!["person.name"]
          : [standup!["person.name"]];
        expect(standupPersons).toContain("Alice Smith");
        expect(standupPersons).toContain("Bob Jones");
        // Carol should NOT be in the standup row
        expect(standupPersons).not.toContain("Carol White");

        const review = result.rows.find((r) => r.name === "Sprint Review");
        expect(review).toBeDefined();
        const reviewPersons = Array.isArray(review!["person.name"])
          ? review!["person.name"]
          : [review!["person.name"]];
        expect(reviewPersons).toContain("Bob Jones");
        expect(reviewPersons).toContain("Carol White");
        // Alice should NOT be in the review row
        expect(reviewPersons).not.toContain("Alice Smith");
      } finally {
        exec.close();
      }
    });

    it("should handle shared targets across multiple source nodes", async () => {
      // Bob appears in both meeting1 and meeting2
      // The join map should associate bob with BOTH meetings
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "meeting", filters: [], resultSet: "R0" },
            { type: "traverse", fromSet: "R0", toTag: "person", resultSet: "R1" },
            { type: "project", fields: [{ fieldName: "name" }, { typeAlias: "person", fieldName: "name" }] },
          ],
          estimatedHops: 1,
        };
        const ast: GraphQueryAST = {
          find: "meeting",
          connected: [{ toTag: "person" }],
          return: [
            { fieldName: "name" },
            { typeAlias: "person", fieldName: "name" },
          ],
        };

        const result = await exec.execute(plan, ast, 100);

        // Both meetings should include Bob in their person.name
        const standup = result.rows.find((r) => r.name === "Weekly Standup");
        const review = result.rows.find((r) => r.name === "Sprint Review");

        const standupPersons = Array.isArray(standup!["person.name"])
          ? (standup!["person.name"] as string[])
          : [standup!["person.name"] as string];
        const reviewPersons = Array.isArray(review!["person.name"])
          ? (review!["person.name"] as string[])
          : [review!["person.name"] as string];

        expect(standupPersons).toContain("Bob Jones");
        expect(reviewPersons).toContain("Bob Jones");
      } finally {
        exec.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Column names from RETURN clause
  // ---------------------------------------------------------------------------

  describe("Result shape", () => {
    it("should produce correct column names for dot-notation projections", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "meeting", filters: [], resultSet: "R0" },
            { type: "traverse", fromSet: "R0", toTag: "person", resultSet: "R1" },
            { type: "project", fields: [] },
          ],
          estimatedHops: 1,
        };
        const ast: GraphQueryAST = {
          find: "meeting",
          connected: [{ toTag: "person" }],
          return: [
            { fieldName: "name" },
            { typeAlias: "person", fieldName: "name" },
          ],
        };

        const result = await exec.execute(plan, ast, 100);
        expect(result.columns).toEqual(["name", "person.name"]);
      } finally {
        exec.close();
      }
    });

    it("should include queryTimeMs in result", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "person", filters: [], resultSet: "R0" },
            { type: "project", fields: [{ fieldName: "name" }] },
          ],
          estimatedHops: 0,
        };
        const ast: GraphQueryAST = {
          find: "person",
          connected: [],
          return: [{ fieldName: "name" }],
        };

        const result = await exec.execute(plan, ast, 100);
        expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
      } finally {
        exec.close();
      }
    });

    it("should respect limit parameter", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "person", filters: [], resultSet: "R0" },
            { type: "project", fields: [{ fieldName: "name" }] },
          ],
          estimatedHops: 0,
        };
        const ast: GraphQueryAST = {
          find: "person",
          connected: [],
          return: [{ fieldName: "name" }],
        };

        const result = await exec.execute(plan, ast, 2);
        expect(result.count).toBe(2);
        // hasMore depends on whether the SQL engine returns more than `limit` rows
        // UnifiedQueryEngine applies LIMIT at SQL level, so executor sees exactly 2
        expect(result.count).toBeLessThanOrEqual(2);
      } finally {
        exec.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Wildcard and ID projections
  // ---------------------------------------------------------------------------

  describe("Projections", () => {
    it("should handle wildcard (*) projection", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "person", filters: [], resultSet: "R0" },
            { type: "project", fields: [{ fieldName: "*" }] },
          ],
          estimatedHops: 0,
        };
        const ast: GraphQueryAST = {
          find: "person",
          connected: [],
          return: [{ fieldName: "*" }],
        };

        const result = await exec.execute(plan, ast, 100);
        expect(result.count).toBe(3);
        // Wildcard should include id, name, tags
        for (const row of result.rows) {
          expect(row).toHaveProperty("id");
          expect(row).toHaveProperty("name");
        }
      } finally {
        exec.close();
      }
    });

    it("should project id field", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "person", filters: [], resultSet: "R0" },
            { type: "project", fields: [{ fieldName: "id" }, { fieldName: "name" }] },
          ],
          estimatedHops: 0,
        };
        const ast: GraphQueryAST = {
          find: "person",
          connected: [],
          return: [{ fieldName: "id" }, { fieldName: "name" }],
        };

        const result = await exec.execute(plan, ast, 100);
        const alice = result.rows.find((r) => r.name === "Alice Smith");
        expect(alice).toBeDefined();
        expect(alice!.id).toBe("alice");
      } finally {
        exec.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // No connected results → empty
  // ---------------------------------------------------------------------------

  describe("Edge cases", () => {
    it("should return empty when no traversal matches", async () => {
      const exec = createExecutor();
      try {
        // meeting CONNECTED TO project — no direct field/ref links exist
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "meeting", filters: [], resultSet: "R0" },
            { type: "traverse", fromSet: "R0", toTag: "project", resultSet: "R1" },
            { type: "project", fields: [{ fieldName: "name" }] },
          ],
          estimatedHops: 1,
        };
        const ast: GraphQueryAST = {
          find: "meeting",
          connected: [{ toTag: "project" }],
          return: [{ fieldName: "name" }],
        };

        const result = await exec.execute(plan, ast, 100);
        // No meetings connect directly to projects
        expect(result.count).toBe(0);
      } finally {
        exec.close();
      }
    });

    it("should handle FIND with no matching tag", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "nonexistent", filters: [], resultSet: "R0" },
            { type: "project", fields: [{ fieldName: "name" }] },
          ],
          estimatedHops: 0,
        };
        const ast: GraphQueryAST = {
          find: "nonexistent",
          connected: [],
          return: [{ fieldName: "name" }],
        };

        const result = await exec.execute(plan, ast, 100);
        expect(result.count).toBe(0);
        expect(result.rows).toEqual([]);
      } finally {
        exec.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Aggregate (COUNT)
  // ---------------------------------------------------------------------------

  describe("Aggregates", () => {
    it("should support COUNT aggregate", async () => {
      const exec = createExecutor();
      try {
        const plan: QueryPlan = {
          steps: [
            { type: "find_by_tag", tag: "meeting", filters: [], resultSet: "R0" },
            { type: "traverse", fromSet: "R0", toTag: "person", resultSet: "R1" },
            { type: "project", fields: [{ fieldName: "person", aggregateFn: "COUNT" }] },
          ],
          estimatedHops: 1,
        };
        const ast: GraphQueryAST = {
          find: "meeting",
          connected: [{ toTag: "person" }],
          return: [
            { fieldName: "person", aggregateFn: "COUNT", alias: "attendee_count" },
          ],
        };

        const result = await exec.execute(plan, ast, 100);
        expect(result.rows.length).toBe(1);
        // 3 unique persons connected to meetings (alice, bob, carol)
        expect(result.rows[0].attendee_count).toBe(3);
      } finally {
        exec.close();
      }
    });
  });
});
