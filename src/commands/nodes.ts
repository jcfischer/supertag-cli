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
import { Database } from "bun:sqlite";
import { TanaQueryEngine } from "../query/tana-query-engine";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
  parseDateRangeOptions,
} from "./helpers";
import {
  getNodeContents,
  getNodeContentsWithDepth,
  formatNodeOutput,
  formatNodeWithDepth,
} from "./show";
import type { StandardOptions } from "../types";

interface NodeShowOptions extends StandardOptions {
  // depth is included via addStandardOptions
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

  showCmd.action((nodeId: string, options: NodeShowOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const db = new Database(dbPath);
    const depth = options.depth ? parseInt(String(options.depth)) : 0;

    try {
      if (depth > 0) {
        if (options.json) {
          const contents = getNodeContentsWithDepth(db, nodeId, 0, depth);
          if (!contents) {
            console.error(`❌ Node not found: ${nodeId}`);
            process.exit(1);
          }
          console.log(formatJsonOutput(contents));
        } else {
          const output = formatNodeWithDepth(db, nodeId, 0, depth);
          if (!output) {
            console.error(`❌ Node not found: ${nodeId}`);
            process.exit(1);
          }
          console.log(output);
        }
      } else {
        const contents = getNodeContents(db, nodeId);
        if (!contents) {
          console.error(`❌ Node not found: ${nodeId}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(formatJsonOutput(contents));
        } else {
          console.log(formatNodeOutput(contents));
        }
      }
    } finally {
      db.close();
    }
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

    const engine = new TanaQueryEngine(dbPath);

    try {
      const graph = await engine.getReferenceGraph(nodeId, 1);

      if (options.json) {
        console.log(formatJsonOutput(graph));
      } else {
        console.log(`\n🔗 References for: ${graph.node.name || nodeId}\n`);

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
      }
    } catch (error) {
      console.error(`❌ Error: ${(error as Error).message}`);
      process.exit(1);
    } finally {
      engine.close();
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

    const engine = new TanaQueryEngine(dbPath);
    const limit = options.limit ? parseInt(String(options.limit)) : 10;
    const dateRange = parseDateRangeOptions(options);

    try {
      const results = await engine.findRecentlyUpdated(limit, dateRange);

      if (options.json) {
        console.log(formatJsonOutput(results));
      } else {
        console.log(`\n⏱️  Recently updated (${results.length}):\n`);
        results.forEach((node, i) => {
          console.log(`${i + 1}. ${node.name || "(unnamed)"}`);
          console.log(`   ID: ${node.id}`);
          if (node.updated) {
            console.log(`   Updated: ${new Date(node.updated).toLocaleString()}`);
          }
          console.log();
        });
      }
    } finally {
      engine.close();
    }
  });

  return nodes;
}
