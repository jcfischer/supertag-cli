/**
 * Attachments Command Group
 *
 * Discover and extract attachments from Tana exports:
 * - attachments list     - List all attachments
 * - attachments extract  - Download attachments to local directory
 * - attachments get      - Download a single attachment
 * - attachments stats    - Show attachment statistics
 *
 * Usage:
 *   supertag attachments list --format table
 *   supertag attachments extract -o ./downloads --organize-by date
 *   supertag attachments get abc123 -o ./file.png
 *   supertag attachments stats
 */

import { Command } from "commander";
import { withDatabase } from "../db/with-database";
import { resolveDbPath, checkDb, addStandardOptions } from "./helpers";
import { AttachmentService } from "../services/attachment-service";
import type { Attachment, AttachmentOptions, OrganizeBy } from "../types/attachment";
import type { StandardOptions } from "../types";
import { resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";
import { EMOJI, formatNumber, header, table, tsv } from "../utils/format";
import { homedir } from "os";
import { join } from "path";

interface ListOptions extends StandardOptions {
  tag?: string[];
  extension?: string[];
  format?: OutputFormat;
  header?: boolean;
}

interface ExtractOptions extends StandardOptions {
  output?: string;
  organizeBy?: OrganizeBy;
  concurrency?: number;
  skipExisting?: boolean;
  tag?: string[];
  extension?: string[];
  dryRun?: boolean;
}

interface GetOptions extends StandardOptions {
  output?: string;
}

interface StatsOptions extends StandardOptions {
  format?: OutputFormat;
}

/**
 * Create the attachments command group
 */
export function createAttachmentsCommand(): Command {
  const attachments = new Command("attachments");
  attachments.description("Discover and extract attachments from Tana");

  // attachments list
  const listCmd = attachments
    .command("list")
    .description("List all attachments in the database");

  addStandardOptions(listCmd);
  listCmd
    .option("-t, --tag <tags...>", "Filter by tag (can specify multiple)")
    .option("-e, --extension <exts...>", "Filter by extension (can specify multiple)");

  listCmd.action(async (options: ListOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const format = resolveOutputFormat(options);

    await withDatabase({ dbPath, readonly: true }, (ctx) => {
      const service = new AttachmentService(ctx.db);
      const attachments = service.list({
        tags: options.tag,
        extensions: options.extension,
        limit: options.limit ? parseInt(String(options.limit)) : undefined,
      });

      if (attachments.length === 0) {
        console.error("No attachments found.");
        return;
      }

      formatAttachmentList(attachments, format, options.header !== false);
    });
  });

  // attachments extract
  const extractCmd = attachments
    .command("extract")
    .description("Download attachments to local directory");

  addStandardOptions(extractCmd);
  extractCmd
    .option("-o, --output <dir>", "Output directory", join(homedir(), "Downloads", "tana-attachments"))
    .option("--organize-by <strategy>", "Organization: flat, date, tag, node", "flat")
    .option("-c, --concurrency <n>", "Parallel downloads (1-10)", "3")
    .option("--skip-existing", "Skip files that already exist")
    .option("-t, --tag <tags...>", "Filter by tag")
    .option("-e, --extension <exts...>", "Filter by extension")
    .option("--dry-run", "List files without downloading");

  extractCmd.action(async (options: ExtractOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      const service = new AttachmentService(ctx.db);

      // Dry run mode - just list what would be downloaded
      if (options.dryRun) {
        const attachments = service.list({
          tags: options.tag,
          extensions: options.extension,
        });
        console.log(`Would download ${attachments.length} attachments to: ${options.output}`);
        attachments.forEach((a) => console.log(`  - ${a.filename} (${a.extension})`));
        return;
      }

      console.error(`${EMOJI.download} Extracting attachments to: ${options.output}`);

      const extractOptions: AttachmentOptions = {
        outputDir: options.output!,
        organizeBy: options.organizeBy as OrganizeBy,
        concurrency: options.concurrency ? parseInt(String(options.concurrency)) : 3,
        skipExisting: options.skipExisting || false,
        tags: options.tag,
        extensions: options.extension,
        verbose: options.verbose || false,
      };

      const summary = await service.extract(extractOptions);

      // Show summary
      console.log("");
      console.log(header(EMOJI.check, "Extraction Complete"));
      console.log(`  ${EMOJI.info} Found: ${summary.totalFound}`);
      console.log(`  ${EMOJI.check} Downloaded: ${summary.downloaded}`);
      if (summary.skipped > 0) {
        console.log(`  ${EMOJI.skip} Skipped: ${summary.skipped}`);
      }
      if (summary.failed > 0) {
        console.log(`  ${EMOJI.error} Failed: ${summary.failed}`);
      }
      console.log(`  ${EMOJI.folder} Output: ${summary.outputDir}`);
      console.log(`  ${EMOJI.time} Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
      console.log(`  ${EMOJI.data} Size: ${formatBytes(summary.totalBytes)}`);

      // Show errors if any
      if (summary.errors && summary.errors.length > 0) {
        console.log("");
        console.log(header(EMOJI.error, "Errors"));
        summary.errors.slice(0, 10).forEach((e) => {
          console.log(`  ${EMOJI.error} ${e.nodeId}: ${e.error}`);
        });
        if (summary.errors.length > 10) {
          console.log(`  ... and ${summary.errors.length - 10} more errors`);
        }
      }
    });
  });

  // attachments get <nodeId>
  const getCmd = attachments
    .command("get [nodeId]")
    .description("Download a single attachment by node ID")
    .usage("--id <nodeId> [options]");

  addStandardOptions(getCmd);
  getCmd
    .option("-o, --output <path>", "Output file path")
    .option("--id <nodeId>", "Node ID (use this for IDs starting with -)");

  getCmd.action(async (nodeIdArg: string | undefined, options: GetOptions & { id?: string }) => {
    const nodeId = options.id || nodeIdArg;
    if (!nodeId) {
      console.error("Error: node ID is required. Use: attachments get <nodeId> or attachments get --id <nodeId>");
      process.exit(1);
    }
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      const service = new AttachmentService(ctx.db);

      const result = await service.downloadOne(nodeId, options.output);

      if (result.success) {
        if (result.skipped) {
          console.log(`${EMOJI.skip} Skipped (already exists): ${result.localPath}`);
        } else {
          console.log(`${EMOJI.check} Downloaded: ${result.localPath}`);
          if (result.bytesDownloaded) {
            console.log(`   Size: ${formatBytes(result.bytesDownloaded)}`);
          }
        }
      } else {
        console.error(`${EMOJI.error} Failed: ${result.error}`);
        process.exit(1);
      }
    });
  });

  // attachments stats
  const statsCmd = attachments
    .command("stats")
    .description("Show attachment statistics");

  addStandardOptions(statsCmd);

  statsCmd.action(async (options: StatsOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const format = resolveOutputFormat(options);

    await withDatabase({ dbPath, readonly: true }, (ctx) => {
      const service = new AttachmentService(ctx.db);
      const stats = service.stats();

      if (format === "json") {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(header(EMOJI.stats, "Attachment Statistics"));
      console.log(`  Total: ${formatNumber(stats.total)}`);
      console.log("");

      console.log("By Extension:");
      const sortedExts = Object.entries(stats.byExtension)
        .sort((a, b) => b[1] - a[1]);
      sortedExts.forEach(([ext, count]) => {
        console.log(`  .${ext}: ${formatNumber(count)}`);
      });

      if (Object.keys(stats.byTag).length > 0) {
        console.log("");
        console.log("By Tag:");
        const sortedTags = Object.entries(stats.byTag)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        sortedTags.forEach(([tag, count]) => {
          console.log(`  ${tag}: ${formatNumber(count)}`);
        });
      }
    });
  });

  return attachments;
}

/**
 * Format attachment list based on output format
 */
function formatAttachmentList(
  attachments: Attachment[],
  format: OutputFormat,
  showHeader: boolean
): void {
  const formatter = createFormatter({ format, noHeader: !showHeader });

  if (format === "table") {
    console.log(header(EMOJI.file, `Attachments (${attachments.length})`));
    console.log("");
    for (const a of attachments) {
      const tagsStr = a.tags.length > 0 ? ` [${a.tags.join(", ")}]` : "";
      console.log(`${EMOJI.file} ${a.filename}${tagsStr}`);
      console.log(`   ID: ${a.nodeId} | Type: ${a.extension}`);
      if (a.parentName) {
        console.log(`   Parent: ${a.parentName}`);
      }
    }
    return;
  }

  if (format === "json") {
    console.log(JSON.stringify(attachments, null, 2));
    return;
  }

  if (format === "jsonl") {
    for (const a of attachments) {
      console.log(JSON.stringify(a));
    }
    return;
  }

  if (format === "ids") {
    for (const a of attachments) {
      console.log(a.nodeId);
    }
    return;
  }

  if (format === "minimal") {
    const minimal = attachments.map((a) => ({
      nodeId: a.nodeId,
      filename: a.filename,
      extension: a.extension,
    }));
    console.log(JSON.stringify(minimal, null, 2));
    return;
  }

  if (format === "csv") {
    const headers = ["nodeId", "filename", "extension", "parentId", "parentName", "tags", "created"];
    const rows = attachments.map((a) => [
      a.nodeId,
      a.filename,
      a.extension,
      a.parentId || "",
      a.parentName || "",
      a.tags.join(";"),
      a.created ? new Date(a.created).toISOString() : "",
    ]);
    formatter.table(headers, rows);
    return;
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
