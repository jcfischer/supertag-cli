/**
 * Tests for calendar/day page smart depth defaults (Issue #37, #65)
 *
 * Day pages (journalPart) default to depth 2 when --depth is not explicitly set,
 * so section children (Todos, Notes, Collected) AND their child nodes are visible
 * without requiring the user to specify --depth.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { isCalendarNode, resolveEffectiveDepth } from "../../src/commands/show";
import { unlinkSync, existsSync } from "fs";

const TEST_DB_PATH = "./test-calendar-depth.db";

describe("isCalendarNode", () => {
  let db: Database;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    db = new Database(TEST_DB_PATH);

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

    // Day page node (journalPart)
    db.run(
      "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "day-page-1",
        "2026-02-04 - Wednesday",
        "calendar-root",
        "node",
        1738627200000,
        null,
        null,
        JSON.stringify({
          id: "day-page-1",
          props: { name: "2026-02-04 - Wednesday", _docType: "journalPart" },
          children: ["section-todos", "section-notes"],
        }),
      ]
    );

    // Week page node (journalPart)
    db.run(
      "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "week-page-1",
        "Week 6",
        "calendar-root",
        "node",
        1738627200000,
        null,
        null,
        JSON.stringify({
          id: "week-page-1",
          props: { name: "Week 6", _docType: "journalPart" },
          children: ["day-page-1"],
        }),
      ]
    );

    // Calendar root (journal)
    db.run(
      "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "calendar-root",
        "Calendar",
        null,
        "node",
        1738627200000,
        null,
        null,
        JSON.stringify({
          id: "calendar-root",
          props: { name: "Calendar", _docType: "journal" },
          children: ["week-page-1"],
        }),
      ]
    );

    // Regular node (no special docType)
    db.run(
      "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "regular-node",
        "My Project",
        null,
        "node",
        1738627200000,
        null,
        null,
        JSON.stringify({
          id: "regular-node",
          props: { name: "My Project" },
          children: ["child-1"],
        }),
      ]
    );

    // Node with null docType
    db.run(
      "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "null-doctype",
        "Some Node",
        null,
        "node",
        1738627200000,
        null,
        null,
        JSON.stringify({
          id: "null-doctype",
          props: { name: "Some Node", _docType: null },
          children: [],
        }),
      ]
    );

    // Tuple node
    db.run(
      "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "tuple-node",
        null,
        "regular-node",
        "node",
        1738627200000,
        null,
        null,
        JSON.stringify({
          id: "tuple-node",
          props: { _docType: "tuple" },
          children: [],
        }),
      ]
    );
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it("returns true for journalPart (day page)", () => {
    expect(isCalendarNode(db, "day-page-1")).toBe(true);
  });

  it("returns true for journalPart (week page)", () => {
    expect(isCalendarNode(db, "week-page-1")).toBe(true);
  });

  it("returns true for journal (calendar root)", () => {
    expect(isCalendarNode(db, "calendar-root")).toBe(true);
  });

  it("returns false for regular nodes", () => {
    expect(isCalendarNode(db, "regular-node")).toBe(false);
  });

  it("returns false for nodes with null docType", () => {
    expect(isCalendarNode(db, "null-doctype")).toBe(false);
  });

  it("returns false for tuple nodes", () => {
    expect(isCalendarNode(db, "tuple-node")).toBe(false);
  });

  it("returns false for non-existent nodes", () => {
    expect(isCalendarNode(db, "nonexistent")).toBe(false);
  });
});

describe("resolveEffectiveDepth", () => {
  let db: Database;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    db = new Database(TEST_DB_PATH);

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

    // Day page
    db.run(
      "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "day-page",
        "2026-02-04 - Wednesday",
        null,
        "node",
        1738627200000,
        null,
        null,
        JSON.stringify({
          id: "day-page",
          props: { name: "2026-02-04 - Wednesday", _docType: "journalPart" },
          children: ["section-1"],
        }),
      ]
    );

    // Regular node
    db.run(
      "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "regular",
        "Project",
        null,
        "node",
        1738627200000,
        null,
        null,
        JSON.stringify({
          id: "regular",
          props: { name: "Project" },
          children: ["child-1"],
        }),
      ]
    );
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it("auto-expands day page to depth 2 when depth not explicitly set", () => {
    expect(resolveEffectiveDepth(db, "day-page", 0, false)).toBe(2);
  });

  it("keeps depth 0 for regular nodes when not explicitly set", () => {
    expect(resolveEffectiveDepth(db, "regular", 0, false)).toBe(0);
  });

  it("respects explicit depth 0 for day pages", () => {
    expect(resolveEffectiveDepth(db, "day-page", 0, true)).toBe(0);
  });

  it("respects explicit depth 2 for day pages", () => {
    expect(resolveEffectiveDepth(db, "day-page", 2, true)).toBe(2);
  });

  it("respects explicit depth 3 for regular nodes", () => {
    expect(resolveEffectiveDepth(db, "regular", 3, true)).toBe(3);
  });

  it("does not auto-expand when depth is already > 0", () => {
    // If somehow requestedDepth is 2 but not explicitly set, keep it
    expect(resolveEffectiveDepth(db, "day-page", 2, false)).toBe(2);
  });
});
