/**
 * tana_graph_query Tool
 * F-102: Graph Query DSL
 *
 * MCP tool for graph-aware queries that traverse typed relationships.
 */

import { resolveWorkspaceContext } from "../../config/workspace-resolver";
import { executeGraphQuery } from "../../query/graph-query-service";
import { handleMcpError } from "../error-handler";
import type { GraphQueryInput } from "../schemas";

/**
 * Execute a graph query via MCP
 */
export async function graphQuery(input: GraphQueryInput) {
  try {
    const wsContext = resolveWorkspaceContext({ workspace: input.workspace });

    const result = await executeGraphQuery({
      query: input.query,
      dbPath: wsContext.dbPath,
      limit: input.limit,
      explain: input.explain,
    });

    const response: Record<string, unknown> = {
      workspace: wsContext.alias,
      query: input.query,
    };

    if (result.executionPlan) {
      response.executionPlan = result.executionPlan;
    }
    if (result.results) {
      response.results = result.results;
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
    };
  } catch (error) {
    return handleMcpError(error);
  }
}
