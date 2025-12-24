/**
 * Unified Search Command
 *
 * Consolidates all search operations into a single command:
 * - FTS (default): Full-text search on node names
 * - Semantic (--semantic): Vector similarity search
 * - Tagged (--tag): Find nodes by supertag
 *
 * Usage:
 *   supertag search <query>                    # FTS search
 *   supertag search <query> --semantic         # Semantic search
 *   supertag search --tag <tagname>            # Find by tag
 *   supertag search <query> --show             # Show full content
 *   supertag search <query> --show --depth 2   # Traverse children
 */

import { Command } from "commander";
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { TanaQueryEngine } from "../query/tana-query-engine";
import { findMeaningfulAncestor } from "../embeddings/ancestor-resolution";
import { ConfigManager } from "../config/manager";
import { resolveWorkspace } from "../config/paths";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
  parseDateRangeOptions,
} from "./helpers";
import {
  tsv,
  EMOJI,
  header,
  table,
  formatDateISO,
  tip,
} from "../utils/format";
import { resolveOutputOptions } from "../utils/output-options";
import {
  getNodeContents,
  getNodeContentsWithDepth,
  formatNodeOutput,
  formatNodeWithDepth,
} from "./show";
import type { StandardOptions, SearchType } from "../types";

interface SearchOptions extends StandardOptions {
  semantic?: boolean;
  tag?: string;
  field?: string;
  ancestor?: boolean;
  raw?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
}

/**
 * Create the unified search command
 */
export function createSearchCommand(): Command {
  const search = new Command("search");

  search
    .description("Search across your Tana data (FTS, semantic, or by tag)")
    .argument("[query]", "Search query (required for FTS/semantic)")
    .option("--semantic", "Use semantic (vector) search instead of FTS")
    .option("-t, --tag <tagname>", "Find nodes with a specific supertag")
    .option("-f, --field <filter>", "Filter by field value (e.g., 'Location=Zurich' or 'Location~Zur')")
    .option("-a, --ancestor", "Show nearest ancestor with supertag (default: true)")
    .option("--no-ancestor", "Disable ancestor resolution")
    .option("--raw", "Return raw results without enrichment")
    .option("--created-after <date>", "Filter nodes created after date (YYYY-MM-DD)")
    .option("--created-before <date>", "Filter nodes created before date (YYYY-MM-DD)")
    .option("--updated-after <date>", "Filter nodes updated after date (YYYY-MM-DD)")
    .option("--updated-before <date>", "Filter nodes updated before date (YYYY-MM-DD)");

  // Add standard options with show and depth
  addStandardOptions(search, {
    includeShow: true,
    includeDepth: true,
    defaultLimit: "20",
  });

  search.action(async (query: string | undefined, options: SearchOptions) => {
    // Determine search type
    const searchType: SearchType = options.semantic
      ? "semantic"
      : options.tag
        ? "tagged"
        : "fts";

    // Validate arguments
    if (searchType === "fts" && !query) {
      console.error("❌ Query is required for full-text search");
      console.error("   Use: supertag search <query>");
      process.exit(1);
    }

    if (searchType === "semantic" && !query) {
      console.error("❌ Query is required for semantic search");
      console.error("   Use: supertag search <query> --semantic");
      process.exit(1);
    }

    if (searchType === "tagged" && !options.tag) {
      console.error("❌ Tag name is required for tag search");
      console.error("   Use: supertag search --tag <tagname>");
      process.exit(1);
    }

    // Resolve database path
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    // Route to appropriate search handler
    switch (searchType) {
      case "fts":
        await handleFtsSearch(query!, options, dbPath);
        break;
      case "semantic":
        await handleSemanticSearch(query!, options, dbPath);
        break;
      case "tagged":
        await handleTaggedSearch(options.tag!, options, dbPath);
        break;
    }
  });

  return search;
}

/**
 * Handle full-text search
 */
