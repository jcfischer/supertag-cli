/**
 * AggregationService
 * Spec 064: Aggregation Queries
 *
 * Provides grouping and counting capabilities for Tana nodes.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import type {
  AggregateAST,
  AggregateResult,
  GroupBySpec,
  TimePeriod,
} from "../query/types";
import { isTimePeriod, isGroupByField, isGroupByTime } from "../query/types";

/**
 * Service for executing aggregation queries on Tana nodes.
 *
 * Example usage:
 * ```ts
 * const service = new AggregationService(dbPath);
 * const result = service.aggregate({
 *   find: "task",
 *   groupBy: [{ field: "Status" }],
 *   aggregate: [{ fn: "count" }],
 * });
 * // { total: 100, groupCount: 3, groups: { Done: 50, "In Progress": 30, Open: 20 } }
 * ```
 */
export class AggregationService {
  private db: Database;

  constructor(private dbPath: string) {
    this.db = new Database(dbPath);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Count total nodes with a given tag (no grouping)
   *
   * @param tag - Tag name to count
   * @returns AggregateResult with total count and empty groups
   */
  countOnly(tag: string): AggregateResult {
    const sql = `
      SELECT COUNT(DISTINCT n.id) as total
      FROM nodes n
      INNER JOIN tag_applications ta ON ta.data_node_id = n.id
      WHERE ta.tag_name = ?
    `;

    const row = this.db.query(sql).get(tag) as { total: number } | null;
    const total = row?.total ?? 0;

    return {
      total,
      groupCount: 0,
      groups: {},
    };
  }

  /**
   * Parse group-by specification from CLI string
   *
   * @param groupBy - Comma-separated string (e.g., "Status,month")
   * @returns Array of GroupBySpec objects
   *
   * Examples:
   * - "Status" → [{ field: "Status" }]
   * - "month" → [{ period: "month" }]
   * - "Status,month" → [{ field: "Status" }, { period: "month" }]
   */
  parseGroupBy(groupBy: string): GroupBySpec[] {
    if (!groupBy.trim()) {
      return [];
    }

    const parts = groupBy.split(",").map((s) => s.trim());
    const result: GroupBySpec[] = [];

    for (const part of parts) {
      if (isTimePeriod(part)) {
        result.push({ period: part as TimePeriod });
      } else {
        result.push({ field: part });
      }
    }

    return result;
  }

  /**
   * Generate SQLite strftime expression for time-based grouping
   *
   * @param period - Time period (day, week, month, quarter, year)
   * @param field - Date field to use (e.g., "created", "updated", "n.created")
   * @returns SQL expression for GROUP BY
   */
  formatTimePeriod(
    period: TimePeriod,
    field: string = "created"
  ): string {
    // SQLite timestamps are in milliseconds, divide by 1000 for unixepoch
    const baseExpr = `${field}/1000, 'unixepoch'`;

    switch (period) {
      case "day":
        return `strftime('%Y-%m-%d', ${baseExpr})`;
      case "week":
        // ISO week format: YYYY-WNN
        return `strftime('%Y-W%W', ${baseExpr})`;
      case "month":
        return `strftime('%Y-%m', ${baseExpr})`;
      case "quarter":
        // Quarter requires calculation: (month-1)/3 + 1 gives Q1-Q4
        return `strftime('%Y', ${baseExpr}) || '-Q' || ((CAST(strftime('%m', ${baseExpr}) AS INTEGER) - 1) / 3 + 1)`;
      case "year":
        return `strftime('%Y', ${baseExpr})`;
    }
  }

  /**
   * Execute aggregation query
   *
   * @param ast - Parsed aggregation query AST
   * @returns Aggregation result with grouped counts
   */
  aggregate(ast: AggregateAST): AggregateResult {
    // Validate we have at least one groupBy
    if (!ast.groupBy || ast.groupBy.length === 0) {
      throw new Error("Aggregation requires at least one groupBy field");
    }

    // Handle two-field nested aggregation separately
    if (ast.groupBy.length >= 2) {
      return this.aggregateTwoFields(ast);
    }

    const params: SQLQueryBindings[] = [];
    const joins: string[] = [];

    // Build group-by expressions for the first dimension only (single-field)
    const spec = ast.groupBy[0];
    const { expr, alias, join: specJoin } = this.buildGroupByExpr(spec, 0);
    if (specJoin) {
      joins.push(specJoin);
    }

    // Base query: count nodes, grouped by expression
    let sql = `
      SELECT
        COALESCE(${expr}, '(none)') AS ${alias},
        COUNT(DISTINCT n.id) AS count
      FROM nodes n
    `;

    // Join with tag_applications if filtering by tag
    if (ast.find !== "*") {
      joins.push("INNER JOIN tag_applications ta ON ta.data_node_id = n.id");
    }

    // Add all joins
    if (joins.length > 0) {
      sql += " " + joins.join(" ");
    }

    // WHERE clause for tag filter
    if (ast.find !== "*") {
      sql += " WHERE ta.tag_name = ?";
      params.push(ast.find);
    }

    // GROUP BY
    sql += ` GROUP BY COALESCE(${expr}, '(none)')`;

    // ORDER BY count DESC (default sort by count)
    sql += " ORDER BY count DESC";

    // Apply top or limit
    const effectiveLimit = ast.top ?? ast.limit ?? 100;
    sql += " LIMIT ?";
    params.push(effectiveLimit + 1); // Fetch one extra to detect if capped

    // Execute query
    const rows = this.db.query(sql).all(...params) as Array<{
      [key: string]: string | number;
    }>;

    // Check if results were capped
    const wasCapped = rows.length > effectiveLimit;
    const cappedRows = wasCapped ? rows.slice(0, effectiveLimit) : rows;

    // Build groups from results
    const groups: Record<string, number> = {};
    for (const row of cappedRows) {
      const key = String(row[alias]);
      groups[key] = Number(row.count);
    }

    // Calculate total (separate query for accuracy)
    const totalSql = ast.find === "*"
      ? "SELECT COUNT(*) AS total FROM nodes"
      : "SELECT COUNT(DISTINCT n.id) AS total FROM nodes n INNER JOIN tag_applications ta ON ta.data_node_id = n.id WHERE ta.tag_name = ?";
    const totalParams: SQLQueryBindings[] = ast.find === "*" ? [] : [ast.find];
    const totalRow = this.db.query(totalSql).get(...totalParams) as { total: number };
    const total = totalRow?.total ?? 0;

    // Calculate percentages if requested
    let percentages: Record<string, number> | undefined;
    if (ast.showPercent && total > 0) {
      percentages = {};
      for (const [key, count] of Object.entries(groups)) {
        percentages[key] = Math.round((count / total) * 100);
      }
    }

    // Build result
    const result: AggregateResult = {
      total,
      groupCount: Object.keys(groups).length,
      groups,
    };

    if (percentages) {
      result.percentages = percentages;
    }

    if (wasCapped) {
      result.warning = `Results capped at ${effectiveLimit} groups`;
    }

    return result;
  }

  /**
   * Execute two-field nested aggregation
   * Returns nested structure like: { "Done": { "High": 10, "Low": 5 }, ... }
   */
  private aggregateTwoFields(ast: AggregateAST): AggregateResult {
    const params: SQLQueryBindings[] = [];
    const joins: string[] = [];

    // Build group-by expressions for both dimensions
    const spec1 = ast.groupBy[0];
    const spec2 = ast.groupBy[1];
    const { expr: expr1, alias: alias1, join: join1 } = this.buildGroupByExpr(spec1, 0);
    const { expr: expr2, alias: alias2, join: join2 } = this.buildGroupByExpr(spec2, 1);

    if (join1) joins.push(join1);
    if (join2) joins.push(join2);

    // Base query with two GROUP BY dimensions
    let sql = `
      SELECT
        COALESCE(${expr1}, '(none)') AS ${alias1},
        COALESCE(${expr2}, '(none)') AS ${alias2},
        COUNT(DISTINCT n.id) AS count
      FROM nodes n
    `;

    // Join with tag_applications if filtering by tag
    if (ast.find !== "*") {
      joins.push("INNER JOIN tag_applications ta ON ta.data_node_id = n.id");
    }

    // Add all joins
    if (joins.length > 0) {
      sql += " " + joins.join(" ");
    }

    // WHERE clause for tag filter
    if (ast.find !== "*") {
      sql += " WHERE ta.tag_name = ?";
      params.push(ast.find);
    }

    // GROUP BY both dimensions
    sql += ` GROUP BY COALESCE(${expr1}, '(none)'), COALESCE(${expr2}, '(none)')`;

    // ORDER BY first dimension, then count DESC
    sql += ` ORDER BY ${alias1}, count DESC`;

    // Execute query
    const rows = this.db.query(sql).all(...params) as Array<{
      [key: string]: string | number;
    }>;

    // Build nested groups structure
    const groups: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const key1 = String(row[alias1]);
      const key2 = String(row[alias2]);
      const count = Number(row.count);

      if (!groups[key1]) {
        groups[key1] = {};
      }
      groups[key1][key2] = count;
    }

    // Calculate total (separate query for accuracy)
    const totalSql = ast.find === "*"
      ? "SELECT COUNT(*) AS total FROM nodes"
      : "SELECT COUNT(DISTINCT n.id) AS total FROM nodes n INNER JOIN tag_applications ta ON ta.data_node_id = n.id WHERE ta.tag_name = ?";
    const totalParams: SQLQueryBindings[] = ast.find === "*" ? [] : [ast.find];
    const totalRow = this.db.query(totalSql).get(...totalParams) as { total: number };
    const total = totalRow?.total ?? 0;

    return {
      total,
      groupCount: Object.keys(groups).length,
      groups,
    };
  }

