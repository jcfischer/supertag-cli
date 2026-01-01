#!/usr/bin/env bun

/**
 * Tana Query CLI - Query indexed Tana data
 *
 * Usage:
 *   tana-query search "keyword"           # Full-text search
 *   tana-query nodes --pattern "Name%"    # Find nodes by name pattern
 *   tana-query tags                       # List all supertags
 *   tana-query refs <node-id>             # Show references for node
 *   tana-query stats                      # Database statistics
 */

import { Command } from "commander";
import { TanaQueryEngine } from "../query/tana-query-engine";
import { TanaIndexer } from "../db/indexer";
import { existsSync } from "fs";
import { getDatabasePath } from "../config/paths";
import { VERSION } from "../version";
import { hasGlobalLogger, getGlobalLogger, createLogger, type Logger } from "../utils/logger";

// Get logger - use global if available, otherwise create a default
function getLogger(): Logger {
  if (hasGlobalLogger()) {
    return getGlobalLogger().child("query");
  }
  return createLogger({ level: "info", mode: "pretty" }).child("query");
}

const program = new Command();

// Default database path - uses XDG paths with legacy fallback
const DEFAULT_DB_PATH = getDatabasePath();

program
  .name("tana-query")
  .description("Query indexed Tana data")
  .version(VERSION);

program
  .command("search <query>")
  .description("Full-text search on node names (resolves to tagged ancestors by default)")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--limit <n>", "Limit results", "20")
  .option("--json", "Output as JSON", false)
  .option("--raw", "Return raw search results without resolution", false)
  .option("-n, --resolve-named", "Resolve to nearest named ancestor instead of tagged", false)
  .action(async (query, options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      console.error(`   Run 'tana-sync index' first`);
      process.exit(1);
    }

    const engine = new TanaQueryEngine(options.dbPath);

    // Ensure FTS index exists
    const hasFTS = await engine.hasFTSIndex();
    if (!hasFTS) {
      console.log("🔄 Creating FTS index...");
      await engine.initializeFTS();
    }

    const results = await engine.searchNodes(query, {
      limit: parseInt(options.limit),
    });

    if (options.raw) {
      // Raw mode: return unresolved search results
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(`\n🔍 Search results for "${query}" (${results.length}):\n`);
        results.forEach((result, i) => {
          console.log(`${i + 1}. ${result.name}`);
          console.log(`   ID: ${result.id}`);
          console.log(`   Rank: ${result.rank.toFixed(2)}`);
          console.log();
        });
      }
    } else {
      // Default: resolve to ancestors (tagged by default, named with -n)
      const indexer = new TanaIndexer(options.dbPath);
      const nodeIds = results.map((r) => r.id);

      const ancestorMap = options.resolveNamed
        ? await indexer.findNamedAncestors(nodeIds)
        : await indexer.findTaggedAncestors(nodeIds);

      // Deduplicate ancestors and get their tags
      const uniqueAncestors = new Map<string, { node: any; tags: string[]; matchCount: number }>();
      for (const result of results) {
        const ancestor = ancestorMap.get(result.id);
        if (ancestor) {
          if (uniqueAncestors.has(ancestor.id)) {
            uniqueAncestors.get(ancestor.id)!.matchCount++;
          } else {
            // Get tags for this ancestor
            const tags = engine.getNodeTags(ancestor.id);
            uniqueAncestors.set(ancestor.id, { node: ancestor, tags, matchCount: 1 });
          }
        }
      }

      indexer.close();

      const resolveType = options.resolveNamed ? "named" : "tagged";

      if (options.json) {
        const output = Array.from(uniqueAncestors.values()).map((a) => ({
          id: a.node.id,
          name: a.node.name,
          tags: a.tags,
          matchCount: a.matchCount,
        }));
        console.log(JSON.stringify(output, null, 2));
      } else {
        const ancestors = Array.from(uniqueAncestors.values());
        console.log(`\n🔍 Search results for "${query}" - resolved to ${ancestors.length} ${resolveType} nodes:\n`);
        ancestors.forEach((a, i) => {
          const tagStr = a.tags.length > 0 ? ` #${a.tags.join(" #")}` : "";
          console.log(`${i + 1}. ${a.node.name || "(unnamed)"}${tagStr}`);
          console.log(`   ID: ${a.node.id}`);
          console.log(`   Matches: ${a.matchCount} child node(s) matched`);
          console.log();
        });
      }
    }

    engine.close();
  });

