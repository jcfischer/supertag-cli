/**
 * tana_aggregate Tool
 * Spec 064: Aggregation Queries
 *
 * Aggregate nodes with grouping and counting.
 * Returns grouped counts, percentages, and nested results.
 */

import type { AggregateInput } from "../schemas";
import { AggregationService } from "../../services/aggregation-service";
import type {
  AggregateAST,
  AggregateResult,
  AggregateFunction,
  GroupBySpec,
} from "../../query/types";
import { isTimePeriod } from "../../query/types";
import { resolveWorkspaceContext } from "../../config/workspace-resolver";

/**
 * Convert MCP input to GroupBySpec array
 */
function convertGroupBy(input: AggregateInput): GroupBySpec[] {
  const specs: GroupBySpec[] = [];

  for (const item of input.groupBy) {
    // String shorthand: "Status" or "month"
    if (typeof item === "string") {
      if (isTimePeriod(item)) {
        specs.push({ period: item });
      } else {
        specs.push({ field: item });
      }
      continue;
    }

    // Object form
    specs.push({
      field: item.field,
      period: item.period,
      dateField: item.dateField,
    });
  }

  return specs;
}

/**
 * Convert MCP input to AggregateAST
 */
function convertInputToAST(input: AggregateInput): AggregateAST {
  // Convert aggregate functions
  let aggregateFns: AggregateFunction[] = [{ fn: "count" }];
  if (input.aggregate && input.aggregate.length > 0) {
    aggregateFns = input.aggregate.map((fn) => ({
      fn: fn.fn,
      field: fn.field,
      alias: fn.alias,
    }));
  }

  const ast: AggregateAST = {
    find: input.find,
    groupBy: convertGroupBy(input),
    aggregate: aggregateFns,
    showPercent: input.showPercent ?? false,
    top: input.top,
    limit: input.limit ?? 100,
  };

  return ast;
}

/**
 * Execute aggregation query
 */
export async function aggregate(input: AggregateInput): Promise<{
  workspace: string;
  query: AggregateAST;
  result: AggregateResult;
}> {
  // Resolve workspace
  const wsContext = resolveWorkspaceContext({ workspace: input.workspace });

  // Convert input to AST
  const ast = convertInputToAST(input);

  // Execute aggregation
  const service = new AggregationService(wsContext.dbPath);

  try {
    const result = service.aggregate(ast);

    return {
      workspace: wsContext.alias,
      query: ast,
      result,
    };
  } finally {
    service.close();
  }
}
