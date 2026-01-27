/**
 * Database Migration for Field Values Schema
 *
 * Handles creation of field_values, field_values_fts, and field_exclusions tables.
 * Safe to run multiple times - uses IF NOT EXISTS and checks for existing tables.
 */

import { Database } from "bun:sqlite";

/**
 * SQL statements for field values schema
 */
const FIELD_VALUES_TABLE = `
CREATE TABLE IF NOT EXISTS field_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tuple_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  field_def_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value_node_id TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_order INTEGER DEFAULT 0,
  created INTEGER
)`;

const FIELD_VALUES_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_field_values_parent ON field_values(parent_id)",
  "CREATE INDEX IF NOT EXISTS idx_field_values_field_name ON field_values(field_name)",
  "CREATE INDEX IF NOT EXISTS idx_field_values_field_def ON field_values(field_def_id)",
  "CREATE INDEX IF NOT EXISTS idx_field_values_created ON field_values(created)",
];

const FIELD_VALUES_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS field_values_fts USING fts5(
  field_name,
  value_text,
  content='field_values',
  content_rowid='id',
  tokenize='porter unicode61'
)`;

const FIELD_VALUES_FTS_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS field_values_ai AFTER INSERT ON field_values BEGIN
    INSERT INTO field_values_fts(rowid, field_name, value_text)
    VALUES (new.id, new.field_name, new.value_text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS field_values_ad AFTER DELETE ON field_values BEGIN
    INSERT INTO field_values_fts(field_values_fts, rowid, field_name, value_text)
    VALUES ('delete', old.id, old.field_name, old.value_text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS field_values_au AFTER UPDATE ON field_values BEGIN
    INSERT INTO field_values_fts(field_values_fts, rowid, field_name, value_text)
    VALUES ('delete', old.id, old.field_name, old.value_text);
    INSERT INTO field_values_fts(rowid, field_name, value_text)
    VALUES (new.id, new.field_name, new.value_text);
  END`,
];

