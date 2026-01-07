/**
 * System Field Discovery Module
 *
 * Provides metadata for known Tana system fields (SYS_A*) and functions
 * to discover which tagDefs define these fields.
 *
 * Spec 074: System Field Discovery
 */

import { Database } from 'bun:sqlite';
import type { SystemFieldMetadata } from '../types/supertag-metadata';

/**
 * Metadata for known Tana system fields.
 *
 * This maps system field IDs (SYS_A*) to their human-readable names,
 * normalized names for matching, and data types.
 *
 * Note: The SYSTEM_FIELD_MARKERS in supertag-metadata.ts only maps ID -> name.
 * This provides richer metadata including dataType for proper field handling.
 */
export const SYSTEM_FIELD_METADATA: Record<string, SystemFieldMetadata> = {
  SYS_A90: {
    name: 'Date',
    normalizedName: 'date',
    dataType: 'date',
  },
  SYS_A61: {
    name: 'Due Date',
    normalizedName: 'duedate',
    dataType: 'date',
  },
  SYS_A142: {
    name: 'Attendees',
    normalizedName: 'attendees',
    dataType: 'reference',
  },
};

/**
 * Create the system_field_sources table.
 *
 * This table tracks which tagDefs define which system fields.
 * During sync, we scan tagDef tuples for SYS_A* fields and record the mapping.
 *
 * @param db Database instance
 */
export function migrateSystemFieldSources(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS system_field_sources (
      id INTEGER PRIMARY KEY,
      field_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      UNIQUE(field_id, tag_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_system_field_sources_field
    ON system_field_sources(field_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_system_field_sources_tag
    ON system_field_sources(tag_id)
  `);
}
