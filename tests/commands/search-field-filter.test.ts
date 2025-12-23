/**
 * Search Field Filter CLI Command Tests
 *
 * TDD tests for --field filter on search command.
 * Enables searching nodes by field values.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { migrateSupertagMetadataSchema } from "../../src/db/migrate";

describe("Search Field Filter CLI Commands", () => {
  const testDir = join(process.cwd(), "tmp-test-search-field-filter");
  const dbPath = join(testDir, "main", "tana-index.db");
  const configPath = join(testDir, "config.json");
  const schemaPath = join(testDir, "main", "schema.json");

  beforeAll(() => {
    // Create test directory structure
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(join(testDir, "main"), { recursive: true });

    // Create test database
    const db = new Database(dbPath);

    // Create required base tables
    db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        created INTEGER,
        updated INTEGER
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS field_values (
        node_id TEXT,
        field_name TEXT,
        field_value TEXT,
        PRIMARY KEY (node_id, field_name)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tag_applications (
        node_id TEXT,
        tag_id TEXT,
        tag_name TEXT,
        PRIMARY KEY (node_id, tag_id)
      )
    `);

    migrateSupertagMetadataSchema(db);

    // Insert test nodes: meetings with Location field
    const nodes = [
      { id: "meeting1", name: "Team sync Zurich", created: 1700000000000 },
      { id: "meeting2", name: "Client call Berlin", created: 1700100000000 },
      { id: "meeting3", name: "Workshop Zurich", created: 1700200000000 },
      { id: "meeting4", name: "All hands Remote", created: 1700300000000 },
    ];

    for (const node of nodes) {
      db.run(
        `INSERT INTO nodes (id, name, created) VALUES (?, ?, ?)`,
        [node.id, node.name, node.created]
      );
      db.run(
        `INSERT INTO tag_applications (node_id, tag_id, tag_name) VALUES (?, ?, ?)`,
        [node.id, "meeting-tag", "meeting"]
      );
    }

    // Insert field values (Location field for meetings)
    const fieldValues = [
      { node_id: "meeting1", field_name: "Location", field_value: "Zurich" },
      { node_id: "meeting2", field_name: "Location", field_value: "Berlin" },
      { node_id: "meeting3", field_name: "Location", field_value: "Zurich" },
      { node_id: "meeting4", field_name: "Location", field_value: "Remote" },
    ];

    for (const fv of fieldValues) {
      db.run(
        `INSERT INTO field_values (node_id, field_name, field_value) VALUES (?, ?, ?)`,
        [fv.node_id, fv.field_name, fv.field_value]
      );
    }

    // Insert supertag field definition
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
      VALUES ('meeting-tag', 'meeting', 'Location', 'loc-label', 0)
    `);

    db.close();

    // Create minimal config
    const config = {
      version: 1,
      workspaces: {
        main: {
          exportPath: testDir,
          dataPath: join(testDir, "main"),
        },
      },
      defaultWorkspace: "main",
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create minimal schema
    const schema = { supertags: [], lastUpdated: Date.now() };
    writeFileSync(schemaPath, JSON.stringify(schema));
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("search --tag --field", () => {
    it("should filter nodes by field value", async () => {
      const result = await $`bun run src/index.ts search --tag meeting --field "Location=Zurich" --db-path ${dbPath}`.text();

      // Should find 2 meetings in Zurich
      expect(result).toContain("Zurich");
      expect(result).not.toContain("Berlin");
      expect(result).not.toContain("Remote");
    });

    it("should support partial field value match", async () => {
      const result = await $`bun run src/index.ts search --tag meeting --field "Location~Zur" --db-path ${dbPath}`.text();

      // Should find meetings containing "Zur" in Location
      expect(result).toContain("Zurich");
    });

    it("should return JSON with --json flag", async () => {
      const result = await $`bun run src/index.ts search --tag meeting --field "Location=Zurich" --json --db-path ${dbPath}`.text();

      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      // Both results should be in Zurich
      expect(parsed.every((n: { name: string }) => n.name.includes("Zurich"))).toBe(true);
    });

    it("should return empty when no matches", async () => {
      const result = await $`bun run src/index.ts search --tag meeting --field "Location=Tokyo" --json --db-path ${dbPath}`.text();

      const parsed = JSON.parse(result);
      expect(parsed).toEqual([]);
    });
  });
});
