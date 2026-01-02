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

/**
 * Query execution result
 */
export interface QueryResult {
  results: Record<string, unknown>[];
  count: number;
  hasMore: boolean;
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

    // Apply projection if select specified
    const projectedResults = ast.select
      ? results.map((r) => this.projectFields(r, ast.select!))
      : results;

    // Calculate hasMore
    const limit = ast.limit ?? 100;
    const hasMore = results.length === limit;

    return {
      results: projectedResults,
      count: projectedResults.length,
      hasMore,
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
    if (typeof clause.value === "string" && isRelativeDateValue(clause.value)) {
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
        sql += " AND fv.value_text = ?";
        params.push(String(value));
        break;
      case "!=":
        sql += " AND fv.value_text != ?";
        params.push(String(value));
        break;
      case "~":
      case "contains":
        sql += " AND fv.value_text LIKE ?";
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
