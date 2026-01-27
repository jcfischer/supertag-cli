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
import { SYSTEM_FIELD_METADATA } from "../db/system-fields";

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
        `SELECT id, tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type, target_supertag_id, target_supertag_name, option_values
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
      inferred_data_type: string | null;
      target_supertag_id: string | null;
      target_supertag_name: string | null;
      option_values: string | null;
    }>;

    return results.map((r) => ({
      id: r.id,
      tagId: r.tag_id,
      tagName: r.tag_name,
      fieldName: r.field_name,
      fieldLabelId: r.field_label_id,
      fieldOrder: r.field_order,
      inferredDataType: r.inferred_data_type ?? undefined,
      targetSupertagId: r.target_supertag_id ?? undefined,
      targetSupertagName: r.target_supertag_name ?? undefined,
      optionValues: r.option_values ? JSON.parse(r.option_values) : undefined,
    }));
  }

  /**
   * Get direct fields for a supertag by tag name.
   * Does not include inherited fields.
   */
  getFieldsByName(tagName: string): SupertagField[] {
    const results = this.db
      .query(
        `SELECT id, tag_id, tag_name, field_name, field_label_id, field_order, inferred_data_type, target_supertag_id, target_supertag_name, option_values
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
      inferred_data_type: string | null;
      target_supertag_id: string | null;
      target_supertag_name: string | null;
      option_values: string | null;
    }>;

    return results.map((r) => ({
      id: r.id,
      tagId: r.tag_id,
      tagName: r.tag_name,
      fieldName: r.field_name,
      fieldLabelId: r.field_label_id,
      fieldOrder: r.field_order,
      inferredDataType: r.inferred_data_type ?? undefined,
      targetSupertagId: r.target_supertag_id ?? undefined,
      targetSupertagName: r.target_supertag_name ?? undefined,
      optionValues: r.option_values ? JSON.parse(r.option_values) : undefined,
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
   * Get all fields for a supertag including inherited fields and system fields (Spec 074).
   * Tracks origin tag and depth for each field.
   *
   * User-defined fields take precedence over system fields with the same name.
   */
  getAllFields(tagId: string): InheritedField[] {
    const allFields: InheritedField[] = [];
    const seenFields = new Set<string>(); // Prevent duplicates by field name

    // Own fields (depth 0) - these take highest precedence
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
          inferredDataType: field.inferredDataType,
          targetSupertagId: field.targetSupertagId,
          targetSupertagName: field.targetSupertagName,
          optionValues: field.optionValues,
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
            inferredDataType: field.inferredDataType,
            targetSupertagId: field.targetSupertagId,
            targetSupertagName: field.targetSupertagName,
            optionValues: field.optionValues,
          });
        }
      }
    }

    // Spec 074: Add system fields (only if not already defined)
    // System fields are added last so user-defined fields take precedence
    const systemFields = this.getSystemFieldsForTag(tagId);
    for (const sysField of systemFields) {
      if (!seenFields.has(sysField.fieldName)) {
        seenFields.add(sysField.fieldName);
        allFields.push(sysField);
      }
    }

    return allFields;
  }

  /**
   * Find tag ID by exact tag name.
   * When multiple tags have the same name, prefers the one with:
   * 1. Most inheritance parents (primary criteria)
   * 2. Most fields (secondary criteria)
   * This matches SchemaRegistry's shouldPreferSchema() logic.
   * Returns null if not found.
   */
  findTagIdByName(tagName: string): string | null {
    // When multiple tags have the same name, prefer the one with most
    // inheritance parents first, then most fields (matches SchemaRegistry)
    const result = this.db
      .query(`
        SELECT
          sf.tag_id,
          COUNT(DISTINCT sf.field_name) as field_count,
          (SELECT COUNT(*) FROM supertag_parents sp WHERE sp.child_tag_id = sf.tag_id) as parent_count
        FROM supertag_fields sf
        WHERE sf.tag_name = ?
        GROUP BY sf.tag_id
        ORDER BY parent_count DESC, field_count DESC
        LIMIT 1
      `)
      .get(tagName) as { tag_id: string; field_count: number; parent_count: number } | null;

    return result?.tag_id ?? null;
  }

  /**
   * Find all tags with a given name, returning details for disambiguation.
   * Includes field count and usage count for each.
   * Returns empty array if no tags found.
   */
  findAllTagsByName(tagName: string): Array<{
    tagId: string;
    tagName: string;
    fieldCount: number;
    parentCount: number;
    usageCount: number;
  }> {
    // Query supertag_metadata as primary table to find supertags even with 0 fields
    const results = this.db
      .query(`
        SELECT
          sm.tag_id,
          sm.tag_name,
          (SELECT COUNT(*) FROM supertag_fields sf WHERE sf.tag_id = sm.tag_id) as field_count,
          (SELECT COUNT(*) FROM supertag_parents sp WHERE sp.child_tag_id = sm.tag_id) as parent_count,
          (SELECT COUNT(*) FROM tag_applications ta WHERE ta.tag_id = sm.tag_id) as usage_count
        FROM supertag_metadata sm
        WHERE sm.tag_name = ? OR sm.normalized_name = ?
        ORDER BY parent_count DESC, field_count DESC
      `)
      .all(tagName, tagName.toLowerCase()) as Array<{
        tag_id: string;
        tag_name: string;
        field_count: number;
        parent_count: number;
        usage_count: number;
      }>;

    return results.map(r => ({
      tagId: r.tag_id,
      tagName: r.tag_name,
      fieldCount: r.field_count,
      parentCount: r.parent_count,
      usageCount: r.usage_count,
    }));
  }

  /**
   * Check if a string looks like a tag ID.
   * Tana IDs are mixed-case alphanumeric strings (e.g., "hDwO8FKJfFPP").
   * This distinguishes them from kebab-case tag names (e.g., "outcome-goal").
   */
  isTagId(input: string): boolean {
    // Must be 8+ chars, alphanumeric with optional - and _
    if (!/^[A-Za-z0-9_-]{8,}$/.test(input)) {
      return false;
    }
    // Must contain both uppercase AND lowercase (distinguishes IDs from tag names)
    return /[A-Z]/.test(input) && /[a-z]/.test(input);
  }

  /**
   * Find tag by ID. Returns the tag name if found, null otherwise.
   */
  findTagById(tagId: string): string | null {
    const result = this.db
      .query(`SELECT tag_name FROM supertag_fields WHERE tag_id = ? LIMIT 1`)
      .get(tagId) as { tag_name: string } | null;

    return result?.tag_name ?? null;
  }

  // =========================================================================
  // Spec 074: System Field Discovery Methods
  // =========================================================================

  /**
   * T-3.1: Get tagDef IDs that define a given system field.
   * Queries the system_field_sources table.
   *
   * @param fieldId System field ID (e.g., "SYS_A90")
   * @returns Array of tagDef IDs that define this system field
   */
  getSystemFieldSourceTags(fieldId: string): string[] {
    try {
      const results = this.db
        .query(`SELECT tag_id FROM system_field_sources WHERE field_id = ?`)
        .all(fieldId) as Array<{ tag_id: string }>;

      return results.map(r => r.tag_id);
    } catch (error) {
      // Table may not exist in older databases - gracefully return empty
      // This allows backwards compatibility until user re-syncs
      if (error instanceof Error && error.message.includes("no such table")) {
        return [];
      }
      throw error;
    }
  }

  /**
   * T-3.2: Get all system fields available to a tag based on its inheritance chain.
   * A tag gets system fields if it or any of its ancestors defines the system field.
   *
   * @param tagId Tag ID to check
   * @returns Array of InheritedField for system fields
   */
  getSystemFieldsForTag(tagId: string): InheritedField[] {
    const systemFields: InheritedField[] = [];

    // Get all ancestor tag IDs (including this tag)
    const ancestorIds = new Set<string>([tagId]);
    const ancestors = this.getAncestors(tagId);
    for (const ancestor of ancestors) {
      ancestorIds.add(ancestor.tagId);
    }

    // Check each known system field
    for (const [fieldId, meta] of Object.entries(SYSTEM_FIELD_METADATA)) {
      // Get tags that define this system field
      const sourceTags = this.getSystemFieldSourceTags(fieldId);

      // Does any ancestor (or the tag itself) define this system field?
      const definingTag = sourceTags.find(sourceId => ancestorIds.has(sourceId));

      if (definingTag) {
        // Get the defining tag's name
        const tagName = this.getTagName(definingTag) || definingTag;

        systemFields.push({
          fieldName: meta.name,
          fieldLabelId: fieldId, // Use system field ID as the label ID
          originTagId: definingTag,
          originTagName: tagName,
          depth: definingTag === tagId ? 0 : (ancestors.find(a => a.tagId === definingTag)?.depth ?? 1),
          inferredDataType: meta.dataType,
          system: true,
        });
      }
    }

    return systemFields;
  }

  /**
   * Get own fields (depth 0) including system fields defined on this tag.
   *
   * This fixes the bug where system fields at depth 0 were not included
   * in "own fields" queries because they're stored in system_field_sources
   * rather than supertag_fields.
   *
   * @param tagId Tag ID to get fields for
   * @returns Array of InheritedField for own fields + own system fields
   */
  getOwnFieldsWithSystem(tagId: string): InheritedField[] {
    const ownFields: InheritedField[] = [];
    const seenFields = new Set<string>();

    // Own fields from supertag_fields table
    const directFields = this.getFields(tagId);
    for (const field of directFields) {
      if (!seenFields.has(field.fieldName)) {
        seenFields.add(field.fieldName);
        ownFields.push({
          fieldName: field.fieldName,
          fieldLabelId: field.fieldLabelId,
          originTagId: tagId,
          originTagName: field.tagName,
          depth: 0,
          inferredDataType: field.inferredDataType,
          targetSupertagId: field.targetSupertagId,
          targetSupertagName: field.targetSupertagName,
          optionValues: field.optionValues,
        });
      }
    }

    // Add system fields at depth 0 (defined on this tag, not inherited)
    const systemFields = this.getSystemFieldsForTag(tagId);
    for (const sysField of systemFields) {
      if (sysField.depth === 0 && !seenFields.has(sysField.fieldName)) {
        seenFields.add(sysField.fieldName);
        ownFields.push(sysField);
      }
    }

    return ownFields;
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
