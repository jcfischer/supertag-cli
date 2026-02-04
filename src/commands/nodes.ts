/**
 * Nodes Command Group
 *
 * Consolidates node access operations:
 * - nodes show <id>   - Display node contents (replaces show node)
 * - nodes refs <id>   - Show reference graph (replaces query refs)
 * - nodes recent      - Recently updated nodes (replaces query recent)
 *
 * Usage:
 *   supertag nodes show abc123             # Show node by ID
 *   supertag nodes show abc123 --depth 3   # Traverse children
 *   supertag nodes refs abc123             # Show references
 *   supertag nodes recent --limit 20       # Recent nodes
 */

import { Command } from "commander";
import { withDatabase, withQueryEngine } from "../db/with-database";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
  parseDateRangeOptions,
  parseSelectOption,
} from "./helpers";
import {
  parseSelectPaths,
  applyProjection,
  applyProjectionToArray,
} from "../utils/select-projection";
import {
  getNodeContents,
  getNodeContentsWithDepth,
  formatNodeOutput,
  formatNodeWithDepth,
  resolveEffectiveDepth,
} from "./show";
import {
  tsv,
  EMOJI,
  header,
  formatDateISO,
} from "../utils/format";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";
import type { StandardOptions } from "../types";

interface NodeShowOptions extends StandardOptions {
  // depth is included via addStandardOptions
  select?: string;
  format?: OutputFormat;
  header?: boolean;
}

interface NodeRefsOptions extends StandardOptions {
  select?: string;
  format?: OutputFormat;
  header?: boolean;
}

interface NodeRecentOptions extends StandardOptions {
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  select?: string;
  format?: OutputFormat;
  header?: boolean;
}

/**
 * Create the nodes command group
 */
