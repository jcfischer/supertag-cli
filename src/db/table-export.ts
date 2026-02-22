/**
 * Table Export Module (F-099: Bulk Field Extractor)
 *
 * Exports all instances of a supertag as a resolved table with field values.
 * Uses batched field extraction — single query for all instances' field values
 * and single query for reference resolution (no N+1).
 *
 * Pipeline:
 *   1. Schema: get field definitions for the supertag
 *   2. Instances: find all nodes with the tag
 *   3. Extract: batch-query field_values for all instance IDs
 *   4. Resolve: batch-resolve referenced node IDs to names
 *   5. Filter/Sort: apply --where, --sort, --limit
 *   6. Format: return structured rows for rendering
 */

import { Database } from "bun:sqlite";
import { SupertagMetadataService } from "../services/supertag-metadata-service.js";
import { FieldResolver } from "../services/field-resolver.js";

// =============================================================================
// Types
// =============================================================================

/** Value for a single field in an export row */
export interface FieldExportValue {
  /** Raw value(s) as stored (may be node IDs for references) */
  raw: string | string[];
  /** Resolved human-readable value(s) for reference fields */
  resolved?: string | string[];
  /** Field data type */
  type: string;
}

/** A single row in the table export */
export interface ExportRow {
  /** Node ID of the instance */
  id: string;
  /** Node name */
  name: string;
  /** Field values keyed by field name */
  fields: Record<string, FieldExportValue>;
}

/** Options for the table export */
export interface TableExportOptions {
  /** Only include these fields (case-insensitive match) */
  fields?: string[];
  /** Filter rows by field value equality: "FieldName=value" */
  where?: string[];
  /** Sort by field name */
  sort?: string;
  /** Sort direction */
  direction?: "asc" | "desc";
  /** Maximum rows to return */
  limit?: number;
  /** Skip first N rows */
  offset?: number;
  /** Resolve reference IDs to names (default: true) */
  resolveReferences?: boolean;
}

/** Result of a table export operation */
export interface TableExportResult {
  /** The supertag name */
  supertag: string;
  /** Column definitions in order */
  columns: string[];
  /** Data rows */
  rows: ExportRow[];
  /** Total count before pagination */
  totalCount: number;
  /** Whether there are more rows beyond limit */
  hasMore: boolean;
}

// =============================================================================
// Core Export Function
// =============================================================================

/**
 * Export all instances of a supertag as a table with resolved field values.
 * Uses batched queries — O(1) for field extraction, O(1) for reference resolution.
 */
