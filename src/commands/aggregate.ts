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
  groupBy?: string;
  showPercent?: boolean;
  top?: number;
  format?: OutputFormat;
  header?: boolean;
}

/**
 * Get display width of string (accounts for emojis taking 2 columns)
 */
function getDisplayWidth(str: string): number {
  // Simple heuristic: count emoji characters as 2 width
  // This handles most common cases
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) ?? 0;
    // Emoji ranges (simplified - covers most common emojis)
    if (
      (code >= 0x1F300 && code <= 0x1F9FF) || // Misc Symbols, Emoticons, etc.
      (code >= 0x2600 && code <= 0x26FF) ||   // Misc Symbols
      (code >= 0x2700 && code <= 0x27BF) ||   // Dingbats
      (code >= 0xFE00 && code <= 0xFE0F) ||   // Variation Selectors
      (code >= 0x1F000 && code <= 0x1FFFF)    // Extended emoji
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad string to target width (accounts for display width)
 */
function padToWidth(str: string, targetWidth: number): string {
  const displayWidth = getDisplayWidth(str);
  const padding = Math.max(0, targetWidth - displayWidth);
  return str + " ".repeat(padding);
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

  // Calculate column widths
  const entries = Object.entries(result.groups);
  const groupColWidth = Math.max(
    getDisplayWidth(groupLabel),
    ...entries.map(([key]) => getDisplayWidth(key))
  ) + 2; // Add padding

  const countColWidth = Math.max(
    getDisplayWidth("Count"),
    ...entries.map(([, count]) => getDisplayWidth(formatNumber(count as number, true)))
  ) + 2;

  // Header
  console.log(`\n${header(EMOJI.aggregate, `Aggregation Results`)}\n`);
  let headerLine = `   ${padToWidth(groupLabel, groupColWidth)}${padToWidth("Count", countColWidth)}`;
  if (showPercent && result.percentages) {
    headerLine += "Percent";
  }
  console.log(headerLine);
  console.log(`   ${"─".repeat(groupColWidth + countColWidth + (showPercent ? 10 : 0))}`);

  // Rows
  for (const [key, count] of entries) {
    let row = `   ${padToWidth(key, groupColWidth)}${padToWidth(formatNumber(count as number, true), countColWidth)}`;
    if (showPercent && result.percentages) {
      row += `${result.percentages[key]}%`;
    }
    console.log(row);
  }

  // Footer
  console.log(`   ${"─".repeat(groupColWidth + countColWidth + (showPercent ? 10 : 0))}`);
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
    .option("--group-by <fields>", "Field(s) to group by (comma-separated, omit for total count)")
    .option("--show-percent", "Show percentage of total alongside counts")
    .option("--top <n>", "Return only top N groups by count", parseInt);

  addStandardOptions(aggregate);

  aggregate.action(async (options: AggregateOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const outputOpts = resolveOutputOptions(options);
    // --format pretty should enable pretty output mode
    const isPretty = outputOpts.pretty || (options.format as string) === "pretty";
    const format = resolveOutputFormat({ format: options.format, json: options.json, pretty: outputOpts.pretty });

    // Create service
    const service = new AggregationService(dbPath);

    try {
      // Handle total-count-only mode (no --group-by)
      if (!options.groupBy) {
        const result = service.countOnly(options.tag);

        if (format === "json" || format === "minimal") {
          console.log(formatJsonOutput(result));
        } else if (format === "csv") {
          if (options.header !== false) {
            console.log("tag,total");
          }
          console.log(`"${options.tag}",${result.total}`);
        } else if (format === "jsonl") {
          console.log(JSON.stringify({ tag: options.tag, total: result.total }));
        } else if (format === "ids") {
          console.log(options.tag);
        } else {
          // Table format (default)
          if (isPretty) {
            console.log(`\n${header(EMOJI.aggregate, `Total Count`)}\n`);
            console.log(`   ${options.tag}: ${formatNumber(result.total, true)}`);
            console.log("");
          } else {
            console.log(tsv(options.tag, result.total));
          }
        }
        return;
      }

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
        if (isPretty) {
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
