/**
 * tana_supertag_info MCP Tool Tests
 *
 * TDD tests for querying supertag inheritance and fields via MCP.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import { migrateSupertagMetadataSchema } from "../../src/db/migrate";
import { supertagInfo } from "../../src/mcp/tools/supertag-info";

describe("tana_supertag_info MCP Tool", () => {
  const testDir = join(process.cwd(), "tmp-test-mcp-supertag-info");
  const dbPath = join(testDir, "tana-index.db");

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
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("mode: fields", () => {
    it("should return own fields for a tag", async () => {
      const result = await supertagInfo({
        tagname: "contact",
        mode: "fields",
        _dbPath: dbPath,
      });

      expect(result.tagname).toBe("contact");
      expect(result.fields).toBeDefined();
      expect(result.fields!.length).toBe(2);
      expect(result.fields!.map((f: { name: string }) => f.name)).toContain("Email");
      expect(result.fields!.map((f: { name: string }) => f.name)).toContain("Phone");
    });

    it("should return all fields including inherited with includeInherited", async () => {
      const result = await supertagInfo({
        tagname: "manager",
        mode: "fields",
        includeInherited: true,
        _dbPath: dbPath,
      });

      expect(result.fields!.length).toBe(5); // Team + Department + StartDate + Email + Phone
      // Inherited fields should have origin info
      const emailField = result.fields!.find((f: { name: string }) => f.name === "Email");
      expect(emailField).toBeDefined();
      expect(emailField?.origin).toBe("contact");
    });
  });

  describe("mode: inheritance", () => {
    it("should return direct parents", async () => {
      const result = await supertagInfo({
        tagname: "employee",
        mode: "inheritance",
        _dbPath: dbPath,
      });

      expect(result.tagname).toBe("employee");
      expect(result.parents).toBeDefined();
      expect(result.parents!.length).toBe(1);
      expect(result.parents![0]).toBe("contact");
    });

    it("should return full inheritance chain with includeAncestors", async () => {
      const result = await supertagInfo({
        tagname: "manager",
        mode: "inheritance",
        includeAncestors: true,
        _dbPath: dbPath,
      });

      expect(result.ancestors).toBeDefined();
      expect(result.ancestors!.length).toBe(2);
      // Should include employee (depth 1) and contact (depth 2)
      expect(result.ancestors!.map((a: { name: string }) => a.name)).toContain("employee");
      expect(result.ancestors!.map((a: { name: string }) => a.name)).toContain("contact");
    });

    it("should return empty for root tag", async () => {
      const result = await supertagInfo({
        tagname: "contact",
        mode: "inheritance",
        _dbPath: dbPath,
      });

      expect(result.parents).toEqual([]);
    });
  });

  describe("mode: full", () => {
    it("should return both fields and inheritance", async () => {
      const result = await supertagInfo({
        tagname: "manager",
        mode: "full",
        _dbPath: dbPath,
      });

      expect(result.fields).toBeDefined();
      expect(result.parents).toBeDefined();
      expect(result.ancestors).toBeDefined();
    });
  });
});
