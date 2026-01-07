/**
 * AggregationService
 * Spec 064: Aggregation Queries
 *
 * Provides grouping and counting capabilities for Tana nodes.
 */

import type {
  AggregateAST,
  AggregateResult,
  GroupBySpec,
  TimePeriod,
} from "../query/types";
import { isTimePeriod } from "../query/types";

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
  constructor(private dbPath: string) {}

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
   * @param field - Date field to use (created or updated)
   * @returns SQL expression for GROUP BY
   */
  formatTimePeriod(
    period: TimePeriod,
    field: "created" | "updated" = "created"
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
  aggregate(_ast: AggregateAST): AggregateResult {
    // TODO: Implement in T-2.4
    return {
      total: 0,
      groupCount: 0,
      groups: {},
    };
  }
}
