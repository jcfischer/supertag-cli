/**
 * UnifiedSchemaService Tests (Spec 020 T-3.1)
 *
 * TDD tests for the database-backed unified schema service.
 * Tests constructor, basic queries, and schema loading.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateSchemaConsolidation, migrateSupertagMetadataSchema } from "../../src/db/migrate";
import { UnifiedSchemaService } from "../../src/services/unified-schema-service";

describe("UnifiedSchemaService (T-3.1)", () => {
  let db: Database;
  let service: UnifiedSchemaService;

  beforeAll(() => {
    db = new Database(":memory:");
    // Run migrations to create all required tables
    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    // Clear data before each test
    db.run("DELETE FROM supertag_metadata");
    db.run("DELETE FROM supertag_fields");
    db.run("DELETE FROM supertag_parents");
    // Create fresh service instance
    service = new UnifiedSchemaService(db);
  });

  describe("constructor", () => {
    it("should create a service instance with database connection", () => {
      const svc = new UnifiedSchemaService(db);
      expect(svc).toBeInstanceOf(UnifiedSchemaService);
    });

    it("should expose the database connection", () => {
      const svc = new UnifiedSchemaService(db);
      expect(svc.db).toBe(db);
    });
  });

  describe("getSupertag", () => {
    it("should return null for non-existent supertag", () => {
      const result = service.getSupertag("nonexistent");
      expect(result).toBeNull();
    });

    it("should find supertag by exact name", () => {
      // Insert test data
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color)
        VALUES ('tag1', 'meeting', 'meeting', 'A meeting supertag', 'blue')
      `);

      const result = service.getSupertag("meeting");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("tag1");
      expect(result!.name).toBe("meeting");
      expect(result!.normalizedName).toBe("meeting");
      expect(result!.description).toBe("A meeting supertag");
      expect(result!.color).toBe("blue");
    });

    it("should find supertag by normalized name", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color)
        VALUES ('tag1', 'My Meeting', 'mymeeting', NULL, NULL)
      `);

      // Should find by normalized name
      const result = service.getSupertag("my meeting");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("My Meeting");
    });

    it("should include fields in returned supertag", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag1', 'contact', 'contact')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
        VALUES ('tag1', 'contact', 'Email', 'email-label', 0, 'email', 'text')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
        VALUES ('tag1', 'contact', 'Phone', 'phone-label', 1, 'phone', 'text')
      `);

      const result = service.getSupertag("contact");
      expect(result).not.toBeNull();
      expect(result!.fields).toHaveLength(2);
      expect(result!.fields[0].name).toBe("Email");
      expect(result!.fields[1].name).toBe("Phone");
    });
  });

  describe("getSupertagById", () => {
    it("should return null for non-existent ID", () => {
      const result = service.getSupertagById("nonexistent-id");
      expect(result).toBeNull();
    });

    it("should find supertag by ID", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('xyz123', 'project', 'project')
      `);

      const result = service.getSupertagById("xyz123");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("xyz123");
      expect(result!.name).toBe("project");
    });
  });

  describe("listSupertags", () => {
    it("should return empty array when no supertags exist", () => {
      const result = service.listSupertags();
      expect(result).toEqual([]);
    });

    it("should return all supertags", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag1', 'meeting', 'meeting'),
               ('tag2', 'contact', 'contact'),
               ('tag3', 'project', 'project')
      `);

      const result = service.listSupertags();
      expect(result).toHaveLength(3);
      expect(result.map((s) => s.name).sort()).toEqual(["contact", "meeting", "project"]);
    });

    it("should include fields for each supertag", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag1', 'meeting', 'meeting')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('tag1', 'meeting', 'Location', 'loc-id', 0)
      `);

      const result = service.listSupertags();
      expect(result).toHaveLength(1);
      expect(result[0].fields).toHaveLength(1);
      expect(result[0].fields[0].name).toBe("Location");
    });
  });

  describe("searchSupertags", () => {
    beforeEach(() => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag1', 'meeting', 'meeting'),
               ('tag2', 'team meeting', 'teammeeting'),
               ('tag3', 'contact', 'contact'),
               ('tag4', 'meeting notes', 'meetingnotes')
      `);
    });

    it("should return empty array for no matches", () => {
      const result = service.searchSupertags("xyz");
      expect(result).toEqual([]);
    });

    it("should find supertags by partial name match", () => {
      const result = service.searchSupertags("meet");
      expect(result).toHaveLength(3);
      expect(result.map((s) => s.name)).toContain("meeting");
      expect(result.map((s) => s.name)).toContain("team meeting");
      expect(result.map((s) => s.name)).toContain("meeting notes");
    });

    it("should be case insensitive", () => {
      const result = service.searchSupertags("MEETING");
      expect(result).toHaveLength(3);
    });

    it("should match on normalized name", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag5', 'My Project', 'myproject')
      `);

      const result = service.searchSupertags("myproj");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("My Project");
    });
  });

  describe("getFieldsCount", () => {
    it("should return 0 for supertag with no fields", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag1', 'empty', 'empty')
      `);

      const result = service.getFieldsCount("tag1");
      expect(result).toBe(0);
    });

    it("should return correct field count", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag1', 'contact', 'contact')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('tag1', 'contact', 'Email', 'e1', 0),
               ('tag1', 'contact', 'Phone', 'p1', 1),
               ('tag1', 'contact', 'Address', 'a1', 2)
      `);

      const result = service.getFieldsCount("tag1");
      expect(result).toBe(3);
    });
  });

  describe("getStats", () => {
    it("should return zero counts for empty database", () => {
      const stats = service.getStats();
      expect(stats.totalSupertags).toBe(0);
      expect(stats.totalFields).toBe(0);
      expect(stats.totalInheritanceRelations).toBe(0);
    });

    it("should return correct counts", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag1', 'meeting', 'meeting'),
               ('tag2', 'contact', 'contact')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('tag1', 'meeting', 'Location', 'loc', 0),
               ('tag1', 'meeting', 'Date', 'date', 1),
               ('tag2', 'contact', 'Email', 'email', 0)
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('tag1', 'tag2')
      `);

      const stats = service.getStats();
      expect(stats.totalSupertags).toBe(2);
      expect(stats.totalFields).toBe(3);
      expect(stats.totalInheritanceRelations).toBe(1);
    });
  });
});

// ============================================================================
// T-3.3: Field Operations
// ============================================================================

describe("UnifiedSchemaService Field Operations (T-3.3)", () => {
  let db: Database;
  let service: UnifiedSchemaService;

  beforeAll(() => {
    db = new Database(":memory:");
    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.run("DELETE FROM supertag_metadata");
    db.run("DELETE FROM supertag_fields");
    db.run("DELETE FROM supertag_parents");
    service = new UnifiedSchemaService(db);
  });

  describe("getFields", () => {
    it("should return empty array for non-existent supertag", () => {
      const result = service.getFields("nonexistent");
      expect(result).toEqual([]);
    });

    it("should return own fields only", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('contact-id', 'contact', 'contact')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
        VALUES ('contact-id', 'contact', 'Email', 'email-id', 0, 'email', 'text'),
               ('contact-id', 'contact', 'Phone', 'phone-id', 1, 'phone', 'text')
      `);

      const fields = service.getFields("contact-id");
      expect(fields).toHaveLength(2);
      expect(fields[0].name).toBe("Email");
      expect(fields[1].name).toBe("Phone");
    });

    it("should return fields ordered by field_order", () => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('tag1', 'test', 'test')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('tag1', 'test', 'Third', 'f3', 2),
               ('tag1', 'test', 'First', 'f1', 0),
               ('tag1', 'test', 'Second', 'f2', 1)
      `);

      const fields = service.getFields("tag1");
      expect(fields.map((f) => f.name)).toEqual(["First", "Second", "Third"]);
    });
  });

  describe("getAllFields (with inheritance)", () => {
    beforeEach(() => {
      // Create inheritance hierarchy: employee extends contact
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('contact-id', 'contact', 'contact'),
               ('employee-id', 'employee', 'employee')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name)
        VALUES ('contact-id', 'contact', 'Email', 'email-id', 0, 'email'),
               ('contact-id', 'contact', 'Phone', 'phone-id', 1, 'phone'),
               ('employee-id', 'employee', 'Department', 'dept-id', 0, 'department'),
               ('employee-id', 'employee', 'Title', 'title-id', 1, 'title')
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('employee-id', 'contact-id')
      `);
    });

    it("should return only own fields when supertag has no parents", () => {
      const fields = service.getAllFields("contact-id");
      expect(fields).toHaveLength(2);
      expect(fields.map((f) => f.name)).toEqual(["Email", "Phone"]);
    });

    it("should include inherited fields from parent", () => {
      const fields = service.getAllFields("employee-id");
      expect(fields).toHaveLength(4);
      // Own fields should come first
      expect(fields.map((f) => f.name)).toContain("Department");
      expect(fields.map((f) => f.name)).toContain("Title");
      // Inherited fields
      expect(fields.map((f) => f.name)).toContain("Email");
      expect(fields.map((f) => f.name)).toContain("Phone");
    });

    it("should handle multi-level inheritance", () => {
      // Add manager extends employee
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('manager-id', 'manager', 'manager')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('manager-id', 'manager', 'Reports', 'reports-id', 0)
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('manager-id', 'employee-id')
      `);

      const fields = service.getAllFields("manager-id");
      expect(fields).toHaveLength(5);
      expect(fields.map((f) => f.name)).toContain("Reports");
      expect(fields.map((f) => f.name)).toContain("Department");
      expect(fields.map((f) => f.name)).toContain("Email");
    });

    it("should handle diamond inheritance without duplicates", () => {
      // Create diamond: D extends B and C, both extend A
      db.run("DELETE FROM supertag_metadata");
      db.run("DELETE FROM supertag_fields");
      db.run("DELETE FROM supertag_parents");

      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('a-id', 'A', 'a'),
               ('b-id', 'B', 'b'),
               ('c-id', 'C', 'c'),
               ('d-id', 'D', 'd')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order)
        VALUES ('a-id', 'A', 'FieldA', 'fa', 0),
               ('b-id', 'B', 'FieldB', 'fb', 0),
               ('c-id', 'C', 'FieldC', 'fc', 0),
               ('d-id', 'D', 'FieldD', 'fd', 0)
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('b-id', 'a-id'),
               ('c-id', 'a-id'),
               ('d-id', 'b-id'),
               ('d-id', 'c-id')
      `);

      const fields = service.getAllFields("d-id");
      // Should have FieldD, FieldB, FieldC, FieldA (no duplicates for A)
      expect(fields).toHaveLength(4);
      expect(fields.filter((f) => f.name === "FieldA")).toHaveLength(1);
    });
  });

  describe("getFieldByNormalizedName", () => {
    beforeEach(() => {
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('contact-id', 'contact', 'contact')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name)
        VALUES ('contact-id', 'contact', 'Email Address', 'email-id', 0, 'emailaddress'),
               ('contact-id', 'contact', 'Phone Number', 'phone-id', 1, 'phonenumber')
      `);
    });

    it("should return null for non-existent field", () => {
      const field = service.getFieldByNormalizedName("contact-id", "nonexistent");
      expect(field).toBeNull();
    });

    it("should find field by normalized name", () => {
      const field = service.getFieldByNormalizedName("contact-id", "emailaddress");
      expect(field).not.toBeNull();
      expect(field!.name).toBe("Email Address");
    });

    it("should normalize input before matching", () => {
      // Input with spaces and different case
      const field = service.getFieldByNormalizedName("contact-id", "Email Address");
      expect(field).not.toBeNull();
      expect(field!.normalizedName).toBe("emailaddress");
    });

    it("should include inherited fields in lookup", () => {
      // Add employee extending contact
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('employee-id', 'employee', 'employee')
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('employee-id', 'contact-id')
      `);

      // Should find Email from parent contact
      const field = service.getFieldByNormalizedName("employee-id", "emailaddress");
      expect(field).not.toBeNull();
      expect(field!.name).toBe("Email Address");
    });
  });
});

// ============================================================================
// T-3.4: buildNodePayload
// ============================================================================

describe("UnifiedSchemaService buildNodePayload (T-3.4)", () => {
  let db: Database;
  let service: UnifiedSchemaService;

  beforeAll(() => {
    db = new Database(":memory:");
    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.run("DELETE FROM supertag_metadata");
    db.run("DELETE FROM supertag_fields");
    db.run("DELETE FROM supertag_parents");
    service = new UnifiedSchemaService(db);

    // Set up test data: contact supertag with fields
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('contact-id', 'contact', 'contact')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
      VALUES ('contact-id', 'contact', 'Email', 'email-field-id', 0, 'email', 'text'),
             ('contact-id', 'contact', 'Phone', 'phone-field-id', 1, 'phone', 'text'),
             ('contact-id', 'contact', 'Website', 'website-field-id', 2, 'website', 'url'),
             ('contact-id', 'contact', 'Birth Date', 'birthdate-field-id', 3, 'birthdate', 'date')
    `);
  });

  describe("basic payload creation", () => {
    it("should throw error for unknown supertag", () => {
      expect(() => {
        service.buildNodePayload("unknown", "Test Node", {});
      }).toThrow("Unknown supertag: unknown");
    });

    it("should create basic payload with supertag ID", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {});
      expect(payload.name).toBe("John Doe");
      expect(payload.supertags).toHaveLength(1);
      expect(payload.supertags![0].id).toBe("contact-id");
    });

    it("should handle supertag name case-insensitively via normalized name", () => {
      const payload = service.buildNodePayload("Contact", "John Doe", {});
      expect(payload.supertags![0].id).toBe("contact-id");
    });
  });

  describe("field values", () => {
    it("should create field children for provided values", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Email: "john@example.com",
      });
      expect(payload.children).toHaveLength(1);
      expect(payload.children![0].type).toBe("field");
      expect((payload.children![0] as any).attributeId).toBe("email-field-id");
      expect((payload.children![0] as any).children[0].name).toBe("john@example.com");
    });

    it("should match fields by normalized name", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        email: "john@example.com", // lowercase
      });
      expect(payload.children).toHaveLength(1);
      expect((payload.children![0] as any).attributeId).toBe("email-field-id");
    });

    it("should skip unknown fields", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Email: "john@example.com",
        UnknownField: "some value",
      });
      expect(payload.children).toHaveLength(1);
    });

    it("should handle multiple field values", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Email: "john@example.com",
        Phone: "555-1234",
      });
      expect(payload.children).toHaveLength(2);
    });

    it("should skip empty field values", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Email: "john@example.com",
        Phone: "",
      });
      expect(payload.children).toHaveLength(1);
    });
  });

  describe("data type handling", () => {
    it("should handle text fields", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Email: "john@example.com",
      });
      const fieldNode = payload.children![0] as any;
      expect(fieldNode.children[0].name).toBe("john@example.com");
      expect(fieldNode.children[0].dataType).toBeUndefined();
    });

    it("should handle URL fields with dataType", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Website: "https://example.com",
      });
      const fieldNode = payload.children![0] as any;
      expect(fieldNode.children[0].name).toBe("https://example.com");
      expect(fieldNode.children[0].dataType).toBe("url");
    });

    it("should handle date fields with dataType", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        "Birth Date": "1990-05-15",
      });
      const fieldNode = payload.children![0] as any;
      expect(fieldNode.children[0].name).toBe("1990-05-15");
      expect(fieldNode.children[0].dataType).toBe("date");
    });

    it("should handle array values (multiple children)", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Email: ["john@example.com", "john@work.com"],
      });
      const fieldNode = payload.children![0] as any;
      expect(fieldNode.children).toHaveLength(2);
      expect(fieldNode.children[0].name).toBe("john@example.com");
      expect(fieldNode.children[1].name).toBe("john@work.com");
    });
  });

  describe("multiple supertags", () => {
    beforeEach(() => {
      // Add employee supertag that extends contact
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('employee-id', 'employee', 'employee')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
        VALUES ('employee-id', 'employee', 'Department', 'dept-field-id', 0, 'department', 'text')
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('employee-id', 'contact-id')
      `);
    });

    it("should handle comma-separated supertag names", () => {
      const payload = service.buildNodePayload("contact,employee", "John Doe", {});
      expect(payload.supertags).toHaveLength(2);
      expect(payload.supertags!.map((s) => s.id).sort()).toEqual(["contact-id", "employee-id"]);
    });

    it("should handle array of supertag names", () => {
      const payload = service.buildNodePayload(["contact", "employee"], "John Doe", {});
      expect(payload.supertags).toHaveLength(2);
    });

    it("should deduplicate same supertag name", () => {
      const payload = service.buildNodePayload("contact,contact", "John Doe", {});
      expect(payload.supertags).toHaveLength(1);
    });

    it("should combine fields from multiple supertags", () => {
      const payload = service.buildNodePayload(["contact", "employee"], "John Doe", {
        Email: "john@example.com",
        Department: "Engineering",
      });
      expect(payload.children).toHaveLength(2);
    });

    it("should use inherited fields via child supertag", () => {
      // employee extends contact, so Email field should be available
      const payload = service.buildNodePayload("employee", "John Doe", {
        Email: "john@example.com",
        Department: "Engineering",
      });
      expect(payload.children).toHaveLength(2);
    });
  });

  describe("reference fields", () => {
    beforeEach(() => {
      // Add a reference-type field
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
        VALUES ('contact-id', 'contact', 'Category', 'category-field-id', 4, 'category', 'reference')
      `);
    });

    it("should handle reference field with node ID", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Category: "xyz123abc456",
      });
      const fieldNode = payload.children![0] as any;
      expect(fieldNode.children[0].dataType).toBe("reference");
      expect(fieldNode.children[0].id).toBe("xyz123abc456");
    });

    it("should handle reference field with name (creates name node)", () => {
      const payload = service.buildNodePayload("contact", "John Doe", {
        Category: "VIP",
      });
      const fieldNode = payload.children![0] as any;
      expect(fieldNode.children[0].name).toBe("VIP");
      expect(fieldNode.children[0].dataType).toBeUndefined();
    });
  });
});

// ============================================================================
// T-4.1: toSchemaRegistryJSON
// ============================================================================

describe("UnifiedSchemaService toSchemaRegistryJSON (T-4.1)", () => {
  let db: Database;
  let service: UnifiedSchemaService;

  beforeAll(() => {
    db = new Database(":memory:");
    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.run("DELETE FROM supertag_metadata");
    db.run("DELETE FROM supertag_fields");
    db.run("DELETE FROM supertag_parents");
    service = new UnifiedSchemaService(db);
  });

  it("should return valid JSON string", () => {
    const json = service.toSchemaRegistryJSON();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("should include version field", () => {
    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    expect(data.version).toBe(1);
  });

  it("should include supertags array", () => {
    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    expect(Array.isArray(data.supertags)).toBe(true);
  });

  it("should return empty supertags array when database is empty", () => {
    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    expect(data.supertags).toEqual([]);
  });

  it("should include all supertags from database", () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color)
      VALUES ('tag1', 'contact', 'contact', 'A contact', 'blue'),
             ('tag2', 'project', 'project', 'A project', 'green')
    `);

    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    expect(data.supertags).toHaveLength(2);
  });

  it("should match SchemaRegistry.SupertagSchema format", () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color)
      VALUES ('contact-id', 'contact', 'contact', 'Contact description', 'blue')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, description, inferred_data_type)
      VALUES ('contact-id', 'contact', 'Email', 'email-attr', 0, 'email', 'Email address', 'text')
    `);

    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    const tag = data.supertags[0];

    // Check SupertagSchema structure
    expect(tag.id).toBe("contact-id");
    expect(tag.name).toBe("contact");
    expect(tag.normalizedName).toBe("contact");
    expect(tag.description).toBe("Contact description");
    expect(tag.color).toBe("blue");
    expect(Array.isArray(tag.fields)).toBe(true);
  });

  it("should match SchemaRegistry.FieldSchema format", () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('contact-id', 'contact', 'contact')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, description, inferred_data_type)
      VALUES ('contact-id', 'contact', 'Email Address', 'email-attr', 0, 'emailaddress', 'Primary email', 'text')
    `);

    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    const field = data.supertags[0].fields[0];

    // Check FieldSchema structure
    expect(field.attributeId).toBe("email-attr");
    expect(field.name).toBe("Email Address");
    expect(field.normalizedName).toBe("emailaddress");
    expect(field.description).toBe("Primary email");
    expect(field.dataType).toBe("text");
  });

  it("should include extends for supertags with parents", () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('contact-id', 'contact', 'contact'),
             ('employee-id', 'employee', 'employee')
    `);
    db.run(`
      INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
      VALUES ('employee-id', 'contact-id')
    `);

    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    const employee = data.supertags.find((t: any) => t.id === "employee-id");

    expect(employee.extends).toEqual(["contact-id"]);
  });

  it("should omit extends for supertags without parents", () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('contact-id', 'contact', 'contact')
    `);

    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    const contact = data.supertags[0];

    expect(contact.extends).toBeUndefined();
  });

  it("should omit null description and color", () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color)
      VALUES ('tag1', 'test', 'test', NULL, NULL)
    `);

    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    const tag = data.supertags[0];

    // Should not include null values
    expect(tag.description).toBeUndefined();
    expect(tag.color).toBeUndefined();
  });

  it("should be deserializable by SchemaRegistry.fromJSON", async () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color)
      VALUES ('contact-id', 'contact', 'contact', 'A contact', 'blue')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
      VALUES ('contact-id', 'contact', 'Email', 'email-attr', 0, 'email', 'text')
    `);

    const json = service.toSchemaRegistryJSON();

    // Import SchemaRegistry and verify it can load the JSON
    const { SchemaRegistry } = await import("../../src/schema/registry");
    const registry = SchemaRegistry.fromJSON(json);

    const contact = registry.getSupertag("contact");
    expect(contact).not.toBeUndefined();
    expect(contact!.id).toBe("contact-id");
    expect(contact!.fields).toHaveLength(1);
  });

  // Spec 081 T-1.2: Test target supertag export
  it("should include targetSupertag in field schema for reference fields", () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('person-id', 'person', 'person'),
             ('company-id', 'company', 'company')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type, target_supertag_id, target_supertag_name)
      VALUES ('person-id', 'person', 'Company', 'company-attr', 0, 'company', 'reference', 'company-id', 'company')
    `);

    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    const person = data.supertags.find((t: any) => t.id === "person-id");
    const companyField = person.fields[0];

    expect(companyField.targetSupertag).toBeDefined();
    expect(companyField.targetSupertag.id).toBe("company-id");
    expect(companyField.targetSupertag.name).toBe("company");
  });

  it("should omit targetSupertag for fields without target supertag", () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('contact-id', 'contact', 'contact')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type, target_supertag_id, target_supertag_name)
      VALUES ('contact-id', 'contact', 'Email', 'email-attr', 0, 'email', 'text', NULL, NULL)
    `);

    const json = service.toSchemaRegistryJSON();
    const data = JSON.parse(json);
    const contact = data.supertags[0];
    const emailField = contact.fields[0];

    expect(emailField.targetSupertag).toBeUndefined();
  });
});

// ============================================================================
// Spec 092: Field Default Values
// ============================================================================

describe("UnifiedSchemaService default field values (Spec 092)", () => {
  let db: Database;
  let service: UnifiedSchemaService;

  beforeAll(() => {
    db = new Database(":memory:");
    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.run("DELETE FROM supertag_metadata");
    db.run("DELETE FROM supertag_fields");
    db.run("DELETE FROM supertag_parents");
    service = new UnifiedSchemaService(db);

    // Set up test data: todo supertag with fields, one having a default value
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('todo-id', 'todo', 'todo')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type, default_value_id, default_value_text)
      VALUES ('todo-id', 'todo', 'Status', 'status-field-id', 0, 'status', 'reference', 'later-id', 'Later'),
             ('todo-id', 'todo', 'Priority', 'priority-field-id', 1, 'priority', 'text', NULL, NULL),
             ('todo-id', 'todo', 'Notes', 'notes-field-id', 2, 'notes', 'text', 'default-notes-id', 'Default notes text')
    `);
  });

  describe("loadFieldsForTag includes default values", () => {
    it("should include default value properties in UnifiedField", () => {
      const fields = service.getFields("todo-id");
      const statusField = fields.find(f => f.name === "Status");

      expect(statusField).toBeDefined();
      expect(statusField!.defaultValueId).toBe("later-id");
      expect(statusField!.defaultValueText).toBe("Later");
    });

    it("should return null for fields without defaults", () => {
      const fields = service.getFields("todo-id");
      const priorityField = fields.find(f => f.name === "Priority");

      expect(priorityField).toBeDefined();
      expect(priorityField!.defaultValueId).toBeNull();
      expect(priorityField!.defaultValueText).toBeNull();
    });
  });

  describe("buildNodePayload auto-populates defaults", () => {
    it("should use default value when user provides no value", () => {
      const payload = service.buildNodePayload("todo", "Buy groceries", {});

      // Should have 2 field children: Status (default) and Notes (default)
      expect(payload.children).toHaveLength(2);

      // Find Status field - should be reference to default value
      const statusField = payload.children!.find(
        (c: any) => c.attributeId === "status-field-id"
      ) as any;
      expect(statusField).toBeDefined();
      expect(statusField.children[0].dataType).toBe("reference");
      expect(statusField.children[0].id).toBe("later-id");
    });

    it("should use user-provided value over default", () => {
      const payload = service.buildNodePayload("todo", "Buy groceries", {
        Status: "done-id-123", // 11 chars, recognized as node ID
      });

      // Find Status field
      const statusField = payload.children!.find(
        (c: any) => c.attributeId === "status-field-id"
      ) as any;
      expect(statusField).toBeDefined();
      expect(statusField.children[0].id).toBe("done-id-123");
    });

    it("should use explicit empty string over default", () => {
      const payload = service.buildNodePayload("todo", "Buy groceries", {
        Notes: "", // Explicit empty overrides default
      });

      // Notes field should not appear (empty string is skipped)
      // But Status should have default since not provided
      const notesField = payload.children!.find(
        (c: any) => c.attributeId === "notes-field-id"
      );
      expect(notesField).toBeUndefined();

      // Status should have default
      const statusField = payload.children!.find(
        (c: any) => c.attributeId === "status-field-id"
      );
      expect(statusField).toBeDefined();
    });

    it("should handle text field defaults", () => {
      const payload = service.buildNodePayload("todo", "Buy groceries", {
        Status: "custom-status-id", // Override default
      });

      // Notes should have text default
      const notesField = payload.children!.find(
        (c: any) => c.attributeId === "notes-field-id"
      ) as any;
      expect(notesField).toBeDefined();
      expect(notesField.children[0].name).toBe("Default notes text");
    });

    it("should not create field for missing default when field has no default", () => {
      const payload = service.buildNodePayload("todo", "Buy groceries", {
        Status: "done-id-123",
        Notes: "My notes",
      });

      // Priority has no default and wasn't provided, so shouldn't appear
      const priorityField = payload.children!.find(
        (c: any) => c.attributeId === "priority-field-id"
      );
      expect(priorityField).toBeUndefined();
    });
  });

  describe("inheritance and defaults", () => {
    beforeEach(() => {
      // Add project supertag that extends todo
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
        VALUES ('project-id', 'project', 'project')
      `);
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type, default_value_id, default_value_text)
        VALUES ('project-id', 'project', 'Team', 'team-field-id', 0, 'team', 'text', 'default-team-id', 'Engineering')
      `);
      db.run(`
        INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
        VALUES ('project-id', 'todo-id')
      `);
    });

    it("should apply defaults from inherited fields", () => {
      const payload = service.buildNodePayload("project", "New project", {});

      // Should have defaults from both project and todo:
      // - Status (from todo, reference default)
      // - Notes (from todo, text default)
      // - Team (from project, text default)
      expect(payload.children).toHaveLength(3);

      // Check inherited Status default
      const statusField = payload.children!.find(
        (c: any) => c.attributeId === "status-field-id"
      ) as any;
      expect(statusField).toBeDefined();
      expect(statusField.children[0].id).toBe("later-id");

      // Check own Team default
      const teamField = payload.children!.find(
        (c: any) => c.attributeId === "team-field-id"
      ) as any;
      expect(teamField).toBeDefined();
      expect(teamField.children[0].name).toBe("Engineering");
    });
  });
});
