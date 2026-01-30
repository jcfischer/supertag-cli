/**
 * Database Migration for Delta-Sync Schema
 *
 * Adds delta-sync tracking columns to the existing sync_metadata table.
 * Safe to run multiple times - checks for column existence before adding.
 *
 * Spec: F-095 Delta-Sync via Local API
 */

import { Database } from "bun:sqlite";

/**
 * Check if a column exists in a table
 */
function columnExists(
  db: Database,
  tableName: string,
  columnName: string
): boolean {
  const columns = db
    .query(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  return columns.some((c) => c.name === columnName);
}

/**
 * Check if a table exists in the database
 */
function tableExists(db: Database, tableName: string): boolean {
  const result = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName);
  return result !== null;
}

/**
 * Ensure delta-sync schema extensions exist on sync_metadata table.
 * Adds delta_sync_timestamp and delta_nodes_synced columns.
 *
 * Safe to call multiple times - uses columnExists checks.
 *
 * @param db - SQLite database connection
 */
export function ensureDeltaSyncSchema(db: Database): void {
  // First ensure sync_metadata table exists at all
  // (it's created by TanaIndexer.initializeSchema(), but delta-sync
  // might run before a full sync, so we need the table to exist)
  if (!tableExists(db, "sync_metadata")) {
    db.run(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_export_file TEXT NOT NULL DEFAULT '',
        last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
        total_nodes INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  // Add delta-sync columns
  if (!columnExists(db, "sync_metadata", "delta_sync_timestamp")) {
    db.run(
      "ALTER TABLE sync_metadata ADD COLUMN delta_sync_timestamp INTEGER"
    );
  }
  if (!columnExists(db, "sync_metadata", "delta_nodes_synced")) {
    db.run(
      "ALTER TABLE sync_metadata ADD COLUMN delta_nodes_synced INTEGER DEFAULT 0"
    );
  }
}

/**
 * Check if delta-sync schema migration is needed
 *
 * @param db - SQLite database connection
 * @returns true if migration is needed
 */
export function needsDeltaSyncMigration(db: Database): boolean {
  if (!tableExists(db, "sync_metadata")) return true;
  if (!columnExists(db, "sync_metadata", "delta_sync_timestamp")) return true;
  if (!columnExists(db, "sync_metadata", "delta_nodes_synced")) return true;
  return false;
}
