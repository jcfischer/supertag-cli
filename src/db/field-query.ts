/**
 * Field Query Engine
 *
 * Provides query capabilities for field values stored in the database.
 * Supports:
 * - Full-text search (FTS5)
 * - Field name filtering
 * - Date range filtering
 * - Pagination
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";

export interface FieldValueResult {
  tupleId: string;
  parentId: string;
  fieldDefId: string;
  fieldName: string;
  valueNodeId: string;
  valueText: string;
  valueOrder: number;
  created: number | null;
}

export interface FieldNameCount {
  fieldName: string;
  count: number;
}

export interface QueryOptions {
  fieldName?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
  createdAfter?: number;
  createdBefore?: number;
  orderBy?: "created" | "value_text";
  orderDir?: "asc" | "desc";
}

/**
 * T-4.1: Get all available field names with their counts
 * Useful for discovering what fields exist in the database
 */
export function getAvailableFieldNames(db: Database): FieldNameCount[] {
  const results = db
    .query(`
      SELECT field_name as fieldName, COUNT(*) as count
      FROM field_values
      GROUP BY field_name
      ORDER BY count DESC
    `)
    .all() as FieldNameCount[];

  return results;
}

/**
 * T-4.2: Query field values by field name with optional filters
 */
export function queryFieldValuesByFieldName(
  db: Database,
  fieldName: string,
  options: {
    limit?: number;
    offset?: number;
    createdAfter?: number;
    createdBefore?: number;
  } = {}
): FieldValueResult[] {
  const { limit = 100, offset = 0, createdAfter, createdBefore } = options;

  let sql = `
    SELECT
      tuple_id as tupleId,
      parent_id as parentId,
      field_def_id as fieldDefId,
      field_name as fieldName,
      value_node_id as valueNodeId,
      value_text as valueText,
      value_order as valueOrder,
      created
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

  return db.query(sql).all(...params) as FieldValueResult[];
}

/**
 * T-4.3: Full-text search across field values
 * Uses FTS5 for efficient text search
 */
export function queryFieldValuesFTS(
  db: Database,
  query: string,
  options: {
    fieldName?: string;
    limit?: number;
  } = {}
): FieldValueResult[] {
  const { fieldName, limit = 50 } = options;

  // Sanitize query for FTS5 - escape special characters
  const sanitizedQuery = sanitizeFTSQuery(query);

  let sql = `
    SELECT
      fv.tuple_id as tupleId,
      fv.parent_id as parentId,
      fv.field_def_id as fieldDefId,
      fv.field_name as fieldName,
      fv.value_node_id as valueNodeId,
      fv.value_text as valueText,
      fv.value_order as valueOrder,
      fv.created
    FROM field_values_fts fts
    JOIN field_values fv ON fts.rowid = fv.id
    WHERE field_values_fts MATCH ?
  `;
  const params: SQLQueryBindings[] = [sanitizedQuery];

  if (fieldName) {
    sql += " AND fv.field_name = ?";
    params.push(fieldName);
  }

  sql += " LIMIT ?";
  params.push(limit);

  return db.query(sql).all(...params) as FieldValueResult[];
}

/**
 * T-4.4: Generic query with multiple conditions
 */
export function queryFieldValues(
  db: Database,
  options: QueryOptions = {}
): FieldValueResult[] {
  const {
    fieldName,
    searchQuery,
    limit = 100,
    offset = 0,
    createdAfter,
    createdBefore,
    orderBy = "created",
    orderDir = "desc",
  } = options;

  // If there's a search query, use FTS join
  if (searchQuery) {
    const sanitizedQuery = sanitizeFTSQuery(searchQuery);
    let sql = `
      SELECT
        fv.tuple_id as tupleId,
        fv.parent_id as parentId,
        fv.field_def_id as fieldDefId,
        fv.field_name as fieldName,
        fv.value_node_id as valueNodeId,
        fv.value_text as valueText,
        fv.value_order as valueOrder,
        fv.created
      FROM field_values_fts fts
      JOIN field_values fv ON fts.rowid = fv.id
      WHERE field_values_fts MATCH ?
    `;
    const params: SQLQueryBindings[] = [sanitizedQuery];

    if (fieldName) {
      sql += " AND fv.field_name = ?";
      params.push(fieldName);
    }

    if (createdAfter !== undefined) {
      sql += " AND fv.created >= ?";
      params.push(createdAfter);
    }

    if (createdBefore !== undefined) {
      sql += " AND fv.created <= ?";
      params.push(createdBefore);
    }

    sql += ` ORDER BY fv.${orderBy} ${orderDir.toUpperCase()} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return db.query(sql).all(...params) as FieldValueResult[];
  }

  // Without search query, use simple query
  let sql = `
    SELECT
      tuple_id as tupleId,
      parent_id as parentId,
      field_def_id as fieldDefId,
      field_name as fieldName,
      value_node_id as valueNodeId,
      value_text as valueText,
      value_order as valueOrder,
      created
    FROM field_values
    WHERE 1=1
  `;
  const params: SQLQueryBindings[] = [];

  if (fieldName) {
    sql += " AND field_name = ?";
    params.push(fieldName);
  }

  if (createdAfter !== undefined) {
    sql += " AND created >= ?";
    params.push(createdAfter);
  }

  if (createdBefore !== undefined) {
    sql += " AND created <= ?";
    params.push(createdBefore);
  }

  sql += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.query(sql).all(...params) as FieldValueResult[];
}

/**
 * T-4.5: Count field values for a specific field name
 */
export function countFieldValuesByFieldName(
  db: Database,
  fieldName: string
): number {
  const result = db
    .query("SELECT COUNT(*) as count FROM field_values WHERE field_name = ?")
    .get(fieldName) as { count: number } | null;

  return result?.count ?? 0;
}

/**
 * Sanitize query string for FTS5
 * Escapes special characters that have meaning in FTS5 syntax
 */
function sanitizeFTSQuery(query: string): string {
  // FTS5 special characters that need handling
  // Remove quotes and parentheses that might break syntax
  let sanitized = query
    .replace(/"/g, "")
    .replace(/'/g, "")
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .replace(/\*/g, "")
    .replace(/\^/g, "")
    .trim();

  // If empty after sanitization, return wildcard match
  if (!sanitized) {
    return "*";
  }

  return sanitized;
}

// Types are already exported via export interface declarations above