async function handleFtsSearch(
  query: string,
  options: SearchOptions,
  dbPath: string
): Promise<void> {
  const engine = new TanaQueryEngine(dbPath);
  const limit = options.limit ? parseInt(String(options.limit)) : 20;
  const depth = options.depth ? parseInt(String(options.depth)) : 0;
  const includeAncestor = options.ancestor !== false && !options.raw;
  const outputOpts = resolveOutputOptions(options);
  const startTime = performance.now();

  try {
    // Ensure FTS index exists
    const hasFTS = await engine.hasFTSIndex();
    if (!hasFTS) {
      console.log("🔄 Creating FTS index...");
      await engine.initializeFTS();
    }

    const dateRange = parseDateRangeOptions(options);
    const results = await engine.searchNodes(query, {
      limit,
      ...dateRange,
    });
    const searchTime = performance.now() - startTime;

    if (options.json) {
      // JSON output
      const enriched = results.map((result) => {
        const item: Record<string, unknown> = {
          id: result.id,
          name: result.name,
          rank: result.rank,
        };

        if (!options.raw) {
          item.tags = engine.getNodeTags(result.id);
        }

        if (includeAncestor) {
          const ancestorResult = findMeaningfulAncestor(engine.rawDb, result.id);
          if (ancestorResult && ancestorResult.depth > 0) {
            item.ancestor = ancestorResult.ancestor;
            item.pathFromAncestor = ancestorResult.path;
            item.depthFromAncestor = ancestorResult.depth;
          }
        }

        // Add full content if --show
        if (options.show) {
          if (depth > 0) {
            const contents = getNodeContentsWithDepth(engine.rawDb, result.id, 0, depth);
            if (contents) {
              item.contents = contents;
            }
          } else {
            const contents = getNodeContents(engine.rawDb, result.id);
            if (contents) {
              item.contents = contents;
            }
          }
        }

        return item;
      });
      console.log(formatJsonOutput(enriched));
    } else if (options.show) {
      // Rich output with full node contents
      console.log(`\n🔍 Search results for "${query}" (${results.length}):\n`);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        console.log(`━━━ Result ${i + 1} ━━━`);

        // Show ancestor context
        if (includeAncestor) {
          const ancestorResult = findMeaningfulAncestor(engine.rawDb, result.id);
          if (ancestorResult && ancestorResult.depth > 0) {
            const tagStr = ancestorResult.ancestor.tags.map(t => `#${t}`).join(" ");
            console.log(`📂 Context: ${ancestorResult.ancestor.name} ${tagStr}`);
          }
        }

        // Show full node content
        if (depth > 0) {
          const output = formatNodeWithDepth(engine.rawDb, result.id, 0, depth, "");
          if (output) {
            console.log(output);
          }
        } else {
          const contents = getNodeContents(engine.rawDb, result.id);
          if (contents) {
            console.log(formatNodeOutput(contents));
          }
        }
        console.log();
      }
    } else {
      if (outputOpts.pretty) {
        // Pretty mode: emoji header, result list
        const headerText = outputOpts.verbose
          ? `Search results for "${query}" (${results.length}) in ${searchTime.toFixed(0)}ms`
          : `Search results for "${query}" (${results.length})`;
        console.log(`\n${header(EMOJI.search, headerText)}:\n`);
        results.forEach((result, i) => {
          const tags = options.raw ? [] : engine.getNodeTags(result.id);
          const tagStr = tags.length > 0 ? ` #${tags.join(" #")}` : "";

          console.log(`${i + 1}. ${result.name || "(unnamed)"}${tagStr}`);
          console.log(`   ID: ${result.id}`);
          console.log(`   Rank: ${result.rank.toFixed(2)}`);

          if (includeAncestor) {
            const ancestorResult = findMeaningfulAncestor(engine.rawDb, result.id);
            if (ancestorResult && ancestorResult.depth > 0) {
              const ancestorTags = ancestorResult.ancestor.tags.map(t => `#${t}`).join(" ");
              console.log(`   📂 ${ancestorResult.ancestor.name} ${ancestorTags}`);
            }
          }
          console.log();
        });
        if (outputOpts.verbose) {
          console.log(`Query time: ${searchTime.toFixed(1)}ms`);
        }
        // Show tip in pretty mode (not when --show is used)
        console.log(tip("Use --show for full node content"));
      } else {
        // Unix mode: TSV output, pipe-friendly
        // Format: id\tname\ttags\trank\tancestor_name
        for (const result of results) {
          const tags = options.raw ? [] : engine.getNodeTags(result.id);
          const tagStr = tags.join(",");
          let ancestorName = "";

          if (includeAncestor) {
            const ancestorResult = findMeaningfulAncestor(engine.rawDb, result.id);
            if (ancestorResult && ancestorResult.depth > 0) {
              ancestorName = ancestorResult.ancestor.name;
            }
          }

          console.log(tsv(result.id, result.name || "", tagStr, result.rank.toFixed(2), ancestorName));
        }
        // Verbose mode: add timing to stderr (to not interfere with TSV parsing)
        if (outputOpts.verbose) {
          console.error(`# Query time: ${searchTime.toFixed(1)}ms, Results: ${results.length}`);
        }
      }
    }
  } finally {
    engine.close();
  }
}

