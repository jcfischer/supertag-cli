/**
 * Tests for whereUsesFieldValue (v2.5.5 fix C helper)
 *
 * Detects whether a query's WHERE clause filters on supertag fields vs
 * core node attributes. Used to decide when to emit a delta-sync
 * field-value staleness warning on tana_query responses.
 */

import { describe, it, expect } from "bun:test";
import { whereUsesFieldValue, CORE_FIELDS } from "../../src/mcp/tools/query";
import type { WhereClause, WhereGroup } from "../../src/query/types";

describe("whereUsesFieldValue", () => {
  it("returns false for core-field-only filter", () => {
    const where: (WhereClause | WhereGroup)[] = [
      { field: "created", operator: ">", value: Date.now() - 86400000 },
    ];
    expect(whereUsesFieldValue(where)).toBe(false);
  });

  it("returns true for a supertag field filter", () => {
    const where: (WhereClause | WhereGroup)[] = [
      { field: "Time Sector", operator: "=", value: "🔴 This week" },
    ];
    expect(whereUsesFieldValue(where)).toBe(true);
  });

  it("strips the 'fields.' prefix before matching against core fields", () => {
    // `fields.created` is NOT a core attribute — it's a user-named field
    // that happens to start with "fields." (the prefix is a bag of
    // field-values paths, not a core indicator).
    const where: (WhereClause | WhereGroup)[] = [
      { field: "fields.Status", operator: "=", value: "Done" },
    ];
    expect(whereUsesFieldValue(where)).toBe(true);
  });

  it("recurses into AND groups", () => {
    const where: (WhereClause | WhereGroup)[] = [
      {
        type: "and",
        clauses: [
          { field: "created", operator: ">", value: 0 },
          { field: "Priority", operator: "=", value: "High" },
        ],
      },
    ];
    expect(whereUsesFieldValue(where)).toBe(true);
  });

  it("recurses into OR groups", () => {
    const where: (WhereClause | WhereGroup)[] = [
      {
        type: "or",
        clauses: [
          { field: "name", operator: "~", value: "hello" },
          { field: "id", operator: "=", value: "abc" },
        ],
      },
    ];
    expect(whereUsesFieldValue(where)).toBe(false);
  });

  it("handles empty where clause", () => {
    expect(whereUsesFieldValue([])).toBe(false);
  });

  it("exports CORE_FIELDS matching the expected attribute set", () => {
    expect(CORE_FIELDS.has("created")).toBe(true);
    expect(CORE_FIELDS.has("updated")).toBe(true);
    expect(CORE_FIELDS.has("done")).toBe(true);
    expect(CORE_FIELDS.has("Time Sector")).toBe(false);
  });
});
