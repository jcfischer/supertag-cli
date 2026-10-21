/**
 * Graph edges: child/parent and reference-field traversal (issues #99, #100).
 *
 * The fixture DB is produced by the real indexer from a synthetic export, so
 * these tests see the same `references` / `field_values` shape a live sync
 * writes (inline_ref rows only — no child/parent rows).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { executeGraphQuery } from "../src/query/graph-query-service";
import { parseGraphQuery } from "../src/query/graph-parser";
import { GraphQueryPlanner } from "../src/query/graph-planner";
import { GraphQueryExecutor } from "../src/query/graph-executor";
import { GraphTraversalService } from "../src/services/graph-traversal";
import { createGraphExportFixture, type GraphExportFixture } from "./helpers/graph-export-fixture";

let fixture: GraphExportFixture;

beforeAll(async () => {
  fixture = await createGraphExportFixture();
});

afterAll(() => {
  fixture?.cleanup();
});

async function gquery(query: string, limit = 100) {
  const { results } = await executeGraphQuery({ query, dbPath: fixture.dbPath, limit });
  if (!results) throw new Error("no results");
  return results;
}

function asList(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? (v as string[]) : [v as string];
}

describe("fixture shape (as written by the production indexer)", () => {
  it("stores inline refs but no child/parent edges in the references table", () => {
    const db = new Database(fixture.dbPath, { readonly: true });
    try {
      const types = db
        .query(`SELECT DISTINCT reference_type AS t FROM "references"`)
        .all() as Array<{ t: string }>;
      expect(types.map((r) => r.t)).toEqual(["inline_ref"]);
      const attendees = db
        .query("SELECT value_node_id FROM field_values WHERE parent_id = 'meeting1' AND field_name = 'Attendees'")
        .all() as Array<{ value_node_id: string }>;
      expect(attendees.map((r) => r.value_node_id)).toEqual(["carol"]);
    } finally {
      db.close();
    }
  });
});

describe("gquery CONNECTED TO (#99)", () => {
  it("finds a log whose child and grandchild carry inline refs to persons", async () => {
    const result = await gquery("FIND log CONNECTED TO person RETURN name, person.name");
    expect(result.rows.map((r) => r.name)).toEqual(["Daily log"]);
    expect(asList(result.rows[0]["person.name"]).sort()).toEqual(["Alice", "Bob"]);
  });

  it("does not leak refs from a tagged node that is only referenced as a child", async () => {
    const result = await gquery("FIND log CONNECTED TO person RETURN name");
    expect(result.rows.map((r) => r.name)).not.toContain("Quiet log");
  });

  it("finds the inverse direction: persons mentioned inside a log's content", async () => {
    const result = await gquery("FIND person CONNECTED TO log RETURN name");
    expect(result.rows.map((r) => r.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("finds matches beyond the first LIMIT source nodes", async () => {
    // 120 newer filler logs sort ahead of log1; LIMIT 5 must still find it
    const result = await gquery("FIND log CONNECTED TO person RETURN name", 5);
    expect(result.rows.map((r) => r.name)).toEqual(["Daily log"]);
  });
});

describe("gquery FIND paging", () => {
  async function paged(query: string, findPageSize: number, limit = 100) {
    const db = new Database(fixture.dbPath, { readonly: true });
    try {
      const ast = parseGraphQuery(query);
      const plan = await new GraphQueryPlanner(db).plan(ast);
      return await new GraphQueryExecutor(db, { findPageSize }).execute(plan, ast, limit);
    } finally {
      db.close();
    }
  }

  it("finds a match on a later FIND page and keeps its joined projection", async () => {
    // 123 logs, newest first: log1 (oldest) lands on the third page of 50
    const result = await paged("FIND log CONNECTED TO person RETURN name, person.name", 50);
    expect(result.rows.map((r) => r.name)).toEqual(["Daily log"]);
    expect(asList(result.rows[0]["person.name"]).sort()).toEqual(["Alice", "Bob"]);
  });

  it("merges connected sets across pages", async () => {
    // One person per page; Alice and Bob each connect to log1 from their own page
    const result = await paged("FIND person CONNECTED TO log RETURN name, log.name", 1);
    expect(result.rows.map((r) => r.name).sort()).toEqual(["Alice", "Bob"]);
    for (const row of result.rows) {
      expect(asList(row["log.name"])).toEqual(["Daily log"]);
    }
  });

  it("stops paging once more than LIMIT rows are connected", async () => {
    const result = await paged("FIND person CONNECTED TO log RETURN name", 1, 1);
    expect(result.count).toBe(1);
    expect(result.hasMore).toBe(true);
  });
});

describe("gquery reference fields (#100)", () => {
  it("traverses reference-field values", async () => {
    const result = await gquery("FIND meeting CONNECTED TO person RETURN name, person.name");
    expect(result.rows.map((r) => r.name)).toEqual(["Standup"]);
    expect(asList(result.rows[0]["person.name"]).sort()).toEqual(["Alice", "Carol"]);
  });

  it("restricts traversal to the named field with VIA", async () => {
    const result = await gquery("FIND meeting CONNECTED TO person VIA Attendees RETURN name, person.name");
    expect(result.rows.map((r) => r.name)).toEqual(["Standup"]);
    expect(asList(result.rows[0]["person.name"])).toEqual(["Carol"]);
  });

  it("matches the VIA field name case-insensitively", async () => {
    const result = await gquery("FIND meeting CONNECTED TO person VIA owner RETURN name, person.name");
    expect(asList(result.rows[0]["person.name"])).toEqual(["Alice"]);
  });

  it("finds the inverse direction through a reference field", async () => {
    const result = await gquery("FIND person CONNECTED TO meeting VIA Attendees RETURN name");
    expect(result.rows.map((r) => r.name)).toEqual(["Carol"]);
  });
});

describe("tana_related edges (#99, #100)", () => {
  async function related(nodeId: string, types: Array<"child" | "parent" | "reference" | "field">, direction: "in" | "out" | "both" = "out") {
    const service = new GraphTraversalService(fixture.dbPath);
    try {
      return await service.traverse({ nodeId, direction, types, depth: 1, limit: 50 }, "main");
    } finally {
      service.close();
    }
  }

  it("serves child edges from the node tree", async () => {
    const result = await related("log1", ["child"]);
    expect(result.related.map((r) => r.id).sort()).toEqual(["c1", "c2"]);
    expect(result.related.every((r) => r.relationship.type === "child")).toBe(true);
  });

  it("leaves field tuples out of child edges", async () => {
    const result = await related("meeting1", ["child"]);
    expect(result.related.map((r) => r.id)).toEqual([]);
  });

  it("serves parent edges from the node tree", async () => {
    const result = await related("c1", ["parent"]);
    expect(result.related.map((r) => r.id)).toEqual(["log1"]);
    expect(result.related[0].relationship.type).toBe("parent");
  });

  it("labels reference-field edges with the field name", async () => {
    const result = await related("meeting1", ["field"]);
    const carol = result.related.find((r) => r.id === "carol");
    expect(carol?.relationship.type).toBe("field");
    expect(carol?.relationship.field).toBe("Attendees");
    const alice = result.related.find((r) => r.id === "alice");
    expect(alice?.relationship.field).toBe("Owner");
  });

  it("still returns inline references", async () => {
    const result = await related("c1", ["reference"]);
    expect(result.related.map((r) => r.id)).toEqual(["alice"]);
  });
});
