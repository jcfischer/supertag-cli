/**
 * T-2.3: Tests for codegen orchestrator
 * TDD: RED phase - write tests before implementation
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { generateSchemas, transformSupertag } from "../../src/codegen/index";
import type { CodegenOptions } from "../../src/codegen/types";
import type { UnifiedSupertag, UnifiedField } from "../../src/services/unified-schema-service";

// Create in-memory test database with mock data
function createTestDb(): Database {
  const db = new Database(":memory:");

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
      ('person456', 'Person', 'person', 'A person entity')
  `);

  db.run(`
    INSERT INTO supertag_fields (tag_id, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
    VALUES
      ('todo123', 'Title', 'title_id', 0, 'title', 'text'),
      ('todo123', 'Due Date', 'duedate_id', 1, 'duedate', 'date'),
      ('todo123', 'Completed', 'completed_id', 2, 'completed', 'checkbox'),
      ('person456', 'Name', 'name_id', 0, 'name', 'text'),
      ('person456', 'Email', 'email_id', 1, 'email', 'email')
  `);

  return db;
}

const defaultOptions: CodegenOptions = {
  outputPath: "./generated/schemas.ts",
  format: "effect",
  optionalStrategy: "option",
  naming: "camelCase",
  includeMetadata: true,
  split: false,
  includeInherited: true,
};

describe("transformSupertag", () => {
  it("should transform UnifiedSupertag to CodegenSupertag", () => {
    const input: UnifiedSupertag = {
      id: "abc123",
      name: "TodoItem",
      normalizedName: "todoitem",
      description: "A task",
      fields: [
        {
          tagId: "abc123",
          attributeId: "title_id",
          name: "Title",
          normalizedName: "title",
          dataType: "text",
          order: 0,
        },
      ],
    };

    const result = transformSupertag(input, defaultOptions);

    expect(result.id).toBe("abc123");
    expect(result.name).toBe("TodoItem");
    expect(result.className).toBe("TodoItem");
    expect(result.fields.length).toBe(1);
    expect(result.fields[0].propertyName).toBe("title");
    // All Tana fields are optional
    expect(result.fields[0].effectSchema).toContain("Schema.String");
    expect(result.fields[0].isOptional).toBe(true);
  });

  it("should convert field names to camelCase", () => {
    const input: UnifiedSupertag = {
      id: "abc123",
      name: "TodoItem",
      normalizedName: "todoitem",
      fields: [
        {
          tagId: "abc123",
          attributeId: "duedate_id",
          name: "Due Date",
          normalizedName: "duedate",
          dataType: "date",
          order: 0,
        },
      ],
    };

    const result = transformSupertag(input, defaultOptions);

    expect(result.fields[0].propertyName).toBe("dueDate");
  });

  it("should map data types to Effect schema", () => {
    const input: UnifiedSupertag = {
      id: "abc123",
      name: "Test",
      normalizedName: "test",
      fields: [
        { tagId: "abc123", attributeId: "f1", name: "Text Field", normalizedName: "textfield", dataType: "text", order: 0 },
        { tagId: "abc123", attributeId: "f2", name: "Number Field", normalizedName: "numberfield", dataType: "number", order: 1 },
        { tagId: "abc123", attributeId: "f3", name: "Date Field", normalizedName: "datefield", dataType: "date", order: 2 },
        { tagId: "abc123", attributeId: "f4", name: "Checkbox", normalizedName: "checkbox", dataType: "checkbox", order: 3 },
      ],
    };

    const result = transformSupertag(input, { ...defaultOptions, optionalStrategy: "option" });

    // All fields are optional in Tana
    expect(result.fields[0].effectSchema).toContain("Schema.String");
    expect(result.fields[1].effectSchema).toContain("Schema.Number");
    expect(result.fields[2].effectSchema).toContain("Schema.DateFromString");
    expect(result.fields[3].effectSchema).toContain("Schema.Boolean");
  });

  it("should include description as comment", () => {
    const input: UnifiedSupertag = {
      id: "abc123",
      name: "Test",
      normalizedName: "test",
      fields: [
        {
          tagId: "abc123",
          attributeId: "f1",
          name: "Priority",
          normalizedName: "priority",
          description: "Task priority level",
          dataType: "text",
          order: 0,
        },
      ],
    };

    const result = transformSupertag(input, defaultOptions);

    expect(result.fields[0].comment).toBe("Task priority level");
  });
});

describe("generateSchemas", () => {
  let db: Database;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  it("should generate schemas from database", async () => {
    const result = await generateSchemas(db, defaultOptions);

    expect(result.stats.supertagsProcessed).toBe(2);
    expect(result.stats.filesGenerated).toBe(1);
    expect(result.files.length).toBe(1);
  });

  it("should include all supertags in generated file", async () => {
    const result = await generateSchemas(db, defaultOptions);

    const content = result.files[0].content;
    expect(content).toContain("export class TodoItem");
    expect(content).toContain("export class Person");
  });

  it("should filter by tags when specified", async () => {
    const result = await generateSchemas(db, {
      ...defaultOptions,
      tags: ["TodoItem"],
    });

    expect(result.stats.supertagsProcessed).toBe(1);
    const content = result.files[0].content;
    expect(content).toContain("export class TodoItem");
    expect(content).not.toContain("export class Person");
  });

  it("should include all fields for each supertag", async () => {
    const result = await generateSchemas(db, defaultOptions);

    const content = result.files[0].content;
    // TodoItem fields
    expect(content).toContain("title:");
    expect(content).toContain("dueDate:");
    expect(content).toContain("completed:");
    // Person fields
    expect(content).toContain("name:");
    expect(content).toContain("email:");
  });

  it("should count total fields processed", async () => {
    const result = await generateSchemas(db, defaultOptions);

    // TodoItem has 3 fields, Person has 2 fields
    expect(result.stats.fieldsProcessed).toBe(5);
  });

  it("should use correct output path", async () => {
    const result = await generateSchemas(db, {
      ...defaultOptions,
      outputPath: "./custom/path/schemas.ts",
    });

    expect(result.files[0].path).toBe("./custom/path/schemas.ts");
  });
});
