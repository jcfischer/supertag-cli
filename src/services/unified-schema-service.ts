/**
 * UnifiedSchemaService (Spec 020 T-3.1)
 *
 * Database-backed unified schema service that consolidates SchemaRegistry
 * functionality with database storage for supertag metadata, fields, and inheritance.
 *
 * This service provides:
 * - Supertag lookup by name (exact and normalized)
 * - Supertag lookup by ID
 * - Supertag search (partial matching)
 * - Field retrieval (own and inherited)
 * - Statistics
 */

import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { dirname } from "path";
import { normalizeName } from "../utils/normalize-name";
import type { TanaApiNode, TanaApiFieldNode } from "../types";

/**
 * Unified representation of a supertag with all metadata.
 */
export interface UnifiedSupertag {
  id: string;
  name: string;
  normalizedName: string;
  description?: string | null;
  color?: string | null;
  fields: UnifiedField[];
  extends?: string[];
}

/**
 * Unified representation of a field definition.
 */
export interface UnifiedField {
  tagId: string;
  attributeId: string;
  name: string;
  normalizedName: string;
  description?: string | null;
  dataType?: string | null;
  order: number;
  targetSupertagId?: string | null;
  targetSupertagName?: string | null;
}

/**
 * Schema service statistics.
 */
export interface SchemaStats {
  totalSupertags: number;
  totalFields: number;
  totalInheritanceRelations: number;
}

/**
 * UnifiedSchemaService provides database-backed supertag schema operations.
 */
export class UnifiedSchemaService {
  readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Find a supertag by name (exact or normalized match).
   *
   * When multiple supertags have the same name (can happen with Tana exports),
   * selects the canonical one using the same logic as SchemaRegistry:
   * 1. Prefer more inheritance parents
   * 2. Then prefer more own fields
   *
   * @param name - Supertag name to find
   * @returns Unified supertag or null if not found
   */
  getSupertag(name: string): UnifiedSupertag | null {
    const normalizedQuery = normalizeName(name);

    // Find all matching supertags and pick the canonical one
    // Priority: more inheritance parents, then more own fields
    // This handles cases where duplicate entries exist in the database
    const row = this.db
      .query(
        `
        SELECT m.tag_id, m.tag_name, m.normalized_name, m.description, m.color,
               (SELECT COUNT(*) FROM supertag_parents p WHERE p.child_tag_id = m.tag_id) as parent_count,
               (SELECT COUNT(*) FROM supertag_fields f WHERE f.tag_id = m.tag_id) as field_count
        FROM supertag_metadata m
        WHERE m.tag_name = ? OR m.normalized_name = ?
        ORDER BY parent_count DESC, field_count DESC
        LIMIT 1
      `
      )
      .get(name, normalizedQuery) as {
      tag_id: string;
      tag_name: string;
      normalized_name: string;
      description: string | null;
      color: string | null;
      parent_count: number;
      field_count: number;
    } | null;

    if (!row) {
      return null;
    }

    return this.buildUnifiedSupertag(row);
  }

  /**
   * Find a supertag by its node ID.
   *
   * @param id - Supertag node ID
   * @returns Unified supertag or null if not found
   */
  getSupertagById(id: string): UnifiedSupertag | null {
    const row = this.db
      .query(
        `
        SELECT tag_id, tag_name, normalized_name, description, color
        FROM supertag_metadata
        WHERE tag_id = ?
      `
      )
      .get(id) as {
      tag_id: string;
      tag_name: string;
      normalized_name: string;
      description: string | null;
      color: string | null;
    } | null;

    if (!row) {
      return null;
    }

    return this.buildUnifiedSupertag(row);
  }

  /**
   * List all supertags in the database.
   *
   * @returns Array of all unified supertags
   */
  listSupertags(): UnifiedSupertag[] {
    const rows = this.db
      .query(
        `
        SELECT tag_id, tag_name, normalized_name, description, color
        FROM supertag_metadata
        ORDER BY tag_name
      `
      )
      .all() as Array<{
      tag_id: string;
      tag_name: string;
      normalized_name: string;
      description: string | null;
      color: string | null;
    }>;

    return rows.map((row) => this.buildUnifiedSupertag(row));
  }