const FIELD_EXCLUSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS field_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_name TEXT NOT NULL UNIQUE,
  reason TEXT
)`;

/**
 * Check if a table exists in the database
 */
function tableExists(db: Database, tableName: string): boolean {
  const result = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    )
    .get(tableName);
  return result !== null;
}

/**
 * Check if a trigger exists in the database
 */
function triggerExists(db: Database, triggerName: string): boolean {
  const result = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?"
    )
    .get(triggerName);
  return result !== null;
}

/**
 * Migrate the field values schema
 * Creates all necessary tables, indexes, and triggers for field value indexing.
 * Safe to run multiple times - uses IF NOT EXISTS.
 *
 * @param db - SQLite database connection
 */
export function migrateFieldValuesSchema(db: Database): void {
  // Create main field_values table
  db.run(FIELD_VALUES_TABLE);

  // Create indexes
  for (const indexSql of FIELD_VALUES_INDEXES) {
    db.run(indexSql);
  }

  // Create FTS virtual table (only if it doesn't exist)
  // Note: FTS tables don't support IF NOT EXISTS in all SQLite versions,
  // so we check first
  if (!tableExists(db, "field_values_fts")) {
    db.run(FIELD_VALUES_FTS);
  }

  // Create triggers (check if they exist first)
  if (!triggerExists(db, "field_values_ai")) {
    db.run(FIELD_VALUES_FTS_TRIGGERS[0]);
  }
  if (!triggerExists(db, "field_values_ad")) {
    db.run(FIELD_VALUES_FTS_TRIGGERS[1]);
  }
  if (!triggerExists(db, "field_values_au")) {
    db.run(FIELD_VALUES_FTS_TRIGGERS[2]);
  }

  // Create field_exclusions table
  db.run(FIELD_EXCLUSIONS_TABLE);
}

/**
 * Check if field values migration is needed
 *
 * @param db - SQLite database connection
 * @returns true if migration is needed (tables don't exist)
 */
export function needsFieldValuesMigration(db: Database): boolean {
  return !tableExists(db, "field_values");
}

/**
 * Clear all field values (used before full reindex)
 *
 * @param db - SQLite database connection
 */
export function clearFieldValues(db: Database): void {
  db.run("DELETE FROM field_values");
}

/**
 * Get count of field values in database
 *
 * @param db - SQLite database connection
 * @returns Number of field values stored
 */
export function getFieldValuesCount(db: Database): number {
  const result = db
    .query("SELECT COUNT(*) as count FROM field_values")
    .get() as { count: number } | null;
  return result?.count ?? 0;
}

// ============================================================================
// Supertag Metadata Schema Migration
// ============================================================================

/**
 * SQL statements for supertag metadata schema
 */
const SUPERTAG_FIELDS_TABLE = `
CREATE TABLE IF NOT EXISTS supertag_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_label_id TEXT NOT NULL,
  field_order INTEGER DEFAULT 0,
  UNIQUE(tag_id, field_name)
)`;

const SUPERTAG_FIELDS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_supertag_fields_tag ON supertag_fields(tag_id)",
  "CREATE INDEX IF NOT EXISTS idx_supertag_fields_name ON supertag_fields(tag_name)",
];

const SUPERTAG_PARENTS_TABLE = `
CREATE TABLE IF NOT EXISTS supertag_parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_tag_id TEXT NOT NULL,
  parent_tag_id TEXT NOT NULL,
  UNIQUE(child_tag_id, parent_tag_id)
)`;

const SUPERTAG_PARENTS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_supertag_parents_child ON supertag_parents(child_tag_id)",
  "CREATE INDEX IF NOT EXISTS idx_supertag_parents_parent ON supertag_parents(parent_tag_id)",
];

/**
 * Migrate the supertag metadata schema
 * Creates tables for storing supertag field definitions and inheritance relationships.
 * Safe to run multiple times - uses IF NOT EXISTS.
 *
 * @param db - SQLite database connection
 */
export function migrateSupertagMetadataSchema(db: Database): void {
  // Create supertag_fields table
  db.run(SUPERTAG_FIELDS_TABLE);

  // Create indexes for supertag_fields
  for (const indexSql of SUPERTAG_FIELDS_INDEXES) {
    db.run(indexSql);
  }

  // Create supertag_parents table
  db.run(SUPERTAG_PARENTS_TABLE);

  // Create indexes for supertag_parents
  for (const indexSql of SUPERTAG_PARENTS_INDEXES) {
    db.run(indexSql);
  }
}

/**
 * Check if supertag metadata migration is needed
 *
 * @param db - SQLite database connection
 * @returns true if migration is needed (tables don't exist)
 */
export function needsSupertagMetadataMigration(db: Database): boolean {
  const fieldsExist = tableExists(db, "supertag_fields");
  const parentsExist = tableExists(db, "supertag_parents");
  return !fieldsExist || !parentsExist;
}

/**
 * Clear all supertag metadata (used before full reindex)
 *
 * @param db - SQLite database connection
 */
export function clearSupertagMetadata(db: Database): void {
  db.run("DELETE FROM supertag_metadata");
  db.run("DELETE FROM supertag_fields");
  db.run("DELETE FROM supertag_parents");
}

/**
 * Get stats for supertag metadata tables
 *
 * @param db - SQLite database connection
 * @returns Object with counts for both tables
 */
export function getSupertagMetadataStats(db: Database): {
  fieldsCount: number;
  parentsCount: number;
} {
  const fieldsResult = db
    .query("SELECT COUNT(*) as count FROM supertag_fields")
    .get() as { count: number } | null;
  const parentsResult = db
    .query("SELECT COUNT(*) as count FROM supertag_parents")
    .get() as { count: number } | null;

  return {
    fieldsCount: fieldsResult?.count ?? 0,
    parentsCount: parentsResult?.count ?? 0,
  };
}

// ============================================================================
// Spec 020: Schema Consolidation Migration
// ============================================================================

/**
 * SQL statements for supertag_metadata table (Spec 020)
 */
const SUPERTAG_METADATA_TABLE = `
CREATE TABLE IF NOT EXISTS supertag_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id TEXT NOT NULL UNIQUE,
  tag_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  created_at INTEGER
)`;

const SUPERTAG_METADATA_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_supertag_metadata_name ON supertag_metadata(tag_name)",
  "CREATE INDEX IF NOT EXISTS idx_supertag_metadata_normalized ON supertag_metadata(normalized_name)",
];

/**
 * Check if a column exists in a table
 */
function columnExists(db: Database, tableName: string, columnName: string): boolean {
  const columns = db
    .query(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  return columns.some((c) => c.name === columnName);
}

/**
 * Migrate schema for Spec 020: Schema Consolidation
 *
 * Creates supertag_metadata table and adds enhanced columns to supertag_fields.
 * Safe to run multiple times - uses IF NOT EXISTS and column checks.
 *
 * @param db - SQLite database connection
 */
export function migrateSchemaConsolidation(db: Database): void {
  // Create supertag_metadata table
  db.run(SUPERTAG_METADATA_TABLE);

  // Create indexes for supertag_metadata
  for (const indexSql of SUPERTAG_METADATA_INDEXES) {
    db.run(indexSql);
  }

  // Create supertag_fields table if it doesn't exist (with enhanced columns)
  if (!tableExists(db, "supertag_fields")) {
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
        default_value_id TEXT,
        default_value_text TEXT,
        option_values TEXT,
        UNIQUE(tag_id, field_name)
      )
    `);
  } else {
    // Add enhanced columns to existing table if they don't exist
    if (!columnExists(db, "supertag_fields", "normalized_name")) {
      db.run("ALTER TABLE supertag_fields ADD COLUMN normalized_name TEXT");
    }
    if (!columnExists(db, "supertag_fields", "description")) {
      db.run("ALTER TABLE supertag_fields ADD COLUMN description TEXT");
    }
    if (!columnExists(db, "supertag_fields", "inferred_data_type")) {
      db.run("ALTER TABLE supertag_fields ADD COLUMN inferred_data_type TEXT");
    }
    // Target supertag columns for reference fields (Options from Supertag)
    if (!columnExists(db, "supertag_fields", "target_supertag_id")) {
      db.run("ALTER TABLE supertag_fields ADD COLUMN target_supertag_id TEXT");
    }
    if (!columnExists(db, "supertag_fields", "target_supertag_name")) {
      db.run("ALTER TABLE supertag_fields ADD COLUMN target_supertag_name TEXT");
    }
    // Default value columns (Spec 092)
    if (!columnExists(db, "supertag_fields", "default_value_id")) {
      db.run("ALTER TABLE supertag_fields ADD COLUMN default_value_id TEXT");
    }
    if (!columnExists(db, "supertag_fields", "default_value_text")) {
      db.run("ALTER TABLE supertag_fields ADD COLUMN default_value_text TEXT");
    }
    // Option values column for inline options (SYS_D12) - stores JSON array of option names
    if (!columnExists(db, "supertag_fields", "option_values")) {
      db.run("ALTER TABLE supertag_fields ADD COLUMN option_values TEXT");
    }
  }

  // Create indexes for enhanced columns
  db.run("CREATE INDEX IF NOT EXISTS idx_supertag_fields_normalized ON supertag_fields(normalized_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_supertag_fields_data_type ON supertag_fields(inferred_data_type)");
}

/**
 * Check if schema consolidation migration is needed
 *
 * @param db - SQLite database connection
 * @returns true if migration is needed (tables or columns don't exist)
 */
export function needsSchemaConsolidationMigration(db: Database): boolean {
  // Check if supertag_metadata table exists
  if (!tableExists(db, "supertag_metadata")) {
    return true;
  }

  // Check if supertag_fields has enhanced columns
  if (tableExists(db, "supertag_fields")) {
    if (!columnExists(db, "supertag_fields", "normalized_name")) return true;
    if (!columnExists(db, "supertag_fields", "description")) return true;
    if (!columnExists(db, "supertag_fields", "inferred_data_type")) return true;
    if (!columnExists(db, "supertag_fields", "target_supertag_id")) return true;
    if (!columnExists(db, "supertag_fields", "target_supertag_name")) return true;
    // Default value columns (Spec 092)
    if (!columnExists(db, "supertag_fields", "default_value_id")) return true;
    if (!columnExists(db, "supertag_fields", "default_value_text")) return true;
    // Option values column for inline options
    if (!columnExists(db, "supertag_fields", "option_values")) return true;
  }

  return false;
}
