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
