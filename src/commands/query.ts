/**
 * Query Command
 * Spec 063: Unified Query Language
 *
 * Unified query command that combines tag filtering, field filtering,
 * date ranges, and full-text search in a single expressive query.
 *
 * Usage:
 *   supertag query "find task where Status = Done order by -created limit 20"
 *   supertag query "find meeting where Attendees ~ John and created > 7d"
 *   supertag query "find * where name ~ project"
 */

import { Command } from "commander";
import { Database } from "bun:sqlite";
import { parseQuery, ParseError } from "../query/parser";
import { UnifiedQueryEngine } from "../query/unified-query-engine";
import { resolveWorkspaceContext } from "../config/workspace-resolver";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";
import { addStandardOptions } from "./helpers";
import { header, EMOJI, table, tip, formatDateISO } from "../utils/format";
import type { StandardOptions } from "../types";

interface QueryOptions extends StandardOptions {
  format?: OutputFormat;
  header?: boolean;
}

/**
 * Create the query command
 */
export function createQueryCommand(): Command {
  const query = new Command("query");

  query
    .description("Run a unified query against your Tana data")
    .argument("<query>", "Query string (e.g., 'find task where Status = Done')");

  // Add standard options (workspace, limit, json, format, etc.)
  addStandardOptions(query, { defaultLimit: "100" });

  query.action(async (queryStr: string, options: QueryOptions) => {
    const format = resolveOutputFormat(options);
    const outputOpts = resolveOutputOptions(options);

    // Parse the query string
    let ast;
    try {
      ast = parseQuery(queryStr);
    } catch (error) {
      if (error instanceof ParseError) {
        console.error(`❌ Query syntax error: ${error.message}`);
        console.error("");
        console.error("Query syntax:");
        console.error("  find <tag> [where <conditions>] [order by <field>] [limit N] [offset N]");
        console.error("");
        console.error("Examples:");
        console.error('  find task where Status = Done');
        console.error('  find meeting where Attendees ~ John and created > 7d');
        console.error('  find task where (Status = Done or Status = Active) order by -created limit 20');
        process.exit(1);
      }
      throw error;
    }

    // Override limit/offset from CLI options if provided
    if (options.limit) {
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

    // Execute query
    const db = new Database(wsContext.dbPath, { readonly: true });
    const engine = new UnifiedQueryEngine(db);
    const startTime = performance.now();

    try {
      const result = await engine.execute(ast);
      const queryTime = performance.now() - startTime;

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
          ? `Query results (${result.count}) in ${queryTime.toFixed(0)}ms`
          : `Query results (${result.count})`;
        console.log(`\n${header(EMOJI.search, headerText)}:\n`);

        // Build table
        const tableHeaders = ["#", "Name", "ID", "Created"];
        const tableRows = result.results.map((node, i) => {
          const created = node.created
            ? (outputOpts.humanDates
              ? new Date(node.created as number).toLocaleDateString()
              : formatDateISO(node.created as number))
            : "";
          return [
            String(i + 1),
            ((node.name as string) || "(unnamed)").substring(0, 50),
            node.id as string,
            created,
          ];
        });

        console.log(table(tableHeaders, tableRows, { align: ["right", "left", "left", "left"] }));

        if (result.hasMore) {
          console.log(tip(`More results available. Use 'limit' and 'offset' for pagination.`));
        }

        if (outputOpts.verbose) {
          console.log(`\nQuery time: ${queryTime.toFixed(1)}ms`);
        }
        return;
      }

      // Other formats: use formatter
      const headers = ["id", "name", "created", "updated"];
      const rows = result.results.map((node) => [
        String(node.id),
        String(node.name || ""),
        node.created ? formatDateISO(node.created as number) : "",
        node.updated ? formatDateISO(node.updated as number) : "",
      ]);

      formatter.table(headers, rows);
      formatter.finalize();
    } catch (error) {
      console.error(`❌ Query execution error: ${(error as Error).message}`);
      process.exit(1);
    } finally {
      db.close();
    }
  });

  return query;
}