  /**
   * Search for supertags by partial name match.
   *
   * @param query - Search query (partial match on name or normalized name)
   * @returns Array of matching supertags
   */
  searchSupertags(query: string): UnifiedSupertag[] {
    const normalizedQuery = normalizeName(query);
    const likePattern = `%${query.toLowerCase()}%`;
    const normalizedPattern = `%${normalizedQuery}%`;

    const rows = this.db
      .query(
        `
        SELECT tag_id, tag_name, normalized_name, description, color
        FROM supertag_metadata
        WHERE LOWER(tag_name) LIKE ? OR normalized_name LIKE ?
        ORDER BY tag_name
      `
      )
      .all(likePattern, normalizedPattern) as Array<{
      tag_id: string;
      tag_name: string;
      normalized_name: string;
      description: string | null;
      color: string | null;
    }>;

    return rows.map((row) => this.buildUnifiedSupertag(row));
  }

  /**
   * Get the count of fields for a supertag.
   *
   * @param tagId - Supertag node ID
   * @returns Number of fields defined for this supertag
   */
  getFieldsCount(tagId: string): number {
    const result = this.db
      .query(
        `
        SELECT COUNT(*) as count
        FROM supertag_fields
        WHERE tag_id = ?
      `
      )
      .get(tagId) as { count: number } | null;

    return result?.count ?? 0;
  }

  /**
   * Get statistics about the schema database.
   *
   * @returns Schema statistics
   */
  getStats(): SchemaStats {
    const supertagsResult = this.db
      .query("SELECT COUNT(*) as count FROM supertag_metadata")
      .get() as { count: number } | null;

    const fieldsResult = this.db
      .query("SELECT COUNT(*) as count FROM supertag_fields")
      .get() as { count: number } | null;

    const inheritanceResult = this.db
      .query("SELECT COUNT(*) as count FROM supertag_parents")
      .get() as { count: number } | null;

    return {
      totalSupertags: supertagsResult?.count ?? 0,
      totalFields: fieldsResult?.count ?? 0,
      totalInheritanceRelations: inheritanceResult?.count ?? 0,
    };
  }

  /**
   * Get own fields for a supertag (not including inherited).
   *
   * @param tagId - Supertag node ID
   * @returns Array of fields defined directly on this supertag
   */
  getFields(tagId: string): UnifiedField[] {
    return this.loadFieldsForTag(tagId);
  }

  /**
   * Get all fields for a supertag, including inherited fields.
   *
   * Uses recursive CTE to traverse inheritance hierarchy and collect
   * all fields, with deduplication for diamond inheritance patterns.
   *
   * @param tagId - Supertag node ID
   * @returns Array of all fields (own + inherited), deduplicated
   */
  getAllFields(tagId: string): UnifiedField[] {
    // Get all ancestor tag IDs using recursive CTE
    const ancestorRows = this.db
      .query(
        `
        WITH RECURSIVE ancestors(tag_id, depth) AS (
          -- Base case: the tag itself
          SELECT ?, 0
          UNION ALL
          -- Recursive case: follow parent relationships
          SELECT sp.parent_tag_id, a.depth + 1
          FROM ancestors a
          JOIN supertag_parents sp ON sp.child_tag_id = a.tag_id
        )
        SELECT DISTINCT tag_id, MIN(depth) as depth
        FROM ancestors
        GROUP BY tag_id
        ORDER BY depth
      `
      )
      .all(tagId) as Array<{ tag_id: string; depth: number }>;

    // Collect fields from all ancestors (including self at depth 0)
    const allFields: UnifiedField[] = [];
    const seenFieldNames = new Set<string>();

    for (const ancestor of ancestorRows) {
      const fields = this.loadFieldsForTag(ancestor.tag_id);
      for (const field of fields) {
        // Deduplicate by normalized name to handle diamond inheritance
        const normalizedName = field.normalizedName;
        if (!seenFieldNames.has(normalizedName)) {
          seenFieldNames.add(normalizedName);
          allFields.push(field);
        }
      }
    }

    return allFields;
  }

  /**
   * Find a field by normalized name, including inherited fields.
   *
   * @param tagId - Supertag node ID
   * @param fieldName - Field name (will be normalized for matching)
   * @returns Field if found, null otherwise
   */
  getFieldByNormalizedName(tagId: string, fieldName: string): UnifiedField | null {
    const normalizedQuery = normalizeName(fieldName);

    // Get all fields (own + inherited)
    const allFields = this.getAllFields(tagId);

    // Find by normalized name
    return allFields.find((f) => f.normalizedName === normalizedQuery) || null;
  }