/**
 * Handle semantic (vector) search
 */
async function handleSemanticSearch(
  query: string,
  options: SearchOptions,
  dbPath: string
): Promise<void> {
  const configManager = ConfigManager.getInstance();
  const embeddingConfig = configManager.getEmbeddingConfig();
  const config = configManager.getConfig();
  const wsContext = resolveWorkspace(options.workspace, config);
  const outputOpts = resolveOutputOptions(options);
  const startTime = performance.now();

  const limit = options.limit ? parseInt(String(options.limit)) : 10;
  const depth = options.depth ? parseInt(String(options.depth)) : 0;
  const includeAncestor = options.ancestor !== false;

  // Check if LanceDB exists
  const lanceDbPath = wsContext.dbPath.replace(/\.db$/, ".lance");
  if (!existsSync(lanceDbPath)) {
    console.error(`❌ No embeddings found for workspace "${wsContext.alias}".`);
    console.error("");
    console.error("Run 'supertag embed generate' first to create embeddings.");
    process.exit(1);
  }

  // Import embedding service dynamically
  const { TanaEmbeddingService } = await import("../embeddings/tana-embedding-service");
  const { filterAndDeduplicateResults, getOverfetchLimit } = await import("../embeddings/search-filter");

  const embeddingService = new TanaEmbeddingService(lanceDbPath, {
    model: embeddingConfig.model,
    endpoint: embeddingConfig.endpoint,
  });

  const db = new Database(dbPath);

  try {
    if (!options.json) {
      console.log(`🔍 Searching: "${query}" [${wsContext.alias}]`);
      console.log("");
    }

    // Over-fetch for filtering
    const overfetchLimit = getOverfetchLimit(limit);
    const rawResults = await embeddingService.search(query, overfetchLimit);
    const results = filterAndDeduplicateResults(db, rawResults, limit);
    const searchTime = performance.now() - startTime;

    if (results.length === 0) {
      if (options.json) {
        console.log("[]");
      } else {
        console.log("No results found");
      }
      return;
    }

    if (options.json) {
      const enriched = results.map((r) => {
        let result: Record<string, unknown>;
        if (options.show && depth > 0) {
          const contents = getNodeContentsWithDepth(db, r.nodeId, 0, depth);
          result = {
            ...contents,
            distance: r.distance,
            similarity: r.similarity,
          };
        } else if (options.show) {
          const contents = getNodeContents(db, r.nodeId);
          result = {
            ...contents,
            distance: r.distance,
            similarity: r.similarity,
          };
        } else {
          result = {
            nodeId: r.nodeId,
            name: r.name,
            tags: r.tags,
            distance: r.distance,
            similarity: r.similarity,
          };
        }

        if (includeAncestor) {
          const ancestorResult = findMeaningfulAncestor(db, r.nodeId);
          if (ancestorResult && ancestorResult.depth > 0) {
            result.ancestor = ancestorResult.ancestor;
            result.pathFromAncestor = ancestorResult.path;
            result.depthFromAncestor = ancestorResult.depth;
          }
        }

        return result;
      });
      console.log(formatJsonOutput(enriched));
    } else if (options.show) {
      console.log(`Results (${results.length}):`);
      console.log("");
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const similarity = (r.similarity * 100).toFixed(1);

        console.log(`━━━ Result ${i + 1} ━━━  ${similarity}% similar`);

        if (includeAncestor) {
          const ancestorResult = findMeaningfulAncestor(db, r.nodeId);
          if (ancestorResult && ancestorResult.depth > 0) {
            const tagStr = ancestorResult.ancestor.tags.map(t => `#${t}`).join(" ");
            console.log(`📂 Context: ${ancestorResult.ancestor.name} ${tagStr}`);
          }
        }

        if (depth > 0) {
          const output = formatNodeWithDepth(db, r.nodeId, 0, depth, "");
          if (output) {
            console.log(output);
          }
        } else {
          const contents = getNodeContents(db, r.nodeId);
          if (contents) {
            console.log(formatNodeOutput(contents));
          }
        }
        console.log("");
      }
    } else {
      if (outputOpts.pretty) {
        // Pretty mode: results list with similarity percentage
        const headerText = outputOpts.verbose
          ? `Results (${results.length}) in ${searchTime.toFixed(0)}ms`
          : `Results (${results.length})`;
        console.log(headerText);
        console.log("");
        for (const r of results) {
          const similarity = (r.similarity * 100).toFixed(1);
          const tagStr = r.tags ? ` #${r.tags.join(" #")}` : "";
          console.log(`  ${similarity}%  ${r.name.substring(0, 50)}${tagStr}`);
          console.log(`        ID: ${r.nodeId}`);

          if (includeAncestor) {
            const ancestorResult = findMeaningfulAncestor(db, r.nodeId);
            if (ancestorResult && ancestorResult.depth > 0) {
              const ancestorTagStr = ancestorResult.ancestor.tags.map(t => `#${t}`).join(" ");
              console.log(`        📂 ${ancestorResult.ancestor.name} ${ancestorTagStr}`);
            }
          }
        }
        if (outputOpts.verbose) {
          console.log("");
          console.log(`Query time: ${searchTime.toFixed(1)}ms`);
        }
        // Show tip in pretty mode (not when --show is used)
        console.log(tip("Use --show for full node content"));
      } else {
        // Unix mode: TSV output, pipe-friendly
        // Format: similarity\tid\tname\ttags\tancestor_name
        for (const r of results) {
          const similarity = r.similarity.toFixed(3);
          const tagStr = r.tags ? r.tags.join(",") : "";
          let ancestorName = "";

          if (includeAncestor) {
            const ancestorResult = findMeaningfulAncestor(db, r.nodeId);
            if (ancestorResult && ancestorResult.depth > 0) {
              ancestorName = ancestorResult.ancestor.name;
            }
          }

          console.log(tsv(similarity, r.nodeId, r.name, tagStr, ancestorName));
        }
        // Verbose mode: add timing to stderr (to not interfere with TSV parsing)
        if (outputOpts.verbose) {
          console.error(`# Query time: ${searchTime.toFixed(1)}ms, Results: ${results.length}`);
        }
      }
    }
  } finally {
    embeddingService.close();
    db.close();
  }
}

