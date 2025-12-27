/**
 * Value-Based Type Inference
 *
 * Infers field data types by analyzing actual field values rather than
 * relying solely on field name heuristics (which are brittle).
 *
 * Spec: Bug fix for field type inference incorrectly showing all fields as "text"
 *
 * Type indicators in value nodes:
 * - _metaNodeId in props → reference type (the value references another node)
 * - Date patterns in value text → date type
 * - true/false values → checkbox type
 */

import { Database } from "bun:sqlite";
import type { DataType } from "../utils/infer-data-type";

/**
 * Date patterns to detect in value text
 * - ISO date format: 2024-12-27
 * - Tana relative dates: PARENT, PARENT+1, PARENT-1
 * - Inline date refs: data-inlineref-date
 */
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}/, // ISO date
  /^PARENT([+-]\d+)?$/, // Relative date (PARENT, PARENT+1, PARENT-1)
  /data-inlineref-date/, // Inline date reference
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // ISO datetime
  /^1970-01-01T/, // Epoch-based timestamps (Tana uses these for times)
];

/**
 * Analyze a value's text and props to determine its type
 */
function analyzeValueForType(
  valueText: string,
  rawData: string
): DataType | null {
  // Parse raw_data JSON to check for type indicators
  let props: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawData || "{}");
    props = parsed.props || {};
  } catch {
    // Invalid JSON, continue with text analysis
  }

  // Reference: value has _metaNodeId (points to another node)
  if (props._metaNodeId) {
    return "reference";
  }

  // Checkbox: value is true/false
  if (valueText === "true" || valueText === "false") {
    return "checkbox";
  }

  // Date: value matches date patterns
  for (const pattern of DATE_PATTERNS) {
    if (pattern.test(valueText)) {
      return "date";
    }
  }

  // No type indicator found
  return null;
}

/**
 * Infer field type by analyzing its actual values in the database
 *
 * @param db - SQLite database connection
 * @param fieldName - Name of the field to analyze
 * @param fieldDefId - Optional field definition ID for more precise matching
 * @returns Inferred type or null if no type can be determined
 */
export function inferTypeFromValues(
  db: Database,
  fieldName: string,
  fieldDefId?: string
): DataType | null {
  // Query field values and their node data
  let query = `
    SELECT fv.value_text, n.raw_data
    FROM field_values fv
    JOIN nodes n ON fv.value_node_id = n.id
    WHERE fv.field_name = ?
  `;
  const params: (string | undefined)[] = [fieldName];

  if (fieldDefId) {
    query += " AND fv.field_def_id = ?";
    params.push(fieldDefId);
  }

  query += " LIMIT 10"; // Sample up to 10 values for inference

  const values = db.query(query).all(...params) as Array<{
    value_text: string;
    raw_data: string;
  }>;

  if (values.length === 0) {
    return null; // No values to analyze
  }

  // Count type votes
  const typeCounts: Record<string, number> = {};

  for (const value of values) {
    const inferredType = analyzeValueForType(value.value_text, value.raw_data);
    if (inferredType) {
      typeCounts[inferredType] = (typeCounts[inferredType] || 0) + 1;
    }
  }

  // Return the type with most votes (if any)
  let maxType: DataType | null = null;
  let maxCount = 0;

  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxType = type as DataType;
    }
  }

  return maxType;
}

/**
 * Update field types in supertag_fields based on value analysis
 *
 * This is a post-processing step that runs after indexing to improve
 * type inference beyond name-based heuristics.
 *
 * Only upgrades types - won't downgrade a specific type to 'text'
 *
 * @param db - SQLite database connection
 * @returns Number of fields updated
 */
export function updateFieldTypesFromValues(db: Database): number {
  // Get all fields that currently have 'text' type (candidates for upgrade)
  const fields = db
    .query(
      `
      SELECT DISTINCT field_name, field_label_id
      FROM supertag_fields
      WHERE inferred_data_type = 'text' OR inferred_data_type IS NULL
    `
    )
    .all() as Array<{ field_name: string; field_label_id: string }>;

  let updatedCount = 0;

  for (const field of fields) {
    const inferredType = inferTypeFromValues(
      db,
      field.field_name,
      field.field_label_id
    );

    if (inferredType && inferredType !== "text") {
      // Update the field type
      db.run(
        `
        UPDATE supertag_fields
        SET inferred_data_type = ?
        WHERE field_name = ? AND field_label_id = ?
      `,
        [inferredType, field.field_name, field.field_label_id]
      );
      updatedCount++;
    }
  }

  return updatedCount;
}
