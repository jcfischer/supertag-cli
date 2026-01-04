/**
 * Tags Visualize Command Tests
 *
 * TDD tests for the `supertag tags visualize` subcommand.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

describe("tags visualize command", () => {
  const testDir = "/tmp/supertag-visualize-test";
  const testDbPath = join(testDir, "tana-index.db");

  beforeAll(() => {
    // Clean up and create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Create test database
    const db = new Database(testDbPath);

    db.run(`
      CREATE TABLE supertag_metadata (
        tag_id TEXT PRIMARY KEY,
        tag_name TEXT NOT NULL,
        normalized_name TEXT,
        description TEXT,
        color TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE supertag_parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_tag_id TEXT NOT NULL,
        parent_tag_id TEXT NOT NULL,
        UNIQUE(child_tag_id, parent_tag_id)
      )
    `);

    db.run(`
      CREATE TABLE supertag_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_label_id TEXT,
        field_order INTEGER DEFAULT 0,
        inferred_data_type TEXT,
        target_supertag_id TEXT,
        target_supertag_name TEXT
      )
    `);

    db.run(`
      CREATE TABLE tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        tag_id TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT
      )
    `);

    // Insert test data - include nodes for metadata service fallback
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, color) VALUES
      ('tag_entity', 'entity', '#E8E8E8'),
      ('tag_person', 'person', '#B5D8FF'),
      ('tag_meeting', 'meeting', '#FFD700')
    `);

    db.run(`INSERT INTO nodes (id, name) VALUES
      ('tag_entity', 'entity'),
      ('tag_person', 'person'),
      ('tag_meeting', 'meeting')
    `);

    db.run(`INSERT INTO supertag_parents (child_tag_id, parent_tag_id) VALUES
      ('tag_person', 'tag_entity'),
      ('tag_meeting', 'tag_entity')
    `);

    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name) VALUES
      ('tag_person', 'person', 'Email'),
      ('tag_person', 'person', 'Phone'),
      ('tag_meeting', 'meeting', 'Date')
    `);

    db.close();
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("basic functionality", () => {
    it("should output mermaid format by default", async () => {
      const result = await $`bun run src/index.ts tags visualize --db-path ${testDbPath}`.text();

      expect(result).toContain("flowchart BT");
      expect(result).toContain("tag_entity");
      expect(result).toContain("tag_person");
      expect(result).toContain("-->");
    });

    it("should support --format mermaid explicitly", async () => {
      const result = await $`bun run src/index.ts tags visualize --format mermaid --db-path ${testDbPath}`.text();

      expect(result).toContain("flowchart BT");
    });

    it("should support --format dot", async () => {
      const result = await $`bun run src/index.ts tags visualize --format dot --db-path ${testDbPath}`.text();

      expect(result).toContain("digraph supertags {");
      expect(result).toContain("rankdir=BT");
      expect(result).toContain("->");
    });

    it("should support --format json", async () => {
      const result = await $`bun run src/index.ts tags visualize --format json --db-path ${testDbPath}`.text();

      const parsed = JSON.parse(result);
      expect(parsed.nodes).toBeDefined();
      expect(parsed.links).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });
  });

  describe("filter options", () => {
    it("should support --root to filter subtree", async () => {
      const result = await $`bun run src/index.ts tags visualize --root entity --format json --db-path ${testDbPath}`.text();

      const parsed = JSON.parse(result);
      expect(parsed.metadata.rootTag).toBe("entity");
    });

    it("should support --orphans to include orphan tags", async () => {
      // First without --orphans
      const without = await $`bun run src/index.ts tags visualize --format json --db-path ${testDbPath}`.text();
      const parsedWithout = JSON.parse(without);

      // With --orphans (entity has no parents, but it's part of inheritance so included anyway)
      const withOrphans = await $`bun run src/index.ts tags visualize --orphans --format json --db-path ${testDbPath}`.text();
      const parsedWith = JSON.parse(withOrphans);

      // Both should work without error
      expect(parsedWithout.nodes).toBeDefined();
      expect(parsedWith.nodes).toBeDefined();
    });
  });

  describe("output options", () => {
    it("should support --output to write to file", async () => {
      const outputFile = join(testDir, "output.md");

      await $`bun run src/index.ts tags visualize --output ${outputFile} --db-path ${testDbPath}`;

      expect(existsSync(outputFile)).toBe(true);
      const content = readFileSync(outputFile, "utf-8");
      expect(content).toContain("flowchart BT");
    });
  });

  describe("direction options", () => {
    it("should support --direction for mermaid", async () => {
      const result = await $`bun run src/index.ts tags visualize --direction TD --db-path ${testDbPath}`.text();

      expect(result).toContain("flowchart TD");
    });

    it("should support --direction for dot", async () => {
      const result = await $`bun run src/index.ts tags visualize --format dot --direction LR --db-path ${testDbPath}`.text();

      expect(result).toContain("rankdir=LR");
    });
  });

  describe("display options", () => {
    it("should support --show-fields to show field names", async () => {
      const result = await $`bun run src/index.ts tags visualize --show-fields --db-path ${testDbPath}`.text();

      // With --show-fields, should show actual field names (Email, Phone for person tag)
      expect(result).toContain("Email");
      expect(result).toContain("Phone");
    });

    it("should support --colors for dot format", async () => {
      const result = await $`bun run src/index.ts tags visualize --format dot --colors --db-path ${testDbPath}`.text();

      expect(result).toContain('fillcolor="#');
    });
  });
});