export function exportTable(
  db: Database,
  supertag: string,
  options: TableExportOptions = {}
): TableExportResult {
  const {
    fields: fieldFilter,
    where,
    sort,
    direction = "asc",
    limit,
    offset = 0,
    resolveReferences = true,
  } = options;

  const metadataService = new SupertagMetadataService(db);

  // 1. Get tag ID and field schema
  let tagId = metadataService.findTagIdByName(supertag);
  if (!tagId) {
    // Try case-insensitive lookup in tag_applications
    const allTags = db
      .query(
        "SELECT DISTINCT tag_name FROM tag_applications WHERE LOWER(tag_name) = LOWER(?)"
      )
      .all(supertag) as Array<{ tag_name: string }>;

    if (allTags.length === 0) {
      throw new Error(`Supertag '${supertag}' not found`);
    }

    const exactName = allTags[0].tag_name;
    // Only recurse if the casing differs (avoids infinite loop for tags with no fields)
    if (exactName !== supertag) {
      return exportTable(db, exactName, options);
    }
    // Tag exists in tag_applications but has no field definitions — proceed with empty fields
  }

  // Get field definitions (empty if tag has no supertag_fields entries)
  const allFields = tagId ? metadataService.getAllFields(tagId) : [];
  let fieldDefs = allFields.filter((f) => !f.system);

  // Apply field filter if specified
  if (fieldFilter && fieldFilter.length > 0) {
    const filterLower = fieldFilter.map((f) => f.toLowerCase());
    fieldDefs = fieldDefs.filter((f) =>
      filterLower.includes(f.fieldName.toLowerCase())
    );
  }

  const columns = fieldDefs.map((f) => f.fieldName);

  // 2. Get all instances of this supertag
  const instances = db
    .query(
      `SELECT DISTINCT n.id, n.name, n.created
       FROM nodes n
       JOIN tag_applications ta ON n.id = ta.data_node_id
       WHERE ta.tag_name = ?
       ORDER BY n.created DESC`
    )
    .all(supertag) as Array<{ id: string; name: string | null; created: number | null }>;

  if (instances.length === 0) {
    return {
      supertag,
      columns,
      rows: [],
      totalCount: 0,
      hasMore: false,
    };
  }

  // 3. Batch-extract field values for ALL instances via FieldResolver
  const instanceIds = instances.map((i) => i.id);
  const fieldResolver = new FieldResolver(db);
  const fieldValueMap = fieldResolver.resolveFieldsRaw(instanceIds, "*");

  // 4. Build export rows
  let rows: ExportRow[] = instances.map((instance) => {
    const instanceFields = fieldValueMap.get(instance.id) || new Map();
    const fields: Record<string, FieldExportValue> = {};

    for (const fieldDef of fieldDefs) {
      const values = instanceFields.get(fieldDef.fieldName);
      if (!values || values.length === 0) {
        fields[fieldDef.fieldName] = {
          raw: "",
          type: fieldDef.inferredDataType || "text",
        };
      } else {
        // Values are already HTML-stripped by FieldResolver
        fields[fieldDef.fieldName] = {
          raw: values.length === 1 ? values[0] : values,
          type: fieldDef.inferredDataType || "text",
        };
      }
    }

    return {
      id: instance.id,
      name: instance.name || "",
      fields,
    };
  });

  // 5. Resolve references (batch all IDs at once)
  if (resolveReferences) {
    batchResolveReferences(db, rows, fieldDefs);
  }

  // 6. Apply --where filters
  if (where && where.length > 0) {
    for (const condition of where) {
      const eqIndex = condition.indexOf("=");
      if (eqIndex === -1) continue;
      const fieldName = condition.slice(0, eqIndex).trim();
      const filterValue = condition.slice(eqIndex + 1).trim().toLowerCase();

      rows = rows.filter((row) => {
        // Case-insensitive field name lookup
        const actualKey = Object.keys(row.fields).find(
          (k) => k.toLowerCase() === fieldName.toLowerCase()
        );
        const fieldValue = actualKey ? row.fields[actualKey] : undefined;
        if (!fieldValue) return false;

        // Check resolved value first, then raw
        const checkValue = fieldValue.resolved || fieldValue.raw;
        if (Array.isArray(checkValue)) {
          return checkValue.some((v) => v.toLowerCase() === filterValue);
        }
        return String(checkValue).toLowerCase() === filterValue;
      });
    }
  }

  // 7. Apply sort
  const totalCount = rows.length;
  if (sort) {
    const sortField = sort;
    const dir = direction === "desc" ? -1 : 1;

    rows.sort((a, b) => {
      // Sort by 'name' or 'id' as special columns
      if (sortField === "name") {
        return dir * a.name.localeCompare(b.name);
      }
      if (sortField === "id") {
        return dir * a.id.localeCompare(b.id);
      }

      const aVal = getDisplayValue(a.fields[sortField]);
      const bVal = getDisplayValue(b.fields[sortField]);
      return dir * aVal.localeCompare(bVal);
    });
  }

  // 8. Apply pagination
  const hasMore = limit ? offset + limit < totalCount : false;
  if (limit || offset > 0) {
    rows = rows.slice(offset, limit ? offset + limit : undefined);
  }

  return {
    supertag,
    columns,
    rows,
    totalCount,
    hasMore,
  };
}

// =============================================================================
// Batched Reference Resolution
// =============================================================================

/**
 * Batch-resolve all reference field IDs to names.
 * Collects all unique IDs, resolves in one query, then maps back.
 */