/**
 * Parse field filter string (e.g., "Location=Zurich" or "Location~Zur")
 * Returns { fieldName, operator, value } or null if invalid
 */
function parseFieldFilter(filter: string): { fieldName: string; operator: "=" | "~"; value: string } | null {
  // Check for exact match (=)
  const exactMatch = filter.match(/^([^=~]+)=(.+)$/);
  if (exactMatch) {
    return { fieldName: exactMatch[1], operator: "=", value: exactMatch[2] };
  }

  // Check for partial match (~)
  const partialMatch = filter.match(/^([^=~]+)~(.+)$/);
  if (partialMatch) {
    return { fieldName: partialMatch[1], operator: "~", value: partialMatch[2] };
  }

  return null;
}

/**
 * Query nodes with tag and field value filter
 */
async function queryNodesWithFieldFilter(
  db: Database,
  tagname: string,
  fieldFilter: { fieldName: string; operator: "=" | "~"; value: string },
  options: { limit?: number; createdAfter?: number; createdBefore?: number }
): Promise<Array<{ id: string; name: string; created?: number }>> {
  const { fieldName, operator, value } = fieldFilter;
  const { limit = 20, createdAfter, createdBefore } = options;

  // Build the SQL query to join nodes, tag_applications, and field_values
  let sql = `
    SELECT DISTINCT n.id, n.name, n.created
    FROM nodes n
    JOIN tag_applications ta ON n.id = ta.node_id
    JOIN field_values fv ON n.id = fv.node_id
    WHERE ta.tag_name = ?
      AND fv.field_name = ?
  `;

  const params: Array<string | number> = [tagname, fieldName];

  // Add value filter based on operator
  if (operator === "=") {
    sql += ` AND fv.field_value = ?`;
    params.push(value);
  } else {
    // Partial match with LIKE
    sql += ` AND fv.field_value LIKE ?`;
    params.push(`%${value}%`);
  }

  // Add date filters if provided
  if (createdAfter) {
    sql += ` AND n.created >= ?`;
    params.push(createdAfter);
  }
  if (createdBefore) {
    sql += ` AND n.created <= ?`;
    params.push(createdBefore);
  }

  sql += ` ORDER BY n.created DESC LIMIT ?`;
  params.push(limit);

  const results = db.query(sql).all(...params) as Array<{
    id: string;
    name: string;
    created: number | null;
  }>;

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    created: r.created ?? undefined,
  }));
}

