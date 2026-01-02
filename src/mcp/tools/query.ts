/**
 * tana_query Tool
 * Spec 063: Unified Query Language
 *
 * Unified query tool that combines tag filtering, field filtering,
 * date ranges, and full-text search in a single expressive query.
 */

import { Database } from "bun:sqlite";
import type { QueryInput } from "../schemas";
import { UnifiedQueryEngine, type QueryResult } from "../../query/unified-query-engine";
import type { QueryAST, WhereClause, QueryOperator } from "../../query/types";
import { resolveWorkspaceContext } from "../../config/workspace-resolver";
import { handleMcpError } from "../error-handler";

/**
 * Convert MCP input to QueryAST
 */
function convertInputToAST(input: QueryInput): QueryAST {
  const ast: QueryAST = {
    find: input.find,
    limit: input.limit ?? 100,
    offset: input.offset ?? 0,
  };

  // Convert where conditions
  if (input.where) {
    const clauses: WhereClause[] = [];

    for (const [field, condition] of Object.entries(input.where)) {
      // Shorthand: string/number value means equality
      if (typeof condition === "string" || typeof condition === "number") {
        clauses.push({ field, operator: "=", value: condition });
        continue;
      }

      // Full condition object
      if (condition.eq !== undefined) {
        clauses.push({ field, operator: "=", value: condition.eq });
      }
      if (condition.neq !== undefined) {
        clauses.push({ field, operator: "!=", value: condition.neq });
      }
      if (condition.contains !== undefined) {
        clauses.push({ field, operator: "~", value: condition.contains });
      }
      if (condition.after !== undefined) {
        clauses.push({ field, operator: ">", value: condition.after });
      }
      if (condition.before !== undefined) {
        clauses.push({ field, operator: "<", value: condition.before });
      }
      if (condition.gt !== undefined) {
        clauses.push({ field, operator: ">", value: condition.gt });
      }
      if (condition.gte !== undefined) {
        clauses.push({ field, operator: ">=", value: condition.gte });
      }
      if (condition.lt !== undefined) {
        clauses.push({ field, operator: "<", value: condition.lt });
      }
      if (condition.lte !== undefined) {
        clauses.push({ field, operator: "<=", value: condition.lte });
      }
      if (condition.exists !== undefined) {
        clauses.push({ field, operator: "exists", value: condition.exists });
      }
    }

    if (clauses.length > 0) {
      ast.where = clauses;
    }
  }

  // Convert orderBy (- prefix for descending)
  if (input.orderBy) {
    const desc = input.orderBy.startsWith("-");
    const field = desc ? input.orderBy.substring(1) : input.orderBy;
    ast.orderBy = { field, desc };
  }

  // Convert select
  if (input.select) {
    ast.select = input.select;
  }

  return ast;
}

/**
 * Execute a unified query
 */
export async function query(input: QueryInput): Promise<{
  workspace: string;
  query: QueryAST;
  results: Record<string, unknown>[];
  count: number;
  hasMore: boolean;
}> {
  try {
    // Resolve workspace
    const wsContext = resolveWorkspaceContext({ workspace: input.workspace });

    // Convert input to AST
    const ast = convertInputToAST(input);

    // Execute query
    const db = new Database(wsContext.dbPath, { readonly: true });
    const engine = new UnifiedQueryEngine(db);

    try {
      const result = await engine.execute(ast);

      return {
        workspace: wsContext.alias,
        query: ast,
        results: result.results,
        count: result.count,
        hasMore: result.hasMore,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    throw error;
  }
}
