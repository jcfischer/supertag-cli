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
   *
   * @param nodeIds - Array of node IDs to get fields for
   * @param fieldNames - Array of field names to retrieve, or "*" for all
   * @returns Map of nodeId -> { fieldName: value }
   */
  resolveFields(
    nodeIds: string[],
    fieldNames: string[] | "*"
  ): Map<string, FieldValues> {
    const result = new Map<string, FieldValues>();

    if (nodeIds.length === 0) {
      return result;
    }

    // Initialize empty objects for all requested nodes
    for (const nodeId of nodeIds) {
      result.set(nodeId, {});
    }

    // Build the query
    const placeholders = nodeIds.map(() => "?").join(", ");
    let sql = `
      SELECT parent_id, field_name, value_text, value_order
      FROM field_values
      WHERE parent_id IN (${placeholders})
    `;
    const params: (string | number)[] = [...nodeIds];

    // Filter by field names if not wildcard
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

    // Group values by node and field, handling multi-value
    // Strip HTML tags from values (e.g., option fields store <span data-color="blue">DONE</span>)
    for (const row of rows) {
      const nodeFields = result.get(row.parent_id);
      if (!nodeFields) continue;

      const cleanValue = stripHtml(row.value_text);

      if (nodeFields[row.field_name]) {
        // Multi-value: comma-join
        nodeFields[row.field_name] += ", " + cleanValue;
      } else {
        nodeFields[row.field_name] = cleanValue;
      }
    }

    return result;
  }
}
