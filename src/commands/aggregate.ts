/**
 * Aggregate Command
 * Spec 064: Aggregation Queries
 *
 * Group and count nodes by field values or time periods.
 *
 * Usage:
 *   supertag aggregate --tag task --group-by Status
 *   supertag aggregate --tag task --group-by Status,Priority
 *   supertag aggregate --tag meeting --group-by month
 *   supertag aggregate --tag task --group-by Status --show-percent --top 5
 */

import { Command } from "commander";
import { AggregationService } from "../services/aggregation-service";
import { resolveWorkspaceContext } from "../config/workspace-resolver";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
} from "./helpers";
import {
  tsv,
  EMOJI,
  header,
  formatNumber,
} from "../utils/format";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import type { OutputFormat } from "../utils/output-formatter";
import type { StandardOptions } from "../types";
import type {
  AggregateAST,
  AggregateResult,
  GroupBySpec,
  NestedGroups,
} from "../query/types";

interface AggregateOptions extends StandardOptions {
  tag: string;
  groupBy: string;
  showPercent?: boolean;
  top?: number;
  format?: OutputFormat;
  header?: boolean;
}

/**
 * Format a single-level aggregation result for table output
 */
function formatFlatResult(
  result: AggregateResult,
  groupBySpec: GroupBySpec[],
  showPercent: boolean
): void {
  const groupLabel = groupBySpec[0].field ?? groupBySpec[0].period ?? "group";

  // Header
  const headerCols = [groupLabel, "Count"];
  if (showPercent && result.percentages) {
    headerCols.push("Percent");
  }
  console.log(`\n${header(EMOJI.aggregate, `Aggregation Results`)}\n`);
  console.log(`   ${headerCols.join("\t")}`);
  console.log(`   ${"─".repeat(40)}`);

  // Rows
  for (const [key, count] of Object.entries(result.groups)) {
    const cols = [key, formatNumber(count as number, true)];
    if (showPercent && result.percentages) {
      cols.push(`${result.percentages[key]}%`);
    }
    console.log(`   ${cols.join("\t")}`);
  }

  // Footer
  console.log(`   ${"─".repeat(40)}`);
  console.log(`   Total: ${formatNumber(result.total, true)} nodes in ${result.groupCount} groups`);

  if (result.warning) {
    console.log(`\n   ⚠️  ${result.warning}`);
  }
  console.log("");
}

/**
 * Format a two-level nested aggregation result for table output
 */
function formatNestedResult(
  result: AggregateResult,
  groupBySpec: GroupBySpec[],
  _showPercent: boolean
): void {
  const group1Label = groupBySpec[0].field ?? groupBySpec[0].period ?? "group1";
  const group2Label = groupBySpec[1].field ?? groupBySpec[1].period ?? "group2";

  console.log(`\n${header(EMOJI.aggregate, `Aggregation Results`)}\n`);
  console.log(`   ${group1Label} → ${group2Label}\n`);

  // Rows
  for (const [key1, nested] of Object.entries(result.groups)) {
    console.log(`   ${key1}:`);
    const nestedObj = nested as NestedGroups;
    for (const [key2, count] of Object.entries(nestedObj)) {
      const countStr = formatNumber(count, true).padStart(6);
      console.log(`      ${key2}: ${countStr}`);
    }
    console.log("");
  }

  // Footer
  console.log(`   Total: ${formatNumber(result.total, true)} nodes in ${result.groupCount} groups`);

  if (result.warning) {
    console.log(`\n   ⚠️  ${result.warning}`);
  }
  console.log("");
}

/**
 * Create the aggregate command
 */
