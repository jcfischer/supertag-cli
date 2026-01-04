/**
 * T-3.1 & T-3.2: Tests for codegen CLI command
 * TDD: RED phase - write tests before implementation
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Test setup - create temp directory with database
const testDir = join(tmpdir(), `supertag-codegen-test-${Date.now()}`);
const dbPath = join(testDir, "tana-index.db");
const outputDir = join(testDir, "generated");

function createTestDb(): Database {
  mkdirSync(testDir, { recursive: true });
  const db = new Database(dbPath);

  // Create schema tables
  db.run(`
    CREATE TABLE supertag_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id TEXT UNIQUE NOT NULL,
      tag_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE supertag_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id TEXT NOT NULL,
      tag_name TEXT,
      field_name TEXT NOT NULL,
      field_label_id TEXT NOT NULL,
      field_order INTEGER DEFAULT 0,
      normalized_name TEXT,
      description TEXT,
      inferred_data_type TEXT,
        target_supertag_id TEXT,
        target_supertag_name TEXT,
        target_supertag_id TEXT,
        target_supertag_name TEXT
    )
  `);

  db.run(`
    CREATE TABLE supertag_parents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_tag_id TEXT NOT NULL,
      parent_tag_id TEXT NOT NULL
    )
  `);

  // Insert test data
  db.run(`
    INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description)
    VALUES
      ('todo123', 'TodoItem', 'todoitem', 'A task to complete'),
      ('person456', 'Person', 'person', 'A person entity'),
      ('employee789', 'Employee', 'employee', 'An employee')
  `);

  db.run(`
    INSERT INTO supertag_fields (tag_id, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
    VALUES
      ('todo123', 'Title', 'title_id', 0, 'title', 'text'),
      ('todo123', 'Due Date', 'duedate_id', 1, 'duedate', 'date'),
      ('todo123', 'Completed', 'completed_id', 2, 'completed', 'checkbox'),
      ('person456', 'Name', 'name_id', 0, 'name', 'text'),
      ('person456', 'Email', 'email_id', 1, 'email', 'email'),
      ('employee789', 'Department', 'dept_id', 0, 'department', 'text')
  `);

  // Employee extends Person
  db.run(`
    INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
    VALUES ('employee789', 'person456')
  `);

  return db;
}

describe("codegen CLI command", () => {
  let db: Database;

  beforeAll(() => {
    db = createTestDb();
    mkdirSync(outputDir, { recursive: true });
  });

  afterAll(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("codegenCommand", () => {
    it("should generate Effect schemas to output path", async () => {
      // Import the command function directly for testing
      const { codegenCommand } = await import("../../src/commands/codegen");

      const outputPath = join(outputDir, "schemas.ts");
      await codegenCommand({
        output: outputPath,
        format: "effect",
        workspace: undefined,
        tags: undefined,
        optional: "option",
        naming: "camelCase",
        split: false,
        dryRun: false,
        noMetadata: false,
      }, dbPath);

      expect(existsSync(outputPath)).toBe(true);
      const content = readFileSync(outputPath, "utf-8");
      expect(content).toContain("export class TodoItem");
      expect(content).toContain("export class Person");
      expect(content).toContain('import { Schema } from "effect"');
    });

    it("should respect --tags filter", async () => {
      const { codegenCommand } = await import("../../src/commands/codegen");

      const outputPath = join(outputDir, "filtered.ts");
      await codegenCommand({
        output: outputPath,
        format: "effect",
        workspace: undefined,
        tags: ["TodoItem"],
        optional: "option",
        naming: "camelCase",
        split: false,
        dryRun: false,
        noMetadata: false,
      }, dbPath);

      expect(existsSync(outputPath)).toBe(true);
      const content = readFileSync(outputPath, "utf-8");
      expect(content).toContain("export class TodoItem");
      expect(content).not.toContain("export class Person");
    });

    it("should support dry-run mode", async () => {
      const { codegenCommand } = await import("../../src/commands/codegen");

      const outputPath = join(outputDir, "dryrun.ts");
      const result = await codegenCommand({
        output: outputPath,
        format: "effect",
        workspace: undefined,
        tags: undefined,
        optional: "option",
        naming: "camelCase",
        split: false,
        dryRun: true,
        noMetadata: false,
      }, dbPath);

      // In dry-run mode, file should not be created
      expect(existsSync(outputPath)).toBe(false);
      // But result should still contain the generated content
      expect(result.files.length).toBeGreaterThan(0);
    });

    it("should support --no-metadata option", async () => {
      const { codegenCommand } = await import("../../src/commands/codegen");

      const outputPath = join(outputDir, "no-meta.ts");
      await codegenCommand({
        output: outputPath,
        format: "effect",
        workspace: undefined,
        tags: undefined,
        optional: "option",
        naming: "camelCase",
        split: false,
        dryRun: false,
        noMetadata: true,
      }, dbPath);

      expect(existsSync(outputPath)).toBe(true);
      const content = readFileSync(outputPath, "utf-8");
      expect(content).not.toContain("Generated from Tana supertag:");
      expect(content).not.toContain("Supertag ID:");
    });

    it("should support different optional strategies", async () => {
      const { codegenCommand } = await import("../../src/commands/codegen");

      const outputPath = join(outputDir, "undefined-opt.ts");
      await codegenCommand({
        output: outputPath,
        format: "effect",
        workspace: undefined,
        tags: ["TodoItem"],
        optional: "undefined",
        naming: "camelCase",
        split: false,
        dryRun: false,
        noMetadata: true,
      }, dbPath);

      expect(existsSync(outputPath)).toBe(true);
      const content = readFileSync(outputPath, "utf-8");
      // When using "undefined" strategy, fields should use Schema.optional
      expect(content).toContain("Schema.optional");
    });
  });

  describe("inheritance support", () => {
    it("should generate parent class before child class", async () => {
      const { codegenCommand } = await import("../../src/commands/codegen");

      const outputPath = join(outputDir, "inherit.ts");
      await codegenCommand({
        output: outputPath,
        format: "effect",
        workspace: undefined,
        tags: undefined,
        optional: "option",
        naming: "camelCase",
        split: false,
        dryRun: false,
        noMetadata: true,
      }, dbPath);

      expect(existsSync(outputPath)).toBe(true);
      const content = readFileSync(outputPath, "utf-8");

      // Person should appear before Employee
      const personIndex = content.indexOf("export class Person");
      const employeeIndex = content.indexOf("export class Employee");
      expect(personIndex).toBeGreaterThan(-1);
      expect(employeeIndex).toBeGreaterThan(-1);
      expect(personIndex).toBeLessThan(employeeIndex);

      // Employee should extend Person
      expect(content).toContain("extends Person.extend");
    });
  });

  describe("multi-file output mode", () => {
    it("should generate separate files per supertag with --split", async () => {
      const { codegenCommand } = await import("../../src/commands/codegen");

      const outputPath = join(outputDir, "split/schemas.ts");
      await codegenCommand({
        output: outputPath,
        format: "effect",
        workspace: undefined,
        tags: ["TodoItem", "Person"],
        optional: "option",
        naming: "camelCase",
        split: true,
        dryRun: false,
        noMetadata: true,
      }, dbPath);

      // Check individual files exist
      const splitDir = join(outputDir, "split/schemas");
      expect(existsSync(join(splitDir, "TodoItem.ts"))).toBe(true);
      expect(existsSync(join(splitDir, "Person.ts"))).toBe(true);
      expect(existsSync(join(splitDir, "index.ts"))).toBe(true);

      // Check index re-exports
      const indexContent = readFileSync(join(splitDir, "index.ts"), "utf-8");
      expect(indexContent).toContain('export * from "./TodoItem"');
      expect(indexContent).toContain('export * from "./Person"');

      // Check individual file content
      const todoContent = readFileSync(join(splitDir, "TodoItem.ts"), "utf-8");
      expect(todoContent).toContain("export class TodoItem");
      expect(todoContent).toContain('import { Schema } from "effect"');
    });
  });
});
