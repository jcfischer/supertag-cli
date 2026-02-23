/**
 * Schema Audit Loader Tests (F-101)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { loadWorkspaceSchema } from '../src/services/schema-audit-loader';

function createTestDb(): Database {
  const db = new Database(':memory:');

  // Create supertag_metadata table
  db.run(`
    CREATE TABLE supertag_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id TEXT NOT NULL UNIQUE,
      tag_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at INTEGER
    )
  `);

  // Create supertag_fields table (enhanced)
  db.run(`
    CREATE TABLE supertag_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_label_id TEXT NOT NULL,
      field_order INTEGER DEFAULT 0,
      normalized_name TEXT,
      description TEXT,
      inferred_data_type TEXT,
      target_supertag_id TEXT,
      target_supertag_name TEXT,
      option_values TEXT,
      UNIQUE(tag_id, field_name)
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

  // Create supertag_parents table
  db.run(`
    CREATE TABLE supertag_parents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_tag_id TEXT NOT NULL,
      parent_tag_id TEXT NOT NULL,
      UNIQUE(child_tag_id, parent_tag_id)
    )
  `);

  // Create field_values table
  db.run(`
    CREATE TABLE field_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      field_def_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      value_text TEXT,
      value_node_id TEXT,
      created INTEGER
    )
  `);

  return db;
}

describe('Schema Audit Loader', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('loads workspace with multiple supertags', () => {
    // Insert supertag metadata
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color) VALUES ('tag1', 'Person', 'person', 'A person', '#ff0000')`);
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color) VALUES ('tag2', 'Meeting', 'meeting', 'A meeting', '#00ff00')`);

    // Insert fields
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('tag1', 'Person', 'Email', 'field1', 0, 'email')`);
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('tag2', 'Meeting', 'Date', 'field2', 0, 'date')`);

    // Insert tag applications
    db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('t1', 'n1', 'tag1', 'Person')`);
    db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('t2', 'n2', 'tag1', 'Person')`);
    db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('t3', 'n3', 'tag2', 'Meeting')`);

    const schema = loadWorkspaceSchema(db);

    expect(schema.supertags).toHaveLength(2);
    expect(schema.fields).toHaveLength(2);

    const person = schema.supertags.find(s => s.name === 'Person');
    expect(person).toBeDefined();
    expect(person!.instanceCount).toBe(2);
    expect(person!.description).toBe('A person');

    const meeting = schema.supertags.find(s => s.name === 'Meeting');
    expect(meeting).toBeDefined();
    expect(meeting!.instanceCount).toBe(1);
  });

  it('calculates correct fill rates', () => {
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('tag1', 'Person', 'person')`);
    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order) VALUES ('tag1', 'Person', 'Email', 'field1', 0)`);

    // 3 instances
    db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('t1', 'n1', 'tag1', 'Person')`);
    db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('t2', 'n2', 'tag1', 'Person')`);
    db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('t3', 'n3', 'tag1', 'Person')`);

    // 2 have email field populated
    db.run(`INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_text) VALUES ('fv1', 'n1', 'field1', 'Email', 'a@b.com')`);
    db.run(`INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_text) VALUES ('fv2', 'n2', 'field1', 'Email', 'c@d.com')`);

    const schema = loadWorkspaceSchema(db);

    const emailStats = schema.fieldValues.find(fv => fv.fieldName === 'Email');
    expect(emailStats).toBeDefined();
    expect(emailStats!.populatedCount).toBe(2);
    expect(emailStats!.totalInstances).toBe(3);
    expect(emailStats!.fillRate).toBeCloseTo(66.67, 0);
  });

  it('loads inheritance relationships', () => {
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('parent', 'Entity', 'entity')`);
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('child', 'Person', 'person')`);
    db.run(`INSERT INTO supertag_parents (child_tag_id, parent_tag_id) VALUES ('child', 'parent')`);

    const schema = loadWorkspaceSchema(db);

    expect(schema.inheritance).toHaveLength(1);
    expect(schema.inheritance[0].childTagId).toBe('child');
    expect(schema.inheritance[0].parentTagId).toBe('parent');
  });

  it('handles empty workspace gracefully', () => {
    const schema = loadWorkspaceSchema(db);

    expect(schema.supertags).toHaveLength(0);
    expect(schema.fields).toHaveLength(0);
    expect(schema.inheritance).toHaveLength(0);
    expect(schema.tagApplications).toHaveLength(0);
    expect(schema.fieldValues).toHaveLength(0);
  });

  it('excludes system tags', () => {
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('sys1', 'tuple', 'tuple')`);
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('sys2', 'viewDef', 'viewdef')`);
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('usr1', 'Person', 'person')`);

    const schema = loadWorkspaceSchema(db);

    expect(schema.supertags).toHaveLength(1);
    expect(schema.supertags[0].name).toBe('Person');
  });

  it('fallback: loads from supertag_fields when no supertag_metadata', () => {
    // Drop supertag_metadata to test fallback path
    db.run('DROP TABLE supertag_metadata');

    db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order) VALUES ('tag1', 'Person', 'Email', 'field1', 0)`);
    db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('t1', 'n1', 'tag1', 'Person')`);

    const schema = loadWorkspaceSchema(db);

    expect(schema.supertags).toHaveLength(1);
    expect(schema.supertags[0].name).toBe('Person');
    expect(schema.supertags[0].instanceCount).toBe(1);
  });
});
