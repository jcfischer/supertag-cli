/**
 * Graph Query Command
 * F-102: Graph Query DSL
 *
 * CLI command for graph-aware queries that traverse typed relationships.
 *
 * Usage:
 *   supertag gquery "FIND person WHERE name ~ John CONNECTED TO project RETURN name, project.name"
 *   supertag gquery "FIND task CONNECTED TO person VIA Assignee RETURN name, person.name" --explain
 */

import { Command } from "commander";
import { Database } from "bun:sqlite";
import { parseGraphQuery, GraphParseError } from "../query/graph-parser";
import { GraphQueryPlanner, GraphPlanError } from "../query/graph-planner";
import { GraphQueryExecutor } from "../query/graph-executor";
import { resolveWorkspaceContext } from "../config/workspace-resolver";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";
import { addStandardOptions } from "./helpers";
import { header, EMOJI, table, tip } from "../utils/format";
import type { StandardOptions } from "../types";

interface GQueryOptions extends StandardOptions {
  format?: OutputFormat;
  header?: boolean;
  explain?: boolean;
}

/**
 * Create the gquery command
 */
export function createGQueryCommand(): Command {
  const gquery = new Command("gquery");

  gquery
    .description("Run a graph-aware query with relationship traversal")
    .argument("<query>", "Graph query (e.g., 'FIND person CONNECTED TO project RETURN name')");

  // Add standard options (workspace, limit, json, format, etc.)
  addStandardOptions(gquery, { defaultLimit: "100" });

  // Graph-specific options
  gquery.option("--explain", "Show execution plan without running the query");

  gquery.action(async (queryStr: string, options: GQueryOptions) => {
    const format = resolveOutputFormat(options);
    const outputOpts = resolveOutputOptions(options);

    // Parse the query string
    let ast;
    try {
      ast = parseGraphQuery(queryStr);
    } catch (error) {
      if (error instanceof GraphParseError) {
        console.error(`❌ Query syntax error: ${error.message}`);
        process.exit(1);
      }
      throw error;
    }

    // Override limit from CLI options only if query doesn't specify one
    if (options.limit && ast.limit === undefined) {
      ast.limit = parseInt(String(options.limit));
    }

    // Resolve workspace and database
    let wsContext;
    try {
      wsContext = resolveWorkspaceContext({ workspace: options.workspace });
    } catch (error) {
      console.error(`❌ ${(error as Error).message}`);
      process.exit(1);
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
          console.error(`❌ Query validation error: ${error.message}`);
          if (error.suggestion) {
            console.error(`   💡 ${error.suggestion}`);
          }
          process.exit(1);
        }
        throw error;
      }

      // --explain: show plan and exit
      if (options.explain) {
        const explanation = planner.formatExplain(plan);
        if (format === "json") {
          console.log(JSON.stringify({ plan: plan.steps, explanation }, null, 2));
        } else {
          console.log(`\n${header(EMOJI.search, "Query Execution Plan")}:\n`);
          console.log(explanation);
          console.log(`\nEstimated hops: ${plan.estimatedHops}`);
        }
        return;
      }

      // Execute the query
      const executor = new GraphQueryExecutor(db, wsContext.dbPath);
      const limit = ast.limit ?? parseInt(String(options.limit)) ?? 100;

      try {
        const result = await executor.execute(plan, ast, limit);

        // Handle empty results
        if (result.count === 0) {
          if (format === "json" || format === "jsonl" || format === "minimal") {
            console.log("[]");
          } else if (format === "ids" || format === "csv") {
            // Empty output for machine formats
          } else {
            console.log(`No results found for: ${queryStr}`);
          }
          return;
        }

        // Create formatter
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        // Table format: pretty output
        if (format === "table") {
          const headerText = outputOpts.verbose
            ? `Graph query results (${result.count}) in ${result.queryTimeMs?.toFixed(0) ?? "?"}ms`
            : `Graph query results (${result.count})`;
          console.log(`\n${header(EMOJI.search, headerText)}:\n`);

          // Build table from result columns and rows
          const tableHeaders = ["#", ...result.columns];
          const tableAligns: ("left" | "right")[] = [
            "right",
            ...result.columns.map(() => "left" as const),
          ];

          const tableRows = result.rows.map((row, i) => {
            const rowData = [String(i + 1)];
            for (const col of result.columns) {
              const val = row[col];
              if (Array.isArray(val)) {
                rowData.push(val.join(", "));
              } else {
                rowData.push(String(val ?? ""));
              }
            }
            return rowData;
          });

          console.log(table(tableHeaders, tableRows, { align: tableAligns }));

          if (result.hasMore) {
            tip("More results available. Add LIMIT <n> to your query.");
          }

          if (outputOpts.verbose && result.queryTimeMs) {
            console.log(`\nQuery time: ${result.queryTimeMs.toFixed(1)}ms`);
          }
          return;
        }

        // Other formats: use formatter
        const headers = result.columns;
        const rows = result.rows.map((row) => {
          return result.columns.map((col) => {
            const val = row[col];
            if (Array.isArray(val)) return val.join(", ");
            return String(val ?? "");
          });
        });

        formatter.table(headers, rows);
        formatter.finalize();
      } finally {
        executor.close();
      }
    } catch (error) {
      console.error(`❌ Query execution error: ${(error as Error).message}`);
      process.exit(1);
    } finally {
      db.close();
    }
  });

  return gquery;
}
