/**
 * Context Builder Module (T-7.1)
 *
 * Builds embedding text with field values included.
 * Extends contextualized text by appending field values in format:
 * [FieldName]: value
 *
 * This improves embedding quality by including structured field data
 * that provides additional semantic context for the node.
 */

import { Database } from "bun:sqlite";

/**
 * Field value for context building
 */
export interface FieldValueForContext {
  fieldName: string;
  valueText: string;
}

/**
 * Node with context text to be enriched
 */
export interface NodeWithContext {
  nodeId: string;
  contextText: string;
}

/**
 * Get field values for a specific node from the database
 *
 * @param db - Database connection
 * @param nodeId - Node ID to get field values for
 * @returns Array of field values for the node
 */
export function getFieldValuesForNode(
  db: Database,
  nodeId: string
): FieldValueForContext[] {
  const result = db
    .query(
      `
      SELECT field_name as fieldName, value_text as valueText
      FROM field_values
      WHERE parent_id = ?
      ORDER BY field_name, value_order
    `
    )
    .all(nodeId) as FieldValueForContext[];

  return result;
}

/**
 * Build field context string from field values
 *
 * Format: [FieldName]: value
 * Multiple values on separate lines
 *
 * @param fields - Array of field values
 * @returns Formatted field context string
 */
export function buildFieldContext(fields: FieldValueForContext[]): string {
  if (fields.length === 0) {
    return "";
  }

  return fields
    .map((f) => `[${f.fieldName}]: ${f.valueText}`)
    .join("\n");
}

/**
 * Enrich context text with field values for a single node
 *
 * @param db - Database connection
 * @param nodeId - Node ID to enrich
 * @param contextText - Existing context text
 * @returns Enriched context text with field values appended
 */
export function enrichContextWithFields(
  db: Database,
  nodeId: string,
  contextText: string
): string {
  const fields = getFieldValuesForNode(db, nodeId);

  if (fields.length === 0) {
    return contextText;
  }

  const fieldContext = buildFieldContext(fields);

  if (!contextText || contextText.trim() === "") {
    return fieldContext;
  }

  return `${contextText}\n${fieldContext}`;
}

/**
 * Batch enrich nodes with field values
 *
 * Efficiently enriches multiple nodes by querying field values
 * for all nodes in a single batch.
 *
 * @param db - Database connection
 * @param nodes - Array of nodes with context text
 * @returns Array of nodes with enriched context text
 */
export function batchEnrichWithFields(
  db: Database,
  nodes: NodeWithContext[]
): NodeWithContext[] {
  if (nodes.length === 0) {
    return [];
  }

  // SQLite has a variable limit (SQLITE_MAX_VARIABLE_NUMBER).
  // Chunk node IDs to stay well under the limit.
  const CHUNK_SIZE = 900;
  const nodeIds = nodes.map((n) => n.nodeId);

  // Group by parent ID across all chunks
  const fieldsByNode = new Map<string, FieldValueForContext[]>();

  for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
    const chunk = nodeIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");

    const chunkFields = db
      .query(
        `
        SELECT parent_id as parentId, field_name as fieldName, value_text as valueText
        FROM field_values
        WHERE parent_id IN (${placeholders})
        ORDER BY parent_id, field_name, value_order
      `
      )
      .all(...chunk) as Array<{
      parentId: string;
      fieldName: string;
      valueText: string;
    }>;

    for (const field of chunkFields) {
      const existing = fieldsByNode.get(field.parentId) || [];
      existing.push({
        fieldName: field.fieldName,
        valueText: field.valueText,
      });
      fieldsByNode.set(field.parentId, existing);
    }
  }

  // Enrich each node
  return nodes.map((node) => {
    const fields = fieldsByNode.get(node.nodeId) || [];

    if (fields.length === 0) {
      return node;
    }

    const fieldContext = buildFieldContext(fields);
    const enrichedText =
      !node.contextText || node.contextText.trim() === ""
        ? fieldContext
        : `${node.contextText}\n${fieldContext}`;

    return {
      nodeId: node.nodeId,
      contextText: enrichedText,
    };
  });
}
