/**
 * System Fields Discovery Tests
 *
 * TDD tests for system field metadata and discovery.
 * Spec 074: System Field Discovery
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// T-1.1: Test SYSTEM_FIELD_METADATA constant
describe('SYSTEM_FIELD_METADATA', () => {
  it('should export SYSTEM_FIELD_METADATA constant', async () => {
    const { SYSTEM_FIELD_METADATA } = await import('../../src/db/system-fields');
    expect(SYSTEM_FIELD_METADATA).toBeDefined();
    expect(typeof SYSTEM_FIELD_METADATA).toBe('object');
  });

  it('should contain SYS_A90 (Date) field metadata', async () => {
    const { SYSTEM_FIELD_METADATA } = await import('../../src/db/system-fields');
    expect(SYSTEM_FIELD_METADATA['SYS_A90']).toBeDefined();
    expect(SYSTEM_FIELD_METADATA['SYS_A90'].name).toBe('Date');
    expect(SYSTEM_FIELD_METADATA['SYS_A90'].normalizedName).toBe('date');
    expect(SYSTEM_FIELD_METADATA['SYS_A90'].dataType).toBe('date');
  });

  it('should contain SYS_A61 (Due Date) field metadata', async () => {
    const { SYSTEM_FIELD_METADATA } = await import('../../src/db/system-fields');
    expect(SYSTEM_FIELD_METADATA['SYS_A61']).toBeDefined();
    expect(SYSTEM_FIELD_METADATA['SYS_A61'].name).toBe('Due Date');
    expect(SYSTEM_FIELD_METADATA['SYS_A61'].normalizedName).toBe('duedate');
    expect(SYSTEM_FIELD_METADATA['SYS_A61'].dataType).toBe('date');
  });

  it('should contain SYS_A142 (Attendees) field metadata', async () => {
    const { SYSTEM_FIELD_METADATA } = await import('../../src/db/system-fields');
    expect(SYSTEM_FIELD_METADATA['SYS_A142']).toBeDefined();
    expect(SYSTEM_FIELD_METADATA['SYS_A142'].name).toBe('Attendees');
    expect(SYSTEM_FIELD_METADATA['SYS_A142'].normalizedName).toBe('attendees');
    expect(SYSTEM_FIELD_METADATA['SYS_A142'].dataType).toBe('reference');
  });

  it('should have all required fields for each metadata entry', async () => {
    const { SYSTEM_FIELD_METADATA } = await import('../../src/db/system-fields');

    for (const [id, meta] of Object.entries(SYSTEM_FIELD_METADATA)) {
      expect(id).toMatch(/^SYS_A/);
      expect(meta.name).toBeDefined();
      expect(typeof meta.name).toBe('string');
      expect(meta.normalizedName).toBeDefined();
      expect(typeof meta.normalizedName).toBe('string');
      expect(meta.dataType).toBeDefined();
      expect(['date', 'reference', 'text']).toContain(meta.dataType);
    }
  });
});

// T-1.3: Test system_field_sources table migration
describe('migrateSystemFieldSources', () => {
  let testDir: string;
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    // Create temp directory and database
    testDir = join('/tmp', `supertag-system-fields-test-${Date.now()}`);
    dbPath = join(testDir, 'test.db');
    mkdirSync(testDir, { recursive: true });
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create system_field_sources table', async () => {
    const { migrateSystemFieldSources } = await import('../../src/db/system-fields');
    migrateSystemFieldSources(db);

    // Verify table exists
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='system_field_sources'"
    ).all();
    expect(tables.length).toBe(1);
  });

  it('should create correct columns', async () => {
    const { migrateSystemFieldSources } = await import('../../src/db/system-fields');
    migrateSystemFieldSources(db);

    // Check table structure
    const info = db.query("PRAGMA table_info(system_field_sources)").all() as Array<{
      name: string;
      type: string;
    }>;
    const columnNames = info.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('field_id');
    expect(columnNames).toContain('tag_id');
  });

  it('should create indexes', async () => {
    const { migrateSystemFieldSources } = await import('../../src/db/system-fields');
    migrateSystemFieldSources(db);

    // Check indexes exist
    const indexes = db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='system_field_sources'"
    ).all() as Array<{ name: string }>;
    const indexNames = indexes.map(i => i.name);

    expect(indexNames.some(n => n.includes('field'))).toBe(true);
    expect(indexNames.some(n => n.includes('tag'))).toBe(true);
  });

  it('should be idempotent (safe to call multiple times)', async () => {
    const { migrateSystemFieldSources } = await import('../../src/db/system-fields');

    // Call twice - should not throw
    migrateSystemFieldSources(db);
    migrateSystemFieldSources(db);

    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='system_field_sources'"
    ).all();
    expect(tables.length).toBe(1);
  });

  it('should enforce unique constraint on field_id + tag_id', async () => {
    const { migrateSystemFieldSources } = await import('../../src/db/system-fields');
    migrateSystemFieldSources(db);

    // Insert first record
    db.run("INSERT INTO system_field_sources (field_id, tag_id) VALUES ('SYS_A90', 'tag1')");

    // Try to insert duplicate - should fail
    expect(() => {
      db.run("INSERT INTO system_field_sources (field_id, tag_id) VALUES ('SYS_A90', 'tag1')");
    }).toThrow();
  });
});
