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
import { SYSTEM_FIELD_METADATA } from "../db/system-fields";
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
  // Default value (Spec 092)
  defaultValueId?: string | null;
  defaultValueText?: string | null;
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
  private hasNodesTable: boolean | null = null;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Check if the nodes table exists (cached for performance).
   * Some databases (e.g., minimal test databases) may not have the nodes table.
   */
  private checkNodesTable(): boolean {
    if (this.hasNodesTable !== null) {
      return this.hasNodesTable;
    }
    try {
      const result = this.db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'")
        .get() as { name: string } | null;
      this.hasNodesTable = result !== null;
    } catch {
      this.hasNodesTable = false;
    }
    return this.hasNodesTable;
  }

  /**
   * Find a supertag by name (exact or normalized match).
   *
   * When multiple supertags have the same name (can happen with Tana exports),
   * selects the canonical one using the same logic as SchemaRegistry:
   * 1. Prefer more inheritance parents
   * 2. Then prefer more own fields
   *
   * Excludes trashed supertags by checking the node's _ownerId in raw_data.
   *
   * @param name - Supertag name to find
   * @returns Unified supertag or null if not found
   */
  getSupertag(name: string): UnifiedSupertag | null {
    const normalizedQuery = normalizeName(name);

    // Find all matching supertags and pick the canonical one
    // Priority: more inheritance parents, then more own fields
    // This handles cases where duplicate entries exist in the database
    // Excludes trashed supertags when nodes table is available
    const hasNodes = this.checkNodesTable();
    const query = hasNodes
      ? `
        SELECT m.tag_id, m.tag_name, m.normalized_name, m.description, m.color,
               (SELECT COUNT(*) FROM supertag_parents p WHERE p.child_tag_id = m.tag_id) as parent_count,
               (SELECT COUNT(*) FROM supertag_fields f WHERE f.tag_id = m.tag_id) as field_count
        FROM supertag_metadata m
        LEFT JOIN nodes n ON n.id = m.tag_id
        WHERE (m.tag_name = ? OR m.normalized_name = ?)
          AND (n.raw_data IS NULL OR COALESCE(json_extract(n.raw_data, '$.props._ownerId'), '') NOT LIKE '%TRASH%')
        ORDER BY parent_count DESC, field_count DESC
        LIMIT 1
      `
      : `
        SELECT m.tag_id, m.tag_name, m.normalized_name, m.description, m.color,
               (SELECT COUNT(*) FROM supertag_parents p WHERE p.child_tag_id = m.tag_id) as parent_count,
               (SELECT COUNT(*) FROM supertag_fields f WHERE f.tag_id = m.tag_id) as field_count
        FROM supertag_metadata m
        WHERE m.tag_name = ? OR m.normalized_name = ?
        ORDER BY parent_count DESC, field_count DESC
        LIMIT 1
      `;

    const row = this.db.query(query).get(name, normalizedQuery) as {
      tag_id: string;
      tag_name: string;
      normalized_name: string;
      description: string | null;
      color: string | null;
      parent_count: number;
      field_count: number;
    } | null;

    if (!row) {
      // Fallback: check supertags table for workspace-only tags not in metadata
      // This handles tags that exist in the workspace but aren't in Tana exports
      try {
        // Try exact match first (fast path)
        const fallbackQuery = `
          SELECT DISTINCT tag_id, tag_name, color
          FROM supertags
          WHERE tag_name = ?
          LIMIT 1
        `;

        let fallbackRow = this.db.query(fallbackQuery).get(name) as {
          tag_id: string;
          tag_name: string;
          color: string | null;
        } | null;

        // If no exact match, fetch distinct tags and normalize in TypeScript
        // We normalize in TypeScript (not SQL) to ensure consistency with the canonical normalizeName()
        // function which handles emoji removal via regex - not possible in SQLite without extensions
        if (!fallbackRow) {
          const candidatesQuery = `
            SELECT DISTINCT tag_id, tag_name, color
            FROM supertags
          `;

          const candidates = this.db.query(candidatesQuery).all() as {
            tag_id: string;
            tag_name: string;
            color: string | null;
          }[];

          // Use canonical normalizeName() to match against pre-computed normalizedQuery
          fallbackRow = candidates.find(tag => normalizeName(tag.tag_name) === normalizedQuery) || null;
        }

        if (fallbackRow) {
          // Build UnifiedSupertag with minimal data (no field metadata available)
          return {
            id: fallbackRow.tag_id,
            name: fallbackRow.tag_name,
            normalizedName: normalizeName(fallbackRow.tag_name),
            description: null,
            color: fallbackRow.color,
            fields: [],
            extends: undefined,
          };
        }
      } catch (error) {
        // supertags table doesn't exist (e.g., in test databases) - skip fallback
      }

      return null;
    }

    return this.buildUnifiedSupertag(row);
  }

  /**
   * Find a supertag by its node ID.
   * Excludes trashed supertags.
   *
   * @param id - Supertag node ID
   * @returns Unified supertag or null if not found
   */
  getSupertagById(id: string): UnifiedSupertag | null {
    const hasNodes = this.checkNodesTable();
    const query = hasNodes
      ? `
        SELECT m.tag_id, m.tag_name, m.normalized_name, m.description, m.color
        FROM supertag_metadata m
        LEFT JOIN nodes n ON n.id = m.tag_id
        WHERE m.tag_id = ?
          AND (n.raw_data IS NULL OR COALESCE(json_extract(n.raw_data, '$.props._ownerId'), '') NOT LIKE '%TRASH%')
      `
      : `
        SELECT tag_id, tag_name, normalized_name, description, color
        FROM supertag_metadata
        WHERE tag_id = ?
      `;

    const row = this.db.query(query).get(id) as {
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
   * Excludes trashed supertags by checking the node's _ownerId in raw_data.
   *
   * @returns Array of all unified supertags
   */
  listSupertags(): UnifiedSupertag[] {
    const startTime = Date.now();
    const isDebug = process.env.DEBUG_SCHEMA === "1";

    if (isDebug) {
      console.error(`[schema-debug] listSupertags: starting...`);
    }

    const hasNodes = this.checkNodesTable();
    const query = hasNodes
      ? `
        SELECT m.tag_id, m.tag_name, m.normalized_name, m.description, m.color
        FROM supertag_metadata m
        LEFT JOIN nodes n ON n.id = m.tag_id
        WHERE n.raw_data IS NULL
           OR COALESCE(json_extract(n.raw_data, '$.props._ownerId'), '') NOT LIKE '%TRASH%'
        ORDER BY m.tag_name
      `
      : `
        SELECT tag_id, tag_name, normalized_name, description, color
        FROM supertag_metadata
        ORDER BY tag_name
      `;

    if (isDebug) {
      console.error(`[schema-debug] listSupertags: executing query (hasNodes=${hasNodes})...`);
    }

    const queryStart = Date.now();
    const rows = this.db.query(query).all() as Array<{
      tag_id: string;
      tag_name: string;
      normalized_name: string;
      description: string | null;
      color: string | null;
    }>;

    if (isDebug) {
      console.error(`[schema-debug] listSupertags: query returned ${rows.length} rows in ${Date.now() - queryStart}ms`);
      console.error(`[schema-debug] listSupertags: building supertag objects...`);
    }

    const buildStart = Date.now();
    let lastLog = Date.now();
    const result = rows.map((row, index) => {
      // Log progress every 5 seconds or every 100 items in debug mode
      if (isDebug && (Date.now() - lastLog > 5000 || (index > 0 && index % 100 === 0))) {
        console.error(`[schema-debug] listSupertags: processed ${index}/${rows.length} supertags (${Date.now() - buildStart}ms elapsed)`);
        lastLog = Date.now();
      }
      return this.buildUnifiedSupertag(row);
    });

    if (isDebug) {
      console.error(`[schema-debug] listSupertags: built ${result.length} supertags in ${Date.now() - buildStart}ms`);
      console.error(`[schema-debug] listSupertags: total time ${Date.now() - startTime}ms`);
    }

    return result;
  }

  /**
   * Search for supertags by partial name match.
   * Excludes trashed supertags.
   *
   * @param query - Search query (partial match on name or normalized name)
   * @returns Array of matching supertags
   */
  searchSupertags(query: string): UnifiedSupertag[] {
    const normalizedQuery = normalizeName(query);
    const likePattern = `%${query.toLowerCase()}%`;
    const normalizedPattern = `%${normalizedQuery}%`;

    const hasNodes = this.checkNodesTable();
    const sql = hasNodes
      ? `
        SELECT m.tag_id, m.tag_name, m.normalized_name, m.description, m.color
        FROM supertag_metadata m
        LEFT JOIN nodes n ON n.id = m.tag_id
        WHERE (LOWER(m.tag_name) LIKE ? OR m.normalized_name LIKE ?)
          AND (n.raw_data IS NULL OR COALESCE(json_extract(n.raw_data, '$.props._ownerId'), '') NOT LIKE '%TRASH%')
        ORDER BY m.tag_name
      `
      : `
        SELECT tag_id, tag_name, normalized_name, description, color
        FROM supertag_metadata
        WHERE LOWER(tag_name) LIKE ? OR normalized_name LIKE ?
        ORDER BY tag_name
      `;

    const rows = this.db.query(sql).all(likePattern, normalizedPattern) as Array<{
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

    // Add system fields (Spec 074) - only if not already defined by user
    const ancestorIds = new Set(ancestorRows.map(a => a.tag_id));
    const systemFields = this.getSystemFieldsForTag(ancestorIds);
    for (const sysField of systemFields) {
      if (!seenFieldNames.has(sysField.normalizedName)) {
        seenFieldNames.add(sysField.normalizedName);
        allFields.push(sysField);
      }
    }

    return allFields;
  }

  /**
   * Get system fields available to a tag based on its inheritance chain.
   * Queries the system_field_sources table to find which system fields apply.
   *
   * @param ancestorIds - Set of tag IDs in the inheritance chain
   * @returns Array of UnifiedField for system fields
   */
  private getSystemFieldsForTag(ancestorIds: Set<string>): UnifiedField[] {
    const systemFields: UnifiedField[] = [];

    // Check if system_field_sources table exists
    try {
      const tableCheck = this.db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='system_field_sources'")
        .get() as { name: string } | null;

      if (!tableCheck) {
        return systemFields;
      }
    } catch {
      return systemFields;
    }

    // For each known system field, check if any ancestor defines it
    for (const [fieldId, meta] of Object.entries(SYSTEM_FIELD_METADATA)) {
      // Get tags that define this system field
      const sourceTags = this.db
        .query("SELECT tag_id FROM system_field_sources WHERE field_id = ?")
        .all(fieldId) as Array<{ tag_id: string }>;

      // Does any ancestor define this system field?
      const definingTag = sourceTags.find(row => ancestorIds.has(row.tag_id));

      if (definingTag) {
        systemFields.push({
          tagId: definingTag.tag_id,
          attributeId: fieldId,
          name: meta.name,
          normalizedName: meta.normalizedName,
          dataType: meta.dataType,
          order: 999, // System fields come last
        });
      }
    }

    return systemFields;
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
   * Resolve a reference by name to a node ID (F-094).
   *
   * Used when field values are prefixed with "@" to indicate lookup by name
   * instead of raw node ID. This matches Tana's native @mention behavior.
   *
   * @param name - The display name to search for (without @ prefix)
   * @param targetSupertagId - Optional supertag ID to filter results (from field definition)
   * @param fieldLabelId - Optional field label node ID for options field lookup
   * @returns Node ID if found, null otherwise
   *
   * @example
   * // Lookup by name only
   * resolveReferenceByName("Superceded")
   *
   * @example
   * // Lookup filtered by target supertag (e.g., "State" options)
   * resolveReferenceByName("Superceded", "state-tag-id")
   *
   * @example
   * // Lookup from field's Values tuple children (for options without targetSupertag)
   * resolveReferenceByName("Active", null, "jDnCkR4gIUDx")
   */
  resolveReferenceByName(name: string, targetSupertagId?: string | null, fieldLabelId?: string | null): string | null {
    if (!this.checkNodesTable()) {
      return null;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return null;
    }

    // If we have a target supertag, filter by it for more precise matching
    if (targetSupertagId) {
      // First try exact name match with supertag filter
      const exactWithTag = this.db.query(`
        SELECT n.id
        FROM nodes n
        INNER JOIN tag_applications ta ON ta.data_node_id = n.id
        WHERE n.name = ? AND ta.tag_id = ?
        LIMIT 1
      `).get(trimmedName, targetSupertagId) as { id: string } | null;

      if (exactWithTag) {
        return exactWithTag.id;
      }

      // Try normalized name match with supertag filter
      const normalizedName = normalizeName(trimmedName);
      const normalizedWithTag = this.db.query(`
        SELECT n.id
        FROM nodes n
        INNER JOIN tag_applications ta ON ta.data_node_id = n.id
        WHERE LOWER(REPLACE(REPLACE(n.name, ' ', ''), '-', '')) = ? AND ta.tag_id = ?
        LIMIT 1
      `).get(normalizedName, targetSupertagId) as { id: string } | null;

      if (normalizedWithTag) {
        return normalizedWithTag.id;
      }
    }

    // If we have a field label ID, try to find option in field's Values tuple children
    // This handles options fields without targetSupertagId (e.g., Status dropdown)
    if (fieldLabelId) {
      const optionId = this.findOptionInFieldChildren(trimmedName, fieldLabelId);
      if (optionId) {
        return optionId;
      }
    }

    // Fallback: search without supertag filter
    // First try exact match
    const exact = this.db.query(`
      SELECT id FROM nodes WHERE name = ? LIMIT 1
    `).get(trimmedName) as { id: string } | null;

    if (exact) {
      return exact.id;
    }

    // Try normalized match
    const normalizedName = normalizeName(trimmedName);
    const normalized = this.db.query(`
      SELECT id FROM nodes
      WHERE LOWER(REPLACE(REPLACE(name, ' ', ''), '-', '')) = ?
      LIMIT 1
    `).get(normalizedName) as { id: string } | null;

    return normalized?.id ?? null;
  }

  /**
   * Find an option value in a field's Values tuple children.
   *
   * Field structure in Tana:
   *   Field Definition (attrDef) → "Values" tuple → Options Container → Option Values
   *
   * @param name - Option name to find
   * @param fieldLabelId - Field definition node ID
   * @returns Node ID if found, null otherwise
   */
  private findOptionInFieldChildren(name: string, fieldLabelId: string): string | null {
    // Get the field label node to find its children
    const fieldNode = this.db.query(`
      SELECT raw_data FROM nodes WHERE id = ?
    `).get(fieldLabelId) as { raw_data: string } | null;

    if (!fieldNode) {
      return null;
    }

    let fieldData: { children?: string[] };
    try {
      fieldData = JSON.parse(fieldNode.raw_data);
    } catch {
      return null;
    }

    if (!fieldData.children || fieldData.children.length === 0) {
      return null;
    }

    // Find the "Values" tuple child
    const valuesTupleId = this.findValuesTupleChild(fieldData.children);
    if (!valuesTupleId) {
      return null;
    }

    // Get the Values tuple node to find its children (options container or direct options)
    const tupleNode = this.db.query(`
      SELECT raw_data FROM nodes WHERE id = ?
    `).get(valuesTupleId) as { raw_data: string } | null;

    if (!tupleNode) {
      return null;
    }

    let tupleData: { children?: string[] };
    try {
      tupleData = JSON.parse(tupleNode.raw_data);
    } catch {
      return null;
    }

    if (!tupleData.children || tupleData.children.length === 0) {
      return null;
    }

    // Collect all potential option IDs - either direct children or children of container nodes
    const optionIds = this.collectOptionIds(tupleData.children);

    // Search for matching name among options
    return this.findNodeByNameInList(name, optionIds);
  }

  /**
   * Find the "Values" tuple child in a list of node IDs.
   */
  private findValuesTupleChild(childIds: string[]): string | null {
    if (childIds.length === 0) return null;

    // Query all children at once for efficiency
    const placeholders = childIds.map(() => "?").join(",");
    const rows = this.db.query(`
      SELECT id, name, json_extract(raw_data, '$.props._docType') as docType
      FROM nodes
      WHERE id IN (${placeholders})
    `).all(...childIds) as Array<{ id: string; name: string; docType: string | null }>;

    // Find the "Values" tuple
    for (const row of rows) {
      if (row.name === "Values" && row.docType === "tuple") {
        return row.id;
      }
    }

    return null;
  }

  /**
   * Collect option IDs from tuple children.
   * Options may be direct children or nested inside a container node.
   */
  private collectOptionIds(childIds: string[]): string[] {
    const optionIds: string[] = [];

    for (const childId of childIds) {
      // Skip system nodes
      if (childId.startsWith("SYS_")) {
        continue;
      }

      // Get the child node to check if it's a container
      const childNode = this.db.query(`
        SELECT raw_data, name FROM nodes WHERE id = ?
      `).get(childId) as { raw_data: string; name: string } | null;

      if (!childNode) {
        continue;
      }

      let childData: { children?: string[] };
      try {
        childData = JSON.parse(childNode.raw_data);
      } catch {
        // Not valid JSON, treat as direct option
        optionIds.push(childId);
        continue;
      }

      // If it has children, it might be a container - add both the container and its children
      if (childData.children && childData.children.length > 0) {
        // Add the container's children as potential options
        for (const grandchildId of childData.children) {
          if (!grandchildId.startsWith("SYS_")) {
            optionIds.push(grandchildId);
          }
        }
      }

      // Also add the node itself as a potential option (might be a direct option)
      optionIds.push(childId);
    }

    return optionIds;
  }

  /**
   * Find a node by name in a list of node IDs.
   */
  private findNodeByNameInList(name: string, nodeIds: string[]): string | null {
    if (nodeIds.length === 0) return null;

    const trimmedName = name.trim();
    const normalizedName = normalizeName(trimmedName);

    // Query all nodes at once
    const placeholders = nodeIds.map(() => "?").join(",");
    const rows = this.db.query(`
      SELECT id, name FROM nodes WHERE id IN (${placeholders})
    `).all(...nodeIds) as Array<{ id: string; name: string }>;

    // First try exact match
    for (const row of rows) {
      if (row.name === trimmedName) {
        return row.id;
      }
    }

    // Then try normalized match
    for (const row of rows) {
      if (normalizeName(row.name) === normalizedName) {
        return row.id;
      }
    }

    return null;
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

  // Performance: pre-built prepared statements for N+1 queries
  private fieldsStatement: ReturnType<Database["query"]> | null = null;
  private parentsStatement: ReturnType<Database["query"]> | null = null;
  private fieldQueryCount = 0;
  private parentQueryCount = 0;

  /**
   * Load fields for a supertag from database.
   */
  private loadFieldsForTag(tagId: string): UnifiedField[] {
    // Use prepared statement for performance
    if (!this.fieldsStatement) {
      this.fieldsStatement = this.db.query(`
        SELECT tag_id, field_name, field_label_id, field_order, normalized_name, description, inferred_data_type, target_supertag_id, target_supertag_name, default_value_id, default_value_text
        FROM supertag_fields
        WHERE tag_id = ?
        ORDER BY field_order
      `);
    }

    this.fieldQueryCount++;
    const rows = this.fieldsStatement.all(tagId) as Array<{
      tag_id: string;
      field_name: string;
      field_label_id: string;
      field_order: number;
      normalized_name: string | null;
      description: string | null;
      inferred_data_type: string | null;
      target_supertag_id: string | null;
      target_supertag_name: string | null;
      default_value_id: string | null;
      default_value_text: string | null;
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
      defaultValueId: row.default_value_id,
      defaultValueText: row.default_value_text,
    }));
  }

  /**
   * Load parent tag IDs for a supertag.
   */
  private loadParentIds(tagId: string): string[] {
    // Use prepared statement for performance
    if (!this.parentsStatement) {
      this.parentsStatement = this.db.query(`
        SELECT parent_tag_id
        FROM supertag_parents
        WHERE child_tag_id = ?
      `);
    }

    this.parentQueryCount++;
    const rows = this.parentsStatement.all(tagId) as Array<{ parent_tag_id: string }>;

    return rows.map((row) => row.parent_tag_id);
  }

  /**
   * Get query counts for debugging
   */
  getQueryCounts(): { fields: number; parents: number } {
    return { fields: this.fieldQueryCount, parents: this.parentQueryCount };
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
        // Handle both single values and arrays of references
        // Also split comma-separated strings into arrays
        const refValues = Array.isArray(value)
          ? value
          : typeof value === "string" && value.includes(",")
            ? value.split(",").map((s) => s.trim())
            : [value];
        for (const v of refValues) {
          const strValue = String(v);

          // F-094: @Name syntax for reference by name lookup
          // Matches Tana's native @mention behavior
          if (strValue.startsWith("@")) {
            const lookupName = strValue.slice(1); // Remove @ prefix
            const resolvedId = this.resolveReferenceByName(lookupName, field.targetSupertagId, field.attributeId);
            if (resolvedId) {
              fieldChildren.push({
                dataType: "reference",
                id: resolvedId,
              } as TanaApiNode);
            } else {
              // Name not found - create new node with the name (without @ prefix)
              if (field.targetSupertagId) {
                fieldChildren.push({
                  name: lookupName,
                  supertags: [{ id: field.targetSupertagId }],
                });
              } else {
                fieldChildren.push({
                  name: lookupName,
                });
              }
            }
          }
          // Check if it's a node ID (8+ alphanumeric chars with dashes/underscores)
          else if (/^[A-Za-z0-9_-]{8,}$/.test(strValue)) {
            fieldChildren.push({
              dataType: "reference",
              id: strValue,
            } as TanaApiNode);
          } else {
            // Creating a new node by name
            // If field has targetSupertag, create tagged node; otherwise plain node
            if (field.targetSupertagId) {
              fieldChildren.push({
                name: strValue,
                supertags: [{ id: field.targetSupertagId }],
              });
            } else {
              fieldChildren.push({
                name: strValue,
              });
            }
          }
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
            const strValue = String(v);
            // F-094: Support @Name syntax even for unknown field types
            if (strValue.startsWith("@")) {
              const lookupName = strValue.slice(1);
              const resolvedId = this.resolveReferenceByName(lookupName, field.targetSupertagId, field.attributeId);
              if (resolvedId) {
                fieldChildren.push({
                  dataType: "reference",
                  id: resolvedId,
                } as TanaApiNode);
              } else {
                fieldChildren.push({ name: lookupName });
              }
            } else {
              fieldChildren.push({ name: strValue });
            }
          }
        } else {
          const strValue = String(value);
          // F-094: Support @Name syntax even for unknown field types
          if (strValue.startsWith("@")) {
            const lookupName = strValue.slice(1);
            const resolvedId = this.resolveReferenceByName(lookupName, field.targetSupertagId, field.attributeId);
            if (resolvedId) {
              fieldChildren.push({
                dataType: "reference",
                id: resolvedId,
              } as TanaApiNode);
            } else {
              fieldChildren.push({ name: lookupName });
            }
          } else {
            fieldChildren.push({ name: strValue });
          }
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
   * Auto-populates default field values when user doesn't provide a value (Spec 092).
   *
   * @param supertagInput Single supertag name, comma-separated names, or array of names
   * @param nodeName Node name
   * @param fieldValues Field values (explicit empty string overrides default)
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

    // Normalize field names provided by user for comparison
    const userFieldNames = new Set(
      Object.keys(fieldValues).map((name) => normalizeName(name))
    );

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

    // Spec 092: Apply default values for fields not provided by user
    for (const field of allFields) {
      // Skip if user provided a value (including explicit empty)
      if (userFieldNames.has(field.normalizedName)) {
        continue;
      }

      // Skip if no default value defined
      if (!field.defaultValueId) {
        continue;
      }

      // Build field node using default value
      // Use reference type if we have a node ID (for options/reference fields)
      const fieldNode = this.buildDefaultFieldNode(field);
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

  /**
   * Build a field node using the field's default value.
   * Used for auto-populating defaults (Spec 092).
   */
  private buildDefaultFieldNode(field: UnifiedField): TanaApiFieldNode | null {
    if (!field.defaultValueId) {
      return null;
    }

    const fieldChildren: TanaApiNode[] = [];

    // For reference/options fields, use the node ID as a reference
    if (field.dataType === "reference" || field.dataType === "options") {
      fieldChildren.push({
        dataType: "reference",
        id: field.defaultValueId,
      } as TanaApiNode);
    } else if (field.defaultValueText) {
      // For other field types, use the text value
      fieldChildren.push({ name: field.defaultValueText });
    } else {
      return null;
    }

    return {
      type: "field",
      attributeId: field.attributeId,
      children: fieldChildren,
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
    const startTime = Date.now();
    const isDebug = process.env.DEBUG_SCHEMA === "1";

    if (isDebug) {
      console.error(`[schema-debug] toSchemaRegistryJSON: starting...`);
    }

    const supertags = this.listSupertags();

    if (isDebug) {
      const counts = this.getQueryCounts();
      console.error(`[schema-debug] toSchemaRegistryJSON: listSupertags returned ${supertags.length} tags`);
      console.error(`[schema-debug] toSchemaRegistryJSON: query counts - fields: ${counts.fields}, parents: ${counts.parents}`);
    }

    // Deduplicate: only export canonical supertag for each name
    // Apply same logic as SchemaRegistry: prefer more parents, then more fields
    const canonicalSupertags = new Map<string, UnifiedSupertag>();
    for (const tag of supertags) {
      const existing = canonicalSupertags.get(tag.name);
      if (!existing) {
        canonicalSupertags.set(tag.name, tag);
      } else {
        // Prefer tag with more inheritance parents
        const tagParents = tag.extends?.length ?? 0;
        const existingParents = existing.extends?.length ?? 0;
        if (tagParents > existingParents) {
          canonicalSupertags.set(tag.name, tag);
        } else if (tagParents === existingParents && tag.fields.length > existing.fields.length) {
          // Same parents - prefer more fields
          canonicalSupertags.set(tag.name, tag);
        }
      }
    }

    // Convert to SchemaRegistry format
    const schemaSupertags = Array.from(canonicalSupertags.values()).map((tag) => {
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

        // Spec 081 T-1.3: Include target supertag for reference fields
        if (field.targetSupertagId && field.targetSupertagName) {
          fieldSchema.targetSupertag = {
            id: field.targetSupertagId,
            name: field.targetSupertagName,
          };
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

    if (isDebug) {
      console.error(`[schema-debug] toSchemaRegistryJSON: serializing ${schemaSupertags.length} canonical supertags...`);
    }

    const jsonStart = Date.now();
    const json = JSON.stringify(data, null, 2);

    if (isDebug) {
      console.error(`[schema-debug] toSchemaRegistryJSON: JSON serialization took ${Date.now() - jsonStart}ms (${(json.length / 1024).toFixed(1)} KB)`);
      console.error(`[schema-debug] toSchemaRegistryJSON: total time ${Date.now() - startTime}ms`);
    }

    return json;
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
