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
} from "../utils/select-projection";
import {
  getNodeContents,
  getNodeContentsWithDepth,
  formatNodeOutput,
  formatNodeWithDepth,
} from "./show";
import {
  tsv,
  EMOJI,
  header,
  formatDateISO,
} from "../utils/format";
import { resolveOutputOptions } from "../utils/output-options";
import type { StandardOptions } from "../types";

interface NodeShowOptions extends StandardOptions {
  // depth is included via addStandardOptions
  select?: string;
}

interface NodeRefsOptions extends StandardOptions {
  // standard options only
}

interface NodeRecentOptions extends StandardOptions {
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
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

    const depth = options.depth ? parseInt(String(options.depth)) : 0;
    const outputOpts = resolveOutputOptions(options);

    // Parse select option for field projection
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);

    await withDatabase({ dbPath, readonly: true }, (ctx) => {
      if (depth > 0) {
        if (options.json) {
          const contents = getNodeContentsWithDepth(ctx.db, nodeId, 0, depth);
          if (!contents) {
            console.error(`❌ Node not found: ${nodeId}`);
            process.exit(1);
          }
          const projected = applyProjection(contents as Record<string, unknown>, projection);
          console.log(formatJsonOutput(projected));
        } else {
          const output = formatNodeWithDepth(ctx.db, nodeId, 0, depth);
          if (!output) {
            console.error(`❌ Node not found: ${nodeId}`);
            process.exit(1);
          }
          console.log(output);
        }
      } else {
        const contents = getNodeContents(ctx.db, nodeId);
        if (!contents) {
          console.error(`❌ Node not found: ${nodeId}`);
          process.exit(1);
        }

        if (options.json) {
          const projected = applyProjection(contents as Record<string, unknown>, projection);
          console.log(formatJsonOutput(projected));
        } else if (outputOpts.pretty) {
          console.log(formatNodeOutput(contents));
        } else {
          // Unix mode: YAML-like record format
          console.log("---");
          console.log(`id: ${contents.id}`);
          console.log(`name: ${contents.name}`);
          if (contents.tags.length > 0) {
            console.log(`tags: ${contents.tags.join(", ")}`);
          }
          if (contents.created) {
            console.log(`created: ${formatDateISO(contents.created)}`);
          }
          if (contents.fields.length > 0) {
            for (const field of contents.fields) {
              console.log(`${field.fieldName}: ${field.value}`);
            }
          }
          if (contents.children.length > 0) {
            console.log(`children: ${contents.children.length}`);
          }
        }
      }
    });
  });

  // nodes refs <node-id>
  const refsCmd = nodes
    .command("refs <node-id>")
    .description("Show references for a node");

  addStandardOptions(refsCmd, { defaultLimit: "10" });

  refsCmd.action(async (nodeId: string, options: NodeRefsOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const outputOpts = resolveOutputOptions(options);

    try {
      await withQueryEngine({ dbPath }, async (ctx) => {
        const graph = await ctx.engine.getReferenceGraph(nodeId, 1);

        if (options.json) {
          console.log(formatJsonOutput(graph));
        } else if (outputOpts.pretty) {
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
        } else {
          // Unix mode: TSV output
          // Format: direction\tfrom_id\tto_id\ttype\tname
          for (const ref of graph.outbound) {
            console.log(tsv("out", nodeId, ref.reference.toNode, ref.reference.referenceType, ref.node?.name || ""));
          }
          for (const ref of graph.inbound) {
            console.log(tsv("in", ref.reference.fromNode, nodeId, ref.reference.referenceType, ref.node?.name || ""));
          }
        }
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
    .option("--updated-before <date>", "Filter nodes updated before date (YYYY-MM-DD)");

  addStandardOptions(recentCmd, { defaultLimit: "10" });

  recentCmd.action(async (options: NodeRecentOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const limit = options.limit ? parseInt(String(options.limit)) : 10;
    const dateRange = parseDateRangeOptions(options);
    const outputOpts = resolveOutputOptions(options);

    await withQueryEngine({ dbPath }, async (ctx) => {
      const results = await ctx.engine.findRecentlyUpdated(limit, dateRange);

      if (options.json) {
        console.log(formatJsonOutput(results));
      } else if (outputOpts.pretty) {
        console.log(`\n${header(EMOJI.recent, `Recently updated (${results.length})`)}:\n`);
        results.forEach((node, i) => {
          console.log(`${i + 1}. ${node.name || "(unnamed)"}`);
          console.log(`   ID: ${node.id}`);
          if (node.updated) {
            console.log(`   Updated: ${new Date(node.updated).toLocaleString()}`);
          }
          console.log();
        });
      } else {
        // Unix mode: TSV output
        // Format: id\tname\tupdated
        for (const node of results) {
          const updated = node.updated ? formatDateISO(new Date(node.updated)) : "";
          console.log(tsv(node.id, node.name || "", updated));
        }
      }
    });
  });

  return nodes;
}