  /**
   * Build a UnifiedSupertag from a database row.
   * Includes loading fields for the supertag.
   */
  private buildUnifiedSupertag(row: {
    tag_id: string;
    tag_name: string;
    normalized_name: string;
    description: string | null;
    color: string | null;
  }): UnifiedSupertag {
    // Load fields for this supertag
    const fields = this.loadFieldsForTag(row.tag_id);

    // Load parent IDs
    const parentIds = this.loadParentIds(row.tag_id);

    return {
      id: row.tag_id,
      name: row.tag_name,
      normalizedName: row.normalized_name,
      description: row.description,
      color: row.color,
      fields,
      extends: parentIds.length > 0 ? parentIds : undefined,
    };
  }

  /**
   * Load fields for a supertag from database.
   */
  private loadFieldsForTag(tagId: string): UnifiedField[] {
    const rows = this.db
      .query(
        `
        SELECT tag_id, field_name, field_label_id, field_order, normalized_name, description, inferred_data_type, target_supertag_id, target_supertag_name
        FROM supertag_fields
        WHERE tag_id = ?
        ORDER BY field_order
      `
      )
      .all(tagId) as Array<{
      tag_id: string;
      field_name: string;
      field_label_id: string;
      field_order: number;
      normalized_name: string | null;
      description: string | null;
      inferred_data_type: string | null;
      target_supertag_id: string | null;
      target_supertag_name: string | null;
    }>;

    return rows.map((row) => ({
      tagId: row.tag_id,
      attributeId: row.field_label_id,
      name: row.field_name,
      normalizedName: row.normalized_name || normalizeName(row.field_name),
      description: row.description,
      dataType: row.inferred_data_type,
      order: row.field_order,
      targetSupertagId: row.target_supertag_id,
      targetSupertagName: row.target_supertag_name,
    }));
  }

  /**
   * Load parent tag IDs for a supertag.
   */
  private loadParentIds(tagId: string): string[] {
    const rows = this.db
      .query(
        `
        SELECT parent_tag_id
        FROM supertag_parents
        WHERE child_tag_id = ?
      `
      )
      .all(tagId) as Array<{ parent_tag_id: string }>;

    return rows.map((row) => row.parent_tag_id);
  }

  // ==========================================================================
  // T-3.4: buildNodePayload
  // ==========================================================================

  /**
   * Parse supertag input into array of names.
   * Handles: string, comma-separated string, or array.
   */
  private parseSupertagInput(input: string | string[]): string[] {
    if (Array.isArray(input)) {
      return input;
    }
    // Handle comma-separated string
    if (input.includes(",")) {
      return input
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [input];
  }

  /**
   * Get combined fields from multiple supertags (deduplicated).
   */
  private getFieldsForMultipleSupertags(
    supertags: UnifiedSupertag[]
  ): UnifiedField[] {
    const allFields: UnifiedField[] = [];
    const seenAttributeIds = new Set<string>();

    for (const tag of supertags) {
      // Get all fields including inherited
      const fields = this.getAllFields(tag.id);
      for (const field of fields) {
        if (!seenAttributeIds.has(field.attributeId)) {
          seenAttributeIds.add(field.attributeId);
          allFields.push(field);
        }
      }
    }

    return allFields;
  }

  /**
   * Build a field node from field definition and value.
   */
  private buildFieldNode(
    field: UnifiedField,
    value: string | string[] | boolean
  ): TanaApiFieldNode | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const fieldChildren: TanaApiNode[] = [];

    // Handle different data types
    switch (field.dataType) {
      case "date":
        fieldChildren.push({
          dataType: "date",
          name: String(value),
        });
        break;

      case "reference":
      case "options":
        // Both reference and options fields use node IDs
        // Check if it's an ID (8+ alphanumeric chars) or a name
        if (typeof value === "string" && /^[A-Za-z0-9_-]{8,}$/.test(value)) {
          fieldChildren.push({
            dataType: "reference",
            id: value,
          } as TanaApiNode);
        } else {
          fieldChildren.push({
            name: String(value),
          });
        }
        break;

      case "url":
        fieldChildren.push({
          dataType: "url",
          name: String(value),
        });
        break;

      case "checkbox":
        fieldChildren.push({
          name: value ? "true" : "false",
        });
        break;

      case "number":
        fieldChildren.push({
          name: String(value),
        });
        break;

      default:
        // Handle arrays (multiple values)
        if (Array.isArray(value)) {
          for (const v of value) {
            fieldChildren.push({ name: String(v) });
          }
        } else {
          fieldChildren.push({ name: String(value) });
        }
    }

    return {
      type: "field",
      attributeId: field.attributeId,
      children: fieldChildren,
    };
  }