export function createNodesCommand(): Command {
  const nodes = new Command("nodes");
  nodes.description("Work with specific nodes (show, refs, recent)");

  // nodes show <node-id>
  const showCmd = nodes
    .command("show <node-id>")
    .description("Show contents of a specific node by ID");

  addStandardOptions(showCmd, {
    includeDepth: true,
    defaultLimit: "1",
  });

  showCmd.option("--select <fields>", "Select specific fields in JSON output (comma-separated, e.g., id,name,fields)");

  showCmd.action(async (nodeId: string, options: NodeShowOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const requestedDepth = options.depth ? parseInt(String(options.depth)) : 0;
    const depthExplicitlySet = showCmd.getOptionValueSource("depth") === "cli";
    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);

    // Parse select option for field projection
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);

    await withDatabase({ dbPath, readonly: true }, (ctx) => {
      // Resolve effective depth: calendar/day pages auto-expand to depth 1
      const depth = resolveEffectiveDepth(ctx.db, nodeId, requestedDepth, depthExplicitlySet);

      // Get node contents (with or without depth)
      const contents = depth > 0
        ? getNodeContentsWithDepth(ctx.db, nodeId, 0, depth)
        : getNodeContents(ctx.db, nodeId);

      if (!contents) {
        console.error(`❌ Node not found: ${nodeId}`);
        process.exit(1);
      }

      // Table format: use rich pretty output
      if (format === "table") {
        if (depth > 0) {
          const output = formatNodeWithDepth(ctx.db, nodeId, 0, depth);
          if (output) {
            console.log(output);
          }
        } else {
          // For depth=0, contents is NodeContents type
          const nodeContents = getNodeContents(ctx.db, nodeId);
          if (nodeContents) {
            console.log(formatNodeOutput(nodeContents));
          }
        }
        return;
      }

      // JSON formats: use projection and format output
      if (format === "json" || format === "jsonl" || format === "minimal") {
        const projected = applyProjection(contents, projection);
        console.log(formatJsonOutput(projected));
        return;
      }

      // CSV and IDs formats: extract single record data
      const formatter = createFormatter({
        format,
        noHeader: options.header === false,
        humanDates: outputOpts.humanDates,
        verbose: outputOpts.verbose,
      });

      // For single-node show, use record() instead of table()
      formatter.record({
        id: contents.id,
        name: contents.name,
        tags: contents.tags.join(", "),
        created: contents.created ? formatDateISO(contents.created) : "",
        fields: contents.fields.map(f => `${f.fieldName}=${f.value}`).join("; "),
        children: contents.children.length,
      });
      formatter.finalize();
    });
  });

  // nodes refs <node-id>
  const refsCmd = nodes
    .command("refs <node-id>")
    .description("Show references for a node")
    .option("--select <fields>", "Select specific fields to output (comma-separated, e.g., direction,type)");

  addStandardOptions(refsCmd, { defaultLimit: "10" });

  refsCmd.action(async (nodeId: string, options: NodeRefsOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);

    try {
      await withQueryEngine({ dbPath }, async (ctx) => {
        const graph = await ctx.engine.getReferenceGraph(nodeId, 1);

        // Build enriched data for all formats
        const allRefs = [
          ...graph.outbound.map(ref => ({
            direction: "out",
            fromId: nodeId,
            toId: ref.reference.toNode,
            type: ref.reference.referenceType,
            name: ref.node?.name || "",
          })),
          ...graph.inbound.map(ref => ({
            direction: "in",
            fromId: ref.reference.fromNode,
            toId: nodeId,
            type: ref.reference.referenceType,
            name: ref.node?.name || "",
          })),
        ];

        // Table format: use rich pretty output
        if (format === "table") {
          console.log(`\n${header(EMOJI.link, `References for: ${graph.node.name || nodeId}`)}:\n`);

          console.log(`📤 Outbound references (${graph.outbound.length}):`);
          graph.outbound.forEach((ref) => {
            console.log(`  → ${ref.node?.name || ref.reference.toNode}`);
            console.log(`     Type: ${ref.reference.referenceType}`);
          });

          console.log(`\n📥 Inbound references (${graph.inbound.length}):`);
          graph.inbound.forEach((ref) => {
            console.log(`  ← ${ref.node?.name || ref.reference.fromNode}`);
            console.log(`     Type: ${ref.reference.referenceType}`);
          });
          return;
        }

        // Apply field projection for JSON formats with --select
        if (selectFields && selectFields.length > 0) {
          if (format === "json" || format === "minimal" || format === "jsonl") {
            const projected = applyProjection(graph, projection);
            console.log(formatJsonOutput(projected));
            return;
          }
        }

        // Create formatter and output based on format
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        // Use lowercase headers for backward-compatible JSON keys
        const headers = ["direction", "fromId", "toId", "type", "name"];
        const rows = allRefs.map((ref) => [
          ref.direction,
          ref.fromId,
          ref.toId,
          ref.type,
          ref.name,
        ]);

        formatter.table(headers, rows);
        formatter.finalize();
      });
    } catch (error) {
      console.error(`❌ Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

  // nodes recent
  const recentCmd = nodes
    .command("recent")
    .description("Show recently updated nodes")
    .option("--created-after <date>", "Filter nodes created after date (YYYY-MM-DD)")
    .option("--created-before <date>", "Filter nodes created before date (YYYY-MM-DD)")
    .option("--updated-after <date>", "Filter nodes updated after date (YYYY-MM-DD)")
    .option("--updated-before <date>", "Filter nodes updated before date (YYYY-MM-DD)")
    .option("--select <fields>", "Select specific fields to output (comma-separated, e.g., id,name)");

  addStandardOptions(recentCmd, { defaultLimit: "10" });

  recentCmd.action(async (options: NodeRecentOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const limit = options.limit ? parseInt(String(options.limit)) : 10;
    const dateRange = parseDateRangeOptions(options);
    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);

    await withQueryEngine({ dbPath }, async (ctx) => {
      const results = await ctx.engine.findRecentlyUpdated(limit, dateRange);

      // Build enriched data for all formats
      const enriched = results.map((node) => ({
        id: node.id,
        name: node.name || "",
        updated: node.updated ? formatDateISO(new Date(node.updated)) : "",
      }));

      // Table format: use rich pretty output
      if (format === "table") {
        console.log(`\n${header(EMOJI.recent, `Recently updated (${results.length})`)}:\n`);
        results.forEach((node, i) => {
          console.log(`${i + 1}. ${node.name || "(unnamed)"}`);
          console.log(`   ID: ${node.id}`);
          if (node.updated) {
            console.log(`   Updated: ${new Date(node.updated).toLocaleString()}`);
          }
          console.log();
        });
        return;
      }

      // Apply field projection for JSON formats with --select
      if (selectFields && selectFields.length > 0) {
        if (format === "json" || format === "minimal" || format === "jsonl") {
          const projectedResults = applyProjectionToArray(results, projection);
          console.log(formatJsonOutput(projectedResults));
          return;
        }
      }

      // Create formatter and output based on format
      const formatter = createFormatter({
        format,
        noHeader: options.header === false,
        humanDates: outputOpts.humanDates,
        verbose: outputOpts.verbose,
      });

      // Use lowercase headers for backward-compatible JSON keys
      const headers = ["id", "name", "updated"];
      const rows = enriched.map((item) => [
        item.id,
        item.name,
        item.updated,
      ]);

      formatter.table(headers, rows);
      formatter.finalize();
    });
  });

  return nodes;
}