  /**
   * Build SQL expression for a single groupBy spec
   */
  private buildGroupByExpr(
    spec: GroupBySpec,
    index: number
  ): { expr: string; alias: string; join?: string } {
    const alias = `group${index}`;

    if (isGroupByTime(spec)) {
      // Time-based grouping on created/updated field
      const dateField = spec.dateField ?? "created";
      const expr = this.formatTimePeriod(spec.period!, `n.${dateField}`);
      return { expr, alias };
    }

    if (isGroupByField(spec)) {
      // Field-based grouping requires LEFT JOIN to field_values
      const fieldName = spec.field!;
      const joinAlias = `fv${index}`;
      const join = `LEFT JOIN field_values ${joinAlias} ON ${joinAlias}.parent_id = n.id AND ${joinAlias}.field_name = ?`;
      // Note: We'll need to add the field name to params in the caller
      // For now, inline it (since SQLite allows expressions in GROUP BY)
      const joinWithParam = `LEFT JOIN field_values ${joinAlias} ON ${joinAlias}.parent_id = n.id AND ${joinAlias}.field_name = '${fieldName.replace(/'/g, "''")}'`;
      const expr = `${joinAlias}.value_text`;
      return { expr, alias, join: joinWithParam };
    }

    // Fallback: treat as field name
    const fieldName = spec.field ?? "unknown";
    const joinAlias = `fv${index}`;
    const joinWithParam = `LEFT JOIN field_values ${joinAlias} ON ${joinAlias}.parent_id = n.id AND ${joinAlias}.field_name = '${fieldName.replace(/'/g, "''")}'`;
    const expr = `${joinAlias}.value_text`;
    return { expr, alias, join: joinWithParam };
  }
}
