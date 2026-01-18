/**
 * tana_create MCP Tool Tests
 *
 * Tests for creating nodes via MCP, with focus on:
 * - Nested children parsing (v1.3.2 bug fix)
 * - Shared parseChildArray function
 * - Reference and URL children
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import { migrateSupertagMetadataSchema, migrateSchemaConsolidation } from "../../src/db/migrate";
import { create } from "../../src/mcp/tools/create";
import { parseChildObject, parseChildArray } from "../../src/services/node-builder";
import { normalizeFieldInput } from "../../src/services/field-normalizer";

describe("tana_create MCP Tool", () => {
  const testDir = join(process.cwd(), "tmp-test-mcp-create");
  const dbPath = join(testDir, "tana-index.db");
  const configPath = join(testDir, "config.json");

  beforeAll(() => {
    // Create test directory structure
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Create test database
    const db = new Database(dbPath);

    // Create required tables
    db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT
      )
    `);

    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);

    // Insert test supertag
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name)
      VALUES
        ('todo-tag', 'todo', 'Status', 'status-id', 0, 'status'),
        ('workshop-tag', 'workshop', 'Topic', 'topic-id', 0, 'topic')
    `);

    db.close();

    // Create minimal config
    writeFileSync(configPath, JSON.stringify({
      apiToken: "test-token",
      defaultTargetNode: "INBOX",
    }));
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  // ============================================================================
  // Shared parseChildObject tests (from node-builder.ts)
  // ============================================================================

  describe("parseChildObject (shared function)", () => {
    it("should parse simple child with name only", () => {
      const result = parseChildObject({ name: "Task 1" });
      expect(result).toEqual({ name: "Task 1" });
    });

    it("should return null for missing name", () => {
      const result = parseChildObject({ id: "abc123" });
      expect(result).toBeNull();
    });

    it("should return null for non-string name", () => {
      const result = parseChildObject({ name: 123 });
      expect(result).toBeNull();
    });

    it("should parse child with id (reference)", () => {
      const result = parseChildObject({ name: "Link", id: "abc123" });
      expect(result).toEqual({ name: "Link", id: "abc123" });
    });

    it("should parse child with dataType url", () => {
      const result = parseChildObject({ name: "https://example.com", dataType: "url" });
      expect(result).toEqual({ name: "https://example.com", dataType: "url" });
    });

    it("should parse child with dataType reference", () => {
      const result = parseChildObject({ name: "Ref", id: "xyz", dataType: "reference" });
      expect(result).toEqual({ name: "Ref", id: "xyz", dataType: "reference" });
    });

    it("should ignore invalid dataType values", () => {
      const result = parseChildObject({ name: "Test", dataType: "invalid" });
      expect(result).toEqual({ name: "Test" });
    });

    it("should parse one level of nested children", () => {
      const result = parseChildObject({
        name: "Section",
        children: [{ name: "Item 1" }, { name: "Item 2" }],
      });
      expect(result).toEqual({
        name: "Section",
        children: [{ name: "Item 1" }, { name: "Item 2" }],
      });
    });

    it("should parse deeply nested children (3 levels)", () => {
      const result = parseChildObject({
        name: "Level 1",
        children: [{
          name: "Level 2",
          children: [{
            name: "Level 3",
          }],
        }],
      });
      expect(result).toEqual({
        name: "Level 1",
        children: [{
          name: "Level 2",
          children: [{ name: "Level 3" }],
        }],
      });
    });

    it("should preserve id and dataType in nested children", () => {
      const result = parseChildObject({
        name: "Parent",
        children: [
          { name: "https://example.com", dataType: "url" },
          { name: "Link", id: "ref123", dataType: "reference" },
        ],
      });
      expect(result).toEqual({
        name: "Parent",
        children: [
          { name: "https://example.com", dataType: "url" },
          { name: "Link", id: "ref123", dataType: "reference" },
        ],
      });
    });

    it("should skip invalid nested children", () => {
      const result = parseChildObject({
        name: "Parent",
        children: [
          { id: "no-name" },  // Invalid - missing name
          { name: "Valid" },
        ],
      });
      expect(result).toEqual({
        name: "Parent",
        children: [{ name: "Valid" }],
      });
    });

    it("should handle empty children array", () => {
      const result = parseChildObject({
        name: "Parent",
        children: [],
      });
      // Empty array should not add children property
      expect(result).toEqual({ name: "Parent" });
    });
  });

  // ============================================================================
  // parseChildArray tests
  // ============================================================================

  describe("parseChildArray (shared function)", () => {
    it("should return undefined for undefined input", () => {
      const result = parseChildArray(undefined);
      expect(result).toBeUndefined();
    });

    it("should return undefined for empty array", () => {
      const result = parseChildArray([]);
      expect(result).toBeUndefined();
    });

    it("should parse array of simple children", () => {
      const result = parseChildArray([
        { name: "Child 1" },
        { name: "Child 2" },
      ]);
      expect(result).toEqual([
        { name: "Child 1" },
        { name: "Child 2" },
      ]);
    });

    it("should skip invalid children in array", () => {
      const result = parseChildArray([
        { name: "Valid 1" },
        { id: "no-name" },  // Invalid
        { name: "Valid 2" },
      ]);
      expect(result).toEqual([
        { name: "Valid 1" },
        { name: "Valid 2" },
      ]);
    });

    it("should return undefined if all children are invalid", () => {
      const result = parseChildArray([
        { id: "no-name-1" },
        { id: "no-name-2" },
      ]);
      expect(result).toBeUndefined();
    });

    it("should handle mixed flat and nested children", () => {
      const result = parseChildArray([
        { name: "Flat child" },
        { name: "Nested parent", children: [{ name: "Nested child" }] },
      ]);
      expect(result).toEqual([
        { name: "Flat child" },
        { name: "Nested parent", children: [{ name: "Nested child" }] },
      ]);
    });
  });

  // ============================================================================
  // Workshop-style hierarchical structure tests (real-world scenario)
  // ============================================================================

  describe("workshop-style hierarchical structures", () => {
    it("should parse workshop notes with sections and items", () => {
      const input = {
        name: "Workshop Notes",
        children: [
          {
            name: "Key Concepts",
            children: [
              { name: "Concept 1" },
              { name: "Concept 2" },
            ],
          },
          {
            name: "Action Items",
            children: [
              { name: "Follow up with team" },
              { name: "Write documentation" },
            ],
          },
          {
            name: "References",
            children: [
              { name: "https://example.com/slides", dataType: "url" },
            ],
          },
        ],
      };

      const result = parseChildObject(input);

      expect(result).toBeDefined();
      expect(result!.name).toBe("Workshop Notes");
      expect(result!.children).toHaveLength(3);

      // Key Concepts section
      expect(result!.children![0].name).toBe("Key Concepts");
      expect(result!.children![0].children).toHaveLength(2);
      expect(result!.children![0].children![0].name).toBe("Concept 1");

      // Action Items section
      expect(result!.children![1].name).toBe("Action Items");
      expect(result!.children![1].children).toHaveLength(2);

      // References section with URL
      expect(result!.children![2].name).toBe("References");
      expect(result!.children![2].children![0].dataType).toBe("url");
    });

    it("should handle impro workshop structure (v1.3.2 bug scenario)", () => {
      // This is the exact structure that failed before the bug fix
      const input = {
        name: "Reimen auf der Improbühne",
        children: [
          {
            name: "Grundlagen",
            children: [
              { name: "Reimtypen (Endreime, Schüttelreime)" },
              { name: "Rhythmus und Metrik" },
            ],
          },
          {
            name: "Übungen",
            children: [
              { name: "ABC-Reimen" },
              { name: "Spontanreime mit Partner" },
            ],
          },
        ],
      };

      const result = parseChildObject(input);

      expect(result).toBeDefined();
      expect(result!.name).toBe("Reimen auf der Improbühne");
      expect(result!.children).toBeDefined();
      expect(result!.children).toHaveLength(2);

      // Verify nested children are preserved (this was the bug)
      expect(result!.children![0].children).toBeDefined();
      expect(result!.children![0].children).toHaveLength(2);
      expect(result!.children![0].children![0].name).toBe("Reimtypen (Endreime, Schüttelreime)");
    });
  });

  // ============================================================================
  // MCP Input schema validation tests
  // ============================================================================

  describe("MCP input type compatibility", () => {
    it("should handle Zod-validated MCP children input", () => {
      // Simulate what MCP receives after Zod validation
      const mcpInput = {
        supertag: "todo",
        name: "Test Node",
        children: [
          { name: "Child 1" },
          { name: "Parent", children: [{ name: "Nested" }] },
        ],
      };

      // Cast to unknown Record like MCP does
      const children = parseChildArray(
        mcpInput.children as Array<Record<string, unknown>>
      );

      expect(children).toEqual([
        { name: "Child 1" },
        { name: "Parent", children: [{ name: "Nested" }] },
      ]);
    });

    it("should handle optional undefined children from MCP", () => {
      const mcpInput = {
        supertag: "todo",
        name: "Test Node",
        // children is undefined (not provided)
      };

      const children = parseChildArray(
        mcpInput.children as Array<Record<string, unknown>> | undefined
      );

      expect(children).toBeUndefined();
    });
  });

  // ============================================================================
  // Edge cases and robustness tests
  // ============================================================================

  describe("edge cases", () => {
    it("should handle null in children array", () => {
      const result = parseChildArray([
        { name: "Valid" },
        null as unknown as Record<string, unknown>,
        { name: "Also valid" },
      ]);
      expect(result).toEqual([
        { name: "Valid" },
        { name: "Also valid" },
      ]);
    });

    it("should handle primitive in children array", () => {
      const result = parseChildArray([
        { name: "Valid" },
        "string" as unknown as Record<string, unknown>,
        123 as unknown as Record<string, unknown>,
        { name: "Also valid" },
      ]);
      expect(result).toEqual([
        { name: "Valid" },
        { name: "Also valid" },
      ]);
    });

    it("should handle very deep nesting (5 levels)", () => {
      const input = {
        name: "L1",
        children: [{
          name: "L2",
          children: [{
            name: "L3",
            children: [{
              name: "L4",
              children: [{
                name: "L5",
              }],
            }],
          }],
        }],
      };

      const result = parseChildObject(input);

      // Navigate to deepest level
      expect(result!.name).toBe("L1");
      expect(result!.children![0].name).toBe("L2");
      expect(result!.children![0].children![0].name).toBe("L3");
      expect(result!.children![0].children![0].children![0].name).toBe("L4");
      expect(result!.children![0].children![0].children![0].children![0].name).toBe("L5");
    });

    it("should handle mixed valid/invalid at multiple nesting levels", () => {
      const input = {
        name: "Root",
        children: [
          { name: "Valid 1" },
          { id: "invalid-1" },  // Invalid at level 1
          {
            name: "Valid parent",
            children: [
              { name: "Valid nested" },
              { id: "invalid-nested" },  // Invalid at level 2
              { name: "Another valid nested" },
            ],
          },
        ],
      };

      const result = parseChildObject(input);

      expect(result!.children).toHaveLength(2);  // Only valid children
      expect(result!.children![0].name).toBe("Valid 1");
      expect(result!.children![1].name).toBe("Valid parent");
      expect(result!.children![1].children).toHaveLength(2);  // Only valid nested
      expect(result!.children![1].children![0].name).toBe("Valid nested");
      expect(result!.children![1].children![1].name).toBe("Another valid nested");
    });

    it("should preserve extra properties gracefully", () => {
      // In case schema adds new properties later
      const input = {
        name: "Node",
        unknownProp: "should be ignored",
        children: [{ name: "Child", anotherUnknown: true }],
      };

      const result = parseChildObject(input);

      // Should only include known properties
      expect(result).toEqual({
        name: "Node",
        children: [{ name: "Child" }],
      });
    });
  });

  // ============================================================================
  // F-091: MCP Unified Field Format Tests
  // ============================================================================

  describe("MCP unified field format (F-091)", () => {
    /**
     * These tests verify that MCP correctly handles the nested field format
     * that is the canonical MCP pattern, as well as flat format for compatibility.
     */

    describe("nested field format (canonical MCP)", () => {
      it("should extract fields from nested format", () => {
        // Standard MCP input format
        const mcpInput = {
          supertag: "todo",
          name: "Complete quarterly report",
          fields: {
            Status: "In Progress",
            "⚙️ Vault": "Work",
            "Due Date": "2024-03-15",
          },
          dryRun: true,
        };

        const result = normalizeFieldInput(mcpInput);

        expect(result.inputFormat).toBe("nested");
        expect(result.fields).toEqual({
          Status: "In Progress",
          "⚙️ Vault": "Work",
          "Due Date": "2024-03-15",
        });
      });

      it("should handle empty nested fields object", () => {
        const mcpInput = {
          supertag: "todo",
          name: "Simple task",
          fields: {},
        };

        const result = normalizeFieldInput(mcpInput);

        expect(result.inputFormat).toBe("nested");
        expect(result.fields).toEqual({});
      });

      it("should handle nested fields with array values", () => {
        const mcpInput = {
          supertag: "todo",
          name: "Tagged task",
          fields: {
            Tags: ["urgent", "customer-facing"],
            Status: "Active",
          },
        };

        const result = normalizeFieldInput(mcpInput);

        expect(result.fields.Tags).toEqual(["urgent", "customer-facing"]);
        expect(result.fields.Status).toBe("Active");
      });
    });

    describe("flat field format (backwards compatibility)", () => {
      it("should accept flat fields for MCP compatibility", () => {
        // Some MCP clients might send flat format
        const flatInput = {
          supertag: "todo",
          name: "Quick task",
          Status: "Done",
          Priority: "High",
        };

        const result = normalizeFieldInput(flatInput);

        expect(result.inputFormat).toBe("flat");
        expect(result.fields).toEqual({
          Status: "Done",
          Priority: "High",
        });
      });
    });

    describe("MCP with children and fields combined", () => {
      it("should handle nested fields with children", () => {
        const mcpInput = {
          supertag: "meeting",
          name: "Team Standup",
          fields: {
            Status: "Scheduled",
            "Meeting Type": "Recurring",
          },
          children: [
            { name: "Agenda item 1" },
            { name: "Agenda item 2" },
          ],
        };

        const result = normalizeFieldInput(mcpInput);

        expect(result.inputFormat).toBe("nested");
        expect(result.fields).toEqual({
          Status: "Scheduled",
          "Meeting Type": "Recurring",
        });
        // Children are not processed by normalizeFieldInput (separate handling)
      });

      it("should handle flat fields with children", () => {
        const mcpInput = {
          supertag: "meeting",
          name: "Team Standup",
          Status: "Scheduled",
          children: [
            { name: "Agenda item 1" },
          ],
        };

        const result = normalizeFieldInput(mcpInput);

        expect(result.inputFormat).toBe("flat");
        expect(result.fields).toEqual({ Status: "Scheduled" });
      });
    });

    describe("MCP real-world scenarios", () => {
      it("should handle workshop creation with nested fields", () => {
        const workshopInput = {
          supertag: "workshop",
          name: "Reimen auf der Improbühne",
          fields: {
            Topic: "Improtheater",
            "⚙️ Vault": "Impro",
            Status: "Planned",
          },
          children: [
            {
              name: "Grundlagen",
              children: [
                { name: "Reimtypen" },
                { name: "Rhythmus und Metrik" },
              ],
            },
          ],
          dryRun: true,
        };

        const result = normalizeFieldInput(workshopInput);

        expect(result.inputFormat).toBe("nested");
        expect(result.fields).toEqual({
          Topic: "Improtheater",
          "⚙️ Vault": "Impro",
          Status: "Planned",
        });
      });

      it("should handle contact creation via MCP", () => {
        const contactInput = {
          supertag: "person",
          name: "John Doe",
          fields: {
            Email: "john@example.com",
            Company: "ACME Corp",
            Role: "Engineer",
          },
        };

        const result = normalizeFieldInput(contactInput);

        expect(result.inputFormat).toBe("nested");
        expect(result.fields.Email).toBe("john@example.com");
        expect(result.fields.Company).toBe("ACME Corp");
        expect(result.fields.Role).toBe("Engineer");
      });

      it("should handle dry run with all MCP options", () => {
        const fullInput = {
          supertag: "todo,project",
          name: "Multi-tag task",
          fields: {
            Status: "Active",
            Priority: "P1",
          },
          target: "INBOX",
          workspace: "main",
          dryRun: true,
        };

        const result = normalizeFieldInput(fullInput);

        expect(result.inputFormat).toBe("nested");
        expect(result.fields).toEqual({
          Status: "Active",
          Priority: "P1",
        });
        // Other keys are reserved and not treated as fields
      });
    });
  });
});
