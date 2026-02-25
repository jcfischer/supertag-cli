/**
 * tana_graph_query Tool
 * F-102: Graph Query DSL
 *
 * MCP tool for graph-aware queries that traverse typed relationships.
 */

import { Database } from "bun:sqlite";
import { parseGraphQuery, GraphParseError } from "../../query/graph-parser";
import { GraphQueryPlanner, GraphPlanError } from "../../query/graph-planner";
import { GraphQueryExecutor } from "../../query/graph-executor";
import { resolveWorkspaceContext } from "../../config/workspace-resolver";
import type { GraphQueryResult } from "../../query/graph-types";

/**
 * Input type for the graph query tool
 */
export interface GraphQueryInput {
  /** Graph query string (DSL) */
  query: string;
  /** Workspace alias or node ID */
  workspace?: string;
  /** Maximum results (default: 100) */
  limit?: number;
  /** Show execution plan instead of results */
  explain?: boolean;
}

/**
 * Execute a graph query
 */
export async function graphQuery(input: GraphQueryInput): Promise<{
  workspace: string;
  query: string;
  results?: GraphQueryResult;
  executionPlan?: string;
  error?: string;
}> {
  const wsContext = resolveWorkspaceContext({ workspace: input.workspace });

  // Parse the query
  let ast;
  try {
    ast = parseGraphQuery(input.query);
  } catch (error) {
    if (error instanceof GraphParseError) {
      return {
        workspace: wsContext.alias,
        query: input.query,
        error: `Parse error: ${error.message}`,
      };
    }
    throw error;
  }

  // Apply limit override
  if (input.limit && ast.limit === undefined) {
    ast.limit = input.limit;
  }

  const db = new Database(wsContext.dbPath, { readonly: true });

  try {
    // Plan the query (validates tags/fields)
    const planner = new GraphQueryPlanner(db);
    let plan;
    try {
      plan = await planner.plan(ast);
    } catch (error) {
      if (error instanceof GraphPlanError) {
        return {
          workspace: wsContext.alias,
          query: input.query,
          error: `Validation error: ${error.message}${error.suggestion ? `. ${error.suggestion}` : ""}`,
        };
      }
      throw error;
    }

    // Explain mode: return plan only
    if (input.explain) {
      const explanation = planner.formatExplain(plan);
      return {
        workspace: wsContext.alias,
        query: input.query,
        executionPlan: explanation,
      };
    }

    // Execute the query
    const executor = new GraphQueryExecutor(db, wsContext.dbPath);
    const limit = ast.limit ?? input.limit ?? 100;

    try {
      const result = await executor.execute(plan, ast, limit);
      return {
        workspace: wsContext.alias,
        query: input.query,
        results: result,
      };
    } finally {
      executor.close();
    }
  } finally {
    db.close();
  }
}
