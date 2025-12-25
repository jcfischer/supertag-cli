/**
 * Field Values Extraction Module
 *
 * Extracts text-based field values from Tana tuple structures.
 * Tuples with _docType="tuple" and _sourceId pointing to a field definition
 * contain field values in their children.
 *
 * Tuple structure:
 * - tuple.children[0] = field label reference (skip)
 * - tuple.children[1..n] = value nodes (extract text from these)
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { NodeDump } from "../types/tana-dump";
import type { ExtractedFieldValue } from "../types/field-values";

/**
 * System field IDs to human-readable names
 * These are synthetic field IDs that don't exist in the nodes table
 * but are used by Tana for built-in fields
 *
 * Categories:
 * - Core fields (SYS_A13, SYS_A61, SYS_A90, SYS_A142): Common user-facing fields
 * - Schema fields (SYS_T01, SYS_T02, SYS_T03): Supertag/field definitions
 * - Search fields (SYS_A15, SYS_A144): Saved search configurations
 * - AI/Entity fields (SYS_A130): AI-detected entity types
 * - Transcript fields (SYS_A150, SYS_A252, SYS_A253, SYS_A254): Meeting transcripts
 * - Internal fields (SYS_A12, SYS_A16, SYS_A20): System configuration
 */
export const SYSTEM_FIELD_NAMES: Record<string, string> = {
  // Core user-facing fields
  SYS_A13: "Tag",
  SYS_A61: "Due date",
  SYS_A90: "Date",
  SYS_A142: "Attendees",

  // Schema/definition fields
  SYS_T01: "Supertag",
  SYS_T02: "Field",
  SYS_T03: "Option value",

  // Search configuration fields
  SYS_A15: "Search expression",
  SYS_A144: "Search title",

  // AI/Entity detection fields
  SYS_A130: "Entity type",

  // Transcript/meeting fields
  SYS_A150: "Speaker",
  SYS_A199: "Transcript",
  SYS_A252: "Transcript speaker",
  SYS_A253: "Start time",
  SYS_A254: "End time",

  // Internal system fields
  SYS_A12: "System reference",
  SYS_A16: "Default value",
  SYS_A20: "Field reference",
};

/**
 * Options for value extraction
 */
export interface ExtractionOptions {
  /** Include nested children in value text */
  includeNestedChildren?: boolean;
  /** Maximum depth for nested children */
  nestedChildrenDepth?: number;
  /** Pre-computed parent map (child -> parent) for O(1) lookup */
  parentMap?: Map<string, string>;
}

/**
 * Check if a node is a tuple with _sourceId (field value container)
 * @deprecated Use isFieldTuple instead - many valid field tuples don't have _sourceId
 */
export function isTupleWithSourceId(node: NodeDump): boolean {
  return (
    node.props._docType === "tuple" &&
    typeof node.props._sourceId === "string" &&
    node.props._sourceId.length > 0
  );
}

/**
 * Check if a node is a field tuple (with or without _sourceId)
 *
 * Many field tuples in Tana don't have _sourceId set. The reliable pattern is:
 * - _docType === "tuple"
 * - Has at least 2 children (label + value)
 * - First child has a non-empty name (the field label)
 *
 * Excludes "mega-tuples" with 50+ children (these are daily briefing containers)
 */
export function isFieldTuple(
  node: NodeDump,
  nodes: Map<string, NodeDump>
): boolean {
  // Must be a tuple
  if (node.props._docType !== "tuple") {
    return false;
  }

  // Must have at least 2 children (label + value)
  if (!node.children || node.children.length < 2) {
    return false;
  }

  // Skip mega-tuples (daily briefing containers with flat structure)
  // These have 50+ children and use indentation-based field structure
  if (node.children.length > 50) {
    return false;
  }

  // First child must be a valid field label (has name, not an indented outline item)
  const firstChildId = node.children[0];

  // System field IDs (SYS_*) are valid field labels even if not in nodes table
  if (firstChildId.startsWith("SYS_")) {
    return true;
  }

  const labelNode = nodes.get(firstChildId);

  if (!labelNode?.props.name) {
    return false;
  }

  // Skip if first child looks like an indented outline item (starts with "  - ")
  // These are part of flat daily briefing structure, not proper field tuples
  const labelName = labelNode.props.name;
  if (labelName.startsWith("  - ") || labelName.startsWith("    - ")) {
    return false;
  }

  return true;
}

/**
 * Resolve field name from the tuple's first child
 * The first child of a tuple is the field label node containing the field name
 *
 * Structure:
 * - tuple._sourceId points to template tuple (but its name is just "tuple")
 * - tuple.children[0] = field label node (contains actual field name)
 * - tuple.children[1..n] = value nodes
 */
