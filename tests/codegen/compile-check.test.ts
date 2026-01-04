/**
 * T-4.1: TypeScript Compilation Validation Tests
 *
 * These tests verify that generated Effect Schema code is syntactically valid
 * and can be imported/evaluated by Bun's transpiler.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";

const testDir = join(tmpdir(), `supertag-compile-check-${Date.now()}`);
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

  // Insert diverse test data covering all data types
  db.run(`
    INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description)
    VALUES
      ('task001', 'Task', 'task', 'A task to complete'),
      ('project002', 'Project', 'project', 'A project entity'),
      ('milestone003', 'Milestone', 'milestone', 'Project milestone'),
      ('contact004', 'Contact', 'contact', 'A contact person')
  `);

  // Insert fields with all data types
  db.run(`
    INSERT INTO supertag_fields (tag_id, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
    VALUES
      -- Task fields covering all types
      ('task001', 'Title', 'title_id', 0, 'title', 'text'),
      ('task001', 'Due Date', 'duedate_id', 1, 'dueDate', 'date'),
      ('task001', 'Completed', 'completed_id', 2, 'completed', 'checkbox'),
      ('task001', 'Priority', 'priority_id', 3, 'priority', 'number'),
      ('task001', 'Website', 'website_id', 4, 'website', 'url'),
      ('task001', 'Contact Email', 'email_id', 5, 'contactEmail', 'email'),
      ('task001', 'Assigned To', 'assigned_id', 6, 'assignedTo', 'reference'),
      ('task001', 'Status', 'status_id', 7, 'status', 'options'),

      -- Project fields
      ('project002', 'Name', 'name_id', 0, 'name', 'text'),
      ('project002', 'Start Date', 'start_id', 1, 'startDate', 'date'),
      ('project002', 'Budget', 'budget_id', 2, 'budget', 'number'),

      -- Milestone fields (inherits from Project)
      ('milestone003', 'Target Date', 'target_id', 0, 'targetDate', 'date'),
      ('milestone003', 'Achieved', 'achieved_id', 1, 'achieved', 'checkbox'),

      -- Contact fields
      ('contact004', 'Full Name', 'fullname_id', 0, 'fullName', 'text'),
      ('contact004', 'Email', 'cemail_id', 1, 'email', 'email'),
      ('contact004', 'LinkedIn', 'linkedin_id', 2, 'linkedIn', 'url')
  `);

  // Set up inheritance: Milestone extends Project
  db.run(`
    INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
    VALUES ('milestone003', 'project002')
  `);

  return db;
}

describe("TypeScript code validation", () => {
  let db: Database;

  beforeAll(() => {
    db = createTestDb();
    mkdirSync(outputDir, { recursive: true });
  });

  afterAll(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should generate valid TypeScript syntax", async () => {
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
      noMetadata: true,
    }, dbPath);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf-8");

    // Verify generated code structure
    expect(content).toContain('import { Schema } from "effect"');
    expect(content).toContain("export class Task extends Schema.Class<Task>");
    expect(content).toContain("export class Project extends Schema.Class<Project>");
    expect(content).toContain("export class Contact extends Schema.Class<Contact>");
    expect(content).toContain("export class Milestone extends Project.extend<Milestone>");

    // Verify all data type mappings are present
    expect(content).toContain("Schema.String");  // text
    expect(content).toContain("Schema.DateFromString");  // date
    expect(content).toContain("Schema.Boolean");  // checkbox
    expect(content).toContain("Schema.Number");  // number
    expect(content).toContain('Schema.pattern(/^https?:\\/\\//)');  // url
    expect(content).toContain('Schema.pattern(/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/)');  // email

    // Try to transpile the code using Bun's transpiler
    const transpiler = new Bun.Transpiler({
      loader: "ts",
    });
    let transpileError = null;
    try {
      transpiler.transformSync(content);
    } catch (e) {
      transpileError = e;
    }

    if (transpileError) {
      console.log("Transpilation error:", transpileError);
      console.log("Generated code:", content);
    }
    expect(transpileError).toBeNull();
  });

  it("should generate valid inheritance syntax", async () => {
    const { codegenCommand } = await import("../../src/commands/codegen");

    const outputPath = join(outputDir, "inherit-check.ts");
    await codegenCommand({
      output: outputPath,
      format: "effect",
      workspace: undefined,
      tags: ["Project", "Milestone"],
      optional: "option",
      naming: "camelCase",
      split: false,
      dryRun: false,
      noMetadata: true,
    }, dbPath);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf-8");

    // Verify inheritance structure
    expect(content).toContain("export class Project extends Schema.Class<Project>");
    expect(content).toContain("export class Milestone extends Project.extend<Milestone>");

    // Parent should come before child in the file
    const projectIndex = content.indexOf("export class Project");
    const milestoneIndex = content.indexOf("export class Milestone");
    expect(projectIndex).toBeLessThan(milestoneIndex);

    // Milestone should have its own fields only (not duplicating parent fields)
    const milestoneSection = content.slice(milestoneIndex);
    expect(milestoneSection).toContain("targetDate");
    expect(milestoneSection).toContain("achieved");
    // Parent fields should NOT be in Milestone's definition
    const milestoneClassEnd = milestoneSection.indexOf("}) {}");
    const milestoneDefinition = milestoneSection.slice(0, milestoneClassEnd);
    expect(milestoneDefinition).not.toContain("startDate");

    // Transpile check
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    let transpileError = null;
    try {
      transpiler.transformSync(content);
    } catch (e) {
      transpileError = e;
    }
    expect(transpileError).toBeNull();
  });

  it("should generate valid 'undefined' optional strategy syntax", async () => {
    const { codegenCommand } = await import("../../src/commands/codegen");

    const outputPath = join(outputDir, "undefined-opt.ts");
    await codegenCommand({
      output: outputPath,
      format: "effect",
      workspace: undefined,
      tags: ["Task"],
      optional: "undefined",
      naming: "camelCase",
      split: false,
      dryRun: false,
      noMetadata: true,
    }, dbPath);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf-8");

    // With 'undefined' strategy, should use Schema.optional
    expect(content).toContain("Schema.optional(Schema.String)");
    expect(content).toContain("Schema.optional(Schema.DateFromString)");
    expect(content).not.toContain("optionalWith");

    // Transpile check
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    let transpileError = null;
    try {
      transpiler.transformSync(content);
    } catch (e) {
      transpileError = e;
    }
    expect(transpileError).toBeNull();
  });

  it("should generate valid 'nullable' optional strategy syntax", async () => {
    const { codegenCommand } = await import("../../src/commands/codegen");

    const outputPath = join(outputDir, "nullable-opt.ts");
    await codegenCommand({
      output: outputPath,
      format: "effect",
      workspace: undefined,
      tags: ["Contact"],
      optional: "nullable",
      naming: "camelCase",
      split: false,
      dryRun: false,
      noMetadata: true,
    }, dbPath);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf-8");

    // With 'nullable' strategy, should use Schema.NullOr
    expect(content).toContain("Schema.NullOr(Schema.String)");
    expect(content).not.toContain("optionalWith");
    expect(content).not.toContain("Schema.optional(");

    // Transpile check
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    let transpileError = null;
    try {
      transpiler.transformSync(content);
    } catch (e) {
      transpileError = e;
    }
    expect(transpileError).toBeNull();
  });

  it("should generate valid split files with proper imports", async () => {
    const { codegenCommand } = await import("../../src/commands/codegen");

    const splitDir = join(outputDir, "split-compile");
    mkdirSync(splitDir, { recursive: true });

    const outputPath = join(splitDir, "schemas.ts");
    await codegenCommand({
      output: outputPath,
      format: "effect",
      workspace: undefined,
      tags: ["Project", "Milestone"],
      optional: "option",
      naming: "camelCase",
      split: true,
      dryRun: false,
      noMetadata: true,
    }, dbPath);

    const schemasDir = join(splitDir, "schemas");

    // Check that split files exist
    expect(existsSync(join(schemasDir, "index.ts"))).toBe(true);
    expect(existsSync(join(schemasDir, "Project.ts"))).toBe(true);
    expect(existsSync(join(schemasDir, "Milestone.ts"))).toBe(true);

    // Check Project.ts content and syntax
    const projectContent = readFileSync(join(schemasDir, "Project.ts"), "utf-8");
    expect(projectContent).toContain('import { Schema } from "effect"');
    expect(projectContent).toContain("export class Project extends Schema.Class<Project>");

    const transpiler = new Bun.Transpiler({ loader: "ts" });
    let projectError = null;
    try {
      transpiler.transformSync(projectContent);
    } catch (e) {
      projectError = e;
    }
    expect(projectError).toBeNull();

    // Check Milestone.ts content - should import Project
    const milestoneContent = readFileSync(join(schemasDir, "Milestone.ts"), "utf-8");
    expect(milestoneContent).toContain('import { Schema } from "effect"');
    expect(milestoneContent).toContain('import { Project } from "./Project"');
    expect(milestoneContent).toContain("export class Milestone extends Project.extend<Milestone>");

    let milestoneError = null;
    try {
      transpiler.transformSync(milestoneContent);
    } catch (e) {
      milestoneError = e;
    }
    expect(milestoneError).toBeNull();

    // Check index.ts re-exports
    const indexContent = readFileSync(join(schemasDir, "index.ts"), "utf-8");
    expect(indexContent).toContain('export * from "./Project"');
    expect(indexContent).toContain('export * from "./Milestone"');
  });

  it("should handle all Tana data types correctly", async () => {
    const { codegenCommand } = await import("../../src/commands/codegen");

    const outputPath = join(outputDir, "all-types.ts");
    await codegenCommand({
      output: outputPath,
      format: "effect",
      workspace: undefined,
      tags: ["Task"],
      optional: "option",
      naming: "camelCase",
      split: false,
      dryRun: false,
      noMetadata: true,
    }, dbPath);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf-8");

    // Verify all type mappings for Task which has all data types:
    // text → Schema.String
    expect(content).toMatch(/title.*Schema\.optionalWith\(Schema\.String/);
    // date → Schema.DateFromString
    expect(content).toMatch(/dueDate.*Schema\.optionalWith\(Schema\.DateFromString/);
    // checkbox → Schema.Boolean
    expect(content).toMatch(/completed.*Schema\.optionalWith\(Schema\.Boolean/);
    // number → Schema.Number
    expect(content).toMatch(/priority.*Schema\.optionalWith\(Schema\.Number/);
    // url → Schema.String with URL pattern
    expect(content).toMatch(/website.*Schema\.String\.pipe\(Schema\.pattern\(\/\^https\?/);
    // email → Schema.String with email pattern
    expect(content).toMatch(/contactEmail.*Schema\.String\.pipe\(Schema\.pattern/);
    // reference → Schema.String (references are IDs)
    expect(content).toMatch(/assignedTo.*Schema\.optionalWith\(Schema\.String/);
    // options → Schema.String
    expect(content).toMatch(/status.*Schema\.optionalWith\(Schema\.String/);
  });
});