export function createAggregateCommand(): Command {
  const aggregate = new Command("aggregate");

  aggregate
    .description("Group and count nodes by field values or time periods")
    .requiredOption("--tag <tagname>", "Supertag to aggregate (e.g., task, meeting)")
    .requiredOption("--group-by <fields>", "Field(s) to group by (comma-separated)")
    .option("--show-percent", "Show percentage of total alongside counts")
    .option("--top <n>", "Return only top N groups by count", parseInt);

  addStandardOptions(aggregate);

  aggregate.action(async (options: AggregateOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const wsContext = resolveWorkspaceContext({
      workspace: options.workspace,
      requireDatabase: false, // Already checked via resolveDbPath
    });

    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat({ format: options.format, json: options.json, pretty: outputOpts.pretty });

    // Create service
    const service = new AggregationService(dbPath);

    try {
      // Parse group-by specification
      const groupBySpec = service.parseGroupBy(options.groupBy);

      if (groupBySpec.length === 0) {
        console.error("Error: --group-by requires at least one field");
        process.exit(1);
      }

      if (groupBySpec.length > 2) {
        console.error("Error: Maximum 2 group-by fields supported");
        process.exit(1);
      }

      // Build AST
      const ast: AggregateAST = {
        find: options.tag,
        groupBy: groupBySpec,
        aggregate: [{ fn: "count" }],
        showPercent: options.showPercent,
        top: options.top,
        limit: options.limit,
      };

      // Execute aggregation
      const result = service.aggregate(ast);

      // Output based on format
      if (format === "json") {
        console.log(formatJsonOutput(result));
      } else if (format === "csv") {
        const isNested = groupBySpec.length > 1;
        if (isNested) {
          // CSV for nested: group1, group2, count
          const group1Label = groupBySpec[0].field ?? groupBySpec[0].period ?? "group1";
          const group2Label = groupBySpec[1].field ?? groupBySpec[1].period ?? "group2";
          const headers = [group1Label, group2Label, "count"];
          if (options.showPercent) headers.push("percent");
          if (options.header !== false) {
            console.log(headers.join(","));
          }
          for (const [key1, nested] of Object.entries(result.groups)) {
            const nestedObj = nested as NestedGroups;
            for (const [key2, count] of Object.entries(nestedObj)) {
              const row = [
                `"${key1.replace(/"/g, '""')}"`,
                `"${key2.replace(/"/g, '""')}"`,
                count.toString(),
              ];
              console.log(row.join(","));
            }
          }
        } else {
          // CSV for flat: group, count
          const groupLabel = groupBySpec[0].field ?? groupBySpec[0].period ?? "group";
          const headers = [groupLabel, "count"];
          if (options.showPercent && result.percentages) headers.push("percent");
          if (options.header !== false) {
            console.log(headers.join(","));
          }
          for (const [key, count] of Object.entries(result.groups)) {
            const row = [
              `"${key.replace(/"/g, '""')}"`,
              (count as number).toString(),
            ];
            if (options.showPercent && result.percentages) {
              row.push((result.percentages[key] as number).toString());
            }
            console.log(row.join(","));
          }
        }
      } else if (format === "jsonl") {
        // JSON Lines
        const isNested = groupBySpec.length > 1;
        if (isNested) {
          for (const [key1, nested] of Object.entries(result.groups)) {
            const nestedObj = nested as NestedGroups;
            for (const [key2, count] of Object.entries(nestedObj)) {
              console.log(JSON.stringify({ group1: key1, group2: key2, count }));
            }
          }
        } else {
          for (const [key, count] of Object.entries(result.groups)) {
            const line: Record<string, unknown> = { group: key, count };
            if (options.showPercent && result.percentages) {
              line.percent = result.percentages[key];
            }
            console.log(JSON.stringify(line));
          }
        }
      } else {
        // Table format (default)
        const isNested = groupBySpec.length > 1;
        if (outputOpts.pretty) {
          if (isNested) {
            formatNestedResult(result, groupBySpec, !!options.showPercent);
          } else {
            formatFlatResult(result, groupBySpec, !!options.showPercent);
          }
        } else {
          // Unix mode: TSV output
          if (isNested) {
            for (const [key1, nested] of Object.entries(result.groups)) {
              const nestedObj = nested as NestedGroups;
              for (const [key2, count] of Object.entries(nestedObj)) {
                console.log(tsv(key1, key2, count));
              }
            }
          } else {
            for (const [key, count] of Object.entries(result.groups)) {
              if (options.showPercent && result.percentages) {
                console.log(tsv(key, count as number, `${result.percentages[key]}%`));
              } else {
                console.log(tsv(key, count as number));
              }
            }
          }
          // Summary line
          console.log(tsv("_total", result.total));
          console.log(tsv("_groups", result.groupCount));
        }
      }
    } finally {
      service.close();
    }
  });

  return aggregate;
}