program
  .command("nodes")
  .description("Find nodes by criteria")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--name <name>", "Exact name match")
  .option("--pattern <pattern>", "Name pattern (SQL LIKE)")
  .option("--tag <tag>", "Filter by supertag")
  .option("--limit <n>", "Limit results", "20")
  .option("--json", "Output as JSON", false)
  .action(async (options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const engine = new TanaQueryEngine(options.dbPath);

    const results = await engine.findNodes({
      name: options.name,
      namePattern: options.pattern,
      supertag: options.tag,
      limit: parseInt(options.limit),
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(`\n📄 Found ${results.length} nodes:\n`);
      results.forEach((node, i) => {
        console.log(`${i + 1}. ${node.name || "(unnamed)"}`);
        console.log(`   ID: ${node.id}`);
        if (node.created) {
          console.log(`   Created: ${new Date(node.created).toLocaleDateString()}`);
        }
        console.log();
      });
    }

    engine.close();
  });

program
  .command("tags")
  .description("List all supertags with counts")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--top <n>", "Show only top N tags", "20")
  .option("--json", "Output as JSON", false)
  .action(async (options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const engine = new TanaQueryEngine(options.dbPath);

    const tags = await engine.getTopSupertags(parseInt(options.top));

    if (options.json) {
      console.log(JSON.stringify(tags, null, 2));
    } else {
      console.log(`\n🏷️  Top ${tags.length} supertags:\n`);
      tags.forEach((tag, i) => {
        console.log(`${i + 1}. ${tag.tagName} (${tag.count} nodes)`);
        console.log(`   ID: ${tag.tagId}`);
        console.log();
      });
    }

    engine.close();
  });

program
  .command("refs <node-id>")
  .description("Show references for a node")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--json", "Output as JSON", false)
  .action(async (nodeId, options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const engine = new TanaQueryEngine(options.dbPath);

    try {
      const graph = await engine.getReferenceGraph(nodeId, 1);

      if (options.json) {
        console.log(JSON.stringify(graph, null, 2));
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
    }

    engine.close();
  });

program
  .command("stats")
  .description("Show database statistics")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--json", "Output as JSON", false)
  .action(async (options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const engine = new TanaQueryEngine(options.dbPath);

    const stats = await engine.getStatistics();

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`\n📊 Database Statistics:\n`);
      console.log(`   Total Nodes: ${stats.totalNodes.toLocaleString()}`);
      console.log(`   Total Supertags: ${stats.totalSupertags.toLocaleString()}`);
      console.log(`   Total Fields: ${stats.totalFields.toLocaleString()}`);
      console.log(`   Total References: ${stats.totalReferences.toLocaleString()}`);
      console.log();
    }

    engine.close();
  });

program
  .command("tagged <tagname>")
  .description("Find nodes with a specific supertag applied")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--limit <n>", "Limit results", "10")
  .option("--order-by <field>", "Order by field (created or updated)", "created")
  .option("--json", "Output as JSON", false)
  .option("-i, --case-insensitive", "Case-insensitive tag matching", false)
  .action(async (tagname, options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const engine = new TanaQueryEngine(options.dbPath);

    // Handle case-insensitive matching
    let results = await engine.findNodesByTag(tagname, {
      limit: parseInt(options.limit),
      orderBy: options.orderBy as "created" | "updated",
    });

    // If no results and case-insensitive, try alternate cases
    if (results.length === 0 && options.caseInsensitive) {
      const alternates = [
        tagname.toLowerCase(),
        tagname.charAt(0).toUpperCase() + tagname.slice(1).toLowerCase(),
        tagname.toUpperCase(),
      ];
      for (const alt of alternates) {
        if (alt === tagname) continue;
        results = await engine.findNodesByTag(alt, {
          limit: parseInt(options.limit),
          orderBy: options.orderBy as "created" | "updated",
        });
        if (results.length > 0) {
          tagname = alt; // Update for display
          break;
        }
      }
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(`\n🏷️  Nodes tagged with #${tagname} (${results.length}):\n`);
      results.forEach((node, i) => {
        console.log(`${i + 1}. ${node.name || "(unnamed)"}`);
        console.log(`   ID: ${node.id}`);
        if (node.created) {
          console.log(`   Created: ${new Date(node.created).toLocaleDateString()}`);
        }
        console.log();
      });

      if (results.length === 0) {
        console.log(`   No nodes found with tag "#${tagname}"`);
        console.log(`   Try --case-insensitive or check available tags with: tana-query top-tags`);
      }
    }

    engine.close();
  });

program
  .command("top-tags")
  .description("Show most used supertags by application count")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--limit <n>", "Number of tags to show", "20")
  .option("--json", "Output as JSON", false)
  .action(async (options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const engine = new TanaQueryEngine(options.dbPath);

    const tags = await engine.getTopTagsByUsage(parseInt(options.limit));

    if (options.json) {
      console.log(JSON.stringify(tags, null, 2));
    } else {
      console.log(`\n🏷️  Top ${tags.length} supertags by usage:\n`);
      tags.forEach((tag, i) => {
        console.log(`${i + 1}. #${tag.tagName} (${tag.count} nodes)`);
      });
      console.log();
    }

    engine.close();
  });

program
  .command("recent")
  .description("Show recently updated nodes")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--limit <n>", "Number of nodes", "10")
  .option("--json", "Output as JSON", false)
  .action(async (options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const engine = new TanaQueryEngine(options.dbPath);

    const results = await engine.findRecentlyUpdated(parseInt(options.limit));

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
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

    engine.close();
  });

program.parse();
