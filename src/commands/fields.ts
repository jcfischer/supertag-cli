/**
 * Fields Command Group
 *
 * Query and search text-based field values from Tana nodes.
 * T-6.1 to T-6.6: CLI commands for field value queries
 *
 * Usage:
 *   supertag fields list               # List all fields with counts
 *   supertag fields values <name>      # Get values for a specific field
 *   supertag fields search <query>     # FTS search in field values
 */

import { Command } from "commander";
import { withDatabase } from "../db/with-database";
import {
  addStandardOptions,
  resolveDbPath,
  checkDb,
  formatJsonOutput,
  parseSelectOption,
} from "./helpers";
import {
  parseSelectPaths,
  applyProjectionToArray,
} from "../utils/select-projection";
import type { StandardOptions } from "../types";
import {
  getAvailableFieldNames,
  queryFieldValuesByFieldName,
  queryFieldValuesFTS,
} from "../db/field-query";
import {
  tsv,
  EMOJI,
  header,
  table,
  formatNumber,
  tip,
} from "../utils/format";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";

/**
 * Create the fields command group
 */
export function createFieldsCommand(): Command {
  const fields = new Command("fields");
  fields.description("Query and search field values from Tana nodes");

  // fields list (T-6.2)
  const listCmd = fields
    .command("list")
    .description("List available field names with usage counts");

  addStandardOptions(listCmd, { defaultLimit: "50" });

  listCmd.action(async (options: StandardOptions & { format?: OutputFormat; header?: boolean }) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);
    const limit = options.limit ? parseInt(String(options.limit)) : 50;

    await withDatabase({ dbPath, readonly: true }, (ctx) => {
      const allFields = getAvailableFieldNames(ctx.db);
      const limitedFields = allFields.slice(0, limit);

      // Build enriched data for all formats
      const enriched = limitedFields.map((field, i) => ({
        rank: i + 1,
        fieldName: field.fieldName,
        count: field.count,
      }));

      // Table format: use rich pretty output
      if (format === "table") {
        console.log(
          `\n${header(EMOJI.search, `Field Names (${limitedFields.length}${allFields.length > limit ? ` of ${allFields.length}` : ""})`)}\n`
        );
        const headers = ["#", "Field Name", "Values"];
        const rows = limitedFields.map((field, i) => [
          String(i + 1),
          field.fieldName,
          formatNumber(field.count, true),
        ]);
        console.log(
          table(headers, rows, { align: ["right", "left", "right"] })
        );
        console.log(
          tip("Use 'fields values <name>' to see values for a field")
        );
        return;
      }

      // JSON formats: return full data
      if (format === "json" || format === "minimal" || format === "jsonl") {
        console.log(formatJsonOutput(limitedFields));
        return;
      }

      // Create formatter and output based on format
      const formatter = createFormatter({
        format,
        noHeader: options.header === false,
        humanDates: outputOpts.humanDates,
        verbose: outputOpts.verbose,
      });

      // Use lowercase headers for backward-compatible JSON keys
      const headers = ["rank", "fieldName", "count"];
      const rows = enriched.map((item) => [
        String(item.rank),
        item.fieldName,
        String(item.count),
      ]);

      formatter.table(headers, rows);
      formatter.finalize();
    });
  });

  // fields values <name> (T-6.3)
  const valuesCmd = fields
    .command("values <name>")
    .description("Get values for a specific field")
    .option("--after <date>", "Filter values created after date (YYYY-MM-DD)")
    .option("--before <date>", "Filter values created before date (YYYY-MM-DD)")
    .option("--offset <n>", "Skip first N results (pagination)", "0")
    .option("--select <fields>", "Select specific fields in JSON output (comma-separated)");

  addStandardOptions(valuesCmd, { defaultLimit: "100" });

  valuesCmd.action(
    async (
      name: string,
      options: StandardOptions & {
        after?: string;
        before?: string;
        offset?: string;
        select?: string;
        format?: OutputFormat;
        header?: boolean;
      }
    ) => {
      const dbPath = resolveDbPath(options);
      if (!checkDb(dbPath, options.workspace)) {
        process.exit(1);
      }

      const outputOpts = resolveOutputOptions(options);
      const format = resolveOutputFormat(options);

      // Build query options before database access
      const queryOptions: {
        limit?: number;
        offset?: number;
        createdAfter?: number;
        createdBefore?: number;
      } = {
        limit: options.limit ? parseInt(String(options.limit)) : 100,
        offset: options.offset ? parseInt(options.offset) : 0,
      };

      if (options.after) {
        const date = new Date(options.after);
        if (isNaN(date.getTime())) {
          console.error(`❌ Invalid date format: ${options.after}`);
          process.exit(1);
        }
        queryOptions.createdAfter = date.getTime();
      }

      if (options.before) {
        const date = new Date(options.before);
        if (isNaN(date.getTime())) {
          console.error(`❌ Invalid date format: ${options.before}`);
          process.exit(1);
        }
        queryOptions.createdBefore = date.getTime();
      }

      await withDatabase({ dbPath, readonly: true }, (ctx) => {
        const values = queryFieldValuesByFieldName(ctx.db, name, queryOptions);

        // Build enriched data for all formats
        const enriched = values.map((value) => ({
          parentId: value.parentId,
          valueText: value.valueText,
          created: value.created != null ? String(value.created) : "",
        }));

        // Table format: use rich pretty output
        if (format === "table") {
          console.log(
            `\n${header(EMOJI.node, `Field: ${name} (${values.length} values)`)}\n`
          );

          if (values.length === 0) {
            console.log("  No values found for this field.\n");
            console.log(tip("Check field name with 'fields list'"));
          } else {
            for (const value of values) {
              const date = value.created
                ? new Date(value.created).toLocaleDateString()
                : "unknown";
              console.log(`  • ${value.valueText}`);
              if (outputOpts.verbose) {
                console.log(`    Parent: ${value.parentId} | Date: ${date}`);
              }
            }
            console.log();
            if (values.length === queryOptions.limit) {
              console.log(
                tip(
                  `Showing first ${queryOptions.limit}. Use --limit and --offset for more.`
                )
              );
            }
          }
          return;
        }

        // JSON formats with optional projection
        if (format === "json" || format === "minimal" || format === "jsonl") {
          const selectFields = parseSelectOption(options.select);
          const projection = parseSelectPaths(selectFields);
          const projectedResults = applyProjectionToArray(values, projection);
          console.log(formatJsonOutput(projectedResults));
          return;
        }

        // Create formatter and output based on format
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        // Use lowercase headers for backward-compatible JSON keys
        const headers = ["parentId", "valueText", "created"];
        const rows = enriched.map((item) => [
          item.parentId,
          item.valueText,
          item.created,
        ]);

        formatter.table(headers, rows);
        formatter.finalize();
      });
    }
  );

  // fields search <query> (T-6.4)
  const searchCmd = fields
    .command("search <query>")
    .description("Full-text search across field values")
    .option("-f, --field <name>", "Limit search to a specific field");

  addStandardOptions(searchCmd, { defaultLimit: "50" });

  searchCmd.action(
    async (
      query: string,
      options: StandardOptions & { field?: string; format?: OutputFormat; header?: boolean }
    ) => {
      const dbPath = resolveDbPath(options);
      if (!checkDb(dbPath, options.workspace)) {
        process.exit(1);
      }

      const outputOpts = resolveOutputOptions(options);
      const format = resolveOutputFormat(options);
      const limit = options.limit ? parseInt(String(options.limit)) : 50;

      await withDatabase({ dbPath, readonly: true }, (ctx) => {
        const results = queryFieldValuesFTS(ctx.db, query, {
          fieldName: options.field,
          limit,
        });

        // Build enriched data for all formats
        const enriched = results.map((result) => ({
          parentId: result.parentId,
          fieldName: result.fieldName,
          valueText: result.valueText,
        }));

        // Table format: use rich pretty output
        if (format === "table") {
          const fieldFilter = options.field ? ` in "${options.field}"` : "";
          console.log(
            `\n${header(EMOJI.search, `Search: "${query}"${fieldFilter} (${results.length} results)`)}\n`
          );

          if (results.length === 0) {
            console.log("  No matches found.\n");
            console.log(tip("Try a different search term or check field names with 'fields list'"));
          } else {
            for (const result of results) {
              console.log(`  [${result.fieldName}]`);
              console.log(`  ${result.valueText}`);
              if (outputOpts.verbose) {
                console.log(`  Parent: ${result.parentId}`);
              }
              console.log();
            }
          }
          return;
        }

        // JSON formats: return full data
        if (format === "json" || format === "minimal" || format === "jsonl") {
          console.log(formatJsonOutput(results));
          return;
        }

        // Create formatter and output based on format
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        // Use lowercase headers for backward-compatible JSON keys
        const headers = ["parentId", "fieldName", "valueText"];
        const rows = enriched.map((item) => [
          item.parentId,
          item.fieldName,
          item.valueText,
        ]);

        formatter.table(headers, rows);
        formatter.finalize();
      });
    }
  );

  return fields;
}