export function resolveFieldNameFromTuple(
  tuple: NodeDump,
  nodes: Map<string, NodeDump>
): string | null {
  // The first child of the tuple contains the field label (name)
  if (!tuple.children || tuple.children.length === 0) {
    return null;
  }

  const firstChildId = tuple.children[0];

  // System field IDs (SYS_*) have known names
  if (firstChildId.startsWith("SYS_")) {
    return SYSTEM_FIELD_NAMES[firstChildId] ?? null;
  }

  const labelNode = nodes.get(firstChildId);

  if (!labelNode?.props.name) {
    return null;
  }

  return labelNode.props.name;
}

/**
 * @deprecated Use resolveFieldNameFromTuple instead
 * Resolve field definition ID to human-readable name
 * This approach doesn't work correctly - the _sourceId points to a template
 * tuple whose name is always "tuple"
 */
export function resolveFieldName(
  fieldDefId: string,
  nodes: Map<string, NodeDump>
): string | null {
  const defNode = nodes.get(fieldDefId);
  if (!defNode?.props.name) {
    return null;
  }
  return defNode.props.name;
}

/**
 * Check if a field is in the exclusion list
 */
export function isExcludedField(db: Database, fieldName: string): boolean {
  const result = db
    .query("SELECT 1 FROM field_exclusions WHERE field_name = ?")
    .get(fieldName);
  return result !== null;
}

/**
 * Extract nested children text recursively
 */
