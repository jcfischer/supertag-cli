/**
 * Supertag Metadata Migration Tests
 *
 * TDD tests for database migration of supertag_fields and supertag_parents tables.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  migrateSupertagMetadataSchema,
  needsSupertagMetadataMigration,
  clearSupertagMetadata,
  getSupertagMetadataStats,
} from "../../src/db/migrate";

describe("Supertag Metadata Migration", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("migrateSupertagMetadataSchema", () => {
    it("should create supertag_fields table", () => {
      migrateSupertagMetadataSchema(db);

      const result = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='supertag_fields'"
        )
        .get();

      expect(result).not.toBeNull();
    });

    it("should create supertag_parents table", () => {
      migrateSupertagMetadataSchema(db);

      const result = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='supertag_parents'"
        )
        .get();

      expect(result).not.toBeNull();
    });

    it("should create indexes on supertag_fields", () => {
      migrateSupertagMetadataSchema(db);

      const indexes = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='supertag_fields'"
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_supertag_fields_tag");
      expect(indexNames).toContain("idx_supertag_fields_name");
    });

    it("should create indexes on supertag_parents", () => {
      migrateSupertagMetadataSchema(db);

      const indexes = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='supertag_parents'"
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_supertag_parents_child");
      expect(indexNames).toContain("idx_supertag_parents_parent");
    });

    it("should be safe to run multiple times (idempotent)", () => {
      // First migration
      migrateSupertagMetadataSchema(db);

      // Insert some data
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('tag1', 'test', 'Field1', 'label1', 0)
      `);

      // Second migration should not fail or lose data
      expect(() => migrateSupertagMetadataSchema(db)).not.toThrow();

      // Data should still be there
      const count = db
        .query("SELECT COUNT(*) as count FROM supertag_fields")
        .get() as { count: number };
      expect(count.count).toBe(1);
    });

    it("should create unique constraint on supertag_fields", () => {
      migrateSupertagMetadataSchema(db);

      // Insert first row
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('tag1', 'test', 'Field1', 'label1', 0)
      `);

      // Try to insert duplicate - should fail
      expect(() => {
        db.run(`
          INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
          VALUES ('tag1', 'test', 'Field1', 'label2', 1)
        `);
      }).toThrow();
    });

    it("should create unique constraint on supertag_parents", () => {
      migrateSupertagMetadataSchema(db);

      // Insert first row
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('child1', 'parent1')
      `);

      // Try to insert duplicate - should fail
      expect(() => {
        db.run(`
          INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
          VALUES ('child1', 'parent1')
        `);
      }).toThrow();
    });
  });

  describe("needsSupertagMetadataMigration", () => {
    it("should return true when tables do not exist", () => {
      expect(needsSupertagMetadataMigration(db)).toBe(true);
    });

    it("should return false when tables exist", () => {
      migrateSupertagMetadataSchema(db);
      expect(needsSupertagMetadataMigration(db)).toBe(false);
    });

    it("should return true when only supertag_fields exists", () => {
      db.run(`
        CREATE TABLE supertag_fields (
          id INTEGER PRIMARY KEY,
          tag_id TEXT NOT NULL
        )
      `);
      expect(needsSupertagMetadataMigration(db)).toBe(true);
    });
  });

  describe("clearSupertagMetadata", () => {
    it("should clear all data from both tables", () => {
      migrateSupertagMetadataSchema(db);

      // Insert test data
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('tag1', 'test', 'Field1', 'label1', 0)
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('child1', 'parent1')
      `);

      clearSupertagMetadata(db);

      const fieldsCount = db
        .query("SELECT COUNT(*) as count FROM supertag_fields")
        .get() as { count: number };
      const parentsCount = db
        .query("SELECT COUNT(*) as count FROM supertag_parents")
        .get() as { count: number };

      expect(fieldsCount.count).toBe(0);
      expect(parentsCount.count).toBe(0);
    });
  });

  describe("getSupertagMetadataStats", () => {
    it("should return counts for both tables", () => {
      migrateSupertagMetadataSchema(db);

      // Insert test data
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('tag1', 'test', 'Field1', 'label1', 0),
               ('tag1', 'test', 'Field2', 'label2', 1),
               ('tag2', 'test2', 'Field3', 'label3', 0)
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('child1', 'parent1'),
               ('child2', 'parent2')
      `);

      const stats = getSupertagMetadataStats(db);

      expect(stats.fieldsCount).toBe(3);
      expect(stats.parentsCount).toBe(2);
    });

    it("should return zeros when tables are empty", () => {
      migrateSupertagMetadataSchema(db);

      const stats = getSupertagMetadataStats(db);

      expect(stats.fieldsCount).toBe(0);
      expect(stats.parentsCount).toBe(0);
    });
  });
});
