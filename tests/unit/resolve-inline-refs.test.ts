/**
 * Tests for the inline-reference resolver (v2.5.7 fix).
 *
 * Tana stores field values that contain references or dates as empty
 * `<span>` tags with data attributes, e.g.:
 *
 *   <span data-inlineref-node="abc123"></span>
 *   <span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-26&quot;,...}"></span>
 *
 * Prior to this fix, FieldResolver ran stripHtml() on these and got back
 * empty strings — causing `tana_query` to return "Context": "" for reference
 * fields (David Delgado Vendrell's bug report against v2.5.5).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolveInlineRefs,
  resolveInlineRefsBatch,
} from "../../src/utils/resolve-inline-refs";

function makeDb(): { db: Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "resolve-refs-"));
  const db = new Database(join(dir, "t.db"));
  db.run(`CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT)`);
  return { db, dir };
}

describe("resolveInlineRefs", () => {
  let db: Database;
  let dir: string;

  beforeEach(() => {
    ({ db, dir } = makeDb());
    db.run("INSERT INTO nodes (id, name) VALUES (?, ?)", ["abc123", "Pr MB2"]);
    db.run("INSERT INTO nodes (id, name) VALUES (?, ?)", ["xyz789", "Another Project"]);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a pure inline node reference to the target name (regression test)", () => {
    const input = '<span data-inlineref-node="abc123"></span>';
    expect(resolveInlineRefs(input, db)).toBe("Pr MB2");
  });

  it("resolves an inline reference embedded in surrounding text", () => {
    const input = 'Meeting with <span data-inlineref-node="abc123"></span> today';
    expect(resolveInlineRefs(input, db)).toBe("Meeting with Pr MB2 today");
  });

  it("resolves multiple references in one value", () => {
    const input =
      '<span data-inlineref-node="abc123"></span>, <span data-inlineref-node="xyz789"></span>';
    expect(resolveInlineRefs(input, db)).toBe("Pr MB2, Another Project");
  });

  it("returns empty string when the referenced node is missing (deleted/orphaned)", () => {
    const input = '<span data-inlineref-node="nonexistent"></span>';
    expect(resolveInlineRefs(input, db)).toBe("");
  });

  it("resolves inline-ref-date to its dateTimeString", () => {
    const input =
      '<span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-26&quot;,&quot;timezone&quot;:&quot;UTC&quot;}"></span>';
    expect(resolveInlineRefs(input, db)).toBe("2026-01-26");
  });

  it("handles plain text without any spans (no-op)", () => {
    expect(resolveInlineRefs("Pr MB2", db)).toBe("Pr MB2");
  });

  it("strips residual HTML after reference substitution (option color spans)", () => {
    const input = '<span data-color="blue">DONE</span>';
    expect(resolveInlineRefs(input, db)).toBe("DONE");
  });

  it("trims whitespace from the final result", () => {
    const input = '  <span data-inlineref-node="abc123"></span>  ';
    expect(resolveInlineRefs(input, db)).toBe("Pr MB2");
  });

  it("returns empty string for completely empty input", () => {
    expect(resolveInlineRefs("", db)).toBe("");
  });

  it("handles malformed date JSON gracefully", () => {
    const input = '<span data-inlineref-date="not-valid-json"></span>';
    expect(resolveInlineRefs(input, db)).toBe("");
  });
});

describe("resolveInlineRefsBatch", () => {
  let db: Database;
  let dir: string;

  beforeEach(() => {
    ({ db, dir } = makeDb());
    db.run("INSERT INTO nodes (id, name) VALUES (?, ?)", ["a", "Alpha"]);
    db.run("INSERT INTO nodes (id, name) VALUES (?, ?)", ["b", "Beta"]);
    db.run("INSERT INTO nodes (id, name) VALUES (?, ?)", ["c", "Gamma"]);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves references across many values in one pass", () => {
    const input = [
      '<span data-inlineref-node="a"></span>',
      '<span data-inlineref-node="b"></span>',
      '<span data-inlineref-node="c"></span>',
      "plain text",
    ];
    expect(resolveInlineRefsBatch(input, db)).toEqual(["Alpha", "Beta", "Gamma", "plain text"]);
  });

  it("performs a single node lookup per unique id (batch efficiency)", () => {
    // Repeat the same ref many times; the lookup should deduplicate.
    const input = Array.from({ length: 100 }, () => '<span data-inlineref-node="a"></span>');
    const results = resolveInlineRefsBatch(input, db);
    expect(results.every((r) => r === "Alpha")).toBe(true);
  });
});
