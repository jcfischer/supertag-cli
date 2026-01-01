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
import { resolveOutputOptions } from "../utils/output-options";

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

  listCmd.action(async (options: StandardOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const outputOpts = resolveOutputOptions(options);
    const limit = options.limit ? parseInt(String(options.limit)) : 50;

    await withDatabase({ dbPath, readonly: true }, (ctx) => {
      const allFields = getAvailableFieldNames(ctx.db);
      const limitedFields = allFields.slice(0, limit);

      if (options.json) {
        console.log(formatJsonOutput(limitedFields));
      } else if (outputOpts.pretty) {
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
      } else {
        // Unix mode: TSV output
        for (const field of limitedFields) {
          console.log(tsv(field.fieldName, field.count));
        }
      }
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
      }
    ) => {
      const dbPath = resolveDbPath(options);
      if (!checkDb(dbPath, options.workspace)) {
        process.exit(1);
      }

      const outputOpts = resolveOutputOptions(options);

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

        if (options.json) {
          // Apply field projection if --select is specified
          const selectFields = parseSelectOption(options.select);
          const projection = parseSelectPaths(selectFields);
          const projectedResults = applyProjectionToArray(values as unknown as Record<string, unknown>[], projection);
          console.log(formatJsonOutput(projectedResults));
        } else if (outputOpts.pretty) {
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
        } else {
          // Unix mode: TSV output
          for (const value of values) {
            if (outputOpts.verbose) {
              console.log(
                tsv(
                  value.parentId,
                  value.created ?? "",
                  value.valueText
                )
              );
            } else {
              console.log(value.valueText);
            }
          }
        }
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
      options: StandardOptions & { field?: string }
    ) => {
      const dbPath = resolveDbPath(options);
      if (!checkDb(dbPath, options.workspace)) {
        process.exit(1);
      }

      const outputOpts = resolveOutputOptions(options);
      const limit = options.limit ? parseInt(String(options.limit)) : 50;

      await withDatabase({ dbPath, readonly: true }, (ctx) => {
        const results = queryFieldValuesFTS(ctx.db, query, {
          fieldName: options.field,
          limit,
        });

        if (options.json) {
          console.log(formatJsonOutput(results));
        } else if (outputOpts.pretty) {
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
        } else {
          // Unix mode: TSV output
          for (const result of results) {
            if (outputOpts.verbose) {
              console.log(
                tsv(
                  result.parentId,
                  result.fieldName,
                  result.valueText
                )
              );
            } else {
              console.log(tsv(result.fieldName, result.valueText));
            }
          }
        }
      });
    }
  );

  return fields;
}
