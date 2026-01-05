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
import { migrateSupertagMetadataSchema, migrateSchemaConsolidation } from "../../src/db/migrate";

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
    migrateSchemaConsolidation(db);

    // Create tag_applications table (used for usage counts)
    db.run(`
      CREATE TABLE IF NOT EXISTS tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_node_id TEXT NOT NULL,
        data_node_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL
      )
    `);

    // Insert test supertag metadata
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES
        ('contact-tag', 'contact', 'contact'),
        ('employee-tag', 'employee', 'employee'),
        ('manager-tag', 'manager', 'manager')
    `);

    // Insert test inheritance: manager -> employee -> contact
    db.run(`
      INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
      VALUES
        ('employee-tag', 'contact-tag'),
        ('manager-tag', 'employee-tag')
    `);

    // Insert test fields with inferred data types
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
      VALUES
        ('contact-tag', 'contact', 'Email', 'l1', 0, 'email'),
        ('contact-tag', 'contact', 'Phone', 'l2', 1, 'text'),
        ('employee-tag', 'employee', 'Department', 'l3', 0, 'text'),
        ('employee-tag', 'employee', 'StartDate', 'l4', 1, 'date'),
        ('manager-tag', 'manager', 'Team', 'l5', 0, 'text')
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
      expect(parsed.tagId).toBe("manager-tag");
      expect(parsed.tagName).toBe("manager");
      expect(Array.isArray(parsed.fields)).toBe(true);
      expect(parsed.fields.length).toBe(5); // Team + Department + StartDate + Email + Phone
    });

    it("should show field IDs matching tags show format", async () => {
      // Use --format table to explicitly request table output (non-TTY defaults to JSON)
      const result = await $`bun run src/index.ts tags fields contact --format table --db-path ${dbPath}`.text();

      // Should show field IDs like tags show does
      expect(result).toContain("(l1)"); // Email field ID
      expect(result).toContain("(l2)"); // Phone field ID
    });

    it("should show field type when available", async () => {
      // First update a field with a type
      const db = new Database(dbPath);
      db.run(`UPDATE supertag_fields SET inferred_data_type = 'email' WHERE field_name = 'Email'`);
      db.run(`UPDATE supertag_fields SET inferred_data_type = 'text' WHERE field_name = 'Phone'`);
      db.close();

      // Use --format table to explicitly request table output (non-TTY defaults to JSON)
      const result = await $`bun run src/index.ts tags fields contact --format table --db-path ${dbPath}`.text();

      // Should show field types like tags show does
      expect(result).toContain("Type: email");
      expect(result).toContain("Type: text");
    });

    it("should show inherited field origin with ID and type", async () => {
      // Use --format table to explicitly request table output (non-TTY defaults to JSON)
      const result = await $`bun run src/index.ts tags fields manager --all --format table --db-path ${dbPath}`.text();

      // Should show field IDs for inherited fields with origin: "(id, from origin)"
      expect(result).toContain("(l1, from contact)"); // Email field ID with origin
      // Should show type for inherited fields
      expect(result).toContain("Type: email");
    });
  });

  describe("tags show <tagname> --all", () => {
    it("should show own fields by default", async () => {
      // Use --format table to explicitly request table output (non-TTY defaults to JSON)
      const result = await $`bun run src/index.ts tags show manager --format table --db-path ${dbPath}`.text();

      // Should show own field
      expect(result).toContain("Team");
      // Should NOT show inherited fields without --all
      expect(result).not.toContain("Email");
      expect(result).not.toContain("Department");
    });

    it("should show all fields including inherited with --all", async () => {
      // Use --format table to explicitly request table output (non-TTY defaults to JSON)
      const result = await $`bun run src/index.ts tags show manager --all --format table --db-path ${dbPath}`.text();

      // Should show own field
      expect(result).toContain("Team");
      // Should show inherited from employee
      expect(result).toContain("Department");
      // Should show inherited from contact with origin
      expect(result).toContain("Email");
      expect(result).toContain("from contact");
    });
  });
});
