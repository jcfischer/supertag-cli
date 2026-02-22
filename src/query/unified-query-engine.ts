/**
 * Unified Query Engine
 * Spec 063: Unified Query Language
 *
 * Executes QueryAST against SQLite database.
 * Supports tag filtering, field filtering, date ranges, FTS, and parent joins.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { QueryAST, WhereClause, WhereGroup, QueryOperator } from "./types";
import { isWhereGroup } from "./types";
import { parseDateValue, isRelativeDateValue } from "./date-resolver";
import { buildPagination, buildOrderBy } from "../db/query-builder";
import { FieldResolver } from "../services/field-resolver";

/**
 * Query execution result
 */
export interface QueryResult {
  results: Record<string, unknown>[];
  count: number;
  hasMore: boolean;
  /** Field names included in output (when select clause used) */
  fieldNames?: string[];
}

/**
 * Validation error
 */
export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryValidationError";
  }
}

/**
 * Unified Query Engine
 *
 * Executes parsed queries against the SQLite database.
 */
export class UnifiedQueryEngine {
  constructor(private db: Database) {}

  /**
   * Execute a query AST and return results
   */
  async execute(ast: QueryAST): Promise<QueryResult> {
    // Validate query
    this.validate(ast);

    // Resolve relative dates in where clauses
    const resolvedAst = this.resolveDates(ast);

    // Build and execute SQL
    const { sql, params } = this.buildQuery(resolvedAst);
    const results = this.db.query(sql).all(...params) as Record<string, unknown>[];

    // Calculate hasMore
    const limit = ast.limit ?? 100;
    const hasMore = results.length === limit;

    // Handle field output if select clause is present
    if (ast.select && ast.select.length > 0) {
      return this.executeWithFields(ast, results, hasMore);
    }

    // Auto-hydrate fields when querying a specific tag (not wildcard)
    // This ensures tana_query results always include field values
    if (ast.find !== "*" && results.length > 0) {
      return this.executeWithFields(
        { ...ast, select: ["*"] },
        results,
        hasMore
      );
    }

    // Wildcard query without select - return core fields only
    return {
      results,
      count: results.length,
      hasMore,
    };
  }

  /**
   * Execute query with field value resolution
   */
  private executeWithFields(
    ast: QueryAST,
    results: Record<string, unknown>[],
    hasMore: boolean
  ): QueryResult {
    const fieldResolver = new FieldResolver(this.db);

    // Determine which fields to include
    let fieldNames: string[];
    if (ast.select!.includes("*")) {
      // Get all fields for this supertag, fall back to wildcard if metadata unavailable
      try {
        fieldNames = fieldResolver.getSupertagFields(ast.find);
      } catch {
        fieldNames = [];
      }
    } else {
      fieldNames = ast.select!;
    }

    // Get node IDs
    const nodeIds = results.map((r) => r.id as string);

    // Resolve field values — use wildcard if no specific fields determined
    const resolveTarget = fieldNames.length > 0 ? fieldNames : ("*" as const);
    const fieldValuesMap = fieldResolver.resolveFields(nodeIds, resolveTarget);

    // Collect actual field names from resolved values
    if (fieldNames.length === 0) {
      const allFields = new Set<string>();
      for (const fields of fieldValuesMap.values()) {
        for (const key of Object.keys(fields)) {
          allFields.add(key);
        }
      }
      fieldNames = [...allFields];
    }

    // Merge field values into results
    const resultsWithFields = results.map((r) => {
      const nodeId = r.id as string;
      const fields = fieldValuesMap.get(nodeId) ?? {};
      return {
        ...r,
        fields,
      };
    });

    return {
      results: resultsWithFields,
      count: resultsWithFields.length,
      hasMore,
      fieldNames,
    };
  }

