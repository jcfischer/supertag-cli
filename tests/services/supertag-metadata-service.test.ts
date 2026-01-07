/**
 * SupertagMetadataService Tests
 *
 * TDD tests for the supertag metadata query service.
 * Covers field lookups, inheritance resolution, and validation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { SupertagMetadataService } from "../../src/services/supertag-metadata-service";
import { migrateSupertagMetadataSchema, migrateSchemaConsolidation } from "../../src/db/migrate";
import { migrateSystemFieldSources } from "../../src/db/system-fields";

describe("SupertagMetadataService", () => {
  const testDir = join(process.cwd(), "tmp-test-metadata-service");
  const dbPath = join(testDir, "test.db");
  let db: Database;
  let service: SupertagMetadataService;

  beforeAll(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Remove previous database and create fresh one
    if (existsSync(dbPath)) {
      rmSync(dbPath);
    }
    db = new Database(dbPath);
    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);
    migrateSystemFieldSources(db);

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

    service = new SupertagMetadataService(db);
  });

  describe("T-3.1: Service initialization", () => {
    it("should create service instance with database connection", () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(SupertagMetadataService);
    });

    it("should have getFields method", () => {
      expect(typeof service.getFields).toBe("function");
    });

    it("should have getFieldsByName method", () => {
      expect(typeof service.getFieldsByName).toBe("function");
    });

    it("should have getDirectParents method", () => {
      expect(typeof service.getDirectParents).toBe("function");
    });

    it("should have getAncestors method", () => {
      expect(typeof service.getAncestors).toBe("function");
    });

    it("should have getInheritanceChain method", () => {
      expect(typeof service.getInheritanceChain).toBe("function");
    });

    it("should have getAllFields method", () => {
      expect(typeof service.getAllFields).toBe("function");
    });

    it("should have findTagIdByName method", () => {
      expect(typeof service.findTagIdByName).toBe("function");
    });

    it("should have validateFieldName method", () => {
      expect(typeof service.validateFieldName).toBe("function");
    });
  });

  describe("T-3.2: getFields and getFieldsByName", () => {
    beforeEach(() => {
      // Insert test data
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES
          ('tag1', 'contact', 'Email', 'label1', 0),
          ('tag1', 'contact', 'Phone', 'label2', 1),
          ('tag2', 'meeting', 'Date', 'label3', 0)
      `);
    });

    it("should return fields for a tag by ID", () => {
      const fields = service.getFields("tag1");
      expect(fields.length).toBe(2);
      expect(fields[0].fieldName).toBe("Email");
      expect(fields[1].fieldName).toBe("Phone");
    });

    it("should return empty array for unknown tag ID", () => {
      const fields = service.getFields("unknown");
      expect(fields.length).toBe(0);
    });

    it("should return fields for a tag by name", () => {
      const fields = service.getFieldsByName("contact");
      expect(fields.length).toBe(2);
      expect(fields[0].fieldName).toBe("Email");
    });

    it("should return empty array for unknown tag name", () => {
      const fields = service.getFieldsByName("unknown");
      expect(fields.length).toBe(0);
    });

    it("should preserve field order", () => {
      const fields = service.getFields("tag1");
      expect(fields[0].fieldOrder).toBe(0);
      expect(fields[1].fieldOrder).toBe(1);
    });
  });

  describe("T-3.3: getDirectParents", () => {
    beforeEach(() => {
      // Insert test data: employee -> contact, manager -> employee
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES
          ('employee-tag', 'contact-tag'),
          ('manager-tag', 'employee-tag')
      `);
    });

    it("should return direct parents for a tag", () => {
      const parents = service.getDirectParents("employee-tag");
      expect(parents.length).toBe(1);
      expect(parents[0]).toBe("contact-tag");
    });

    it("should not return grandparents", () => {
      const parents = service.getDirectParents("manager-tag");
      expect(parents.length).toBe(1);
      expect(parents[0]).toBe("employee-tag");
      // Should NOT include contact-tag
      expect(parents).not.toContain("contact-tag");
    });

    it("should return empty array for root tags", () => {
      const parents = service.getDirectParents("contact-tag");
      expect(parents.length).toBe(0);
    });
  });

  describe("T-3.4: getAncestors with recursive CTE", () => {
    beforeEach(() => {
      // Insert test data: manager -> employee -> contact
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES
          ('employee-tag', 'contact-tag'),
          ('manager-tag', 'employee-tag')
      `);
    });

    it("should return all ancestors with depth", () => {
      const ancestors = service.getAncestors("manager-tag");
      expect(ancestors.length).toBe(2);

      // Check depths
      const employeeAncestor = ancestors.find(a => a.tagId === "employee-tag");
      const contactAncestor = ancestors.find(a => a.tagId === "contact-tag");

      expect(employeeAncestor?.depth).toBe(1);
      expect(contactAncestor?.depth).toBe(2);
    });

    it("should return empty array for root tags", () => {
      const ancestors = service.getAncestors("contact-tag");
      expect(ancestors.length).toBe(0);
    });

    it("should detect cycles and not loop infinitely", () => {
      // Insert a cycle: A -> B -> C -> A
      db.run(`DELETE FROM supertag_parents`);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES
          ('tag-a', 'tag-b'),
          ('tag-b', 'tag-c'),
          ('tag-c', 'tag-a')
      `);

      // Should not hang, should return limited results
      const ancestors = service.getAncestors("tag-a");
      // SQLite recursive CTE will stop at cycle
      expect(ancestors.length).toBeLessThanOrEqual(10); // Max depth limit
    });
  });

  describe("T-3.5: getInheritanceChain tree builder", () => {
    beforeEach(() => {
      // Insert test data: manager -> employee -> contact
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES
          ('employee-tag', 'contact-tag'),
          ('manager-tag', 'employee-tag')
      `);
      // Add tag names via supertag_fields (we need a way to get tag names)
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES
          ('contact-tag', 'contact', 'Email', 'l1', 0),
          ('employee-tag', 'employee', 'Department', 'l2', 0),
          ('manager-tag', 'manager', 'Team', 'l3', 0)
      `);
    });

    it("should build inheritance tree from leaf", () => {
      const chain = service.getInheritanceChain("manager-tag");
      expect(chain).toBeDefined();
      expect(chain.tagId).toBe("manager-tag");
      expect(chain.tagName).toBe("manager");
    });

    it("should include parent in tree", () => {
      const chain = service.getInheritanceChain("manager-tag");
      expect(chain.parents).toBeDefined();
      expect(chain.parents.length).toBe(1);
      expect(chain.parents[0].tagId).toBe("employee-tag");
    });

    it("should include grandparent in nested tree", () => {
      const chain = service.getInheritanceChain("manager-tag");
      expect(chain.parents[0].parents.length).toBe(1);
      expect(chain.parents[0].parents[0].tagId).toBe("contact-tag");
    });

    it("should return tree with empty parents for root", () => {
      const chain = service.getInheritanceChain("contact-tag");
      expect(chain.parents.length).toBe(0);
    });
  });

  describe("T-3.6: getAllFields with inherited fields", () => {
    beforeEach(() => {
      // Insert inheritance: manager -> employee -> contact
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES
          ('employee-tag', 'contact-tag'),
          ('manager-tag', 'employee-tag')
      `);
      // Insert fields at each level
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES
          ('contact-tag', 'contact', 'Email', 'l1', 0),
          ('contact-tag', 'contact', 'Phone', 'l2', 1),
          ('employee-tag', 'employee', 'Department', 'l3', 0),
          ('manager-tag', 'manager', 'Team', 'l4', 0)
      `);
    });

    it("should return own fields for root tag", () => {
      const fields = service.getAllFields("contact-tag");
      expect(fields.length).toBe(2);
      expect(fields.every(f => f.depth === 0)).toBe(true);
    });

    it("should return own + inherited fields for child tag", () => {
      const fields = service.getAllFields("employee-tag");
      expect(fields.length).toBe(3); // 1 own + 2 inherited

      const ownFields = fields.filter(f => f.depth === 0);
      const inheritedFields = fields.filter(f => f.depth > 0);

      expect(ownFields.length).toBe(1);
      expect(inheritedFields.length).toBe(2);
    });

    it("should return all fields with correct depths for grandchild", () => {
      const fields = service.getAllFields("manager-tag");
      expect(fields.length).toBe(4); // 1 own + 1 from employee + 2 from contact

      const ownFields = fields.filter(f => f.depth === 0);
      const depth1Fields = fields.filter(f => f.depth === 1);
      const depth2Fields = fields.filter(f => f.depth === 2);

      expect(ownFields.length).toBe(1);
      expect(depth1Fields.length).toBe(1); // Department from employee
      expect(depth2Fields.length).toBe(2); // Email, Phone from contact
    });

    it("should track origin tag for inherited fields", () => {
      const fields = service.getAllFields("manager-tag");
      const emailField = fields.find(f => f.fieldName === "Email");

      expect(emailField?.originTagId).toBe("contact-tag");
      expect(emailField?.originTagName).toBe("contact");
    });
  });

  describe("T-3.7: findTagIdByName and validateFieldName", () => {
    beforeEach(() => {
      // Insert test data
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES
          ('contact-tag', 'contact', 'Email', 'l1', 0),
          ('contact-tag', 'contact', 'Phone', 'l2', 1)
      `);
    });

    it("should find tag ID by exact name", () => {
      const tagId = service.findTagIdByName("contact");
      expect(tagId).toBe("contact-tag");
    });

    it("should prefer tag with most inheritance parents, then most fields when multiple tags have same name", () => {
      // Insert duplicate tag names with different field counts and inheritance
      // This simulates the real-world "todo" situation with 3 different tag IDs
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES
          ('todo-small', 'todo', 'Date', 'td1', 0),
          ('todo-large-fields', 'todo', 'Parent', 'td2', 0),
          ('todo-large-fields', 'todo', 'Do Date', 'td3', 1),
          ('todo-large-fields', 'todo', 'Vault', 'td4', 2),
          ('todo-large-fields', 'todo', 'Focus', 'td5', 3),
          ('todo-large-fields', 'todo', 'Extra', 'td8', 4),
          ('todo-with-inheritance', 'todo', 'Status', 'td6', 0),
          ('todo-with-inheritance', 'todo', 'Details', 'td7', 1)
      `);

      // Add inheritance: todo-with-inheritance has 2 parents, todo-large-fields has 1
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES
          ('todo-with-inheritance', 'parent-tag-1'),
          ('todo-with-inheritance', 'parent-tag-2'),
          ('todo-large-fields', 'parent-tag-3')
      `);

      // Should return the tag with most inheritance parents (todo-with-inheritance with 2 parents)
      // even though todo-large-fields has more fields (5 vs 2)
      const tagId = service.findTagIdByName("todo");
      expect(tagId).toBe("todo-with-inheritance");
    });

    it("should use field count as tiebreaker when inheritance is equal", () => {
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES
          ('task-few', 'task', 'Status', 'tf1', 0),
          ('task-many', 'task', 'Status', 'tm1', 0),
          ('task-many', 'task', 'Priority', 'tm2', 1),
          ('task-many', 'task', 'Due', 'tm3', 2)
      `);

      // Both have 0 parents, so field count is the tiebreaker
      const tagId = service.findTagIdByName("task");
      expect(tagId).toBe("task-many");
    });

    it("should return null for unknown tag name", () => {
      const tagId = service.findTagIdByName("unknown");
      expect(tagId).toBeNull();
    });

    it("should find all tags with same name via findAllTagsByName", () => {
      // Insert into supertag_metadata (primary table for findAllTagsByName)
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES
          ('project-a', 'project', 'project'),
          ('project-b', 'project', 'project')
      `);
      // Insert fields
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES
          ('project-a', 'project', 'Status', 'pa1', 0),
          ('project-b', 'project', 'Status', 'pb1', 0),
          ('project-b', 'project', 'Priority', 'pb2', 1)
      `);

      const tags = service.findAllTagsByName("project");
      expect(tags.length).toBe(2);
      // Should be ordered by field count (since no inheritance)
      expect(tags[0].tagId).toBe("project-b");
      expect(tags[0].fieldCount).toBe(2);
      expect(tags[1].tagId).toBe("project-a");
      expect(tags[1].fieldCount).toBe(1);
    });

    it("should detect tag ID format via isTagId", () => {
      expect(service.isTagId("fbAkgDqs3k")).toBe(true);
      expect(service.isTagId("XREuzJk36V")).toBe(true);
      expect(service.isTagId("uEWX7oeC5L")).toBe(true);
      expect(service.isTagId("todo")).toBe(false);
      expect(service.isTagId("meeting")).toBe(false);
      expect(service.isTagId("short")).toBe(false);
    });

    it("should find tag name by ID via findTagById", () => {
      const name = service.findTagById("contact-tag");
      expect(name).toBe("contact");
    });

    it("should return null for unknown tag ID via findTagById", () => {
      const name = service.findTagById("unknown-id-12345");
      expect(name).toBeNull();
    });

    it("should validate existing field name", () => {
      const result = service.validateFieldName("contact-tag", "Email");
      expect(result.valid).toBe(true);
      expect(result.fieldLabelId).toBe("l1");
    });

    it("should invalidate non-existing field name", () => {
      const result = service.validateFieldName("contact-tag", "Address");
      expect(result.valid).toBe(false);
      expect(result.fieldLabelId).toBeUndefined();
    });

    it("should validate inherited field names", () => {
      // Add inheritance
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('employee-tag', 'contact-tag')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('employee-tag', 'employee', 'Department', 'l3', 0)
      `);

      // Employee should have access to Email (inherited from contact)
      const result = service.validateFieldName("employee-tag", "Email");
      expect(result.valid).toBe(true);
    });
  });

  // Spec 074: System Field Discovery Tests
  describe("System Field Retrieval (Spec 074)", () => {
    beforeEach(async () => {
      // Import and run migration for system_field_sources table
      const { migrateSystemFieldSources } = await import("../../src/db/system-fields");
      migrateSystemFieldSources(db);

      // Set up inheritance: meeting -> Type|Event -> type
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES
          ('meeting-tag', 'event-type-tag'),
          ('event-type-tag', 'type-tag')
      `);

      // Add regular fields to tags
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES
          ('type-tag', 'type', 'Description', 'type-desc', 0),
          ('event-type-tag', 'Type | Event', 'Location', 'event-loc', 0),
          ('meeting-tag', 'meeting', 'Agenda', 'meeting-agenda', 0)
      `);

      // Register system fields defined on event-type-tag
      db.run(`
        INSERT INTO system_field_sources (field_id, tag_id)
        VALUES
          ('SYS_A90', 'event-type-tag'),
          ('SYS_A142', 'event-type-tag')
      `);
    });

    describe("T-3.1: getSystemFieldSourceTags", () => {
      it("should return tagDef IDs that define a system field", () => {
        const sources = service.getSystemFieldSourceTags("SYS_A90");
        expect(sources).toContain("event-type-tag");
      });

      it("should return empty array for unknown system field", () => {
        const sources = service.getSystemFieldSourceTags("SYS_A999");
        expect(sources.length).toBe(0);
      });

      it("should return multiple sources if multiple tags define the same field", () => {
        // Add another tag that defines SYS_A90
        db.run(`
          INSERT INTO system_field_sources (field_id, tag_id)
          VALUES ('SYS_A90', 'another-tag')
        `);

        const sources = service.getSystemFieldSourceTags("SYS_A90");
        expect(sources.length).toBe(2);
        expect(sources).toContain("event-type-tag");
        expect(sources).toContain("another-tag");
      });
    });

    describe("T-3.2: getSystemFieldsForTag", () => {
      it("should return system fields for tag that inherits from system field source", () => {
        const systemFields = service.getSystemFieldsForTag("meeting-tag");
        expect(systemFields.length).toBe(2);

        const fieldNames = systemFields.map(f => f.fieldName);
        expect(fieldNames).toContain("Date");
        expect(fieldNames).toContain("Attendees");
      });

      it("should return system fields for tag that directly defines them", () => {
        const systemFields = service.getSystemFieldsForTag("event-type-tag");
        expect(systemFields.length).toBe(2);

        const fieldNames = systemFields.map(f => f.fieldName);
        expect(fieldNames).toContain("Date");
        expect(fieldNames).toContain("Attendees");
      });

      it("should return empty array for tag without system field ancestors", () => {
        // person tag has no connection to event-type-tag
        db.run(`
          INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
          VALUES ('person-tag', 'person', 'Name', 'person-name', 0)
        `);

        const systemFields = service.getSystemFieldsForTag("person-tag");
        expect(systemFields.length).toBe(0);
      });

      it("should mark system fields with system: true", () => {
        const systemFields = service.getSystemFieldsForTag("meeting-tag");
        expect(systemFields.every(f => f.system === true)).toBe(true);
      });

      it("should include correct dataType from SYSTEM_FIELD_METADATA", () => {
        const systemFields = service.getSystemFieldsForTag("meeting-tag");
        const dateField = systemFields.find(f => f.fieldName === "Date");
        const attendeesField = systemFields.find(f => f.fieldName === "Attendees");

        expect(dateField?.inferredDataType).toBe("date");
        expect(attendeesField?.inferredDataType).toBe("reference");
      });
    });

    describe("T-3.3: getAllFields includes system fields", () => {
      it("should include system fields in getAllFields result", () => {
        const allFields = service.getAllFields("meeting-tag");

        const fieldNames = allFields.map(f => f.fieldName);
        expect(fieldNames).toContain("Date");
        expect(fieldNames).toContain("Attendees");
        expect(fieldNames).toContain("Agenda"); // own field
        expect(fieldNames).toContain("Location"); // inherited from event-type-tag
      });

      it("should not duplicate system fields that are already defined as regular fields", () => {
        // Define Date as a regular field on meeting
        db.run(`
          INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
          VALUES ('meeting-tag', 'meeting', 'Date', 'meeting-date-custom', 1, 'date')
        `);

        const allFields = service.getAllFields("meeting-tag");
        const dateFields = allFields.filter(f => f.fieldName === "Date");

        // Should only have ONE Date field (the user-defined one takes precedence)
        expect(dateFields.length).toBe(1);
        expect(dateFields[0].fieldLabelId).toBe("meeting-date-custom");
        expect(dateFields[0].system).toBeUndefined(); // Not a system field anymore
      });

      it("should return system fields with correct origin information", () => {
        const allFields = service.getAllFields("meeting-tag");
        const dateField = allFields.find(f => f.fieldName === "Date" && f.system === true);

        // System fields have origin from where the system field was discovered
        expect(dateField?.system).toBe(true);
        expect(dateField?.originTagName).toBe("Type | Event");
      });
    });

    describe("T-3.4 & T-3.5: Edge cases", () => {
      it("should not include system fields for unrelated tags (no inheritance)", () => {
        // Create isolated tag with no inheritance
        db.run(`
          INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
          VALUES ('isolated-tag', 'isolated', 'Notes', 'isolated-notes', 0)
        `);

        const allFields = service.getAllFields("isolated-tag");
        const systemFields = allFields.filter(f => f.system === true);

        expect(systemFields.length).toBe(0);
      });

      it("user-defined fields should take precedence over system fields", () => {
        // User defines Attendees field with different type
        db.run(`
          INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type)
          VALUES ('meeting-tag', 'meeting', 'Attendees', 'custom-attendees', 2, 'text')
        `);

        const allFields = service.getAllFields("meeting-tag");
        const attendeesFields = allFields.filter(f => f.fieldName === "Attendees");

        expect(attendeesFields.length).toBe(1);
        expect(attendeesFields[0].fieldLabelId).toBe("custom-attendees");
        expect(attendeesFields[0].inferredDataType).toBe("text");
        expect(attendeesFields[0].system).toBeUndefined();
      });
    });
  });
});
