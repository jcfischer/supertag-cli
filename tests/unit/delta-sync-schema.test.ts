import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureDeltaSyncSchema, needsDeltaSyncMigration } from '../../src/db/delta-sync-schema';

describe('Delta-Sync Schema Migration (T-1.3)', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  describe('ensureDeltaSyncSchema', () => {
    it('creates sync_metadata table if not exists and adds delta columns', () => {
      // No tables exist yet
      ensureDeltaSyncSchema(db);

      // Verify table and columns exist
      const columns = db.query('PRAGMA table_info(sync_metadata)').all() as Array<{ name: string }>;
      const colNames = columns.map(c => c.name);
      expect(colNames).toContain('delta_sync_timestamp');
      expect(colNames).toContain('delta_nodes_synced');
      expect(colNames).toContain('last_export_file');
      expect(colNames).toContain('last_sync_timestamp');
    });

    it('adds columns to existing sync_metadata table without delta columns', () => {
      // Create table without delta columns (simulates existing DB)
      db.run(`
        CREATE TABLE sync_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_export_file TEXT NOT NULL,
          last_sync_timestamp INTEGER NOT NULL,
          total_nodes INTEGER NOT NULL
        )
      `);
      // Insert existing data
      db.run(
        'INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, ?, ?, ?)',
        ['test.json', Date.now(), 1000]
      );

      ensureDeltaSyncSchema(db);

      // Verify columns added
      const columns = db.query('PRAGMA table_info(sync_metadata)').all() as Array<{ name: string }>;
      const colNames = columns.map(c => c.name);
      expect(colNames).toContain('delta_sync_timestamp');
      expect(colNames).toContain('delta_nodes_synced');

      // Verify existing data preserved
      const row = db.query('SELECT * FROM sync_metadata WHERE id = 1').get() as Record<string, unknown>;
      expect(row.last_export_file).toBe('test.json');
      expect(row.total_nodes).toBe(1000);
      // New columns should be null/default
      expect(row.delta_sync_timestamp).toBeNull();
      expect(row.delta_nodes_synced).toBe(0);
    });

    it('is idempotent - running twice does not error', () => {
      ensureDeltaSyncSchema(db);
      ensureDeltaSyncSchema(db);  // Second call should not throw

      const columns = db.query('PRAGMA table_info(sync_metadata)').all() as Array<{ name: string }>;
      const colNames = columns.map(c => c.name);
      expect(colNames).toContain('delta_sync_timestamp');
      expect(colNames).toContain('delta_nodes_synced');
    });

    it('works on database with sync_metadata that already has delta columns', () => {
      // Full setup with delta columns already present
      db.run(`
        CREATE TABLE sync_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_export_file TEXT NOT NULL,
          last_sync_timestamp INTEGER NOT NULL,
          total_nodes INTEGER NOT NULL,
          delta_sync_timestamp INTEGER,
          delta_nodes_synced INTEGER DEFAULT 0
        )
      `);
      db.run(
        'INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes, delta_sync_timestamp, delta_nodes_synced) VALUES (1, ?, ?, ?, ?, ?)',
        ['test.json', 1700000000000, 5000, 1700000300000, 12]
      );

      // Should not throw
      ensureDeltaSyncSchema(db);

      // Data preserved
      const row = db.query('SELECT * FROM sync_metadata WHERE id = 1').get() as Record<string, unknown>;
      expect(row.delta_sync_timestamp).toBe(1700000300000);
      expect(row.delta_nodes_synced).toBe(12);
    });
  });

  describe('needsDeltaSyncMigration', () => {
    it('returns true when sync_metadata table does not exist', () => {
      expect(needsDeltaSyncMigration(db)).toBe(true);
    });

    it('returns true when delta columns are missing', () => {
      db.run(`
        CREATE TABLE sync_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_export_file TEXT NOT NULL,
          last_sync_timestamp INTEGER NOT NULL,
          total_nodes INTEGER NOT NULL
        )
      `);
      expect(needsDeltaSyncMigration(db)).toBe(true);
    });

    it('returns false when all delta columns exist', () => {
      db.run(`
        CREATE TABLE sync_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_export_file TEXT NOT NULL,
          last_sync_timestamp INTEGER NOT NULL,
          total_nodes INTEGER NOT NULL,
          delta_sync_timestamp INTEGER,
          delta_nodes_synced INTEGER DEFAULT 0
        )
      `);
      expect(needsDeltaSyncMigration(db)).toBe(false);
    });
  });
});
