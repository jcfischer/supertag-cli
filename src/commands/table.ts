/**
 * Table Command (F-099: Bulk Field Extractor)
 *
 * Export all instances of a supertag as a table with resolved field values.
 *
 * Usage:
 *   supertag table <supertag>                          # Default table format
 *   supertag table book --format csv > books.csv       # CSV export
 *   supertag table book --format json                  # JSON with raw+resolved
 *   supertag table book --format markdown               # Markdown table
 *   supertag table person --fields "Name,Email,Company" # Select columns
 *   supertag table task --where "Status=Done"           # Filter rows
 *   supertag table project --sort Name --direction asc  # Sort
 */

import { Command } from "commander";
import { withDatabase } from "../db/with-database";
import {
  addStandardOptions,
  resolveDbPath,
  checkDb,
  formatJsonOutput,
} from "./helpers";
import type { StandardOptions } from "../types";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";
import {
  exportTable,
  formatAsMarkdown,
  getDisplayValue,
  getTruncatedDisplayValue,
  type TableExportOptions,
  type TableExportResult,
} from "../db/table-export";
import {
  EMOJI,
  header,
  table,
  tip,
  formatNumber,
} from "../utils/format";

/**
 * Create the table command
 */
export function createTableCommand(): Command {
  const cmd = new Command("table");
  cmd
    .description("Export all instances of a supertag as a table with resolved field values")
    .argument("<supertag>", "Supertag name to export (e.g., book, person, project)")
    .option("--fields <names>", "Only include these fields (comma-separated)")
    .option("--where <filter...>", "Filter rows by field=value (repeatable)")
    .option("--sort <field>", "Sort by field name")
    .option("--direction <dir>", "Sort direction: asc or desc", "asc")
    .option("--no-resolve", "Skip reference resolution (show raw IDs)")
    .option("--offset <n>", "Skip first N rows (pagination)", "0");

  addStandardOptions(cmd, { defaultLimit: "100" });

  cmd.action(
    async (
      supertag: string,
      options: StandardOptions & {
        fields?: string;
        where?: string[];
        sort?: string;
        direction?: string;
        resolve?: boolean;
        format?: string;
        header?: boolean;
        offset?: string;
      }
    ) => {
      const dbPath = resolveDbPath(options);
      if (!checkDb(dbPath, options.workspace)) {
        process.exit(1);
      }

      const format = resolveOutputFormat(options);
      const outputOpts = resolveOutputOptions(options);

      // Parse options
      const exportOptions: TableExportOptions = {
        fields: options.fields
          ? options.fields.split(",").map((f) => f.trim())
          : undefined,
        where: options.where,
        sort: options.sort,
        direction: (options.direction as "asc" | "desc") || "asc",
        limit: options.limit ? parseInt(String(options.limit)) : undefined,
        offset: options.offset ? parseInt(String(options.offset)) : 0,
        resolveReferences: options.resolve !== false,
      };

      await withDatabase({ dbPath, readonly: true }, (ctx) => {
        const result = exportTable(ctx.db, supertag, exportOptions);

        // Warn if large result set without limit
        if (result.totalCount > 500 && !options.limit) {
          console.error(
            `⚠️  ${result.totalCount} instances found. Consider using --limit for large exports.`
          );
        }

        // Handle markdown format specially (not in the standard formatter)
        if (format === "table" && options.format === "markdown") {
          // User explicitly requested markdown
          console.log(formatAsMarkdown(result));
          return;
        }

        // Table format: rich pretty output
        if (format === "table") {
          renderTableFormat(result);
          return;
        }

        // JSON format: include both raw and resolved
        if (format === "json" || format === "minimal" || format === "jsonl") {
          const jsonRows = result.rows.map((row) => {
            const obj: Record<string, unknown> = {
              id: row.id,
              name: row.name,
            };
            for (const col of result.columns) {
              const field = row.fields[col];
              if (!field || (field.raw === "" && !field.resolved)) {
                obj[col] = null;
              } else if (field.resolved) {
                // Include both raw and resolved for reference fields
                obj[col] = {
                  value: field.resolved,
                  raw: field.raw,
                  type: field.type,
                };
              } else {
                obj[col] = field.raw;
              }
            }
            return obj;
          });

          const output = {
            supertag: result.supertag,
            totalCount: result.totalCount,
            hasMore: result.hasMore,
            columns: result.columns,
            rows: jsonRows,
          };

          console.log(formatJsonOutput(output));
          return;
        }

        // CSV and other formats: use standard formatter
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        const headers = ["id", "name", ...result.columns];
        const rows = result.rows.map((row) => [
          row.id,
          row.name,
          ...result.columns.map((col) =>
            getTruncatedDisplayValue(row.fields[col])
          ),
        ]);

        formatter.table(headers, rows);
        formatter.finalize();
      });
    }
  );

  // Also support --format markdown via the format flag
  return cmd;
}

/**
 * Render rich table format for terminal output
 */
function renderTableFormat(result: TableExportResult): void {
  console.log(
    `\n${header(EMOJI.node, `${result.supertag} (${formatNumber(result.totalCount, true)} instances)`)}\n`
  );

  if (result.rows.length === 0) {
    console.log("  No instances found.\n");
    return;
  }

  const headers = ["#", "Name", ...result.columns];
  const rows = result.rows.map((row, i) => [
    String(i + 1),
    row.name || "(unnamed)",
    ...result.columns.map((col) => {
      const val = getTruncatedDisplayValue(row.fields[col]);
      return val || "-";
    }),
  ]);

  console.log(table(headers, rows));

  if (result.hasMore) {
    console.log(
      tip(`Showing ${result.rows.length} of ${result.totalCount}. Use --limit and --offset for more.`)
    );
  }

  console.log(
    tip("Use --format csv, --format json, or --format markdown for export")
  );
}
