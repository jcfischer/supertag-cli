/**
 * Shared seeded test database for service-level tests that would otherwise
 * implicitly resolve the live 854k-node workspace DB (and then either run for
 * tens of seconds or `SQLITE_CANTOPEN`-skip on CI).
 *
 * Pass `dbPath` to a service via its injection point — e.g.
 * `batchCreateNodes(nodes, { dryRun: true, _dbPathOverride: db.dbPath })` or
 * `buildNodePayloadFromDatabase(db.dbPath, …)` — so the test is deterministic
 * and runs on CI instead of depending on a real workspace database.
 *
 * Schema mirrors the columns the node-builder / schema-service read; it seeds a
 * couple of supertags (`todo`, `meeting`) so tag resolution succeeds.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export interface SeededDb {
  /** Absolute path to the seeded SQLite database. */
  dbPath: string;
  /** Remove the temp directory. Call in afterEach/afterAll. */
  cleanup: () => void;
}

let counter = 0;

/**
 * Create a fresh, schema-valid, seeded database in a unique temp directory.
 */
export function createSeededDb(label = "seeded"): SeededDb {
  const dir = join(tmpdir(), `supertag-${label}-${process.pid}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "test.db");

  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      parent_id TEXT,
      node_type TEXT,
      created INTEGER,
      updated INTEGER,
      raw_data TEXT
    )
  `);
  db.run(`
    CREATE TABLE supertags (
      id TEXT PRIMARY KEY,
      name TEXT,
      color TEXT
    )
  `);
  db.run(`
    CREATE TABLE tag_applications (
      tag_node_id TEXT,
      data_node_id TEXT,
      tag_name TEXT,
      PRIMARY KEY (tag_node_id, data_node_id)
    )
  `);
  db.run(`
    CREATE TABLE field_definitions (
      id TEXT PRIMARY KEY,
      supertag_id TEXT,
      name TEXT,
      field_type TEXT
    )
  `);
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
  db.run(`
    CREATE TABLE supertag_fields (
      tag_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_label_id TEXT NOT NULL,
      field_order INTEGER DEFAULT 0,
      normalized_name TEXT,
      description TEXT,
      inferred_data_type TEXT,
      target_supertag_id TEXT,
      target_supertag_name TEXT,
      default_value_id TEXT,
      default_value_text TEXT,
      PRIMARY KEY (tag_id, field_label_id)
    )
  `);
  db.run(`
    CREATE TABLE supertag_parents (
      child_tag_id TEXT NOT NULL,
      parent_tag_id TEXT NOT NULL,
      PRIMARY KEY (child_tag_id, parent_tag_id)
    )
  `);

  for (const [id, name, color] of [
    ["tag_todo", "todo", "#FF0000"],
    ["tag_meeting", "meeting", "#00FF00"],
  ] as const) {
    db.run(`INSERT INTO supertags (id, name, color) VALUES (?, ?, ?)`, [id, name, color]);
    db.run(
      `INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, color) VALUES (?, ?, ?, ?)`,
      [id, name, name, color]
    );
  }

  db.close();

  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
