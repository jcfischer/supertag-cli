/**
 * Tags Metadata CLI Command Tests
 *
 * TDD tests for tags inheritance and tags fields subcommands.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { migrateSupertagMetadataSchema } from "../../src/db/migrate";

describe("Tags Metadata CLI Commands", () => {
  const testDir = join(process.cwd(), "tmp-test-tags-metadata");
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

    // Create required base tables (nodes for joins)
    db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT
      )
    `);

    migrateSupertagMetadataSchema(db);

    // Insert test inheritance: manager -> employee -> contact
    db.run(`
      INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
      VALUES
        ('employee-tag', 'contact-tag'),
        ('manager-tag', 'employee-tag')
    `);

    // Insert test fields
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
      VALUES
        ('contact-tag', 'contact', 'Email', 'l1', 0),
        ('contact-tag', 'contact', 'Phone', 'l2', 1),
        ('employee-tag', 'employee', 'Department', 'l3', 0),
        ('employee-tag', 'employee', 'StartDate', 'l4', 1),
        ('manager-tag', 'manager', 'Team', 'l5', 0)
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

  describe("tags inheritance <tagname>", () => {
    it("should show inheritance tree for a tag", async () => {
      const result = await $`bun run src/index.ts tags inheritance manager --db-path ${dbPath}`.text();

      expect(result).toContain("manager");
      expect(result).toContain("employee");
      expect(result).toContain("contact");
    });

    it("should support --flat flag for flattened list", async () => {
      const result = await $`bun run src/index.ts tags inheritance manager --flat --db-path ${dbPath}`.text();

      // Should list ancestors with depth
      expect(result).toContain("employee");
      expect(result).toContain("contact");
    });

    it("should return JSON with --json flag", async () => {
      const result = await $`bun run src/index.ts tags inheritance manager --json --db-path ${dbPath}`.text();

      const parsed = JSON.parse(result);
      expect(parsed.tagId).toBe("manager-tag");
      expect(parsed.parents).toBeDefined();
      expect(Array.isArray(parsed.parents)).toBe(true);
    });

    it("should show no parents for root tag", async () => {
      const result = await $`bun run src/index.ts tags inheritance contact --db-path ${dbPath}`.text();

      expect(result).toContain("contact");
      // Should indicate no parents or show empty tree
    });
  });

  describe("tags fields <tagname>", () => {
    it("should show own fields for a tag", async () => {
      const result = await $`bun run src/index.ts tags fields contact --db-path ${dbPath}`.text();

      expect(result).toContain("Email");
      expect(result).toContain("Phone");
    });

    it("should show all fields including inherited with --all", async () => {
      const result = await $`bun run src/index.ts tags fields manager --all --db-path ${dbPath}`.text();

      // Own field
      expect(result).toContain("Team");
      // Inherited from employee
      expect(result).toContain("Department");
      // Inherited from contact
      expect(result).toContain("Email");
      expect(result).toContain("Phone");
    });

    it("should show only inherited fields with --inherited", async () => {
      const result = await $`bun run src/index.ts tags fields manager --inherited --db-path ${dbPath}`.text();

      // Should show inherited
      expect(result).toContain("Email");
      expect(result).toContain("Department");
      // Should NOT show own
      expect(result).not.toContain("Team");
    });

    it("should show only own fields with --own", async () => {
      const result = await $`bun run src/index.ts tags fields manager --own --db-path ${dbPath}`.text();

      // Should show own
      expect(result).toContain("Team");
      // Should NOT show inherited
      expect(result).not.toContain("Email");
    });

    it("should return JSON with --json flag", async () => {
      const result = await $`bun run src/index.ts tags fields manager --all --json --db-path ${dbPath}`.text();

      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(5); // Team + Department + StartDate + Email + Phone
    });
  });
});
