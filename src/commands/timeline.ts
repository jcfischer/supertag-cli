/**
 * Timeline Command
 * Spec: 066-timeline-queries
 *
 * Time-based queries for viewing activity over time periods.
 *
 * Usage:
 *   supertag timeline                          # Last 30 days, daily buckets
 *   supertag timeline --from 7d --granularity week
 *   supertag timeline --tag meeting --from 2025-01-01
 *   supertag recent                            # Last 24 hours
 *   supertag recent --period 7d --types meeting,task
 */

import { Command } from "commander";
import { withDatabase } from "../db/with-database";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
} from "./helpers";
import { TimelineService } from "../services/timeline-service";
import {
  type TimeGranularity,
  type TimelineResponse,
  type RecentResponse,
  VALID_GRANULARITIES,
} from "../query/timeline";
import {
  EMOJI,
  header,
  formatDateISO,
  formatDateHuman,
  divider,
} from "../utils/format";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";
import type { StandardOptions } from "../types";

interface TimelineOptions extends StandardOptions {
  from?: string;
  to?: string;
  granularity?: TimeGranularity;
  tag?: string;
  format?: OutputFormat;
  header?: boolean;
}

interface RecentOptions extends StandardOptions {
  period?: string;
  types?: string;
  created?: boolean;
  updated?: boolean;
  format?: OutputFormat;
  header?: boolean;
}

/**
 * Create the timeline command
 */
export function createTimelineCommand(): Command {
  const timeline = new Command("timeline");
  timeline.description("View activity over time periods");

  // Main timeline command
  addStandardOptions(timeline, { defaultLimit: "10" });

  timeline
    .option("--from <date>", "Start date (ISO or relative: 30d, 1m, today)")
    .option("--to <date>", "End date (ISO or relative, default: today)")
    .option(
      "--granularity <level>",
      `Time bucket size: ${VALID_GRANULARITIES.join(", ")}`,
      "day"
    )
    .option("-t, --tag <name>", "Filter by supertag");

  timeline.action(async (options: TimelineOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const limit = options.limit ? parseInt(String(options.limit)) : 10;
    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);

    await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      const service = new TimelineService(ctx.db);

      try {
        const result = await service.timeline({
          from: options.from,
          to: options.to,
          granularity: options.granularity,
          tag: options.tag,
          limit,
        });

        // Table format: rich output
        if (format === "table") {
          printTimelineTable(result, outputOpts.humanDates ?? false);
          return;
        }

        // JSON formats
        if (format === "json" || format === "jsonl" || format === "minimal") {
          console.log(formatJsonOutput(result));
          return;
        }

        // CSV/ids format: flatten buckets
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        const headers = ["bucket", "start", "end", "count"];
        const rows = result.buckets.map((b) => [b.key, b.start, b.end, String(b.count)]);

        formatter.table(headers, rows);
        formatter.finalize();
      } catch (error) {
        console.error(`❌ Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });
  });

  return timeline;
}

/**
 * Create the recent command
 */
export function createRecentCommand(): Command {
  const recent = new Command("recent");
  recent.description("Show recently created or updated items");

  addStandardOptions(recent, { defaultLimit: "20" });

  recent
    .option("-p, --period <period>", "Time period (24h, 7d, 1w, 1m)", "24h")
    .option("--types <tags>", "Filter by supertag types (comma-separated)")
    .option("--created", "Only show created items (not updated)")
    .option("--updated", "Only show updated items (not created)");

  recent.action(async (options: RecentOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const limit = options.limit ? parseInt(String(options.limit)) : 20;
    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);

    // Parse types option
    const types = options.types
      ? options.types.split(",").map((t) => t.trim()).filter((t) => t)
      : undefined;

    await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      const service = new TimelineService(ctx.db);

      try {
        const result = await service.recent({
          period: options.period,
          types,
          createdOnly: options.created,
          updatedOnly: options.updated,
          limit,
        });

        // Table format: rich output
        if (format === "table") {
          printRecentTable(result, outputOpts.humanDates ?? false);
          return;
        }

        // JSON formats
        if (format === "json" || format === "jsonl" || format === "minimal") {
          console.log(formatJsonOutput(result));
          return;
        }

        // CSV/ids format
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        const headers = ["id", "name", "created", "updated", "tag"];
        const rows = result.items.map((item) => [
          item.id,
          item.name,
          item.created ?? "",
          item.updated ?? "",
          item.tag ?? "",
        ]);

        formatter.table(headers, rows);
        formatter.finalize();
      } catch (error) {
        console.error(`❌ Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });
  });

  return recent;
}

/**
 * Print timeline as a rich table
 */
function printTimelineTable(result: TimelineResponse, humanDates: boolean): void {
  const formatDate = humanDates ? formatDateHuman : formatDateISO;

  console.log(
    `\n${header(EMOJI.time, `Timeline: ${result.from} to ${result.to} (${result.granularity})`)}\n`
  );

  if (result.warnings && result.warnings.length > 0) {
    console.log(`⚠️  Warnings: ${result.warnings.join("; ")}\n`);
  }

  console.log(`Total items: ${result.totalCount}\n`);
  console.log(divider(60));

  for (const bucket of result.buckets) {
    const countDisplay = bucket.truncated
      ? `${bucket.items.length}/${bucket.count} items (truncated)`
      : `${bucket.count} items`;

    console.log(`\n📅 ${bucket.key} (${countDisplay})`);
    console.log(`   ${bucket.start} → ${bucket.end}`);

    if (bucket.items.length > 0) {
      for (const item of bucket.items) {
        const tag = item.tag ? ` #${item.tag}` : "";
        console.log(`   • ${item.name}${tag}`);
      }
    } else {
      console.log(`   (no items)`);
    }
  }

  console.log();
}

/**
 * Print recent items as a rich table
 */
function printRecentTable(result: RecentResponse, humanDates: boolean): void {
  const formatDate = humanDates ? formatDateHuman : formatDateISO;

  console.log(`\n${header(EMOJI.recent, `Recent Activity (last ${result.period})`)}\n`);

  if (result.excludedCount && result.excludedCount > 0) {
    console.log(`⚠️  ${result.excludedCount} items excluded (missing timestamps)\n`);
  }

  console.log(`Found ${result.count} items\n`);
  console.log(divider(60));

  if (result.items.length === 0) {
    console.log("\n(no items in this period)");
    return;
  }

  for (let i = 0; i < result.items.length; i++) {
    const item = result.items[i];
    const tag = item.tag ? ` #${item.tag}` : "";

    console.log(`\n${i + 1}. ${item.name}${tag}`);
    console.log(`   ID: ${item.id}`);
    if (item.created) {
      console.log(`   Created: ${formatDate(item.created)}`);
    }
    if (item.updated) {
      console.log(`   Updated: ${formatDate(item.updated)}`);
    }
  }

  console.log();
}
