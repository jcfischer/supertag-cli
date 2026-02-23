/**
 * Schema Audit Fixer Tests (Issue #57)
 *
 * Tests for auto-fix functionality: orphan tag removal,
 * unused field removal, fixable annotation, and audit trail.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { annotateFixable, applyFix, writeAuditTrail } from '../src/services/schema-audit-fixer';
import { SchemaAuditService } from '../src/services/schema-audit-service';
import type { SchemaFinding } from '../src/types/schema-audit';

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
  // Tags: Person (2 instances), Meeting (1 instance), Orphan (0 instances)
  db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('t1', 'Person', 'person')`);
  db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('t2', 'Meeting', 'meeting')`);
  db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name) VALUES ('t3', 'Orphan', 'orphan')`);

  // Fields
  db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('t1', 'Person', 'Email', 'f1', 0, 'email')`);
  db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('t1', 'Person', 'Phone', 'f4', 1, 'plain')`);
  db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('t2', 'Meeting', 'Date', 'f2', 0, 'date')`);
  db.run(`INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type) VALUES ('t3', 'Orphan', 'Notes', 'f3', 0, 'plain')`);

  // Tag applications
  db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('ta1', 'n1', 't1', 'Person')`);
  db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('ta2', 'n2', 't1', 'Person')`);
  db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('ta3', 'n3', 't2', 'Meeting')`);
  // t3 has no applications → orphan

  // Field values: Only Email is populated for Person, Phone is unused
  db.run(`INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_text) VALUES ('fv1', 'n1', 'f1', 'Email', 'test@test.com')`);
}

describe('Schema Audit Fixer', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('annotateFixable', () => {
    it('marks orphan-tags findings as fixable', () => {
      const findings: SchemaFinding[] = [{
        detector: 'orphan-tags',
        severity: 'warning',
        message: 'Supertag "Orphan" has zero instances',
        details: { tagId: 't3', tagName: 'Orphan', instanceCount: 0 },
      }];

      const annotated = annotateFixable(findings);
      expect(annotated[0].fixable).toBe(true);
      expect(annotated[0].skipReason).toBeUndefined();
    });

    it('marks unused-fields findings as fixable', () => {
      const findings: SchemaFinding[] = [{
        detector: 'unused-fields',
        severity: 'info',
        message: 'Field "Phone" on "Person" is never populated',
        details: { fieldName: 'Phone', tagId: 't1', tagName: 'Person', fillRate: 0 },
      }];

      const annotated = annotateFixable(findings);
      expect(annotated[0].fixable).toBe(true);
    });

    it('marks type-mismatch findings as NOT fixable with reason', () => {
      const findings: SchemaFinding[] = [{
        detector: 'type-mismatch',
        severity: 'error',
        message: 'Field "Email" has conflicting types: email, plain',
        details: { fieldName: 'Email' },
      }];

      const annotated = annotateFixable(findings);
      expect(annotated[0].fixable).toBe(false);
      expect(annotated[0].skipReason).toContain('manual decision');
    });

    it('marks duplicate-fields findings as NOT fixable with reason', () => {
      const findings: SchemaFinding[] = [{
        detector: 'duplicate-fields',
        severity: 'warning',
        message: 'Field "Name" defined on unrelated tags',
        details: { fieldName: 'Name' },
      }];

      const annotated = annotateFixable(findings);
      expect(annotated[0].fixable).toBe(false);
      expect(annotated[0].skipReason).toContain('architectural decision');
    });

    it('marks missing-inheritance findings as NOT fixable', () => {
      const findings: SchemaFinding[] = [{
        detector: 'missing-inheritance',
        severity: 'info',
        message: 'Tags share fields',
        details: {},
      }];

      const annotated = annotateFixable(findings);
      expect(annotated[0].fixable).toBe(false);
    });
  });

  describe('applyFix — orphan tags', () => {
    it('removes orphan tag from supertag_metadata', () => {
      const finding: SchemaFinding = {
        detector: 'orphan-tags',
        severity: 'warning',
        message: 'Supertag "Orphan" has zero instances',
        details: { tagId: 't3', tagName: 'Orphan', instanceCount: 0 },
        fixable: true,
      };

      const result = applyFix(db, finding);
      expect(result.success).toBe(true);
      expect(result.action).toContain('Removed orphan tag');
      expect(result.action).toContain('Orphan');

      // Verify removal from database
      const meta = db.query(`SELECT * FROM supertag_metadata WHERE tag_id = 't3'`).get();
      expect(meta).toBeNull();
    });

    it('removes orphan tag fields from supertag_fields', () => {
      const finding: SchemaFinding = {
        detector: 'orphan-tags',
        severity: 'warning',
        message: 'Supertag "Orphan" has zero instances',
        details: { tagId: 't3', tagName: 'Orphan', instanceCount: 0 },
        fixable: true,
      };

      const result = applyFix(db, finding);
      expect(result.success).toBe(true);

      const fields = db.query(`SELECT * FROM supertag_fields WHERE tag_id = 't3'`).all();
      expect(fields).toHaveLength(0);
    });

    it('does NOT remove tags that have gained instances since audit', () => {
      // Give the "orphan" tag an instance
      db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('ta4', 'n4', 't3', 'Orphan')`);

      const finding: SchemaFinding = {
        detector: 'orphan-tags',
        severity: 'warning',
        message: 'Supertag "Orphan" has zero instances',
        details: { tagId: 't3', tagName: 'Orphan', instanceCount: 0 },
        fixable: true,
      };

      const result = applyFix(db, finding);
      expect(result.success).toBe(false);
      expect(result.error).toContain('no longer orphaned');

      // Tag should still exist
      const meta = db.query(`SELECT * FROM supertag_metadata WHERE tag_id = 't3'`).get();
      expect(meta).not.toBeNull();
    });

    it('does NOT affect non-orphan tags', () => {
      const finding: SchemaFinding = {
        detector: 'orphan-tags',
        severity: 'warning',
        message: 'Supertag "Orphan" has zero instances',
        details: { tagId: 't3', tagName: 'Orphan', instanceCount: 0 },
        fixable: true,
      };

      applyFix(db, finding);

      // Person and Meeting should still exist
      const person = db.query(`SELECT * FROM supertag_metadata WHERE tag_id = 't1'`).get();
      const meeting = db.query(`SELECT * FROM supertag_metadata WHERE tag_id = 't2'`).get();
      expect(person).not.toBeNull();
      expect(meeting).not.toBeNull();
    });

    it('removes orphan tag from supertag_parents', () => {
      // Add an inheritance relationship for the orphan
      db.run(`INSERT INTO supertag_parents (child_tag_id, parent_tag_id) VALUES ('t3', 't1')`);

      const finding: SchemaFinding = {
        detector: 'orphan-tags',
        severity: 'warning',
        message: 'Supertag "Orphan" has zero instances',
        details: { tagId: 't3', tagName: 'Orphan', instanceCount: 0 },
        fixable: true,
      };

      applyFix(db, finding);

      const parents = db.query(`SELECT * FROM supertag_parents WHERE child_tag_id = 't3' OR parent_tag_id = 't3'`).all();
      expect(parents).toHaveLength(0);
    });
  });

  describe('applyFix — unused fields', () => {
    it('removes unused field from supertag_fields', () => {
      const finding: SchemaFinding = {
        detector: 'unused-fields',
        severity: 'info',
        message: 'Field "Phone" on "Person" is never populated',
        details: { fieldName: 'Phone', tagId: 't1', tagName: 'Person', fillRate: 0 },
        fixable: true,
      };

      const result = applyFix(db, finding);
      expect(result.success).toBe(true);
      expect(result.action).toContain('Removed unused field');
      expect(result.action).toContain('Phone');

      // Verify removal
      const field = db.query(`SELECT * FROM supertag_fields WHERE field_name = 'Phone' AND tag_id = 't1'`).get();
      expect(field).toBeNull();
    });

    it('does NOT remove fields that have gained values since audit', () => {
      // Add a value for the Phone field
      db.run(`INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_text) VALUES ('fv2', 'n1', 'f4', 'Phone', '555-1234')`);

      const finding: SchemaFinding = {
        detector: 'unused-fields',
        severity: 'info',
        message: 'Field "Phone" on "Person" is never populated',
        details: { fieldName: 'Phone', tagId: 't1', tagName: 'Person', fillRate: 0 },
        fixable: true,
      };

      const result = applyFix(db, finding);
      expect(result.success).toBe(false);
      expect(result.error).toContain('no longer unused');
    });

    it('does NOT affect other fields on the same tag', () => {
      const finding: SchemaFinding = {
        detector: 'unused-fields',
        severity: 'info',
        message: 'Field "Phone" on "Person" is never populated',
        details: { fieldName: 'Phone', tagId: 't1', tagName: 'Person', fillRate: 0 },
        fixable: true,
      };

      applyFix(db, finding);

      // Email field should still exist
      const email = db.query(`SELECT * FROM supertag_fields WHERE field_name = 'Email' AND tag_id = 't1'`).get();
      expect(email).not.toBeNull();
    });
  });

  describe('applyFix — non-fixable findings', () => {
    it('skips type-mismatch findings', () => {
      const finding: SchemaFinding = {
        detector: 'type-mismatch',
        severity: 'error',
        message: 'Field "Email" has conflicting types',
        details: { fieldName: 'Email' },
      };

      const result = applyFix(db, finding);
      expect(result.success).toBe(false);
      expect(result.action).toBe('skipped');
    });

    it('skips duplicate-fields findings', () => {
      const finding: SchemaFinding = {
        detector: 'duplicate-fields',
        severity: 'warning',
        message: 'Field "Name" on unrelated tags',
        details: { fieldName: 'Name' },
      };

      const result = applyFix(db, finding);
      expect(result.success).toBe(false);
      expect(result.action).toBe('skipped');
    });
  });

  describe('annotateFixable via SchemaAuditService', () => {
    it('audit results include fixable annotations', () => {
      const service = new SchemaAuditService(db);
      const report = service.audit();

      // Should have some fixable findings (orphan tag)
      const fixable = report.findings.filter(f => f.fixable);
      const nonFixable = report.findings.filter(f => f.fixable === false);

      expect(fixable.length).toBeGreaterThan(0);
      // All findings should have fixable annotation
      for (const f of report.findings) {
        expect(typeof f.fixable).toBe('boolean');
      }
    });
  });

  describe('writeAuditTrail', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `schema-audit-test-${Date.now()}`);
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true });
      }
    });

    it('writes JSONL audit trail for successful fixes', () => {
      const results = [{
        finding: {
          detector: 'orphan-tags',
          severity: 'warning' as const,
          message: 'Orphan tag removed',
          details: { tagId: 't3', tagName: 'Orphan' },
        },
        action: 'Removed orphan tag "Orphan"',
        success: true,
      }];

      const logFile = writeAuditTrail('main', results, tempDir);
      expect(logFile).toBeTruthy();
      expect(existsSync(logFile)).toBe(true);

      const content = readFileSync(logFile, 'utf-8');
      const entry = JSON.parse(content.trim());
      expect(entry.workspace).toBe('main');
      expect(entry.action).toContain('Removed orphan tag');
      expect(entry.detector).toBe('orphan-tags');
    });

    it('returns empty string for no successful fixes', () => {
      const results = [{
        finding: {
          detector: 'type-mismatch',
          severity: 'error' as const,
          message: 'Not fixable',
          details: {},
        },
        action: 'skipped',
        success: false,
      }];

      const logFile = writeAuditTrail('main', results, tempDir);
      expect(logFile).toBe('');
    });
  });
});