  /**
   * Validate query AST
   */
  private validate(ast: QueryAST): void {
    if (!ast.find) {
      throw new QueryValidationError("Query must specify 'find' target");
    }

    if (ast.limit !== undefined && ast.limit < 1) {
      throw new QueryValidationError("Limit must be positive");
    }

    if (ast.offset !== undefined && ast.offset < 0) {
      throw new QueryValidationError("Offset must be non-negative");
    }
  }

  /**
   * Resolve relative dates in where clauses
   */
  private resolveDates(ast: QueryAST): QueryAST {
    if (!ast.where) return ast;

    const resolvedWhere = ast.where.map((clause) => {
      if (isWhereGroup(clause)) {
        return {
          ...clause,
          clauses: clause.clauses.map((c) => this.resolveClauseDates(c as WhereClause)),
        };
      }
      return this.resolveClauseDates(clause);
    });

    return { ...ast, where: resolvedWhere };
  }

  /**
   * Resolve dates in a single clause
   */
  private resolveClauseDates(clause: WhereClause): WhereClause {
    if (typeof clause.value !== "string") {
      return clause;
    }

    // Always parse dates for date fields (created, updated, doneAt)
    const dateFields = ["created", "updated", "doneAt"];
    const isDateField = dateFields.includes(clause.field);

    if (isRelativeDateValue(clause.value) || isDateField) {
      return {
        ...clause,
        value: parseDateValue(clause.value),
      };
    }
    return clause;
  }

  /**
   * Build SQL query from AST
   */
  private buildQuery(ast: QueryAST): { sql: string; params: SQLQueryBindings[] } {
    const params: SQLQueryBindings[] = [];
    const joins: string[] = [];
    const conditions: string[] = [];

    // Base SELECT
    let selectClause = `
      SELECT DISTINCT
        n.id,
        n.name,
        n.parent_id as parentId,
        n.node_type as nodeType,
        n.created,
        n.updated,
        n.done_at as doneAt
    `;

    // FROM clause
    let fromClause = "FROM nodes n";

    // Join with tag_applications if we're finding a specific tag
    if (ast.find !== "*") {
      joins.push("INNER JOIN tag_applications ta ON ta.data_node_id = n.id");
      conditions.push("ta.tag_name = ?");
      params.push(ast.find);
    }

    // Process where clauses
    if (ast.where) {
      for (const clause of ast.where) {
        const { sql: condSql, params: condParams, join } = this.buildWhereCondition(clause);
        if (condSql) {
          conditions.push(condSql);
          params.push(...condParams);
        }
        if (join && !joins.includes(join)) {
          joins.push(join);
        }
      }
    }

    // Combine query parts
    const sqlParts = [selectClause, fromClause, ...joins];

    if (conditions.length > 0) {
      sqlParts.push("WHERE " + conditions.join(" AND "));
    }

    // ORDER BY
    if (ast.orderBy) {
      const column = this.mapSortField(ast.orderBy.field);
      const direction = ast.orderBy.desc ? "DESC" : "ASC";
      sqlParts.push(`ORDER BY ${column} ${direction}`);
    } else {
      sqlParts.push("ORDER BY n.created DESC");
    }

    // LIMIT/OFFSET
    const limit = ast.limit ?? 100;
    const pagination = buildPagination({ limit, offset: ast.offset });
    if (pagination.sql) {
      sqlParts.push(pagination.sql);
      params.push(...(pagination.params as SQLQueryBindings[]));
    }

    return { sql: sqlParts.join(" "), params };
  }

  /**
   * Build SQL condition from where clause or group
   */
  private buildWhereCondition(
    clause: WhereClause | WhereGroup
  ): { sql: string; params: SQLQueryBindings[]; join?: string } {
    if (isWhereGroup(clause)) {
      return this.buildGroupCondition(clause);
    }
    return this.buildClauseCondition(clause);
  }