  /**
   * Build a Tana API node payload for one or more supertags.
   *
   * Replicates SchemaRegistry.buildNodePayload using database data.
   *
   * @param supertagInput Single supertag name, comma-separated names, or array of names
   * @param nodeName Node name
   * @param fieldValues Field values
   * @returns TanaApiNode payload ready for Input API
   */
  buildNodePayload(
    supertagInput: string | string[],
    nodeName: string,
    fieldValues: Record<string, string | string[] | boolean>
  ): TanaApiNode {
    const supertagNames = this.parseSupertagInput(supertagInput);

    // Deduplicate supertag names (case-sensitive)
    const uniqueNames = [...new Set(supertagNames)];

    // Resolve all schemas and validate
    const supertags: UnifiedSupertag[] = [];
    for (const name of uniqueNames) {
      const tag = this.getSupertag(name);
      if (!tag) {
        throw new Error(`Unknown supertag: ${name}`);
      }
      supertags.push(tag);
    }

    // Get combined fields from all supertags
    const allFields = this.getFieldsForMultipleSupertags(supertags);

    const children: (TanaApiNode | TanaApiFieldNode)[] = [];

    // Process each provided field value
    for (const [fieldName, value] of Object.entries(fieldValues)) {
      const normalizedFieldName = normalizeName(fieldName);
      const field = allFields.find((f) => f.normalizedName === normalizedFieldName);

      if (!field) {
        // Skip unknown fields (graceful degradation)
        continue;
      }

      const fieldNode = this.buildFieldNode(field, value);
      if (fieldNode) {
        children.push(fieldNode);
      }
    }

    // Deduplicate supertag IDs (in case same tag resolved via different names)
    const uniqueTagIds = [...new Set(supertags.map((s) => s.id))];

    return {
      name: nodeName,
      supertags: uniqueTagIds.map((id) => ({ id })),
      children: children.length > 0 ? children : undefined,
    };
  }

  // ==========================================================================
  // T-4.1: toSchemaRegistryJSON
  // ==========================================================================

  /**
   * Generate JSON in the exact SchemaRegistry format for backward compatibility.
   *
   * Produces JSON that can be loaded by SchemaRegistry.fromJSON().
   * Format: { version: 1, supertags: SupertagSchema[] }
   *
   * @returns JSON string in SchemaRegistry format
   */
  toSchemaRegistryJSON(): string {
    const supertags = this.listSupertags();

    // Convert to SchemaRegistry format
    const schemaSupertags = supertags.map((tag) => {
      // Convert fields to FieldSchema format
      const fields = tag.fields.map((field) => {
        const fieldSchema: Record<string, unknown> = {
          attributeId: field.attributeId,
          name: field.name,
          normalizedName: field.normalizedName,
        };

        // Only include non-null optional fields
        if (field.description) {
          fieldSchema.description = field.description;
        }
        if (field.dataType) {
          fieldSchema.dataType = field.dataType;
        }

        return fieldSchema;
      });

      // Build supertag schema
      const supertagSchema: Record<string, unknown> = {
        id: tag.id,
        name: tag.name,
        normalizedName: tag.normalizedName,
        fields,
      };

      // Only include non-null optional fields
      if (tag.description) {
        supertagSchema.description = tag.description;
      }
      if (tag.color) {
        supertagSchema.color = tag.color;
      }
      if (tag.extends && tag.extends.length > 0) {
        supertagSchema.extends = tag.extends;
      }

      return supertagSchema;
    });

    const data = {
      version: 1,
      supertags: schemaSupertags,
    };

    return JSON.stringify(data, null, 2);
  }

  // ==========================================================================
  // T-4.2: generateSchemaCache
  // ==========================================================================

  /**
   * Generate schema cache file at the specified path.
   *
   * Called after sync index to generate the schema-registry.json cache file.
   * Creates parent directories if they don't exist.
   *
   * @param filePath - Path to write the schema cache file
   * @returns The path that was written
   */
  async generateSchemaCache(filePath: string): Promise<string> {
    // Ensure parent directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Generate JSON content
    const json = this.toSchemaRegistryJSON();

    // Write to file
    writeFileSync(filePath, json, "utf-8");

    return filePath;
  }
}
