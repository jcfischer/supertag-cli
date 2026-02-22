/**
 * Tests for Table Export (F-099: Bulk Field Extractor)
 *
 * Tests the core exportTable function and formatting helpers.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import {
  exportTable,
  formatAsMarkdown,
  getDisplayValue,
  getTruncatedDisplayValue,
  type FieldExportValue,
} from "../src/db/table-export";

describe("Table Export (F-099)", () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(":memory:");

    // Create schema tables
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        created INTEGER,
        updated INTEGER
      )
    `);

    db.run(`
      CREATE TABLE tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_node_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        tag_id TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE supertag_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_label_id TEXT NOT NULL DEFAULT '',
        field_order INTEGER DEFAULT 0,
        inferred_data_type TEXT,
        target_supertag_id TEXT,
        target_supertag_name TEXT,
        option_values TEXT
      )
    `);

    db.run(`
      CREATE TABLE supertag_parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_tag_id TEXT NOT NULL,
        parent_tag_id TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE field_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_id TEXT,
        parent_id TEXT NOT NULL,
        field_def_id TEXT,
        field_name TEXT NOT NULL,
        value_node_id TEXT,
        value_text TEXT NOT NULL,
        value_order INTEGER DEFAULT 0,
        created INTEGER
      )
    `);

    db.run(`
      CREATE TABLE field_exclusions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_name TEXT NOT NULL UNIQUE
      )
    `);

    // Insert test data: supertag "book" with fields
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
            VALUES ('tag_book', 'book', 'Author', 'fl_author', 0, 'text')`);
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
            VALUES ('tag_book', 'book', 'Year', 'fl_year', 1, 'text')`);
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
            VALUES ('tag_book', 'book', 'Status', 'fl_status', 2, 'text')`);

    // Insert book instances
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('book1', 'The Great Gatsby', 1700000000000)`);
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('book2', 'To Kill a Mockingbird', 1700100000000)`);
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('book3', 'No Fields Book', 1700200000000)`);

    db.run(`INSERT INTO tag_applications (data_node_id, tag_name, tag_id) VALUES ('book1', 'book', 'tag_book')`);
    db.run(`INSERT INTO tag_applications (data_node_id, tag_name, tag_id) VALUES ('book2', 'book', 'tag_book')`);
    db.run(`INSERT INTO tag_applications (data_node_id, tag_name, tag_id) VALUES ('book3', 'book', 'tag_book')`);

    // Insert field values for book1
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('book1', 'Author', 'F. Scott Fitzgerald', 0)`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('book1', 'Year', '1925', 0)`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('book1', 'Status', 'Read', 0)`);

    // Insert field values for book2
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('book2', 'Author', 'Harper Lee', 0)`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('book2', 'Year', '1960', 0)`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('book2', 'Status', 'Reading', 0)`);

    // book3 has no field values (tests ISC-C15: missing fields)

    // Set up reference test data
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type, target_supertag_id)
            VALUES ('tag_project', 'project', 'Owner', 'fl_owner', 0, 'instance', 'tag_person')`);
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
            VALUES ('tag_project', 'project', 'Priority', 'fl_priority', 1, 'text')`);

    db.run(`INSERT INTO nodes (id, name, created) VALUES ('proj1', 'Website Redesign', 1700300000000)`);
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('person1', 'Jane Doe', 1700000000000)`);
    db.run(`INSERT INTO tag_applications (data_node_id, tag_name, tag_id) VALUES ('proj1', 'project', 'tag_project')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('proj1', 'Owner', 'person1', 0)`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('proj1', 'Priority', 'High', 0)`);

    // Multi-value field test data
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
            VALUES ('tag_task', 'task', 'Assignees', 'fl_assignees', 0, 'text')`);
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('task1', 'Fix bug', 1700400000000)`);
    db.run(`INSERT INTO tag_applications (data_node_id, tag_name, tag_id) VALUES ('task1', 'task', 'tag_task')`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('task1', 'Assignees', 'Alice', 0)`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('task1', 'Assignees', 'Bob', 1)`);
    db.run(`INSERT INTO field_values (parent_id, field_name, value_text, value_order) VALUES ('task1', 'Assignees', 'Charlie', 2)`);

    // Supertag with no fields
    db.run(`INSERT INTO nodes (id, name, created) VALUES ('note1', 'Random Note', 1700500000000)`);
    db.run(`INSERT INTO tag_applications (data_node_id, tag_name, tag_id) VALUES ('note1', 'note', 'tag_note')`);
  });

  afterAll(() => {
    db.close();
  });

  // ===== ISC-C2: Table output includes all field columns from supertag schema =====
  describe("field columns from schema", () => {
    it("includes all schema fields as columns", () => {
      const result = exportTable(db, "book");
      expect(result.columns).toEqual(["Author", "Year", "Status"]);
    });
  });

  // ===== ISC-C3: Each row represents one instance with resolved field values =====
  describe("row per instance", () => {
    it("returns one row per tagged instance", () => {
      const result = exportTable(db, "book");
      expect(result.rows.length).toBe(3);
      expect(result.rows.map((r) => r.name).sort()).toEqual([
        "No Fields Book",
        "The Great Gatsby",
        "To Kill a Mockingbird",
      ]);
    });

    it("each row has id, name, and fields", () => {
      const result = exportTable(db, "book");
      for (const row of result.rows) {
        expect(row.id).toBeDefined();
        expect(typeof row.name).toBe("string");
        expect(row.fields).toBeDefined();
      }
    });
  });

  // ===== ISC-C4: Reference fields resolve node IDs to names =====
  describe("reference resolution", () => {
    it("resolves reference field IDs to names", () => {
      const result = exportTable(db, "project");
      const proj = result.rows.find((r) => r.id === "proj1");
      expect(proj).toBeDefined();
      expect(proj!.fields["Owner"].resolved).toBe("Jane Doe");
      expect(proj!.fields["Owner"].raw).toBe("person1");
    });

    it("skips resolution when resolveReferences is false", () => {
      const result = exportTable(db, "project", { resolveReferences: false });
      const proj = result.rows.find((r) => r.id === "proj1");
      expect(proj!.fields["Owner"].raw).toBe("person1");
      expect(proj!.fields["Owner"].resolved).toBeUndefined();
    });
  });

  // ===== ISC-C5: JSON output includes both raw IDs and resolved names =====
  describe("JSON dual values", () => {
    it("reference fields have both raw and resolved", () => {
      const result = exportTable(db, "project");
      const proj = result.rows.find((r) => r.id === "proj1");
      const owner = proj!.fields["Owner"];
      expect(owner.raw).toBe("person1");
      expect(owner.resolved).toBe("Jane Doe");
      expect(owner.type).toBe("instance");
    });
  });

  // ===== ISC-C8: --fields flag limits columns =====
  describe("field filtering", () => {
    it("limits columns to specified fields", () => {
      const result = exportTable(db, "book", { fields: ["Author", "Year"] });
      expect(result.columns).toEqual(["Author", "Year"]);
      expect(result.rows[0].fields["Status"]).toBeUndefined();
    });

    it("field filter is case-insensitive", () => {
      const result = exportTable(db, "book", { fields: ["author"] });
      expect(result.columns).toEqual(["Author"]);
    });
  });

  // ===== ISC-C9: --where flag filters rows =====
  describe("where filtering", () => {
    it("filters rows by field value equality", () => {
      const result = exportTable(db, "book", { where: ["Status=Read"] });
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].name).toBe("The Great Gatsby");
    });

    it("where filter is case-insensitive", () => {
      const result = exportTable(db, "book", { where: ["status=read"] });
      expect(result.rows.length).toBe(1);
    });
  });

  // ===== ISC-C10: --sort and --direction flags =====
  describe("sorting", () => {
    it("sorts by field name ascending", () => {
      const result = exportTable(db, "book", {
        sort: "Author",
        direction: "asc",
      });
      const names = result.rows
        .filter((r) => getDisplayValue(r.fields["Author"]))
        .map((r) => getDisplayValue(r.fields["Author"]));
      expect(names).toEqual(["F. Scott Fitzgerald", "Harper Lee"]);
    });

    it("sorts by name descending", () => {
      const result = exportTable(db, "book", {
        sort: "name",
        direction: "desc",
      });
      expect(result.rows[0].name).toBe("To Kill a Mockingbird");
    });
  });

  // ===== ISC-C11: --limit and --offset =====
  describe("pagination", () => {
    it("limits results", () => {
      const result = exportTable(db, "book", { limit: 2 });
      expect(result.rows.length).toBe(2);
      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    it("offsets results", () => {
      const result = exportTable(db, "book", { limit: 2, offset: 1 });
      expect(result.rows.length).toBe(2);
      expect(result.hasMore).toBe(false);
    });
  });

  // ===== ISC-C12: Multi-value fields =====
  describe("multi-value fields", () => {
    it("returns array for multi-value fields", () => {
      const result = exportTable(db, "task");
      const task = result.rows.find((r) => r.id === "task1");
      expect(task).toBeDefined();
      const assignees = task!.fields["Assignees"];
      expect(Array.isArray(assignees.raw)).toBe(true);
      expect(assignees.raw).toEqual(["Alice", "Bob", "Charlie"]);
    });
  });

  // ===== ISC-C13: Empty supertag returns header row only =====
  describe("empty supertag", () => {
    it("returns empty rows with columns for a tag with no instances", () => {
      // Create empty tag
      db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order) VALUES ('tag_empty', 'empty', 'Field1', 'fl1', 0)`);
      const result = exportTable(db, "empty");
      expect(result.rows.length).toBe(0);
      expect(result.columns).toEqual(["Field1"]);
      expect(result.totalCount).toBe(0);
    });
  });

  // ===== ISC-C14: Supertag with no fields exports name and ID only =====
  describe("supertag with no fields", () => {
    it("returns empty columns array", () => {
      const result = exportTable(db, "note");
      expect(result.columns).toEqual([]);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].name).toBe("Random Note");
      expect(result.rows[0].id).toBe("note1");
    });
  });

  // ===== ISC-C15: Missing field values =====
  describe("missing field values", () => {
    it("empty raw value for missing fields", () => {
      const result = exportTable(db, "book");
      const noFieldBook = result.rows.find((r) => r.id === "book3");
      expect(noFieldBook).toBeDefined();
      expect(noFieldBook!.fields["Author"].raw).toBe("");
      expect(noFieldBook!.fields["Year"].raw).toBe("");
    });
  });

  // ===== ISC-C17: Batched field extraction =====
  describe("batched extraction", () => {
    it("extracts all instances in single operation", () => {
      // This tests the result structure - batching is verified by code review
      const result = exportTable(db, "book");
      expect(result.rows.length).toBe(3);
      // All instances have fields populated (or empty for missing values)
      for (const row of result.rows) {
        expect(Object.keys(row.fields).length).toBe(3);
      }
    });
  });

  // ===== Supertag not found =====
  describe("error handling", () => {
    it("throws for non-existent supertag", () => {
      expect(() => exportTable(db, "nonexistent")).toThrow(
        "Supertag 'nonexistent' not found"
      );
    });
  });
});

// ===== ISC-C7: Markdown output =====
describe("formatAsMarkdown", () => {
  it("renders a clean markdown table", () => {
    const result = {
      supertag: "book",
      columns: ["Author", "Year"],
      rows: [
        {
          id: "b1",
          name: "Gatsby",
          fields: {
            Author: { raw: "Fitzgerald", type: "text" },
            Year: { raw: "1925", type: "text" },
          },
        },
        {
          id: "b2",
          name: "Mockingbird",
          fields: {
            Author: { raw: "Lee", type: "text" },
            Year: { raw: "1960", type: "text" },
          },
        },
      ],
      totalCount: 2,
      hasMore: false,
    };

    const md = formatAsMarkdown(result);
    const lines = md.split("\n");
    expect(lines.length).toBe(4); // header + separator + 2 rows
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Author");
    expect(lines[0]).toContain("Year");
    expect(lines[1]).toMatch(/^[\| -]+$/); // separator row
    expect(lines[2]).toContain("Gatsby");
    expect(lines[2]).toContain("Fitzgerald");
  });
});

// ===== Display value helpers =====
describe("getDisplayValue", () => {
  it("returns resolved over raw", () => {
    const field: FieldExportValue = { raw: "id1", resolved: "Name", type: "instance" };
    expect(getDisplayValue(field)).toBe("Name");
  });

  it("returns raw when no resolved", () => {
    const field: FieldExportValue = { raw: "plain text", type: "text" };
    expect(getDisplayValue(field)).toBe("plain text");
  });

  it("joins array values with commas", () => {
    const field: FieldExportValue = { raw: ["a", "b", "c"], type: "text" };
    expect(getDisplayValue(field)).toBe("a, b, c");
  });

  it("returns empty string for undefined", () => {
    expect(getDisplayValue(undefined)).toBe("");
  });
});

describe("getTruncatedDisplayValue", () => {
  it("truncates arrays over maxItems", () => {
    const field: FieldExportValue = {
      raw: ["a", "b", "c", "d", "e", "f", "g"],
      type: "text",
    };
    const result = getTruncatedDisplayValue(field, 3);
    expect(result).toBe("a, b, c...+4 more");
  });

  it("does not truncate short arrays", () => {
    const field: FieldExportValue = { raw: ["a", "b"], type: "text" };
    expect(getTruncatedDisplayValue(field, 5)).toBe("a, b");
  });
});
