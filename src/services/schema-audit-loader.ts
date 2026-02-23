/**
 * Schema Audit Loader (F-101)
 *
 * Loads workspace schema data from SQLite for analysis.
 * Read-only — never modifies the database.
 */

import type { Database } from 'bun:sqlite';
import type {
  WorkspaceSchema,
  SupertagInfo,
  FieldInfo,
  InheritanceRelation,
  TagApplicationCount,
  FieldValueStats,
} from '../types/schema-audit';

/** System docTypes to exclude from audit */
const SYSTEM_DOC_TYPES = new Set([
  'tuple', 'metanode', 'viewDef', 'field', 'search',
  'codeblock', 'image', 'url', 'video', 'audio',
]);

/**
 * Load workspace schema from database for analysis.
 * Queries supertag_metadata, supertag_fields, supertag_parents,
 * tag_applications, and field_values tables.
 */
export function loadWorkspaceSchema(db: Database): WorkspaceSchema {
  const supertags = loadSupertags(db);
  const fields = loadFields(db);
  const inheritance = loadInheritance(db);
  const tagApplications = loadTagApplications(db);
  const fieldValues = loadFieldValues(db);

  return { supertags, fields, inheritance, tagApplications, fieldValues };
}

function loadSupertags(db: Database): SupertagInfo[] {
  // Check if supertag_metadata table exists
  const hasMetadata = tableExists(db, 'supertag_metadata');

  if (hasMetadata) {
    const rows = db.query(`
      SELECT
        sm.tag_id as id,
        sm.tag_name as name,
        sm.normalized_name as normalizedName,
        sm.description,
        sm.color,
        COALESCE(ta_count.cnt, 0) as instanceCount,
        sm.created_at as lastUsed
      FROM supertag_metadata sm
      LEFT JOIN (
        SELECT tag_id, COUNT(*) as cnt
        FROM tag_applications
        GROUP BY tag_id
      ) ta_count ON ta_count.tag_id = sm.tag_id
      ORDER BY sm.tag_name
    `).all() as SupertagInfo[];

    // Filter out system doc types
    return rows.filter(s => !SYSTEM_DOC_TYPES.has(s.name));
  }

  // Fallback: derive from supertag_fields
  const rows = db.query(`
    SELECT DISTINCT
      sf.tag_id as id,
      sf.tag_name as name,
      COALESCE(sf.normalized_name, LOWER(REPLACE(sf.tag_name, ' ', '-'))) as normalizedName,
      NULL as description,
      NULL as color,
      COALESCE(ta_count.cnt, 0) as instanceCount,
      NULL as lastUsed
    FROM supertag_fields sf
    LEFT JOIN (
      SELECT tag_id, COUNT(*) as cnt
      FROM tag_applications
      GROUP BY tag_id
    ) ta_count ON ta_count.tag_id = sf.tag_id
    ORDER BY sf.tag_name
  `).all() as SupertagInfo[];

  return rows.filter(s => !SYSTEM_DOC_TYPES.has(s.name));
}

function loadFields(db: Database): FieldInfo[] {
  return db.query(`
    SELECT
      field_label_id as fieldLabelId,
      field_name as fieldName,
      tag_id as tagId,
      tag_name as tagName,
      inferred_data_type as inferredDataType,
      target_supertag_id as targetSupertagId,
      field_order as "order"
    FROM supertag_fields
    ORDER BY tag_name, field_order
  `).all() as FieldInfo[];
}

function loadInheritance(db: Database): InheritanceRelation[] {
  if (!tableExists(db, 'supertag_parents')) {
    return [];
  }

  return db.query(`
    SELECT
      child_tag_id as childTagId,
      parent_tag_id as parentTagId
    FROM supertag_parents
  `).all() as InheritanceRelation[];
}

function loadTagApplications(db: Database): TagApplicationCount[] {
  if (!tableExists(db, 'tag_applications')) {
    return [];
  }

  return db.query(`
    SELECT
      tag_id as tagId,
      COUNT(*) as instanceCount
    FROM tag_applications
    GROUP BY tag_id
  `).all() as TagApplicationCount[];
}

function loadFieldValues(db: Database): FieldValueStats[] {
  if (!tableExists(db, 'field_values') || !tableExists(db, 'tag_applications')) {
    return [];
  }

  return db.query(`
    SELECT
      fv.field_name as fieldName,
      ta.tag_id as tagId,
      COUNT(DISTINCT fv.parent_id) as populatedCount,
      (SELECT COUNT(*) FROM tag_applications ta2 WHERE ta2.tag_id = ta.tag_id) as totalInstances,
      CAST(COUNT(DISTINCT fv.parent_id) AS REAL) * 100 /
        NULLIF((SELECT COUNT(*) FROM tag_applications ta2 WHERE ta2.tag_id = ta.tag_id), 0) as fillRate
    FROM field_values fv
    JOIN tag_applications ta ON ta.data_node_id = fv.parent_id
    GROUP BY fv.field_name, ta.tag_id
  `).all() as FieldValueStats[];
}

function tableExists(db: Database, tableName: string): boolean {
  const result = db.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName) as { name: string } | null;
  return result !== null;
}
