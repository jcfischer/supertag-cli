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

/**
 * Minimal document interface for discovery.
 * Compatible with Tana export format.
 */
interface TanaDoc {
  id: string;
  props?: {
    _docType?: string;
    name?: string;
  };
  children?: string[] | null;
}

/**
 * Discover which tagDefs define system fields by scanning their tuples.
 *
 * System fields are identified by SYS_A* IDs in the first child of tuple nodes.
 * Only known system fields (in SYSTEM_FIELD_METADATA) are tracked.
 *
 * @param docs Array of Tana export documents
 * @param docsById Map of document ID to document for child lookup
 * @returns Map of field ID (SYS_A*) -> Set of tagDef IDs that define it
 */
export function discoverSystemFieldSources(
  docs: TanaDoc[],
  docsById: Map<string, TanaDoc>
): Map<string, Set<string>> {
  const fieldSources = new Map<string, Set<string>>();

  for (const doc of docs) {
    // Only process tagDef documents
    if (doc.props?._docType !== 'tagDef') continue;
    if (!doc.children) continue;

    // Check each tuple child for system field definitions
    for (const childId of doc.children) {
      const child = docsById.get(childId);
      if (child?.props?._docType === 'tuple' && child.children?.length) {
        const fieldId = child.children[0];

        // Is this a known system field?
        if (fieldId.startsWith('SYS_A') && SYSTEM_FIELD_METADATA[fieldId]) {
          if (!fieldSources.has(fieldId)) {
            fieldSources.set(fieldId, new Set());
          }
          fieldSources.get(fieldId)!.add(doc.id);
        }
      }
    }
  }

  return fieldSources;
}

/**
 * Insert discovered system field sources into the database.
 *
 * Clears existing sources before inserting (full replace).
 *
 * @param db Database instance
 * @param sources Map of field ID -> Set of tagDef IDs
 */
export function insertSystemFieldSources(
  db: Database,
  sources: Map<string, Set<string>>
): void {
  // Clear existing sources (full replace on each sync)
  db.run('DELETE FROM system_field_sources');

  // Insert new sources
  const stmt = db.prepare(
    'INSERT INTO system_field_sources (field_id, tag_id) VALUES (?, ?)'
  );

  for (const [fieldId, tagIds] of sources) {
    for (const tagId of tagIds) {
      stmt.run(fieldId, tagId);
    }
  }
}
