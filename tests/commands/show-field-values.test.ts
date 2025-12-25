/**
 * Tests for getNodeContents using field_values table
 *
 * Bug: getNodeContents was parsing raw tuples and using field_names lookup,
 * which fails when fields are not formally defined in supertag schemas.
 *
 * Fix: getNodeContents should query field_values table directly, which
 * already has the correct field_name and value_text.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { getNodeContents } from "../../src/commands/show";
import { unlinkSync, existsSync } from "fs";

const TEST_DB_PATH = "./test-show-field-values.db";

describe("getNodeContents with field_values", () => {
  let db: Database;

  beforeAll(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    db = new Database(TEST_DB_PATH);

    // Create minimal schema for nodes
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        parent_id TEXT,
        node_type TEXT,
        created INTEGER,
        updated INTEGER,
        done_at INTEGER,
        raw_data TEXT
      )
    `);

    // Create tag_applications table
    db.run(`
      CREATE TABLE tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_node_id TEXT NOT NULL,
        data_node_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL
      )
    `);

    // Create field_names table (will be empty to simulate missing field definitions)
    db.run(`
      CREATE TABLE field_names (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_id TEXT NOT NULL UNIQUE,
        field_name TEXT NOT NULL,
        supertags TEXT
      )
    `);

    // Create field_values table (has the correct data)
    db.run(`
      CREATE TABLE field_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        field_def_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        value_node_id TEXT NOT NULL,
        value_text TEXT NOT NULL,
        value_order INTEGER DEFAULT 0,
        created INTEGER
      )
    `);

    // Create a test #day node
    const dayNodeId = "test-day-node";
    const rawData = {
      id: dayNodeId,
      props: { created: 1735132800000, name: "2025-12-25 - Wednesday" },
      children: ["tuple-focus", "tuple-meetings"],
    };

    db.run(
      `INSERT INTO nodes (id, name, created, raw_data) VALUES (?, ?, ?, ?)`,
      [dayNodeId, "2025-12-25 - Wednesday", 1735132800000, JSON.stringify(rawData)]
    );

    // Apply #day tag
    db.run(
      `INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES (?, ?, ?, ?)`,
      ["tuple-tag", dayNodeId, "day-tag-id", "day"]
    );

    // Create tuple for Focus field (in field_names - will work)
    const focusTupleRaw = {
      id: "tuple-focus",
      props: { _docType: "tuple" },
      children: ["field-focus-id", "value-focus-id"],
    };
    db.run(
      `INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)`,
      ["tuple-focus", null, JSON.stringify(focusTupleRaw)]
    );

    // Create Focus field label node
    db.run(
      `INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)`,
      ["field-focus-id", "Focus", JSON.stringify({ id: "field-focus-id", props: { name: "Focus" } })]
    );

    // Create Focus value node
    db.run(
      `INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)`,
      ["value-focus-id", "Work", JSON.stringify({ id: "value-focus-id", props: { name: "Work" } })]
    );

    // Add Focus to field_names (simulating it's in a supertag definition)
    db.run(
      `INSERT INTO field_names (field_id, field_name, supertags) VALUES (?, ?, ?)`,
      ["field-focus-id", "Focus", '["day"]']
    );

    // Add Focus to field_values
    db.run(
      `INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text) VALUES (?, ?, ?, ?, ?, ?)`,
      ["tuple-focus", dayNodeId, "field-focus-id", "Focus", "value-focus-id", "Work"]
    );

    // Create tuple for Meetings field (NOT in field_names - was failing)
    const meetingsTupleRaw = {
      id: "tuple-meetings",
      props: { _docType: "tuple" },
      children: ["field-meetings-id", "value-meeting-1", "value-meeting-2"],
    };
    db.run(
      `INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)`,
      ["tuple-meetings", null, JSON.stringify(meetingsTupleRaw)]
    );

    // Create Meetings field label node
    db.run(
      `INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)`,
      ["field-meetings-id", "Meetings", JSON.stringify({ id: "field-meetings-id", props: { name: "Meetings" } })]
    );

    // Create meeting value nodes
    db.run(
      `INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)`,
      ["value-meeting-1", "Team Sync", JSON.stringify({ id: "value-meeting-1", props: { name: "Team Sync" } })]
    );
    db.run(
      `INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)`,
      ["value-meeting-2", "Planning", JSON.stringify({ id: "value-meeting-2", props: { name: "Planning" } })]
    );

    // NOTE: Meetings is NOT in field_names (simulating field not in supertag schema)
    // But it IS in field_values (the correct data source)
    db.run(
      `INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["tuple-meetings", dayNodeId, "field-meetings-id", "Meetings", "value-meeting-1", "Team Sync", 0]
    );
    db.run(
      `INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["tuple-meetings", dayNodeId, "field-meetings-id", "Meetings", "value-meeting-2", "Planning", 1]
    );
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it("should return Focus field (in field_names)", () => {
    const contents = getNodeContents(db, "test-day-node");
    expect(contents).not.toBeNull();

    const focusField = contents!.fields.find(f => f.fieldName === "Focus");
    expect(focusField).toBeDefined();
    expect(focusField!.value).toBe("Work");
  });

  it("should return Meetings field (NOT in field_names but in field_values)", () => {
    const contents = getNodeContents(db, "test-day-node");
    expect(contents).not.toBeNull();

    // This is the bug - Meetings should be found even though it's not in field_names
    const meetingsField = contents!.fields.find(f => f.fieldName === "Meetings");
    expect(meetingsField).toBeDefined();
    expect(meetingsField!.value).toContain("Team Sync");
  });

  it("should return all field values for multi-value fields", () => {
    const contents = getNodeContents(db, "test-day-node");
    expect(contents).not.toBeNull();

    const meetingsField = contents!.fields.find(f => f.fieldName === "Meetings");
    expect(meetingsField).toBeDefined();
    // Should contain both meeting values
    expect(meetingsField!.value).toContain("Team Sync");
    expect(meetingsField!.value).toContain("Planning");
  });

  it("should return correct number of fields", () => {
    const contents = getNodeContents(db, "test-day-node");
    expect(contents).not.toBeNull();

    // Should have 2 fields: Focus and Meetings
    expect(contents!.fields.length).toBe(2);
  });
});
