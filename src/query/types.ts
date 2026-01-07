/**
 * Query AST Types
 * Spec 063: Unified Query Language
 *
 * Type definitions for the unified query language AST (Abstract Syntax Tree).
 * These types represent parsed queries from both CLI strings and MCP structured input.
 */

/**
 * Relative date values for time-based queries
 * - Keywords: today, yesterday
 * - Duration notation: Nd, Nw, Nm, Ny (days, weeks, months, years)
 */
export type RelativeDate =
  | "today"
  | "yesterday"
  | `${number}d`
  | `${number}w`
  | `${number}m`
  | `${number}y`;

/**
 * Supported comparison operators in where clauses
 */
export type QueryOperator =
  | "="       // Exact match
  | "!="      // Not equal
  | ">"       // Greater than
  | "<"       // Less than
  | ">="      // Greater than or equal
  | "<="      // Less than or equal
  | "~"       // Contains (substring/array)
  | "contains"// Alias for ~
  | "exists"; // Field has value

/**
 * Value types in query conditions
 * - string: Literal text value
 * - number: Numeric value
 * - boolean: For exists operator
 * - RelativeDate: Relative date notation
 * - Array: For IN-style queries
 */
export type QueryValue =
  | string
  | number
  | boolean
  | RelativeDate
  | QueryValue[];

/**
 * Single filter condition in a where clause
 */
export interface WhereClause {
  /** Field name (e.g., "Status", "created", "parent.tags") */
  field: string;
  /** Comparison operator */
  operator: QueryOperator;
  /** Value to compare against */
  value: QueryValue;
  /** Negate the condition (NOT) */
  negated?: boolean;
}

/**
 * Logical grouping of where clauses (AND/OR)
 * Supports nesting for complex conditions like:
 * `created > 7d and (Status = Done or Status = Active)`
 */
export interface WhereGroup {
  /** Logical operator for this group */
  type: "and" | "or";
  /** Clauses or nested groups in this group */
  clauses: (WhereClause | WhereGroup)[];
}

/**
 * Order by specification
 */
export interface OrderBy {
  /** Field to order by */
  field: string;
  /** Descending order (default: false = ascending) */
  desc: boolean;
}

/**
 * Parsed query representation (Abstract Syntax Tree)
 *
 * Represents a complete query from either:
 * - CLI: `supertag query "find task where Status = Done order by -created limit 20"`
 * - MCP: `tana_query({ find: "task", where: { Status: "Done" }, ... })`
 */
export interface QueryAST {
  /** Supertag to find, or "*" for all nodes */
  find: string;
  /** Filter conditions (can be flat array or nested groups) */
  where?: (WhereClause | WhereGroup)[];
  /** Fields to return (projection) */
  select?: string[];
  /** Sort order */
  orderBy?: OrderBy;
  /** Maximum results (default: 100, max: 1000) */
  limit?: number;
  /** Skip first N results (pagination) */
  offset?: number;
}

/**
 * Type guard to check if a clause is a WhereGroup
 */
export function isWhereGroup(
  clause: WhereClause | WhereGroup
): clause is WhereGroup {
  return "type" in clause && (clause.type === "and" || clause.type === "or");
}

/**
 * Type guard to check if a clause is a WhereClause
 */
export function isWhereClause(
  clause: WhereClause | WhereGroup
): clause is WhereClause {
  return "field" in clause && "operator" in clause;
}

/**
 * Check if a string is a valid relative date
 */
export function isRelativeDate(value: string): value is RelativeDate {
  if (value === "today" || value === "yesterday") {
    return true;
  }
  return /^\d+[dwmy]$/.test(value);
}

// ============================================================================
// Aggregation Types (Spec 064)
// ============================================================================

/**
 * Time periods for date-based grouping
 */
export type TimePeriod = "day" | "week" | "month" | "quarter" | "year";

/**
 * Valid time periods
 */
const VALID_TIME_PERIODS: TimePeriod[] = ["day", "week", "month", "quarter", "year"];

/**
 * Check if a string is a valid time period
 */
export function isTimePeriod(value: string): value is TimePeriod {
  return VALID_TIME_PERIODS.includes(value as TimePeriod);
}

/**
 * Group-by specification for aggregation
 */
export interface GroupBySpec {
  /** Field name to group by (for field-based grouping) */
  field?: string;
  /** Time period for date-based grouping */
  period?: TimePeriod;
  /** Date field to use: 'created' or 'updated' (default: 'created') */
  dateField?: "created" | "updated";
}

/**
 * Check if GroupBySpec is field-based grouping
 */
export function isGroupByField(spec: GroupBySpec): boolean {
  return spec.field !== undefined;
}

/**
 * Check if GroupBySpec is time-based grouping (no field, just period)
 */
export function isGroupByTime(spec: GroupBySpec): boolean {
  return spec.field === undefined && spec.period !== undefined;
}

/**
 * Aggregation function specification
 */
export interface AggregateFunction {
  /** Function name */
  fn: "count" | "sum" | "avg" | "min" | "max";
  /** Field to aggregate (required for sum/avg/min/max) */
  field?: string;
  /** Alias for the result */
  alias?: string;
}

/**
 * Aggregation query AST (extends QueryAST)
 */
export interface AggregateAST extends QueryAST {
  /** Fields to group by */
  groupBy: GroupBySpec[];
  /** Aggregation functions to apply (default: [{ fn: "count" }]) */
  aggregate: AggregateFunction[];
  /** Show percentage of total alongside counts */
  showPercent?: boolean;
  /** Return only top N groups by count */
  top?: number;
}

/**
 * Nested groups type for two-level grouping
 */
export type NestedGroups = Record<string, number>;

/**
 * Aggregation result
 */
export interface AggregateResult {
  /** Total count before grouping */
  total: number;
  /** Number of groups returned */
  groupCount: number;
  /** Grouped results (flat or nested) */
  groups: Record<string, number | NestedGroups>;
  /** Percentages (if showPercent enabled) */
  percentages?: Record<string, number | NestedGroups>;
  /** Warning message (e.g., if groups were capped) */
  warning?: string;
}
