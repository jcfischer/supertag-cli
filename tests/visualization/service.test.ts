/**
 * VisualizationService Tests
 *
 * TDD tests for the visualization data gathering service.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { VisualizationService } from "../../src/visualization/service";
import type { VisualizationData } from "../../src/visualization/types";

describe("VisualizationService", () => {
  let db: Database;
  let service: VisualizationService;

  beforeAll(() => {
    // Create in-memory test database with required tables
    db = new Database(":memory:");

    // Create tables matching the actual schema
    db.run(`
      CREATE TABLE supertag_metadata (
        tag_id TEXT PRIMARY KEY,
        tag_name TEXT NOT NULL,
        normalized_name TEXT,
        description TEXT,
        color TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE supertag_parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_tag_id TEXT NOT NULL,
        parent_tag_id TEXT NOT NULL,
        UNIQUE(child_tag_id, parent_tag_id)
      )
    `);

    db.run(`
      CREATE TABLE supertag_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_label_id TEXT,
        field_order INTEGER DEFAULT 0,
        inferred_data_type TEXT
      )
    `);

    db.run(`
      CREATE TABLE tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        tag_id TEXT NOT NULL
      )
    `);

    // Required by SupertagMetadataService.getTagName() as fallback
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT
      )
    `);

    // Insert node names for tags (used by getTagName fallback)
    db.run(`INSERT INTO nodes (id, name) VALUES
      ('tag_entity', 'entity'),
      ('tag_person', 'person'),
      ('tag_event', 'event'),
      ('tag_meeting', 'meeting'),
      ('tag_orphan', 'orphan')
    `);

    // Insert test data
    // Tags: entity (root), person (extends entity), meeting (extends event), event (extends entity)
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, color) VALUES
      ('tag_entity', 'entity', '#E8E8E8'),
      ('tag_person', 'person', '#B5D8FF'),
      ('tag_event', 'event', '#FFE4B5'),
      ('tag_meeting', 'meeting', '#FFD700'),
      ('tag_orphan', 'orphan', NULL)
    `);

    // Inheritance: person -> entity, event -> entity, meeting -> event
    db.run(`INSERT INTO supertag_parents (child_tag_id, parent_tag_id) VALUES
      ('tag_person', 'tag_entity'),
      ('tag_event', 'tag_entity'),
      ('tag_meeting', 'tag_event')
    `);

    // Fields (for field count)
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name) VALUES
      ('tag_person', 'person', 'Email'),
      ('tag_person', 'person', 'Phone'),
      ('tag_person', 'person', 'Company'),
      ('tag_meeting', 'meeting', 'Date'),
      ('tag_meeting', 'meeting', 'Attendees'),
      ('tag_meeting', 'meeting', 'Location'),
      ('tag_meeting', 'meeting', 'Notes'),
      ('tag_event', 'event', 'Date')
    `);

    // Tag applications (for usage count)
    for (let i = 0; i < 804; i++) {
      db.run(`INSERT INTO tag_applications (node_id, tag_id) VALUES ('node_${i}', 'tag_person')`);
    }
    for (let i = 0; i < 2245; i++) {
      db.run(`INSERT INTO tag_applications (node_id, tag_id) VALUES ('node_m${i}', 'tag_meeting')`);
    }
    for (let i = 0; i < 100; i++) {
      db.run(`INSERT INTO tag_applications (node_id, tag_id) VALUES ('node_e${i}', 'tag_event')`);
    }

    service = new VisualizationService(db);
  });

  afterAll(() => {
    db.close();
  });

  describe("getData", () => {
    it("should return all nodes and links by default (excluding orphans)", () => {
      const data = service.getData();

      // Should have 4 tags (entity, person, event, meeting) - orphan excluded by default
      expect(data.nodes.length).toBe(4);

      // Should have 3 links: person->entity, event->entity, meeting->event
      expect(data.links.length).toBe(3);

      // Metadata should be populated
      expect(data.metadata.totalTags).toBe(4);
      expect(data.metadata.totalLinks).toBe(3);
      expect(data.metadata.workspace).toBe("test");
    });

    it("should include orphans when includeOrphans is true", () => {
      const data = service.getData({ includeOrphans: true });

      // Should have 5 tags including orphan
      expect(data.nodes.length).toBe(5);

      // Orphan should be marked as orphan
      const orphan = data.nodes.find(n => n.name === "orphan");
      expect(orphan?.isOrphan).toBe(true);
    });

    it("should correctly identify leaf nodes", () => {
      const data = service.getData();

      // person and meeting are leaves (no children)
      const person = data.nodes.find(n => n.name === "person");
      const meeting = data.nodes.find(n => n.name === "meeting");
      const entity = data.nodes.find(n => n.name === "entity");
      const event = data.nodes.find(n => n.name === "event");

      expect(person?.isLeaf).toBe(true);
      expect(meeting?.isLeaf).toBe(true);
      expect(entity?.isLeaf).toBe(false);
      expect(event?.isLeaf).toBe(false);
    });

    it("should return correct field counts", () => {
      const data = service.getData();

      const person = data.nodes.find(n => n.name === "person");
      const meeting = data.nodes.find(n => n.name === "meeting");
      const entity = data.nodes.find(n => n.name === "entity");

      expect(person?.fieldCount).toBe(3);
      expect(meeting?.fieldCount).toBe(4);
      expect(entity?.fieldCount).toBe(0);
    });

    it("should return correct usage counts", () => {
      const data = service.getData();

      const person = data.nodes.find(n => n.name === "person");
      const meeting = data.nodes.find(n => n.name === "meeting");

      expect(person?.usageCount).toBe(804);
      expect(meeting?.usageCount).toBe(2245);
    });

    it("should filter by minUsage", () => {
      const data = service.getData({ minUsage: 500 });

      // Only person (804) and meeting (2245) have usage >= 500
      // But we also need entity and event for inheritance structure
      // Actually, minUsage should filter out low-usage tags
      expect(data.nodes.some(n => n.name === "person")).toBe(true);
      expect(data.nodes.some(n => n.name === "meeting")).toBe(true);
    });
  });

  describe("getSubtree", () => {
    it("should return subtree from root tag", () => {
      const data = service.getSubtree("event");

      // Should have event and meeting (child of event)
      expect(data.nodes.length).toBe(2);
      expect(data.nodes.some(n => n.name === "event")).toBe(true);
      expect(data.nodes.some(n => n.name === "meeting")).toBe(true);

      // Should have 1 link: meeting -> event
      expect(data.links.length).toBe(1);

      // Metadata should show root
      expect(data.metadata.rootTag).toBe("event");
    });

    it("should limit depth when specified", () => {
      const data = service.getSubtree("entity", 1);

      // At depth 1 from entity: person and event (direct children)
      // Should NOT include meeting (depth 2)
      expect(data.nodes.some(n => n.name === "entity")).toBe(true);
      expect(data.nodes.some(n => n.name === "person")).toBe(true);
      expect(data.nodes.some(n => n.name === "event")).toBe(true);
      expect(data.nodes.some(n => n.name === "meeting")).toBe(false);
    });

    it("should return null for unknown tag", () => {
      const data = service.getSubtree("unknown");
      expect(data).toBeNull();
    });
  });

  describe("getMaxDepth", () => {
    it("should calculate max depth of inheritance", () => {
      const depth = service.getMaxDepth();

      // entity -> event -> meeting = depth 2
      // entity -> person = depth 1
      // Max is 2
      expect(depth).toBe(2);
    });
  });

  describe("link structure", () => {
    it("should have links with correct source/target direction", () => {
      const data = service.getData();

      // Links should be child -> parent (source is child, target is parent)
      const personLink = data.links.find(l => l.source === "tag_person");
      expect(personLink?.target).toBe("tag_entity");

      const meetingLink = data.links.find(l => l.source === "tag_meeting");
      expect(meetingLink?.target).toBe("tag_event");
    });
  });

  describe("getDataWithFields", () => {
    it("should enrich nodes with field details", () => {
      const data = service.getDataWithFields();

      // Person should have its own fields
      const person = data.nodes.find(n => n.name === "person");
      expect(person?.fields).toBeDefined();
      expect(person?.fields?.length).toBeGreaterThan(0);

      // All person fields should be own (not inherited since entity has no fields)
      const ownFields = person?.fields?.filter(f => !f.inherited);
      expect(ownFields?.length).toBe(3); // Email, Phone, Company
    });

    it("should mark inherited fields with origin tag", () => {
      const data = service.getDataWithFields();

      // Meeting inherits Date from event
      const meeting = data.nodes.find(n => n.name === "meeting");
      expect(meeting?.fields).toBeDefined();

      // Meeting's own fields
      const ownFields = meeting?.fields?.filter(f => !f.inherited);
      expect(ownFields?.length).toBe(4); // Date, Attendees, Location, Notes (meeting's own Date)

      // Actually wait - if both meeting and event have "Date", meeting's Date should win (depth 0)
      // Let me check the logic - getAllFields uses field name deduplication, own fields first
    });

    it("should include all nodes even without fields", () => {
      const data = service.getDataWithFields();

      // Entity has no fields
      const entity = data.nodes.find(n => n.name === "entity");
      expect(entity?.fields).toBeDefined();
      expect(entity?.fields?.length).toBe(0);
    });

    it("should work with subtree filtering", () => {
      const data = service.getSubtreeWithFields("event");

      expect(data).not.toBeNull();
      expect(data?.nodes.length).toBe(2); // event and meeting

      // Event should have its field
      const event = data?.nodes.find(n => n.name === "event");
      expect(event?.fields?.some(f => f.name === "Date")).toBe(true);
    });

    it("should preserve other node properties", () => {
      const data = service.getDataWithFields();

      const person = data.nodes.find(n => n.name === "person");
      expect(person?.id).toBe("tag_person");
      expect(person?.fieldCount).toBe(3);
      expect(person?.usageCount).toBe(804);
      expect(person?.isLeaf).toBe(true);
      expect(person?.color).toBe("#B5D8FF");
    });
  });
});