/**
 * Handle tag-based search
 */
async function handleTaggedSearch(
  tagname: string,
  options: SearchOptions,
  dbPath: string
): Promise<void> {
  const engine = new TanaQueryEngine(dbPath);
  const limit = options.limit ? parseInt(String(options.limit)) : 10;
  const depth = options.depth ? parseInt(String(options.depth)) : 0;
  const dateRange = parseDateRangeOptions(options);

  // Parse field filter if provided
  const fieldFilter = options.field ? parseFieldFilter(options.field) : null;
  if (options.field && !fieldFilter) {
    console.error(`❌ Invalid field filter format: ${options.field}`);
    console.error("   Use: 'FieldName=value' for exact match or 'FieldName~value' for partial match");
    process.exit(1);
  }

  try {
    // If we have a field filter, we need to query with field values
    let results: Array<{ id: string; name: string | null; created?: number | null }>;

    if (fieldFilter) {
      // Query nodes with field value filter
      results = await queryNodesWithFieldFilter(engine.rawDb, tagname, fieldFilter, {
        limit,
        ...dateRange,
      });
    } else {
      results = await engine.findNodesByTag(tagname, {
        limit,
        orderBy: "created",
        ...dateRange,
      });
    }

    // Try case variations if no results (only when no field filter)
    if (results.length === 0 && !fieldFilter) {
      const alternates = [
        tagname.toLowerCase(),
        tagname.charAt(0).toUpperCase() + tagname.slice(1).toLowerCase(),
        tagname.toUpperCase(),
      ];
      for (const alt of alternates) {
        if (alt === tagname) continue;
        results = await engine.findNodesByTag(alt, {
          limit,
          orderBy: "created",
          ...dateRange,
        });
        if (results.length > 0) {
          tagname = alt;
          break;
        }
      }
    }

    if (results.length === 0) {
      if (options.json) {
        console.log("[]");
      } else {
        console.log(`❌ No nodes found with tag "#${tagname}"`);
        console.log(`   Check available tags with: supertag tags list`);
      }
      return;
    }

    if (options.json) {
      if (options.show) {
        // Full content for each node
        const enriched = results.map((node) => {
          if (depth > 0) {
            return getNodeContentsWithDepth(engine.rawDb, node.id, 0, depth);
          } else {
            return getNodeContents(engine.rawDb, node.id);
          }
        }).filter(Boolean);
        console.log(formatJsonOutput(enriched));
      } else {
        console.log(formatJsonOutput(results));
      }
    } else if (options.show) {
      console.log(`\n🏷️  Nodes tagged with #${tagname} (${results.length}):\n`);
      for (const node of results) {
        if (depth > 0) {
          const output = formatNodeWithDepth(engine.rawDb, node.id, 0, depth, "");
          if (output) {
            console.log(output);
          }
        } else {
          const contents = getNodeContents(engine.rawDb, node.id);
          if (contents) {
            console.log(formatNodeOutput(contents));
          }
        }
        console.log();
      }
    } else {
      const outputOpts = resolveOutputOptions(options);

      if (outputOpts.pretty) {
        // Pretty mode: emoji header, result list
        console.log(`\n${header(EMOJI.tags, `Nodes tagged with #${tagname} (${results.length})`)}:\n`);
        results.forEach((node, i) => {
          console.log(`${i + 1}. ${node.name || "(unnamed)"}`);
          console.log(`   ID: ${node.id}`);
          if (node.created) {
            const dateStr = outputOpts.humanDates
              ? new Date(node.created).toLocaleDateString()
              : formatDateISO(node.created);
            console.log(`   Created: ${dateStr}`);
          }
          console.log();
        });
        // Show tip in pretty mode (not when --show is used)
        console.log(tip("Use --show for full node content"));
      } else {
        // Unix mode: TSV output, pipe-friendly
        // Format: id\tname\tcreated
        for (const node of results) {
          const created = node.created ? formatDateISO(node.created) : "";
          console.log(tsv(node.id, node.name || "", created));
        }
      }
    }
  } finally {
    engine.close();
  }
}
