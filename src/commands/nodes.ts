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
  select?: string;
}

interface NodeRecentOptions extends StandardOptions {
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  select?: string;
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
          const projected = applyProjection(contents, projection);
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
          const projected = applyProjection(contents, projection);
          console.log(formatJsonOutput(projected));
        } else if (outputOpts.pretty) {
          console.log(formatNodeOutput(contents));
        } else {
          // Unix mode: YAML-like record format
          // Apply --select to filter which fields are shown
          const fieldsToShow = selectFields && selectFields.length > 0
            ? new Set(selectFields)
            : null; // null means show all

          console.log("---");
          if (!fieldsToShow || fieldsToShow.has("id")) {
            console.log(`id: ${contents.id}`);
          }
          if (!fieldsToShow || fieldsToShow.has("name")) {
            console.log(`name: ${contents.name}`);
          }
          if ((!fieldsToShow || fieldsToShow.has("tags")) && contents.tags.length > 0) {
            console.log(`tags: ${contents.tags.join(", ")}`);
          }
          if ((!fieldsToShow || fieldsToShow.has("created")) && contents.created) {
            console.log(`created: ${formatDateISO(contents.created)}`);
          }
          if (!fieldsToShow || fieldsToShow.has("fields")) {
            if (contents.fields.length > 0) {
              for (const field of contents.fields) {
                console.log(`${field.fieldName}: ${field.value}`);
              }
            }
          }
          if ((!fieldsToShow || fieldsToShow.has("children")) && contents.children.length > 0) {
            console.log(`children: ${contents.children.length}`);
          }
        }
      }
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
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);

    try {
      await withQueryEngine({ dbPath }, async (ctx) => {
        const graph = await ctx.engine.getReferenceGraph(nodeId, 1);

        if (options.json) {
          const projected = applyProjection(graph, projection);
          console.log(formatJsonOutput(projected));
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
          // Unix mode: TSV output with --select support
          // Default fields: direction, fromId, toId, type, name
          const defaultFields = ["direction", "fromId", "toId", "type", "name"];

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

          for (const ref of allRefs) {
            const fieldsToOutput = selectFields && selectFields.length > 0 ? selectFields : defaultFields;
            const values = fieldsToOutput.map(field => {
              const value = ref[field as keyof typeof ref];
              return value !== undefined ? String(value) : "";
            });

            if (values.length === 1) {
              console.log(values[0]);
            } else {
              console.log(tsv(...values));
            }
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
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);

    await withQueryEngine({ dbPath }, async (ctx) => {
      const results = await ctx.engine.findRecentlyUpdated(limit, dateRange);

      if (options.json) {
        const projectedResults = applyProjectionToArray(results, projection);
        console.log(formatJsonOutput(projectedResults));
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
        // Unix mode: TSV output with --select support
        const defaultFields = ["id", "name", "updated"];
        for (const node of results) {
          const data: Record<string, string> = {
            id: node.id,
            name: node.name || "",
            updated: node.updated ? formatDateISO(new Date(node.updated)) : "",
          };
          const fieldsToOutput = selectFields && selectFields.length > 0 ? selectFields : defaultFields;
          const values = fieldsToOutput.map(field => {
            const value = data[field];
            return value !== undefined ? String(value) : "";
          });

          if (values.length === 1) {
            console.log(values[0]);
          } else {
            console.log(tsv(...values));
          }
        }
      }
    });
  });

  return nodes;
}
