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
 * The supertag tables the schema-service reads (`supertag_metadata`,
 * `supertag_fields`, …) are built with the PRODUCTION migration functions so
 * the fixture can't drift from the real schema. The two indexer-owned tables
 * (`nodes`, `tag_applications`) are declared here as a minimal local subset —
 * not a verified mirror of `src/db/indexer.ts`; they exist only so the builder
 * can open the DB without `SQLITE_CANTOPEN`. Seeds `todo`/`meeting`.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  migrateSupertagMetadataSchema,
  migrateSchemaConsolidation,
  migrateFieldValuesSchema,
} from "../../src/db/migrate";

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

  // Schema-service tables via the real production migrations (no drift).
  migrateSupertagMetadataSchema(db);
  migrateSchemaConsolidation(db);
  migrateFieldValuesSchema(db);

  // Indexer-owned tables the node builder may read (mirror src/db/indexer.ts).
  db.run(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      parent_id TEXT,
      created INTEGER,
      updated INTEGER,
      raw_data TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tag_applications (
      tuple_node_id TEXT NOT NULL,
      data_node_id TEXT NOT NULL,
      tag_id TEXT,
      tag_name TEXT
    )
  `);

  for (const [id, name, color] of [
    ["tag_todo", "todo", "#FF0000"],
    ["tag_meeting", "meeting", "#00FF00"],
  ] as const) {
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

/**
 * Run `fn` with a fresh seeded database path, guaranteeing cleanup afterwards.
 * Use in the individual tests that need a DB so throw-before-DB / import-only
 * tests in the same describe don't pay for fixture setup.
 */
export async function withSeededDb<T>(
  label: string,
  fn: (dbPath: string) => Promise<T>
): Promise<T> {
  const seeded = createSeededDb(label);
  try {
    return await fn(seeded.dbPath);
  } finally {
    seeded.cleanup();
  }
}