function batchResolveReferences(
  db: Database,
  rows: ExportRow[],
  fieldDefs: Array<{
    fieldName: string;
    inferredDataType?: string;
    targetSupertagId?: string;
  }>
): void {
  // Identify which fields are reference types
  const refFieldNames = new Set(
    fieldDefs
      .filter(
        (f) =>
          f.inferredDataType === "instance" ||
          f.inferredDataType === "reference" ||
          f.targetSupertagId
      )
      .map((f) => f.fieldName)
  );

  if (refFieldNames.size === 0) return;

  // Collect all unique IDs across all rows
  const allIds = new Set<string>();
  for (const row of rows) {
    for (const fieldName of refFieldNames) {
      const field = row.fields[fieldName];
      if (!field) continue;
      const rawValues = Array.isArray(field.raw) ? field.raw : [field.raw];
      for (const val of rawValues) {
        // Only collect values that look like Tana node IDs (alphanumeric, ~10-15 chars)
        if (val && /^[a-zA-Z0-9_-]{5,}$/.test(val)) {
          allIds.add(val);
        }
      }
    }
  }

  if (allIds.size === 0) return;

  // Batch resolve names
  const idToName = batchResolveNodeNames(db, Array.from(allIds));

  // Map back to rows
  for (const row of rows) {
    for (const fieldName of refFieldNames) {
      const field = row.fields[fieldName];
      if (!field) continue;
      const rawValues = Array.isArray(field.raw) ? field.raw : [field.raw];
      const resolved = rawValues.map((val) => {
        if (!val) return "";
        const name = idToName.get(val);
        if (name) return name;
        // If ID doesn't resolve, it might be a plain text value
        if (/^[a-zA-Z0-9_-]{5,}$/.test(val)) {
          return `[deleted:${val}]`;
        }
        return val;
      });

      field.resolved = resolved.length === 1 ? resolved[0] : resolved;
    }
  }
}

/**
 * Batch resolve node IDs to names.
 * Returns Map<id, name>.
 */
function batchResolveNodeNames(
  db: Database,
  ids: string[]
): Map<string, string> {
  const result = new Map<string, string>();
  if (ids.length === 0) return result;

  const BATCH_SIZE = 500;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");

    const rows = db
      .query(
        `SELECT id, name FROM nodes WHERE id IN (${placeholders})`
      )
      .all(...batch) as Array<{ id: string; name: string | null }>;

    for (const row of rows) {
      if (row.name) {
        result.set(row.id, row.name);
      }
    }
  }

  return result;
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Get the display value from a field export value (prefers resolved over raw).
 */
export function getDisplayValue(field?: FieldExportValue): string {
  if (!field) return "";
  const value = field.resolved || field.raw;
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value || "");
}

/**
 * Get truncated display value for markdown/CSV (first 5 items + "...+N more").
 */
export function getTruncatedDisplayValue(
  field?: FieldExportValue,
  maxItems: number = 5
): string {
  if (!field) return "";
  const value = field.resolved || field.raw;
  if (Array.isArray(value) && value.length > maxItems) {
    const shown = value.slice(0, maxItems).join(", ");
    return `${shown}...+${value.length - maxItems} more`;
  }
  return getDisplayValue(field);
}

/**
 * Format table export as markdown table.
 */
export function formatAsMarkdown(result: TableExportResult): string {
  const headers = ["Name", ...result.columns];
  const lines: string[] = [];

  // Calculate column widths
  const widths = headers.map((h) => h.length);
  const dataRows = result.rows.map((row) => {
    const cells = [
      row.name,
      ...result.columns.map((col) =>
        getTruncatedDisplayValue(row.fields[col]) || "-"
      ),
    ];
    cells.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], cell.length);
    });
    return cells;
  });

  // Header row
  lines.push(
    "| " + headers.map((h, i) => h.padEnd(widths[i])).join(" | ") + " |"
  );
  // Separator
  lines.push(
    "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |"
  );
  // Data rows
  for (const cells of dataRows) {
    lines.push(
      "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |"
    );
  }

  return lines.join("\n");
}
