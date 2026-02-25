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
import { GraphParseError } from "../query/graph-parser";
import { GraphPlanError } from "../query/graph-planner";
import { executeGraphQuery } from "../query/graph-query-service";
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

    // Resolve workspace
    let wsContext;
    try {
      wsContext = resolveWorkspaceContext({ workspace: options.workspace });
    } catch (error) {
      console.error(`❌ ${(error as Error).message}`);
      process.exit(1);
    }

    try {
      const result = await executeGraphQuery({
        query: queryStr,
        dbPath: wsContext.dbPath,
        limit: options.limit ? parseInt(String(options.limit)) : undefined,
        explain: options.explain,
        workspace: wsContext.alias,
      });

      // --explain: show plan and exit
      if (result.executionPlan) {
        if (format === "json") {
          console.log(JSON.stringify({ explanation: result.executionPlan }, null, 2));
        } else {
          console.log(`\n${header(EMOJI.search, "Query Execution Plan")}:\n`);
          console.log(result.executionPlan);
        }
        return;
      }

      // Results mode
      const queryResult = result.results!;

      // Handle empty results
      if (queryResult.count === 0) {
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
          ? `Graph query results (${queryResult.count}) in ${queryResult.queryTimeMs?.toFixed(0) ?? "?"}ms`
          : `Graph query results (${queryResult.count})`;
        console.log(`\n${header(EMOJI.search, headerText)}:\n`);

        // Build table from result columns and rows
        const tableHeaders = ["#", ...queryResult.columns];
        const tableAligns: ("left" | "right")[] = [
          "right",
          ...queryResult.columns.map(() => "left" as const),
        ];

        const tableRows = queryResult.rows.map((row, i) => {
          const rowData = [String(i + 1)];
          for (const col of queryResult.columns) {
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

        if (queryResult.hasMore) {
          tip("More results available. Add LIMIT <n> to your query.");
        }

        if (outputOpts.verbose && queryResult.queryTimeMs) {
          console.log(`\nQuery time: ${queryResult.queryTimeMs.toFixed(1)}ms`);
        }
        return;
      }

      // Other formats: use formatter
      const headers = queryResult.columns;
      const rows = queryResult.rows.map((row) => {
        return queryResult.columns.map((col) => {
          const val = row[col];
          if (Array.isArray(val)) return val.join(", ");
          return String(val ?? "");
        });
      });

      formatter.table(headers, rows);
      formatter.finalize();
    } catch (error) {
      if (error instanceof GraphParseError) {
        console.error(`❌ Query syntax error: ${error.message}`);
        process.exit(1);
      }
      if (error instanceof GraphPlanError) {
        console.error(`❌ Query validation error: ${error.message}`);
        if (error.suggestion) {
          console.error(`   💡 ${error.suggestion}`);
        }
        process.exit(1);
      }
      console.error(`❌ Query execution error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

  return gquery;
}
