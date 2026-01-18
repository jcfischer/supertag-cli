/**
 * Create Command Tests (T-5.3)
 *
 * Tests for buildNodePayloadFromDatabase function that uses
 * UnifiedSchemaService.buildNodePayload for database-backed node creation.
 *
 * Also includes F-091 unified field format tests for CLI --json input.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { migrateSupertagMetadataSchema, migrateSchemaConsolidation } from "../../src/db/migrate";
import { normalizeFieldInput } from "../../src/services/field-normalizer";

describe("buildNodePayloadFromDatabase (T-5.3)", () => {
  let testDir: string;
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    testDir = join("/tmp", `supertag-create-test-${Date.now()}`);
    dbPath = join(testDir, "tana-index.db");
    mkdirSync(testDir, { recursive: true });

    // Create database with schema
    db = new Database(dbPath);
    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);

    // Insert test supertag with fields
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('todo-id', 'todo', 'todo')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
      VALUES
        ('todo-id', 'todo', 'Status', 'status-attr', 0, 'status', 'text'),
        ('todo-id', 'todo', 'Due Date', 'due-attr', 1, 'duedate', 'date')
    `);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should export buildNodePayloadFromDatabase function", async () => {
    const { buildNodePayloadFromDatabase } = await import("../../src/services/node-builder");
    expect(typeof buildNodePayloadFromDatabase).toBe("function");
  });

  it("should build node payload with supertag from database", async () => {
    const { buildNodePayloadFromDatabase } = await import("../../src/services/node-builder");

    const payload = await buildNodePayloadFromDatabase(dbPath, {
      supertag: "todo",
      name: "Buy groceries",
      fields: {},
    });

    expect(payload.name).toBe("Buy groceries");
    expect(payload.supertags).toBeDefined();
    expect(payload.supertags).toHaveLength(1);
    expect(payload.supertags![0].id).toBe("todo-id");
  });

  it("should build node payload with fields mapped to tuples", async () => {
    const { buildNodePayloadFromDatabase } = await import("../../src/services/node-builder");

    const payload = await buildNodePayloadFromDatabase(dbPath, {
      supertag: "todo",
      name: "Buy groceries",
      fields: { status: "pending" },
    });

    expect(payload.children).toBeDefined();
    // Should have field tuple
    const children = payload.children as Array<{ name?: string; children?: Array<{ name?: string }> }>;
    expect(children.length).toBeGreaterThanOrEqual(1);
  });

  it("should throw for unknown supertag", async () => {
    const { buildNodePayloadFromDatabase } = await import("../../src/services/node-builder");

    await expect(
      buildNodePayloadFromDatabase(dbPath, {
        supertag: "nonexistent",
        name: "Test",
        fields: {},
      })
    ).rejects.toThrow("Unknown supertag");
  });

  it("should handle multiple supertags", async () => {
    // Add another supertag
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('project-id', 'project', 'project')
    `);

    const { buildNodePayloadFromDatabase } = await import("../../src/services/node-builder");

    const payload = await buildNodePayloadFromDatabase(dbPath, {
      supertag: "todo,project",
      name: "Project Task",
      fields: {},
    });

    expect(payload.supertags).toHaveLength(2);
    const tagIds = payload.supertags!.map(t => t.id);
    expect(tagIds).toContain("todo-id");
    expect(tagIds).toContain("project-id");
  });

  it("should include children in payload", async () => {
    const { buildNodePayloadFromDatabase } = await import("../../src/services/node-builder");

    const payload = await buildNodePayloadFromDatabase(dbPath, {
      supertag: "todo",
      name: "Parent Task",
      fields: {},
      children: [
        { name: "Child 1" },
        { name: "Child 2" },
      ],
    });

    expect(payload.children).toBeDefined();
    const children = payload.children as Array<{ name?: string }>;
    const childNames = children.filter(c => c.name === "Child 1" || c.name === "Child 2");
    expect(childNames.length).toBe(2);
  });
});

// =============================================================================
// F-091: CLI --json Field Format Tests
// =============================================================================

describe("CLI --json unified field format (F-091)", () => {
  /**
   * These tests verify that the CLI correctly handles both nested and flat
   * field formats when using --json input, via the normalizeFieldInput function.
   */

  describe("flat field format (existing CLI behavior)", () => {
    it("should extract flat fields from JSON", () => {
      // Simulates: supertag create todo --json '{"name": "Task", "Status": "Done"}'
      const jsonInput = {
        name: "Task",
        Status: "Done",
        Priority: "High",
      };

      const result = normalizeFieldInput(jsonInput);

      expect(result.inputFormat).toBe("flat");
      expect(result.fields).toEqual({
        Status: "Done",
        Priority: "High",
      });
    });

    it("should not include reserved keys as fields", () => {
      const jsonInput = {
        name: "Task",
        supertag: "todo",
        target: "INBOX",
        dryRun: true,
        Status: "Done",
      };

      const result = normalizeFieldInput(jsonInput);

      expect(result.fields).toEqual({ Status: "Done" });
      expect(result.fields).not.toHaveProperty("name");
      expect(result.fields).not.toHaveProperty("supertag");
      expect(result.fields).not.toHaveProperty("target");
      expect(result.fields).not.toHaveProperty("dryRun");
    });
  });

  describe("nested field format (MCP-style)", () => {
    it("should extract fields from nested format", () => {
      // Simulates: supertag create todo --json '{"name": "Task", "fields": {"Status": "Done"}}'
      const jsonInput = {
        name: "Task",
        fields: {
          Status: "Done",
          Priority: "High",
        },
      };

      const result = normalizeFieldInput(jsonInput);

      expect(result.inputFormat).toBe("nested");
      expect(result.fields).toEqual({
        Status: "Done",
        Priority: "High",
      });
    });

    it("should allow reserved key names inside fields object", () => {
      // Inside nested fields, reserved keys become regular field names
      const jsonInput = {
        name: "Task",
        fields: {
          name: "Field named 'name'",
          title: "Field named 'title'",
        },
      };

      const result = normalizeFieldInput(jsonInput);

      expect(result.fields).toEqual({
        name: "Field named 'name'",
        title: "Field named 'title'",
      });
    });
  });

  describe("mixed format (precedence)", () => {
    it("should prefer nested fields over flat for same key", () => {
      // Simulates: supertag create todo --json '{"name": "Task", "Status": "Flat", "fields": {"Status": "Nested"}}'
      const jsonInput = {
        name: "Task",
        Status: "Flat",
        fields: {
          Status: "Nested",
        },
      };

      const result = normalizeFieldInput(jsonInput);

      expect(result.inputFormat).toBe("mixed");
      expect(result.fields.Status).toBe("Nested");
    });

    it("should merge flat and nested fields", () => {
      const jsonInput = {
        name: "Task",
        FlatField: "from flat",
        fields: {
          NestedField: "from nested",
        },
      };

      const result = normalizeFieldInput(jsonInput);

      expect(result.inputFormat).toBe("mixed");
      expect(result.fields).toEqual({
        FlatField: "from flat",
        NestedField: "from nested",
      });
    });
  });

  describe("array field values", () => {
    it("should handle array values in flat format", () => {
      const jsonInput = {
        name: "Task",
        Tags: ["urgent", "bug", "frontend"],
      };

      const result = normalizeFieldInput(jsonInput);

      expect(result.fields.Tags).toEqual(["urgent", "bug", "frontend"]);
    });

    it("should handle array values in nested format", () => {
      const jsonInput = {
        name: "Task",
        fields: {
          Tags: ["urgent", "bug"],
        },
      };

      const result = normalizeFieldInput(jsonInput);

      expect(result.fields.Tags).toEqual(["urgent", "bug"]);
    });
  });

  describe("real-world CLI JSON scenarios", () => {
    it("should handle typical flat CLI input", () => {
      // What users typically pass via CLI
      const cliJson = {
        name: "Complete Q4 Report",
        Status: "In Progress",
        "Due Date": "2025-01-20",
        Assignee: "Alice",
      };

      const result = normalizeFieldInput(cliJson);

      expect(result.inputFormat).toBe("flat");
      expect(result.fields).toEqual({
        Status: "In Progress",
        "Due Date": "2025-01-20",
        Assignee: "Alice",
      });
    });

    it("should handle MCP-style nested input via CLI", () => {
      // When MCP output is piped to CLI
      const mcpStyleJson = {
        supertag: "todo",
        name: "Complete Q4 Report",
        fields: {
          Status: "In Progress",
          "⚙️ Vault": "Work",
        },
        dryRun: true,
      };

      const result = normalizeFieldInput(mcpStyleJson);

      expect(result.inputFormat).toBe("nested");
      expect(result.fields).toEqual({
        Status: "In Progress",
        "⚙️ Vault": "Work",
      });
    });
  });
});