  /**
   * Build condition for WhereGroup (OR)
   */
  private buildGroupCondition(group: WhereGroup): {
    sql: string;
    params: SQLQueryBindings[];
    join?: string;
  } {
    const parts: string[] = [];
    const params: SQLQueryBindings[] = [];
    let join: string | undefined;

    for (const clause of group.clauses) {
      const result = this.buildClauseCondition(clause as WhereClause);
      if (result.sql) {
        parts.push(result.sql);
        params.push(...result.params);
      }
      if (result.join) {
        join = result.join;
      }
    }

    const operator = group.type === "or" ? " OR " : " AND ";
    return {
      sql: `(${parts.join(operator)})`,
      params,
      join,
    };
  }

  /**
   * Build condition for single WhereClause
   */
  private buildClauseCondition(clause: WhereClause): {
    sql: string;
    params: SQLQueryBindings[];
    join?: string;
  } {
    const { field, operator, value, negated } = clause;
    const params: SQLQueryBindings[] = [];
    let join: string | undefined;

    // Handle special field paths
    if (field.startsWith("parent.")) {
      return this.buildParentCondition(clause);
    }

    if (field.startsWith("fields.") || this.isFieldName(field)) {
      return this.buildFieldCondition(clause);
    }

    // Handle core node fields
    const column = this.mapNodeField(field);
    let sql: string;

    switch (operator) {
      case "=":
        sql = `${column} = ?`;
        params.push(value as SQLQueryBindings);
        break;
      case "!=":
        sql = `${column} != ?`;
        params.push(value as SQLQueryBindings);
        break;
      case ">":
        sql = `${column} > ?`;
        params.push(value as SQLQueryBindings);
        break;
      case "<":
        sql = `${column} < ?`;
        params.push(value as SQLQueryBindings);
        break;
      case ">=":
        sql = `${column} >= ?`;
        params.push(value as SQLQueryBindings);
        break;
      case "<=":
        sql = `${column} <= ?`;
        params.push(value as SQLQueryBindings);
        break;
      case "~":
      case "contains":
        sql = `${column} LIKE ?`;
        params.push(`%${value}%`);
        break;
      case "exists":
        sql = value ? `${column} IS NOT NULL` : `${column} IS NULL`;
        break;
      case "is_empty":
        // For core fields, check if NULL or empty string
        sql = `(${column} IS NULL OR ${column} = '')`;
        break;
      default:
        throw new QueryValidationError(`Unknown operator: ${operator}`);
    }

    if (negated) {
      sql = `NOT (${sql})`;
    }

    return { sql, params, join };
  }

  /**
   * Build condition for parent.* fields
   */
  private buildParentCondition(clause: WhereClause): {
    sql: string;
    params: SQLQueryBindings[];
    join?: string;
  } {
    const { field, operator, value } = clause;
    const parentField = field.replace("parent.", "");
    const params: SQLQueryBindings[] = [];

    if (parentField === "tags") {
      // Join parent with its tags
      const join = `
        LEFT JOIN nodes parent ON parent.id = n.parent_id
        LEFT JOIN tag_applications parent_ta ON parent_ta.data_node_id = parent.id
      `;

      let sql: string;
      if (operator === "~" || operator === "contains") {
        sql = "parent_ta.tag_name LIKE ?";
        params.push(`%${value}%`);
      } else {
        sql = "parent_ta.tag_name = ?";
        params.push(value as SQLQueryBindings);
      }

      return { sql, params, join };
    }

    if (parentField === "name") {
      const join = "LEFT JOIN nodes parent ON parent.id = n.parent_id";
      let sql: string;

      if (operator === "~" || operator === "contains") {
        sql = "parent.name LIKE ?";
        params.push(`%${value}%`);
      } else {
        sql = "parent.name = ?";
        params.push(value as SQLQueryBindings);
      }

      return { sql, params, join };
    }

    throw new QueryValidationError(`Unknown parent field: ${parentField}`);
  }

