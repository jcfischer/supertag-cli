/**
 * Field Resolver Service
 * F-093: Query Field Output
 *
 * Resolves field definitions and values for supertags.
 * Handles inheritance and multi-value fields.
 */

import { Database } from "bun:sqlite";
import { stripHtml } from "../utils/html";

/**
 * Field value map: field_name -> value (comma-joined if multiple)
 */
export type FieldValues = Record<string, string>;

/**
 * Raw field value map: field_name -> array of values (preserves multi-value)
 */
export type RawFieldValues = Map<string, string[]>;

/** Batch size for SQL IN clauses to avoid SQLite parameter limits */
const BATCH_SIZE = 500;

/**
 * FieldResolver handles:
 * 1. Looking up field definitions for a supertag (including inherited)
 * 2. Resolving field values for nodes
 */
export class FieldResolver {
  constructor(private db: Database) {}

  /**
   * Get field names defined on a supertag, including inherited fields.
   * Own fields come first, then inherited fields, all in field_order.
   *
   * When multiple supertags have the same name, selects the one with
   * the most inheritance/fields (matching tags fields behavior).
   *
   * @param tagName - Supertag name (e.g., "person", "employee")
   * @returns Array of field names in order
   */
  getSupertagFields(tagName: string): string[] {
    // Find the best matching supertag (most inheritance/fields) when duplicates exist
    // This matches the behavior in supertag-metadata-service.ts findAllTagsByName()
    const tagRow = this.db
      .query(`
        SELECT
          sm.tag_id,
          (SELECT COUNT(*) FROM supertag_fields sf WHERE sf.tag_id = sm.tag_id) as field_count,
          (SELECT COUNT(*) FROM supertag_parents sp WHERE sp.child_tag_id = sm.tag_id) as parent_count
        FROM supertag_metadata sm
        WHERE sm.tag_name = ? OR sm.normalized_name = ?
        ORDER BY parent_count DESC, field_count DESC
        LIMIT 1
      `)
      .get(tagName, tagName.toLowerCase()) as { tag_id: string } | null;

    if (!tagRow) {
      return [];
    }

    const tagId = tagRow.tag_id;

    // Get own fields first (ordered by field_order)
    const ownFields = this.db
      .query(`
        SELECT field_name
        FROM supertag_fields
        WHERE tag_id = ?
        ORDER BY field_order ASC
      `)
      .all(tagId) as { field_name: string }[];

    const fields = ownFields.map((f) => f.field_name);

    // Get parent tag IDs for inheritance
    const parentIds = this.getParentTagIds(tagId);

    // Get inherited fields from each parent
    for (const parentId of parentIds) {
      const parentFields = this.db
        .query(`
          SELECT field_name
          FROM supertag_fields
          WHERE tag_id = ?
          ORDER BY field_order ASC
        `)
        .all(parentId) as { field_name: string }[];

      for (const pf of parentFields) {
        // Avoid duplicates
        if (!fields.includes(pf.field_name)) {
          fields.push(pf.field_name);
        }
      }
    }

    return fields;
  }

  /**
   * Get parent tag IDs for inheritance lookup.
   * Currently supports single-level inheritance.
   */
  private getParentTagIds(tagId: string): string[] {
    const rows = this.db
      .query("SELECT parent_tag_id FROM supertag_parents WHERE child_tag_id = ?")
      .all(tagId) as { parent_tag_id: string }[];

    return rows.map((r) => r.parent_tag_id);
  }

  /**
   * Resolve field values for a set of nodes.
   * Returns comma-joined strings for multi-value fields.
   *
   * @param nodeIds - Array of node IDs to get fields for
   * @param fieldNames - Array of field names to retrieve, or "*" for all
   * @returns Map of nodeId -> { fieldName: value }
   */
  resolveFields(
    nodeIds: string[],
    fieldNames: string[] | "*"
  ): Map<string, FieldValues> {
    const rawMap = this.resolveFieldsRaw(nodeIds, fieldNames);
    const result = new Map<string, FieldValues>();

    for (const nodeId of nodeIds) {
      const rawFields = rawMap.get(nodeId);
      const joined: FieldValues = {};
      if (rawFields) {
        for (const [fieldName, values] of rawFields) {
          joined[fieldName] = values.join(", ");
        }
      }
      result.set(nodeId, joined);
    }

    return result;
  }

  /**
   * Resolve field values for a set of nodes, preserving multi-value as arrays.
   * Processes in batches of 500 to avoid SQLite parameter limits.
   *
   * @param nodeIds - Array of node IDs to get fields for
   * @param fieldNames - Array of field names to retrieve, or "*" for all
   * @returns Map of nodeId -> Map of fieldName -> string[]
   */
  resolveFieldsRaw(
    nodeIds: string[],
    fieldNames: string[] | "*"
  ): Map<string, RawFieldValues> {
    const result = new Map<string, RawFieldValues>();

    if (nodeIds.length === 0) return result;

    for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
      const batch = nodeIds.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(", ");

      let sql = `
        SELECT parent_id, field_name, value_text, value_order
        FROM field_values
        WHERE parent_id IN (${placeholders})
      `;
      const params: (string | number)[] = [...batch];

      if (fieldNames !== "*" && fieldNames.length > 0) {
        const fieldPlaceholders = fieldNames.map(() => "?").join(", ");
        sql += ` AND field_name IN (${fieldPlaceholders})`;
        params.push(...fieldNames);
      }

      sql += " ORDER BY parent_id, field_name, value_order";

      const rows = this.db.query(sql).all(...params) as {
        parent_id: string;
        field_name: string;
        value_text: string;
        value_order: number;
      }[];

      for (const row of rows) {
        let nodeMap = result.get(row.parent_id);
        if (!nodeMap) {
          nodeMap = new Map();
          result.set(row.parent_id, nodeMap);
        }

        let values = nodeMap.get(row.field_name);
        if (!values) {
          values = [];
          nodeMap.set(row.field_name, values);
        }

        values.push(stripHtml(row.value_text));
      }
    }

    return result;
  }
}
