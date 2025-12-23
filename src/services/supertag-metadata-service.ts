/**
 * Supertag Metadata Service
 *
 * Provides query methods for supertag field definitions and inheritance relationships.
 * Computes transitive inheritance on-demand using SQLite recursive CTEs.
 *
 * Use cases:
 * 1. Show inheritance tree & flattened structure for any supertag
 * 2. Find all fields a supertag has including inherited fields
 * 3. Enable Input API node creation with proper field validation
 * 4. Query nodes based on field values
 */

import { Database } from "bun:sqlite";
import type {
  SupertagField,
  InheritedField,
  InheritanceNode,
  Ancestor,
  FieldValidationResult,
} from "../types/supertag-metadata";

export class SupertagMetadataService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Get direct fields for a supertag by tag ID.
   * Does not include inherited fields.
   */
  getFields(tagId: string): SupertagField[] {
    const results = this.db
      .query(
        `SELECT id, tag_id, tag_name, field_name, field_label_id, field_order
         FROM supertag_fields
         WHERE tag_id = ?
         ORDER BY field_order`
      )
      .all(tagId) as Array<{
      id: number;
      tag_id: string;
      tag_name: string;
      field_name: string;
      field_label_id: string;
      field_order: number;
    }>;

    return results.map((r) => ({
      id: r.id,
      tagId: r.tag_id,
      tagName: r.tag_name,
      fieldName: r.field_name,
      fieldLabelId: r.field_label_id,
      fieldOrder: r.field_order,
    }));
  }

  /**
   * Get direct fields for a supertag by tag name.
   * Does not include inherited fields.
   */
  getFieldsByName(tagName: string): SupertagField[] {
    const results = this.db
      .query(
        `SELECT id, tag_id, tag_name, field_name, field_label_id, field_order
         FROM supertag_fields
         WHERE tag_name = ?
         ORDER BY field_order`
      )
      .all(tagName) as Array<{
      id: number;
      tag_id: string;
      tag_name: string;
      field_name: string;
      field_label_id: string;
      field_order: number;
    }>;

    return results.map((r) => ({
      id: r.id,
      tagId: r.tag_id,
      tagName: r.tag_name,
      fieldName: r.field_name,
      fieldLabelId: r.field_label_id,
      fieldOrder: r.field_order,
    }));
  }

  /**
   * Get direct parent tag IDs for a supertag.
   * Does not include grandparents or further ancestors.
   */
  getDirectParents(tagId: string): string[] {
    const results = this.db
      .query(`SELECT parent_tag_id FROM supertag_parents WHERE child_tag_id = ?`)
      .all(tagId) as Array<{ parent_tag_id: string }>;

    return results.map((r) => r.parent_tag_id);
  }

  /**
   * Get all ancestors (transitive closure) for a supertag using recursive CTE.
   * Returns ancestors with depth tracking.
   * Includes cycle detection via depth limit.
   */
  getAncestors(tagId: string): Ancestor[] {
    // Use recursive CTE to compute transitive inheritance
    // Max depth of 10 prevents infinite loops in case of cycles
    const results = this.db
      .query(
        `WITH RECURSIVE ancestor_chain(tag_id, depth) AS (
           -- Base case: direct parents
           SELECT parent_tag_id, 1
           FROM supertag_parents
           WHERE child_tag_id = ?

           UNION ALL

           -- Recursive case: parents of parents
           SELECT sp.parent_tag_id, ac.depth + 1
           FROM supertag_parents sp
           INNER JOIN ancestor_chain ac ON sp.child_tag_id = ac.tag_id
           WHERE ac.depth < 10  -- Cycle protection
         )
         SELECT DISTINCT tag_id, MIN(depth) as depth
         FROM ancestor_chain
         GROUP BY tag_id
         ORDER BY depth`
      )
      .all(tagId) as Array<{ tag_id: string; depth: number }>;

    return results.map((r) => ({
      tagId: r.tag_id,
      depth: r.depth,
    }));
  }

  /**
   * Get the tag name for a given tag ID.
   * First checks supertag_fields, then falls back to nodes table.
   * Some tagDefs may not have fields but still exist as nodes.
   */
  getTagName(tagId: string): string | null {
    // First check supertag_fields table
    const fromFields = this.db
      .query(
        `SELECT DISTINCT tag_name FROM supertag_fields WHERE tag_id = ? LIMIT 1`
      )
      .get(tagId) as { tag_name: string } | null;

    if (fromFields?.tag_name) {
      return fromFields.tag_name;
    }

    // Fallback to nodes table for tagDefs without fields
    const fromNodes = this.db
      .query(`SELECT name FROM nodes WHERE id = ? LIMIT 1`)
      .get(tagId) as { name: string } | null;

    return fromNodes?.name ?? null;
  }

  /**
   * Build inheritance chain tree starting from a tag.
   * Returns a tree structure with nested parents.
   */
  getInheritanceChain(tagId: string): InheritanceNode {
    const tagName = this.getTagName(tagId) || tagId;
    const directParents = this.getDirectParents(tagId);

    const parents: InheritanceNode[] = directParents.map((parentId) =>
      this.getInheritanceChain(parentId)
    );

    return {
      tagId,
      tagName,
      parents,
    };
  }

  /**
   * Get all fields for a supertag including inherited fields.
   * Tracks origin tag and depth for each field.
   */
  getAllFields(tagId: string): InheritedField[] {
    const allFields: InheritedField[] = [];
    const seenFields = new Set<string>(); // Prevent duplicates by field name

    // Own fields (depth 0)
    const ownFields = this.getFields(tagId);
    for (const field of ownFields) {
      if (!seenFields.has(field.fieldName)) {
        seenFields.add(field.fieldName);
        allFields.push({
          fieldName: field.fieldName,
          fieldLabelId: field.fieldLabelId,
          originTagId: tagId,
          originTagName: field.tagName,
          depth: 0,
        });
      }
    }

    // Inherited fields from ancestors
    const ancestors = this.getAncestors(tagId);
    for (const ancestor of ancestors) {
      const ancestorFields = this.getFields(ancestor.tagId);
      const ancestorName = this.getTagName(ancestor.tagId);

      for (const field of ancestorFields) {
        if (!seenFields.has(field.fieldName)) {
          seenFields.add(field.fieldName);
          allFields.push({
            fieldName: field.fieldName,
            fieldLabelId: field.fieldLabelId,
            originTagId: ancestor.tagId,
            originTagName: ancestorName || ancestor.tagId,
            depth: ancestor.depth,
          });
        }
      }
    }

    return allFields;
  }

  /**
   * Find tag ID by exact tag name.
   * Returns null if not found.
   */
  findTagIdByName(tagName: string): string | null {
    const result = this.db
      .query(`SELECT DISTINCT tag_id FROM supertag_fields WHERE tag_name = ? LIMIT 1`)
      .get(tagName) as { tag_id: string } | null;

    return result?.tag_id ?? null;
  }

  /**
   * Validate that a field name exists for a supertag (including inherited fields).
   * Returns validation result with field label ID if valid.
   */
  validateFieldName(tagId: string, fieldName: string): FieldValidationResult {
    const allFields = this.getAllFields(tagId);
    const field = allFields.find((f) => f.fieldName === fieldName);

    if (field) {
      return {
        valid: true,
        fieldLabelId: field.fieldLabelId,
        originTagId: field.originTagId,
        originTagName: field.originTagName,
        inherited: field.depth > 0,
      };
    }

    return { valid: false };
  }
}
