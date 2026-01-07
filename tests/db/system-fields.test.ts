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

// T-2.1: Test discoverSystemFieldSources function
describe('discoverSystemFieldSources', () => {
  it('should discover SYS_A90 (Date) from tagDef tuples', async () => {
    const { discoverSystemFieldSources } = await import('../../src/db/system-fields');

    // Mock docs simulating a tagDef with SYS_A90 field
    const mockDocs = [
      {
        id: 'tagDef1',
        props: { _docType: 'tagDef', name: 'meeting' },
        children: ['tuple1'],
      },
      {
        id: 'tuple1',
        props: { _docType: 'tuple' },
        children: ['SYS_A90', 'value1'], // First child is field ID
      },
    ];

    const docsById = new Map(mockDocs.map(d => [d.id, d]));
    const result = discoverSystemFieldSources(mockDocs, docsById);

    expect(result.has('SYS_A90')).toBe(true);
    expect(result.get('SYS_A90')!.has('tagDef1')).toBe(true);
  });

  it('should discover SYS_A142 (Attendees) from tagDef tuples', async () => {
    const { discoverSystemFieldSources } = await import('../../src/db/system-fields');

    const mockDocs = [
      {
        id: 'eventTag',
        props: { _docType: 'tagDef', name: 'event' },
        children: ['tuple2'],
      },
      {
        id: 'tuple2',
        props: { _docType: 'tuple' },
        children: ['SYS_A142', 'attendeesList'],
      },
    ];

    const docsById = new Map(mockDocs.map(d => [d.id, d]));
    const result = discoverSystemFieldSources(mockDocs, docsById);

    expect(result.has('SYS_A142')).toBe(true);
    expect(result.get('SYS_A142')!.has('eventTag')).toBe(true);
  });

  it('should ignore unknown SYS_A* fields not in SYSTEM_FIELD_METADATA', async () => {
    const { discoverSystemFieldSources } = await import('../../src/db/system-fields');

    const mockDocs = [
      {
        id: 'tagDef1',
        props: { _docType: 'tagDef', name: 'test' },
        children: ['tuple1'],
      },
      {
        id: 'tuple1',
        props: { _docType: 'tuple' },
        children: ['SYS_A999', 'value'], // Unknown system field
      },
    ];

    const docsById = new Map(mockDocs.map(d => [d.id, d]));
    const result = discoverSystemFieldSources(mockDocs, docsById);

    expect(result.has('SYS_A999')).toBe(false);
  });

  it('should ignore non-tagDef documents', async () => {
    const { discoverSystemFieldSources } = await import('../../src/db/system-fields');

    const mockDocs = [
      {
        id: 'node1',
        props: { _docType: 'node', name: 'regular node' },
        children: ['tuple1'],
      },
      {
        id: 'tuple1',
        props: { _docType: 'tuple' },
        children: ['SYS_A90', 'value'],
      },
    ];

    const docsById = new Map(mockDocs.map(d => [d.id, d]));
    const result = discoverSystemFieldSources(mockDocs, docsById);

    expect(result.size).toBe(0);
  });

  it('should handle multiple tagDefs defining the same system field', async () => {
    const { discoverSystemFieldSources } = await import('../../src/db/system-fields');

    const mockDocs = [
      {
        id: 'tagDef1',
        props: { _docType: 'tagDef', name: 'meeting' },
        children: ['tuple1'],
      },
      {
        id: 'tuple1',
        props: { _docType: 'tuple' },
        children: ['SYS_A90', 'date1'],
      },
      {
        id: 'tagDef2',
        props: { _docType: 'tagDef', name: 'appointment' },
        children: ['tuple2'],
      },
      {
        id: 'tuple2',
        props: { _docType: 'tuple' },
        children: ['SYS_A90', 'date2'],
      },
    ];

    const docsById = new Map(mockDocs.map(d => [d.id, d]));
    const result = discoverSystemFieldSources(mockDocs, docsById);

    expect(result.has('SYS_A90')).toBe(true);
    expect(result.get('SYS_A90')!.size).toBe(2);
    expect(result.get('SYS_A90')!.has('tagDef1')).toBe(true);
    expect(result.get('SYS_A90')!.has('tagDef2')).toBe(true);
  });
});

// T-2.2: Test insertSystemFieldSources function
describe('insertSystemFieldSources', () => {
  let testDir: string;
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    testDir = join('/tmp', `supertag-system-fields-insert-test-${Date.now()}`);
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

  it('should insert discovered system field sources', async () => {
    const { migrateSystemFieldSources, insertSystemFieldSources } = await import('../../src/db/system-fields');
    migrateSystemFieldSources(db);

    const sources = new Map<string, Set<string>>();
    sources.set('SYS_A90', new Set(['tagDef1', 'tagDef2']));
    sources.set('SYS_A142', new Set(['tagDef1']));

    insertSystemFieldSources(db, sources);

    const rows = db.query('SELECT field_id, tag_id FROM system_field_sources ORDER BY field_id, tag_id').all() as Array<{
      field_id: string;
      tag_id: string;
    }>;

    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({ field_id: 'SYS_A142', tag_id: 'tagDef1' });
    expect(rows[1]).toEqual({ field_id: 'SYS_A90', tag_id: 'tagDef1' });
    expect(rows[2]).toEqual({ field_id: 'SYS_A90', tag_id: 'tagDef2' });
  });

  it('should clear existing sources before inserting', async () => {
    const { migrateSystemFieldSources, insertSystemFieldSources } = await import('../../src/db/system-fields');
    migrateSystemFieldSources(db);

    // Insert initial data
    db.run("INSERT INTO system_field_sources (field_id, tag_id) VALUES ('SYS_A61', 'oldTag')");

    // Insert new data (should replace old)
    const sources = new Map<string, Set<string>>();
    sources.set('SYS_A90', new Set(['newTag']));

    insertSystemFieldSources(db, sources);

    const rows = db.query('SELECT field_id, tag_id FROM system_field_sources').all() as Array<{
      field_id: string;
      tag_id: string;
    }>;

    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({ field_id: 'SYS_A90', tag_id: 'newTag' });
  });

  it('should handle empty sources map', async () => {
    const { migrateSystemFieldSources, insertSystemFieldSources } = await import('../../src/db/system-fields');
    migrateSystemFieldSources(db);

    const sources = new Map<string, Set<string>>();
    insertSystemFieldSources(db, sources);

    const rows = db.query('SELECT * FROM system_field_sources').all();
    expect(rows.length).toBe(0);
  });
});
