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
import { findMeaningfulAncestor } from "../embeddings/ancestor-resolution";
import { ConfigManager } from "../config/manager";
import { resolveWorkspaceContext } from "../config/workspace-resolver";
import { withDatabase, withQueryEngine } from "../db/with-database";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
  parseDateRangeOptions,
  parseSelectOption,
  resolveReadBackendFromOptions,
} from "./helpers";
import {
  parseSelectPaths,
  applyProjectionToArray,
} from "../utils/select-projection";
import { buildPagination, buildOrderBy } from "../db/query-builder";
import {
  tsv,
  EMOJI,
  header,
  table,
  formatDateISO,
  tip,
} from "../utils/format";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";
import {
  getNodeContents,
  getNodeContentsWithDepth,
  formatNodeOutput,
  formatNodeWithDepth,
} from "./show";
import type { ReadSearchResult } from "../api/read-backend";
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
  select?: string;
  format?: OutputFormat;
  header?: boolean;
  includeDescendants?: boolean;
  minScore?: string;
  typeHint?: string;
}

/**
 * Build output values based on selected fields
 * @param data - Record containing all available field values
 * @param selectFields - Fields to include (undefined = all fields in order)
 * @param defaultFields - Default field order when no select specified
 * @returns Array of values to output
 */
function buildSelectedOutput(
  data: Record<string, string | number | null | undefined>,
  selectFields: string[] | undefined,
  defaultFields: string[]
): string[] {
  const fields = selectFields && selectFields.length > 0 ? selectFields : defaultFields;
  return fields.map(field => {
    const value = data[field];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}

/**
 * Parse min-score option value to a normalized decimal (0-1)
 *
 * Accepts:
 * - Decimal values: 0.75 → 0.75
 * - Percentage values: 75 → 0.75
 * - Edge cases: 0 → 0, 100 → 1
 *
 * @param value - String value from CLI option
 * @returns Normalized score (0-1) or undefined
 */
export function parseMinScore(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const num = parseFloat(value);
  if (isNaN(num)) return undefined;

  // Determine if this is a percentage (>1) or decimal
  // Special case: "1.0" or "0.5" are clearly decimals
  // Numbers > 1 without decimal point are treated as percentages
  let score: number;
  if (num > 1 && !value.includes(".")) {
    // Treat as percentage
    score = num / 100;
  } else {
    // Treat as decimal
    score = num;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, score));
}

/**
 * Filter search results by minimum similarity score
 *
 * @param results - Array of search results with similarity scores
 * @param minScore - Minimum similarity threshold (0-1)
 * @returns Filtered results with similarity >= minScore
 */
export function filterByMinScore<T extends { similarity: number }>(
  results: T[],
  minScore: number | undefined
): T[] {
  if (minScore === undefined || minScore === null || minScore <= 0) {
    return results;
  }
  return results.filter((r) => r.similarity >= minScore);
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
    .option("--min-score <threshold>", "Minimum similarity threshold for semantic search (0-1 or 0-100)")
    .option("-t, --tag <tagname>", "Find nodes with a specific supertag")
    .option("--include-descendants", "Include nodes with supertags inheriting from --tag")
    .option("-f, --field <filter>", "Filter by field value (e.g., 'Location=Zurich' or 'Location~Zur')")
    .option("-a, --ancestor", "Show nearest ancestor with supertag (default: true)")
    .option("--no-ancestor", "Disable ancestor resolution")
    .option("--raw", "Return raw results without enrichment")
    .option("--created-after <date>", "Filter nodes created after date (YYYY-MM-DD)")
    .option("--created-before <date>", "Filter nodes created before date (YYYY-MM-DD)")
    .option("--updated-after <date>", "Filter nodes updated after date (YYYY-MM-DD)")
    .option("--updated-before <date>", "Filter nodes updated before date (YYYY-MM-DD)")
    .option("--select <fields>", "Select specific fields to output (comma-separated, e.g., id,name,rank)")
    .option("--type-hint <tag>", "Enrich semantic search query with type prefix (e.g., --type-hint project)");

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
        await handleTaggedSearch(options.tag!, query, options, dbPath);  // Spec 089: Pass query
        break;
    }
  });

  return search;
}

/**
 * Handle full-text search
 * Spec: F-097 — Routes through TanaReadBackend (Local API or SQLite)
 */
