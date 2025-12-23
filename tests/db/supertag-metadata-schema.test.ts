/**
 * Supertag Metadata Schema Tests
 *
 * TDD tests for database tables storing supertag field definitions and inheritance.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import {
  supertagFields,
  supertagParents,
  type SupertagFieldRow,
  type SupertagParentRow,
} from "../../src/db/schema";

describe("Supertag Metadata Schema", () => {
  let db: Database;
  let drizzleDb: ReturnType<typeof drizzle>;

  beforeAll(() => {
    db = new Database(":memory:");

    // Create supertag_fields table
    db.run(`
      CREATE TABLE supertag_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_label_id TEXT NOT NULL,
        field_order INTEGER DEFAULT 0,
        UNIQUE(tag_id, field_name)
      )
    `);

    // Create indexes for supertag_fields
    db.run(
      "CREATE INDEX idx_supertag_fields_tag ON supertag_fields(tag_id)"
    );
    db.run(
      "CREATE INDEX idx_supertag_fields_name ON supertag_fields(tag_name)"
    );

    // Create supertag_parents table
    db.run(`
      CREATE TABLE supertag_parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_tag_id TEXT NOT NULL,
        parent_tag_id TEXT NOT NULL,
        UNIQUE(child_tag_id, parent_tag_id)
      )
    `);

    // Create indexes for supertag_parents
    db.run(
      "CREATE INDEX idx_supertag_parents_child ON supertag_parents(child_tag_id)"
    );
    db.run(
      "CREATE INDEX idx_supertag_parents_parent ON supertag_parents(parent_tag_id)"
    );

    drizzleDb = drizzle(db);
  });

  afterAll(() => {
    db.close();
  });

  describe("supertag_fields table", () => {
    it("should insert and retrieve field definitions", async () => {
      await drizzleDb.insert(supertagFields).values({
        tagId: "tag123",
        tagName: "meeting",
        fieldName: "Location",
        fieldLabelId: "label456",
        fieldOrder: 0,
      });

      const results = await drizzleDb
        .select()
        .from(supertagFields)
        .where(eq(supertagFields.tagId, "tag123"));

      expect(results.length).toBe(1);
      expect(results[0].tagName).toBe("meeting");
      expect(results[0].fieldName).toBe("Location");
      expect(results[0].fieldLabelId).toBe("label456");
      expect(results[0].fieldOrder).toBe(0);
    });

    it("should store multiple fields per supertag", async () => {
      // Clear previous data
      db.run("DELETE FROM supertag_fields");

      await drizzleDb.insert(supertagFields).values([
        {
          tagId: "meeting123",
          tagName: "meeting",
          fieldName: "Location",
          fieldLabelId: "loc1",
          fieldOrder: 0,
        },
        {
          tagId: "meeting123",
          tagName: "meeting",
          fieldName: "Duration",
          fieldLabelId: "dur2",
          fieldOrder: 1,
        },
        {
          tagId: "meeting123",
          tagName: "meeting",
          fieldName: "Participants",
          fieldLabelId: "part3",
          fieldOrder: 2,
        },
      ]);

      const results = await drizzleDb
        .select()
        .from(supertagFields)
        .where(eq(supertagFields.tagId, "meeting123"));

      expect(results.length).toBe(3);
      expect(results.map((r) => r.fieldName).sort()).toEqual([
        "Duration",
        "Location",
        "Participants",
      ]);
    });

    it("should enforce unique constraint on tag_id + field_name", async () => {
      db.run("DELETE FROM supertag_fields");

      // Insert first
      await drizzleDb.insert(supertagFields).values({
        tagId: "tag1",
        tagName: "test",
        fieldName: "Field1",
        fieldLabelId: "label1",
        fieldOrder: 0,
      });

      // Try to insert duplicate - should throw
      expect(() => {
        db.run(`
          INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
          VALUES ('tag1', 'test', 'Field1', 'label2', 1)
        `);
      }).toThrow();
    });
  });

  describe("supertag_parents table", () => {
    it("should insert and retrieve parent relationships", async () => {
      await drizzleDb.insert(supertagParents).values({
        childTagId: "child123",
        parentTagId: "parent456",
      });

      const results = await drizzleDb
        .select()
        .from(supertagParents)
        .where(eq(supertagParents.childTagId, "child123"));

      expect(results.length).toBe(1);
      expect(results[0].parentTagId).toBe("parent456");
    });

    it("should store multiple parents for diamond inheritance", async () => {
      db.run("DELETE FROM supertag_parents");

      await drizzleDb.insert(supertagParents).values([
        { childTagId: "meeting", parentTagId: "calendar-item" },
        { childTagId: "meeting", parentTagId: "entity" },
        { childTagId: "meeting", parentTagId: "collaboratable" },
      ]);

      const results = await drizzleDb
        .select()
        .from(supertagParents)
        .where(eq(supertagParents.childTagId, "meeting"));

      expect(results.length).toBe(3);
      expect(results.map((r) => r.parentTagId).sort()).toEqual([
        "calendar-item",
        "collaboratable",
        "entity",
      ]);
    });

    it("should enforce unique constraint on child_tag_id + parent_tag_id", async () => {
      db.run("DELETE FROM supertag_parents");

      // Insert first
      await drizzleDb.insert(supertagParents).values({
        childTagId: "child1",
        parentTagId: "parent1",
      });

      // Try to insert duplicate - should throw
      expect(() => {
        db.run(`
          INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
          VALUES ('child1', 'parent1')
        `);
      }).toThrow();
    });
  });

  describe("indexes", () => {
    it("should have indexes on supertag_fields", () => {
      const indexes = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='supertag_fields'"
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_supertag_fields_tag");
      expect(indexNames).toContain("idx_supertag_fields_name");
    });

    it("should have indexes on supertag_parents", () => {
      const indexes = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='supertag_parents'"
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_supertag_parents_child");
      expect(indexNames).toContain("idx_supertag_parents_parent");
    });
  });
});