function extractNestedText(
  nodeId: string,
  nodes: Map<string, NodeDump>,
  depth: number,
  maxDepth: number
): string {
  if (depth > maxDepth) return "";

  const node = nodes.get(nodeId);
  if (!node) return "";

  const parts: string[] = [];
  const name = node.props.name;

  if (name) {
    parts.push(name);
  }

  if (node.children && depth < maxDepth) {
    for (const childId of node.children) {
      const childText = extractNestedText(childId, nodes, depth + 1, maxDepth);
      if (childText) {
        parts.push(childText);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Extract values from tuple children
 * Skips the first child (field label reference) and extracts text from remaining children
 */
export function extractValuesFromTupleChildren(
  tuple: NodeDump,
  nodes: Map<string, NodeDump>,
  options: ExtractionOptions = {}
): Array<{ valueNodeId: string; valueText: string; valueOrder: number }> {
  const { includeNestedChildren = false, nestedChildrenDepth = 2 } = options;

  if (!tuple.children || tuple.children.length < 2) {
    return [];
  }

  const values: Array<{
    valueNodeId: string;
    valueText: string;
    valueOrder: number;
  }> = [];

  // Skip first child (field label reference), process remaining as values
  let valueOrder = 0;
  for (let i = 1; i < tuple.children.length; i++) {
    const childId = tuple.children[i];
    const childNode = nodes.get(childId);

    if (!childNode) continue;

    let valueText = childNode.props.name ?? "";

    // Include nested children if requested
    if (includeNestedChildren && childNode.children && childNode.children.length > 0) {
      const nestedParts: string[] = [valueText];
      for (const nestedId of childNode.children) {
        const nestedText = extractNestedText(nestedId, nodes, 0, nestedChildrenDepth);
        if (nestedText) {
          nestedParts.push(nestedText);
        }
      }
      valueText = nestedParts.filter(Boolean).join("\n");
    }

    // Skip empty values
    if (!valueText || valueText.trim() === "") {
      continue;
    }

    values.push({
      valueNodeId: childId,
      valueText,
      valueOrder: valueOrder++,
    });
  }

  return values;
}

/**
 * Find parent node ID for a tuple
 * Uses parentMap for O(1) lookup if provided, otherwise O(n) search
 */
function findTupleParent(
  tupleId: string,
  nodes: Map<string, NodeDump>,
  parentMap?: Map<string, string>
): string | null {
  // Fast path: use pre-computed parent map for O(1) lookup
  if (parentMap) {
    let currentId = tupleId;
    let parentId = parentMap.get(currentId);

    // Walk up until we find a non-tuple parent
    while (parentId) {
      const parentNode = nodes.get(parentId);
      if (!parentNode || parentNode.props._docType !== "tuple") {
        return parentId;
      }
      currentId = parentId;
      parentId = parentMap.get(currentId);
    }
    return null;
  }

  // Slow path: O(n) search through all nodes
  for (const [nodeId, node] of nodes) {
    if (node.children?.includes(tupleId)) {
      // Check if parent is also a tuple (keep going up)
      if (node.props._docType === "tuple") {
        const grandparent = findTupleParent(nodeId, nodes, parentMap);
        if (grandparent) return grandparent;
      }
      return nodeId;
    }
  }
  return null;
}

/**
 * Extract all field values from a map of nodes
 * Scans for tuples with _sourceId and extracts their values
 */
export function extractFieldValuesFromNodes(
  nodes: Map<string, NodeDump>,
  db: Database,
  options: ExtractionOptions = {}
): ExtractedFieldValue[] {
  const extracted: ExtractedFieldValue[] = [];

  for (const [nodeId, node] of nodes) {
    // Skip non-field-value tuples (use isFieldTuple which handles tuples without _sourceId)
    if (!isFieldTuple(node, nodes)) {
      continue;
    }

    // sourceId may be undefined for tuples without _sourceId
    const sourceId = (node.props._sourceId as string) || "";

    // Resolve field name from the tuple's first child (field label)
    const fieldName = resolveFieldNameFromTuple(node, nodes);
    if (!fieldName) {
      continue; // Can't resolve field name, skip
    }

    // Check exclusions
    if (isExcludedField(db, fieldName)) {
      continue;
    }

    // Find parent node (use parentMap for O(1) lookup if available)
    const parentId = findTupleParent(nodeId, nodes, options.parentMap);
    if (!parentId) {
      continue; // Can't find parent, skip
    }

    // Extract values from tuple children
    const values = extractValuesFromTupleChildren(node, nodes, options);

    for (const value of values) {
      extracted.push({
        tupleId: nodeId,
        parentId,
        fieldDefId: sourceId,
        fieldName,
        valueNodeId: value.valueNodeId,
        valueText: value.valueText,
        valueOrder: value.valueOrder,
      });
    }
  }

  return extracted;
}

/**
 * Insert extracted field values into database
 * Uses batch insert for performance
 */
export function insertFieldValues(
  db: Database,
  values: ExtractedFieldValue[],
  getCreatedTimestamp: (parentId: string) => number | null
): void {
  const stmt = db.prepare(`
    INSERT INTO field_values
    (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, value_order, created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const value of values) {
    const created = getCreatedTimestamp(value.parentId);
    stmt.run(
      value.tupleId,
      value.parentId,
      value.fieldDefId,
      value.fieldName,
      value.valueNodeId,
      value.valueText,
      value.valueOrder,
      created
    );
  }
}

/**
 * Get all unique field names from the database
 */
export function getFieldNames(db: Database): Array<{ fieldName: string; count: number }> {
  return db
    .query(`
      SELECT field_name as fieldName, COUNT(*) as count
      FROM field_values
      GROUP BY field_name
      ORDER BY count DESC
    `)
    .all() as Array<{ fieldName: string; count: number }>;
}

/**
 * Get field values by field name with optional filters
 */
export function getFieldValuesByName(
  db: Database,
  fieldName: string,
  options: {
    limit?: number;
    offset?: number;
    createdAfter?: number;
    createdBefore?: number;
  } = {}
): Array<{
  parentId: string;
  valueText: string;
  valueOrder: number;
  created: number | null;
}> {
  const { limit = 100, offset = 0, createdAfter, createdBefore } = options;

  let sql = `
    SELECT parent_id as parentId, value_text as valueText, value_order as valueOrder, created
    FROM field_values
    WHERE field_name = ?
  `;
  const params: SQLQueryBindings[] = [fieldName];

  if (createdAfter !== undefined) {
    sql += " AND created >= ?";
    params.push(createdAfter);
  }

  if (createdBefore !== undefined) {
    sql += " AND created <= ?";
    params.push(createdBefore);
  }

  sql += " ORDER BY created DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  return db.query(sql).all(...params) as Array<{
    parentId: string;
    valueText: string;
    valueOrder: number;
    created: number | null;
  }>;
}

/**
 * Full-text search in field values
 */
export function searchFieldValues(
  db: Database,
  query: string,
  options: {
    fieldName?: string;
    limit?: number;
  } = {}
): Array<{
  fieldName: string;
  valueText: string;
  parentId: string;
}> {
  const { fieldName, limit = 50 } = options;

  let sql = `
    SELECT fv.field_name as fieldName, fv.value_text as valueText, fv.parent_id as parentId
    FROM field_values_fts fts
    JOIN field_values fv ON fts.rowid = fv.id
    WHERE field_values_fts MATCH ?
  `;
  const params: SQLQueryBindings[] = [query];

  if (fieldName) {
    sql += " AND fv.field_name = ?";
    params.push(fieldName);
  }

  sql += " LIMIT ?";
  params.push(limit);

  return db.query(sql).all(...params) as Array<{
    fieldName: string;
    valueText: string;
    parentId: string;
  }>;
}
