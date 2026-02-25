/**
 * Graph Query Service
 * F-102: Graph Query DSL
 *
 * Shared pipeline for graph query execution, used by both CLI and MCP.
 * Encapsulates: parse → plan → execute (or explain).
 */

import { Database } from "bun:sqlite";
import { parseGraphQuery, GraphParseError } from "./graph-parser";
import { GraphQueryPlanner, GraphPlanError } from "./graph-planner";
import { GraphQueryExecutor } from "./graph-executor";
import type { GraphQueryResult } from "./graph-types";

export interface GraphQueryOptions {
  query: string;
  dbPath: string;
  limit?: number;
  explain?: boolean;
}

export interface GraphQuerySuccess {
  results?: GraphQueryResult;
  executionPlan?: string;
}

/**
 * Execute a graph query through the full pipeline: parse → plan → execute.
 *
 * @throws GraphParseError on syntax errors
 * @throws GraphPlanError on validation errors (unknown tags/fields)
 * @throws Error on execution errors
 */
export async function executeGraphQuery(
  options: GraphQueryOptions
): Promise<GraphQuerySuccess> {
  // Parse the query string
  const ast = parseGraphQuery(options.query);

  // Apply limit override if query doesn't specify one
  if (options.limit && ast.limit === undefined) {
    ast.limit = options.limit;
  }

  const db = new Database(options.dbPath, { readonly: true });

  try {
    // Plan the query (validates tags/fields against DB schema)
    const planner = new GraphQueryPlanner(db);
    const plan = await planner.plan(ast);

    // Explain mode: return plan text only
    if (options.explain) {
      return { executionPlan: planner.formatExplain(plan) };
    }

    // Execute the query
    const executor = new GraphQueryExecutor(db, options.dbPath);
    const limit = ast.limit ?? options.limit ?? 100;

    try {
      const results = await executor.execute(plan, ast, limit);
      return { results };
    } finally {
      executor.close();
    }
  } finally {
    db.close();
  }
}