async function handleFtsSearch(
  query: string,
  options: SearchOptions,
  dbPath: string
): Promise<void> {
  const limit = options.limit ? parseInt(String(options.limit)) : 20;
  const depth = options.depth ? parseInt(String(options.depth)) : 0;
  const includeAncestor = options.ancestor !== false && !options.raw;
  const outputOpts = resolveOutputOptions(options);
  const format = resolveOutputFormat(options);
  const startTime = performance.now();

  // Resolve read backend (Local API or SQLite)
  const readBackend = await resolveReadBackendFromOptions(options);
  const isLive = readBackend.isLive();

  const dateRange = parseDateRangeOptions(options);
  const results = await readBackend.search(query, {
    limit,
    ...dateRange,
  });
  const searchTime = performance.now() - startTime;

  // Lazily-opened SQLite DB for ancestor resolution and show mode (SQLite only)
  let sqliteDb: Database | null = null;
  const getSqliteDb = (): Database => {
    if (!sqliteDb) {
      sqliteDb = new Database(dbPath, { readonly: true });
    }
    return sqliteDb;
  };

  // Dual-path ancestor resolution
  const resolveAncestor = (result: ReadSearchResult): { name: string; fullStr: string } => {
    if (!includeAncestor) return { name: "", fullStr: "" };

    if (isLive && result.breadcrumb && result.breadcrumb.length > 1) {
      const name = result.breadcrumb[result.breadcrumb.length - 2] || "";
      return { name, fullStr: name };
    }
    if (!isLive) {
      const ancestorResult = findMeaningfulAncestor(getSqliteDb(), result.id);
      if (ancestorResult && ancestorResult.depth > 0) {
        const tagStr = ancestorResult.ancestor.tags.map(t => `#${t}`).join(" ");
        return {
          name: ancestorResult.ancestor.name,
          fullStr: `${ancestorResult.ancestor.name} ${tagStr}`,
        };
      }
    }
    return { name: "", fullStr: "" };
  };

  try {
    // Handle --show separately (rich output with full node contents)
    if (options.show && format === "table") {
      console.log(`\n🔍 Search results for "${query}" (${results.length}):\n`);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        console.log(`━━━ Result ${i + 1} ━━━`);

        // Show ancestor context
        const ancestor = resolveAncestor(result);
        if (ancestor.fullStr) {
          console.log(`📂 Context: ${ancestor.fullStr}`);
        }

        // Show full node content
        if (isLive) {
          const nodeContent = await readBackend.readNode(result.id, depth);
          console.log(nodeContent.markdown);
        } else {
          if (depth > 0) {
            const output = formatNodeWithDepth(getSqliteDb(), result.id, 0, depth, "");
            if (output) {
              console.log(output);
            }
          } else {
            const contents = getNodeContents(getSqliteDb(), result.id);
            if (contents) {
              console.log(formatNodeOutput(contents));
            }
          }
        }
        console.log();
      }
      return;
    }

    // Build enriched data for all formats
    const enriched = results.map((result) => {
      const tags = options.raw ? [] : result.tags;
      const ancestor = resolveAncestor(result);

      const item: Record<string, unknown> = {
        id: result.id,
        name: result.name || "",
        tags: tags.join(", "),
        rank: result.rank !== undefined ? result.rank.toFixed(2) : "",
        ancestor: ancestor.name,
      };

      // Add full content if --show (for JSON formats) — SQLite path
      if (options.show && !isLive) {
        if (depth > 0) {
          const contents = getNodeContentsWithDepth(getSqliteDb(), result.id, 0, depth);
          if (contents) {
            item.contents = contents;
          }
        } else {
          const contents = getNodeContents(getSqliteDb(), result.id);
          if (contents) {
            item.contents = contents;
          }
        }
      }

      return item;
    });

    // Add contents for live backend --show mode (async)
    if (options.show && isLive) {
      for (const item of enriched) {
        try {
          const nodeContent = await readBackend.readNode(item.id as string, depth);
          item.contents = nodeContent;
        } catch {
          // Skip nodes that can't be read
        }
      }
    }

    // Create formatter and output based on format
    const formatter = createFormatter({
      format,
      noHeader: options.header === false,
      humanDates: outputOpts.humanDates,
      verbose: outputOpts.verbose,
    });

    // Table format: use actual table output
    if (format === "table") {
      const headerText = outputOpts.verbose
        ? `Search results for "${query}" (${results.length}) in ${searchTime.toFixed(0)}ms`
        : `Search results for "${query}" (${results.length})`;
      console.log(`\n${header(EMOJI.search, headerText)}:\n`);

      // Build table rows
      const tableHeaders = ["#", "Name", "ID", "Tags", "Rank", "Ancestor"];
      const tableRows = results.map((result, i) => {
        const tags = options.raw ? [] : result.tags;
        const tagStr = tags.length > 0 ? `#${tags.join(" #")}` : "";
        const ancestor = resolveAncestor(result);

        return [
          String(i + 1),
          (result.name || "(unnamed)").substring(0, 40),
          result.id,
          tagStr.substring(0, 30),
          result.rank !== undefined ? result.rank.toFixed(2) : "",
          ancestor.fullStr.substring(0, 40),
        ];
      });

      console.log(table(tableHeaders, tableRows, { align: ["right", "left", "left", "left", "right", "left"] }));
      if (outputOpts.verbose) {
        console.log(`\nQuery time: ${searchTime.toFixed(1)}ms`);
      }
      console.log(tip("Use --show for full node content"));
      return;
    }

    // All other formats: use formatter with table data
    // Use lowercase headers for backward-compatible JSON keys
    const headers = ["id", "name", "tags", "rank", "ancestor"];
    const rows = enriched.map((item) => [
      String(item.id),
      String(item.name),
      String(item.tags),
      String(item.rank),
      String(item.ancestor),
    ]);

    // Apply field projection if --select is specified
    const selectFields = parseSelectOption(options.select);
    if (selectFields && selectFields.length > 0) {
      // For JSON formats with --select, use projection
      if (format === "json" || format === "minimal" || format === "jsonl") {
        const projection = parseSelectPaths(selectFields);
        const projectedResults = applyProjectionToArray(enriched, projection);
        console.log(formatJsonOutput(projectedResults));
        return;
      }
    }

    formatter.table(headers, rows);
    formatter.finalize();

    // Verbose mode: add timing to stderr (table format already returned above)
    if (outputOpts.verbose) {
      console.error(`# Query time: ${searchTime.toFixed(1)}ms, Results: ${results.length}`);
    }
  } finally {
    // TS can't track mutation through the getSqliteDb() closure
    (sqliteDb as Database | null)?.close();
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
  const wsContext = resolveWorkspaceContext({
    workspace: options.workspace,
    requireDatabase: false, // Check LanceDB separately below
  });
  const outputOpts = resolveOutputOptions(options);
  const format = resolveOutputFormat(options);
  const startTime = performance.now();

  const limit = options.limit ? parseInt(String(options.limit)) : 10;
  const depth = options.depth ? parseInt(String(options.depth)) : 0;
  const includeAncestor = options.ancestor !== false;
  const minScore = parseMinScore(options.minScore);

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
  const { filterAndDeduplicateResults, getOverfetchLimit, filterByTag } = await import("../embeddings/search-filter");

  const embeddingService = new TanaEmbeddingService(lanceDbPath, {
    model: embeddingConfig.model,
    endpoint: embeddingConfig.endpoint,
  });

  try {
    // Show progress indicator for non-machine formats
    if (format === "table") {
      console.log(`🔍 Searching: "${query}" [${wsContext.alias}]`);
      console.log("");
    }

    // Enrich query with type hint if provided (F-104 graph-aware embeddings)
    const effectiveQuery = options.typeHint
      ? `[Type: #${options.typeHint}] ${query}`
      : query;

    // Over-fetch for filtering (more aggressive if tag filter is specified)
    const baseOverfetch = getOverfetchLimit(limit);
    const overfetchLimit = options.tag ? baseOverfetch * 3 : baseOverfetch;
    const rawResults = await embeddingService.search(effectiveQuery, overfetchLimit);

    await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      const { db } = ctx;
      // Don't apply limit yet - we'll apply it after tag filtering
      const dedupedResults = filterAndDeduplicateResults(db, rawResults);

      // Apply tag filter if specified
      const tagFilteredResults = options.tag
        ? filterByTag(dedupedResults, options.tag)
        : dedupedResults;

      // Apply min-score filter after tag filtering
      const scoreFilteredResults = filterByMinScore(tagFilteredResults, minScore);

      // Now apply limit
      const results = scoreFilteredResults.slice(0, limit);
      const searchTime = performance.now() - startTime;

      if (results.length === 0) {
        if (format === "json" || format === "jsonl" || format === "minimal") {
          console.log("[]");
        } else if (format === "ids" || format === "csv") {
          // Empty output for machine formats
        } else {
          console.log("No results found");
        }
        return;
      }

      // Handle --show separately for table format (rich output)
      if (options.show && format === "table") {
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
        return;
      }

      // Build enriched data for all formats
      const enriched = results.map((r) => {
        let ancestorName = "";
        if (includeAncestor) {
          const ancestorResult = findMeaningfulAncestor(db, r.nodeId);
          if (ancestorResult && ancestorResult.depth > 0) {
            ancestorName = ancestorResult.ancestor.name;
          }
        }

        const item: Record<string, unknown> = {
          id: r.nodeId,
          name: r.name,
          tags: r.tags ? r.tags.join(", ") : "",
          similarity: r.similarity.toFixed(3),
          ancestor: ancestorName,
        };

        // Add full content if --show (for JSON formats)
        if (options.show) {
          if (depth > 0) {
            const contents = getNodeContentsWithDepth(db, r.nodeId, 0, depth);
            if (contents) {
              item.contents = contents;
            }
          } else {
            const contents = getNodeContents(db, r.nodeId);
            if (contents) {
              item.contents = contents;
            }
          }
        }

        return item;
      });

      // Create formatter and output based on format
      const formatter = createFormatter({
        format,
        noHeader: options.header === false,
        humanDates: outputOpts.humanDates,
        verbose: outputOpts.verbose,
      });

      // Table format: use actual table output
      if (format === "table") {
        const headerText = outputOpts.verbose
          ? `Results (${results.length}) in ${searchTime.toFixed(0)}ms`
          : `Results (${results.length})`;
        console.log(headerText);
        console.log("");

        // Build table rows
        const tableHeaders = ["#", "Similarity", "Name", "ID", "Tags", "Ancestor"];
        const tableRows = results.map((r, i) => {
          const similarity = (r.similarity * 100).toFixed(1) + "%";
          const tagStr = r.tags ? `#${r.tags.join(" #")}` : "";

          let ancestorName = "";
          if (includeAncestor) {
            const ancestorResult = findMeaningfulAncestor(db, r.nodeId);
            if (ancestorResult && ancestorResult.depth > 0) {
              const ancestorTagStr = ancestorResult.ancestor.tags.map(t => `#${t}`).join(" ");
              ancestorName = `${ancestorResult.ancestor.name} ${ancestorTagStr}`;
            }
          }

          return [
            String(i + 1),
            similarity,
            r.name.substring(0, 40),
            r.nodeId,
            tagStr.substring(0, 30),
            ancestorName.substring(0, 40),
          ];
        });

        console.log(table(tableHeaders, tableRows, { align: ["right", "right", "left", "left", "left", "left"] }));
        if (outputOpts.verbose) {
          console.log(`\nQuery time: ${searchTime.toFixed(1)}ms`);
        }
        console.log(tip("Use --show for full node content"));
        return;
      }

      // All other formats: use formatter with table data
      // Use lowercase headers for backward-compatible JSON keys
      const headers = ["id", "name", "tags", "similarity", "ancestor"];
      const rows = enriched.map((item) => [
        String(item.id),
        String(item.name),
        String(item.tags),
        String(item.similarity),
        String(item.ancestor),
      ]);

      // Apply field projection if --select is specified
      const selectFields = parseSelectOption(options.select);
      if (selectFields && selectFields.length > 0) {
        // For JSON formats with --select, use projection
        if (format === "json" || format === "minimal" || format === "jsonl") {
          const projection = parseSelectPaths(selectFields);
          const projectedResults = applyProjectionToArray(enriched, projection);
          console.log(formatJsonOutput(projectedResults));
          return;
        }
      }

      formatter.table(headers, rows);
      formatter.finalize();

      // Verbose mode: add timing to stderr (table format already returned above)
      if (outputOpts.verbose) {
        console.error(`# Query time: ${searchTime.toFixed(1)}ms, Results: ${results.length}`);
      }
    });
  } finally {
    embeddingService.close();
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

  // Build base query
  const sqlParts = [
    `SELECT DISTINCT n.id, n.name, n.created
    FROM nodes n
    JOIN tag_applications ta ON n.id = ta.data_node_id
    JOIN field_values fv ON n.id = fv.parent_id
    WHERE ta.tag_name = ?
      AND fv.field_name = ?`,
  ];
  const params: Array<string | number> = [tagname, fieldName];

  // Add value filter based on operator
  if (operator === "=") {
    sqlParts.push("AND fv.value_text = ?");
    params.push(value);
  } else {
    // Partial match with LIKE
    sqlParts.push("AND fv.value_text LIKE ?");
    params.push(`%${value}%`);
  }

  // Add date filters if provided
  if (createdAfter) {
    sqlParts.push("AND n.created >= ?");
    params.push(createdAfter);
  }
  if (createdBefore) {
    sqlParts.push("AND n.created <= ?");
    params.push(createdBefore);
  }

  // Use query builders for ORDER BY and pagination
  const orderBy = buildOrderBy({ sort: "n.created", direction: "DESC" }, []);
  sqlParts.push(orderBy.sql);

  const pagination = buildPagination({ limit });
  if (pagination.sql) {
    sqlParts.push(pagination.sql);
    params.push(...(pagination.params as (string | number)[]));
  }

  const results = db.query(sqlParts.join(" ")).all(...params) as Array<{
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
/**
 * Find all descendant tag IDs for a given tag using recursive CTE
 * Same logic as VisualizationService.getSubtree()
 */
function findDescendantTagIds(db: Database, rootTagName: string): string[] {
  // Find root tag ID (case-insensitive)
  const rootResult = db.query(`
    SELECT tag_id FROM supertag_metadata
    WHERE LOWER(tag_name) = LOWER(?)
  `).get(rootTagName) as { tag_id: string } | null;

  if (!rootResult) {
    return [];
  }

  const rootId = rootResult.tag_id;

  // Get all descendants using recursive CTE
  const descendantRows = db.query(`
    WITH RECURSIVE descendants(tag_id, depth) AS (
      -- Base case: root tag
      SELECT ?, 0

      UNION ALL

      -- Recursive case: children of current nodes
      SELECT sp.child_tag_id, d.depth + 1
      FROM supertag_parents sp
      INNER JOIN descendants d ON sp.parent_tag_id = d.tag_id
      WHERE d.depth < 10
    )
    SELECT DISTINCT tag_id
    FROM descendants
  `).all(rootId) as Array<{ tag_id: string }>;

  return descendantRows.map(r => r.tag_id);
}

async function handleTaggedSearch(
  tagname: string,
  query: string | undefined,  // Spec 089: Filter by name
  options: SearchOptions,
  dbPath: string
): Promise<void> {
  const limit = options.limit ? parseInt(String(options.limit)) : 10;
  const depth = options.depth ? parseInt(String(options.depth)) : 0;
  const dateRange = parseDateRangeOptions(options);
  const outputOpts = resolveOutputOptions(options);
  const format = resolveOutputFormat(options);

  // Parse field filter if provided
  const fieldFilter = options.field ? parseFieldFilter(options.field) : null;
  if (options.field && !fieldFilter) {
    console.error(`❌ Invalid field filter format: ${options.field}`);
    console.error("   Use: 'FieldName=value' for exact match or 'FieldName~value' for partial match");
    process.exit(1);
  }

  await withQueryEngine({ dbPath }, async (ctx) => {
    const { engine } = ctx;

    // If we have a field filter, we need to query with field values
    let results: Array<{ id: string; name: string | null; created?: number | null }>;

    // Get tag IDs to search (either just the specified tag or all descendants)
    let tagIds: string[] = [];
    if (options.includeDescendants) {
      tagIds = findDescendantTagIds(engine.rawDb, tagname);
      if (tagIds.length === 0) {
        if (format === "json" || format === "jsonl" || format === "minimal") {
          console.log("[]");
        } else if (format === "ids" || format === "csv") {
          // Empty output
        } else {
          console.log(`❌ Tag not found: "${tagname}"`);
        }
        return;
      }
    }

    if (fieldFilter) {
      // Query nodes with field value filter
      results = await queryNodesWithFieldFilter(engine.rawDb, tagname, fieldFilter, {
        limit,
        ...dateRange,
      });
    } else if (options.includeDescendants && tagIds.length > 0) {
      // Query for nodes with ANY of the descendant tags
      // First get tag names for all descendant tag IDs
      const tagNameRows = engine.rawDb.query(`
        SELECT tag_id, tag_name
        FROM supertag_metadata
        WHERE tag_id IN (${tagIds.map(() => '?').join(',')})
      `).all(...tagIds) as Array<{ tag_id: string; tag_name: string }>;

      const tagNames = tagNameRows.map(r => r.tag_name);

      if (tagNames.length === 0) {
        results = [];
      } else {
        const placeholders = tagNames.map(() => '?').join(',');
        const sql = `
          SELECT DISTINCT
            n.id,
            n.name,
            n.created
          FROM nodes n
          INNER JOIN tag_applications ta ON n.id = ta.data_node_id
          WHERE ta.tag_name IN (${placeholders})
          ${dateRange.createdAfter ? 'AND n.created > ?' : ''}
          ${dateRange.createdBefore ? 'AND n.created < ?' : ''}
          ${dateRange.updatedAfter ? 'AND n.updated > ?' : ''}
          ${dateRange.updatedBefore ? 'AND n.updated < ?' : ''}
          ORDER BY n.created DESC
          LIMIT ?
        `;
        const params = [
          ...tagNames,
          ...(dateRange.createdAfter ? [dateRange.createdAfter] : []),
          ...(dateRange.createdBefore ? [dateRange.createdBefore] : []),
          ...(dateRange.updatedAfter ? [dateRange.updatedAfter] : []),
          ...(dateRange.updatedBefore ? [dateRange.updatedBefore] : []),
          limit,
        ];
        results = engine.rawDb.query(sql).all(...params) as any;
      }
    } else {
      results = await engine.findNodesByTag(tagname, {
        limit,
        orderBy: "created",
        nameContains: query,  // Spec 089: Filter by name
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
          nameContains: query,  // Spec 089: Pass query to fallback too
          ...dateRange,
        });
        if (results.length > 0) {
          tagname = alt;
          break;
        }
      }
    }

    if (results.length === 0) {
      if (format === "json" || format === "jsonl" || format === "minimal") {
        console.log("[]");
      } else if (format === "ids" || format === "csv") {
        // Empty output for machine formats
      } else {
        console.log(`❌ No nodes found with tag "#${tagname}"`);
        console.log(`   Check available tags with: supertag tags list`);
      }
      return;
    }

    // Handle --show separately for table format (rich output)
    if (options.show && format === "table") {
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
      return;
    }

    // Build enriched data for all formats
    const enriched = results.map((node) => {
      const item: Record<string, unknown> = {
        id: node.id,
        name: node.name || "",
        created: node.created ? formatDateISO(node.created) : "",
      };

      // Add full content if --show (for JSON formats)
      if (options.show) {
        if (depth > 0) {
          const contents = getNodeContentsWithDepth(engine.rawDb, node.id, 0, depth);
          if (contents) {
            item.contents = contents;
          }
        } else {
          const contents = getNodeContents(engine.rawDb, node.id);
          if (contents) {
            item.contents = contents;
          }
        }
      }

      return item;
    });

    // Create formatter and output based on format
    const formatter = createFormatter({
      format,
      noHeader: options.header === false,
      humanDates: outputOpts.humanDates,
      verbose: outputOpts.verbose,
    });

    // Table format: use actual table output
    if (format === "table") {
      console.log(`\n${header(EMOJI.tags, `Nodes tagged with #${tagname} (${results.length})`)}:\n`);

      // Build table rows
      const tableHeaders = ["#", "Name", "ID", "Created"];
      const tableRows = results.map((node, i) => {
        const dateStr = node.created
          ? (outputOpts.humanDates
            ? new Date(node.created).toLocaleDateString()
            : formatDateISO(node.created))
          : "";

        return [
          String(i + 1),
          (node.name || "(unnamed)").substring(0, 50),
          node.id,
          dateStr,
        ];
      });

      console.log(table(tableHeaders, tableRows, { align: ["right", "left", "left", "left"] }));
      console.log(tip("Use --show for full node content"));
      return;
    }

    // All other formats: use formatter with table data
    // Use lowercase headers for backward-compatible JSON keys
    const headers = ["id", "name", "created"];
    const rows = enriched.map((item) => [
      String(item.id),
      String(item.name),
      String(item.created),
    ]);

    // Apply field projection if --select is specified
    const selectFields = parseSelectOption(options.select);
    if (selectFields && selectFields.length > 0) {
      // For JSON formats with --select, use projection
      if (format === "json" || format === "minimal" || format === "jsonl") {
        const projection = parseSelectPaths(selectFields);
        const projectedResults = applyProjectionToArray(enriched, projection);
        console.log(formatJsonOutput(projectedResults));
        return;
      }
    }

    formatter.table(headers, rows);
    formatter.finalize();
  });
}
