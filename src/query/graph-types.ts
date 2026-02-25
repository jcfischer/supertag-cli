/**
 * Graph Query DSL Types
 * F-102: Graph Query DSL
 *
 * Type definitions for the graph-aware query language AST.
 * Reuses WhereClause/WhereGroup from Spec 063 for condition syntax.
 */

import type { WhereClause, WhereGroup } from "./types";

// =============================================================================
// Graph Query AST
// =============================================================================

/**
 * A single CONNECTED TO clause in the graph query
 */
export interface ConnectedClause {
  /** Target supertag name */
  toTag: string;
  /** Optional field name for VIA (typed edge traversal) */
  viaField?: string;
  /** Filters on the connected type */
  where?: (WhereClause | WhereGroup)[];
}

/**
 * Projection field in the RETURN clause
 *
 * Supports:
 * - Simple fields: `name`, `Status`
 * - Dot notation: `person.name` (cross-type reference)
 * - Aggregates: `COUNT(meeting) AS meeting_count`
 * - Wildcard: `*` (all fields)
 */
export interface ProjectionField {
  /** Type alias for dot notation (e.g., "person" in "person.name") */
  typeAlias?: string;
  /** Field name (e.g., "name") */
  fieldName: string;
  /** AS alias for aggregations */
  alias?: string;
  /** Aggregate function */
  aggregateFn?: "COUNT" | "SUM" | "AVG";
}

/**
 * Top-level Graph Query AST
 *
 * Represents a parsed graph query:
 *   FIND <supertag>
 *     [WHERE <conditions>]*
 *     [CONNECTED TO <supertag> [VIA <field>]]*
 *     [DEPTH <n>]
 *     RETURN <projection>
 */
export interface GraphQueryAST {
  /** Primary supertag to find (FIND clause) */
  find: string;
  /** Filter conditions on the primary type */
  where?: (WhereClause | WhereGroup)[];
  /** CONNECTED TO chain (ordered) */
  connected: ConnectedClause[];
  /** Maximum traversal depth per hop (default: 1) */
  depth?: number;
  /** RETURN clause projection fields (required) */
  return: ProjectionField[];
  /** Maximum results (default: 100) */
  limit?: number;
}

// =============================================================================
// Query Plan (Runtime execution plan)
// =============================================================================

/** Find nodes by supertag with optional filters */
export interface FindByTagStep {
  type: "find_by_tag";
  tag: string;
  filters: (WhereClause | WhereGroup)[];
  resultSet: string;
}

/** Traverse from one result set to another via relationship */
export interface TraverseStep {
  type: "traverse";
  fromSet: string;
  toTag: string;
  viaField?: string;
  resultSet: string;
}

/** Filter an existing result set */
export interface FilterStep {
  type: "filter";
  resultSet: string;
  conditions: (WhereClause | WhereGroup)[];
}

/** Project specific fields from the final result set */
export interface ProjectStep {
  type: "project";
  fields: ProjectionField[];
}

/** Discriminated union of query execution steps */
export type QueryStep = FindByTagStep | TraverseStep | FilterStep | ProjectStep;

/**
 * Execution plan produced by the query planner
 */
export interface QueryPlan {
  /** Ordered sequence of execution steps */
  steps: QueryStep[];
  /** Number of traversal hops */
  estimatedHops: number;
}

// =============================================================================
// Query Result
// =============================================================================

/**
 * Result of executing a graph query
 */
export interface GraphQueryResult {
  /** Result rows (one per matched node/combination) */
  rows: Record<string, unknown>[];
  /** Column names derived from RETURN clause */
  columns: string[];
  /** Number of rows returned */
  count: number;
  /** Whether more results exist beyond the limit */
  hasMore: boolean;
  /** Formatted execution plan (when --explain is used) */
  executionPlan?: string;
  /** Query execution time in milliseconds */
  queryTimeMs?: number;
}