  /**
   * Build condition for field values
   */
  private buildFieldCondition(clause: WhereClause): {
    sql: string;
    params: SQLQueryBindings[];
    join?: string;
  } {
    const { field, operator, value } = clause;
    const fieldName = field.startsWith("fields.") ? field.replace("fields.", "") : field;
    const params: SQLQueryBindings[] = [];

    const join = "LEFT JOIN field_values fv ON fv.parent_id = n.id";

    let sql = "fv.field_name = ?";
    params.push(fieldName);

    switch (operator) {
      case "=":
        // Case-insensitive match, handling HTML-wrapped values (e.g., <span>DONE</span>)
        // Match plain text OR text between HTML tags
        sql += " AND (fv.value_text = ? COLLATE NOCASE OR fv.value_text LIKE '%>' || ? || '<%' COLLATE NOCASE)";
        params.push(String(value), String(value));
        break;
      case "!=":
        // Case-insensitive not-equal, handling HTML-wrapped values
        sql += " AND fv.value_text != ? COLLATE NOCASE AND fv.value_text NOT LIKE '%>' || ? || '<%' COLLATE NOCASE";
        params.push(String(value), String(value));
        break;
      case "~":
      case "contains":
        // Contains match is already substring-based, just add COLLATE NOCASE
        sql += " AND fv.value_text LIKE ? COLLATE NOCASE";
        params.push(`%${value}%`);
        break;
      case ">":
      case "<":
      case ">=":
      case "<=":
        // For numeric comparison, try to cast
        sql += ` AND CAST(fv.value_text AS REAL) ${operator} ?`;
        params.push(value as SQLQueryBindings);
        break;
      case "exists":
        if (!value) {
          sql = "NOT EXISTS (SELECT 1 FROM field_values fv2 WHERE fv2.parent_id = n.id AND fv2.field_name = ?)";
          return { sql, params: [fieldName], join: undefined };
        }
        break;
      case "is_empty":
        // Match if field doesn't exist OR value is NULL/empty
        // Use NOT EXISTS with condition for non-empty values
        sql = "NOT EXISTS (SELECT 1 FROM field_values fv2 WHERE fv2.parent_id = n.id AND fv2.field_name = ? AND fv2.value_text IS NOT NULL AND fv2.value_text != '')";
        if (clause.negated) {
          // Negated: field exists AND has non-empty value
          sql = "EXISTS (SELECT 1 FROM field_values fv2 WHERE fv2.parent_id = n.id AND fv2.field_name = ? AND fv2.value_text IS NOT NULL AND fv2.value_text != '')";
        }
        return { sql, params: [fieldName], join: undefined };
    }

    return { sql: `(${sql})`, params, join };
  }

  /**
   * Check if a field name looks like a custom field (not a node property)
   */
  private isFieldName(field: string): boolean {
    const nodeFields = ["id", "name", "created", "updated", "parentId", "nodeType", "doneAt"];
    return !nodeFields.includes(field) && !field.startsWith("parent.");
  }

  /**
   * Map field name to SQL column
   */
  private mapNodeField(field: string): string {
    const mapping: Record<string, string> = {
      id: "n.id",
      name: "n.name",
      created: "n.created",
      updated: "n.updated",
      parentId: "n.parent_id",
      nodeType: "n.node_type",
      doneAt: "n.done_at",
    };
    return mapping[field] ?? `n.${field}`;
  }

  /**
   * Map sort field to SQL column
   */
  private mapSortField(field: string): string {
    if (field.startsWith("fields.")) {
      // Sorting by field value would require a subquery
      return "n.created";
    }
    return this.mapNodeField(field);
  }

  /**
   * Project selected fields from result
   */
  private projectFields(
    result: Record<string, unknown>,
    select: string[]
  ): Record<string, unknown> {
    const projected: Record<string, unknown> = {};
    for (const field of select) {
      if (field in result) {
        projected[field] = result[field];
      }
    }
    return projected;
  }
}
