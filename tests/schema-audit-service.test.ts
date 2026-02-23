/**
 * Schema Audit Service Tests (F-101)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SchemaAuditService } from '../src/services/schema-audit-service';

function createTestDb(): Database {
  const db = new Database(':memory:');

  db.run(`CREATE TABLE supertag_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT NOT NULL UNIQUE,
    tag_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE supertag_fields (
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
  )`);

  db.run(`CREATE TABLE tag_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tuple_node_id TEXT NOT NULL,
    data_node_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    tag_name TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE supertag_parents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_tag_id TEXT NOT NULL,
    parent_tag_id TEXT NOT NULL,
    UNIQUE(child_tag_id, parent_tag_id)
  )`);

  db.run(`CREATE TABLE field_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tuple_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    field_def_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    value_text TEXT,
    value_node_id TEXT,
    created INTEGER
  )`);

  return db;
}

function seedTestData(db: Database) {
  // Tags
  db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('t1', 'Person', 'person')`);
  db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('t2', 'Meeting', 'meeting')`);
  db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('t3', 'Orphan', 'orphan')`);

  // Fields
  db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('t1', 'Person', 'Email', 'f1', 0, 'email')`);
  db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('t2', 'Meeting', 'Date', 'f2', 0, 'date')`);
  db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('t2', 'Meeting', 'Email', 'f3', 0, 'plain')`);

  // Tag applications
  db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('ta1', 'n1', 't1', 'Person')`);
  db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('ta2', 'n2', 't1', 'Person')`);
  db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('ta3', 'n3', 't2', 'Meeting')`);
  // t3 has no applications → orphan

  // Field values
  db.run(`INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_text) VALUES ('fv1', 'n1', 'f1', 'Email', 'test@test.com')`);
}

describe('SchemaAuditService', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns SchemaAuditReport with correct summary', () => {
    const service = new SchemaAuditService(db);
    const report = service.audit();

    expect(report.workspace).toBe('default');
    expect(report.timestamp).toBeTruthy();
    expect(report.summary.totalSupertags).toBe(3);
    expect(report.summary.totalFields).toBe(3);
    expect(typeof report.summary.findingsCount.error).toBe('number');
    expect(typeof report.summary.findingsCount.warning).toBe('number');
    expect(typeof report.summary.findingsCount.info).toBe('number');
  });

  it('detects orphan tag', () => {
    const service = new SchemaAuditService(db);
    const report = service.audit();

    const orphanFindings = report.findings.filter(f => f.detector === 'orphan-tags');
    expect(orphanFindings.length).toBeGreaterThanOrEqual(1);
    expect(orphanFindings.some(f => f.details.tagName === 'Orphan')).toBe(true);
  });

  it('detects type mismatch (Email: email vs plain)', () => {
    const service = new SchemaAuditService(db);
    const report = service.audit();

    const typeFindings = report.findings.filter(f => f.detector === 'type-mismatch');
    expect(typeFindings.length).toBeGreaterThanOrEqual(1);
    expect(typeFindings[0].severity).toBe('error');
    expect(typeFindings[0].details.fieldName).toBe('Email');
  });

  it('filters by tag', () => {
    const service = new SchemaAuditService(db);
    const report = service.audit({ tag: 'Person' });

    // Should only analyze Person tag
    expect(report.summary.totalSupertags).toBe(1);
  });

  it('returns empty report for non-existent tag', () => {
    const service = new SchemaAuditService(db);
    const report = service.audit({ tag: 'NonExistent' });

    expect(report.summary.totalSupertags).toBe(0);
    expect(report.findings).toHaveLength(0);
  });

  it('filters by severity', () => {
    const service = new SchemaAuditService(db);
    const report = service.audit({ severity: 'error' });

    for (const finding of report.findings) {
      expect(finding.severity).toBe('error');
    }
  });

  it('includes Tana Paste fixes when requested', () => {
    const service = new SchemaAuditService(db);
    const report = service.audit({ includeFixes: true });

    const orphanFinding = report.findings.find(f => f.detector === 'orphan-tags');
    if (orphanFinding) {
      expect(orphanFinding.tanaPaste).toBeTruthy();
    }
  });

  it('handles empty database', () => {
    const emptyDb = createTestDb();
    const service = new SchemaAuditService(emptyDb);
    const report = service.audit();

    expect(report.summary.totalSupertags).toBe(0);
    expect(report.findings).toHaveLength(0);
    emptyDb.close();
  });

  it('generates documentation', () => {
    const service = new SchemaAuditService(db);
    const docs = service.generateDocs();

    expect(docs).toContain('# Workspace Schema Reference');
    expect(docs).toContain('Person');
    expect(docs).toContain('Meeting');
    expect(docs).toContain('Email');
  });
});
