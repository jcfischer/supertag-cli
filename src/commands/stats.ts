/**
 * Stats Command
 *
 * Consolidates statistics operations:
 * - stats           - Show all statistics (default)
 * - stats --db      - Database stats only (replaces query stats)
 * - stats --embed   - Embedding stats only (replaces embed stats)
 * - stats --filter  - Content filter breakdown (replaces embed filter-stats)
 *
 * Usage:
 *   supertag stats                    # All stats
 *   supertag stats --db               # Database only
 *   supertag stats --embed            # Embedding only
 *   supertag stats --filter           # Filter breakdown
 */

import { Command } from "commander";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { TanaQueryEngine } from "../query/tana-query-engine";
import { resolveWorkspaceContext } from "../config/workspace-resolver";
import { ConfigManager } from "../config/manager";
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
import { resolveOutputOptions } from "../utils/output-options";
import { getFilterStats } from "../embeddings/content-filter";
import type { StandardOptions, StatsType } from "../types";

interface StatsOptions extends StandardOptions {
  db?: boolean;
  embed?: boolean;
  filter?: boolean;
}

/**
 * Create the unified stats command
 */
export function createStatsCommand(): Command {
  const stats = new Command("stats");
  stats
    .description("Show database and embedding statistics")
    .option("--db", "Show database statistics only")
    .option("--embed", "Show embedding statistics only")
    .option("--filter", "Show content filter breakdown");

  addStandardOptions(stats, { defaultLimit: "1" });

  stats.action(async (options: StatsOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    // Determine what stats to show
    const showAll = !options.db && !options.embed && !options.filter;
    const showDb = showAll || options.db;
    const showEmbed = showAll || options.embed;
    const showFilter = options.filter;

    const wsContext = resolveWorkspaceContext({
      workspace: options.workspace,
      requireDatabase: false, // Already checked via resolveDbPath
    });

    const results: Record<string, unknown> = {};

    const outputOpts = resolveOutputOptions(options);

    // Database stats
    if (showDb) {
      const engine = new TanaQueryEngine(dbPath);
      try {
        const dbStats = await engine.getStatistics();
        results.database = dbStats;

        if (!options.json) {
          if (outputOpts.pretty) {
            // Pretty mode: emoji header, formatted numbers
            console.log(`\n${header(EMOJI.stats, `Database Statistics [${wsContext.alias}]`)}:\n`);
            console.log(`   Total Nodes: ${formatNumber(dbStats.totalNodes, true)}`);
            console.log(`   Total Supertags: ${formatNumber(dbStats.totalSupertags, true)}`);
            console.log(`   Total Fields: ${formatNumber(dbStats.totalFields, true)}`);
            console.log(`   Total References: ${formatNumber(dbStats.totalReferences, true)}`);
          } else {
            // Unix mode: TSV key-value output
            console.log(tsv("nodes", dbStats.totalNodes));
            console.log(tsv("supertags", dbStats.totalSupertags));
            console.log(tsv("fields", dbStats.totalFields));
            console.log(tsv("references", dbStats.totalReferences));
          }
        }
      } finally {
        engine.close();
      }
    }

    // Embedding stats
    if (showEmbed) {
      const lanceDbPath = dbPath.replace(/\.db$/, ".lance");
      const configManager = ConfigManager.getInstance();
      const embeddingConfig = configManager.getEmbeddingConfig();

      if (!existsSync(lanceDbPath)) {
        results.embeddings = { status: "not_generated", totalEmbeddings: 0 };

        if (!options.json) {
          if (outputOpts.pretty) {
            if (showDb) console.log("");
            console.log(`${header(EMOJI.embeddings, `Embedding Statistics [${wsContext.alias}]`)}:\n`);
            console.log("   Status: No embeddings generated yet");
            console.log("");
            console.log("   Run 'supertag embed generate' to create embeddings.");
          } else {
            // Unix mode: status only
            console.log(tsv("embeddings_status", "not_generated"));
            console.log(tsv("embeddings_count", 0));
          }
        }
      } else {
        const { TanaEmbeddingService } = await import("../embeddings/tana-embedding-service");
        const embeddingService = new TanaEmbeddingService(lanceDbPath, {
          model: embeddingConfig.model,
          endpoint: embeddingConfig.endpoint,
        });

        const db = new Database(dbPath);

        try {
          const embedStats = await embeddingService.getStats();
          const diagnostics = await embeddingService.getDiagnostics();

          // Get node count for coverage
          const nodeCount = db
            .query("SELECT COUNT(*) as count FROM nodes WHERE name IS NOT NULL")
            .get() as { count: number };
          const coverage = nodeCount.count > 0
            ? ((embedStats.totalEmbeddings / nodeCount.count) * 100).toFixed(1)
            : "0.0";

          results.embeddings = {
            status: "ready",
            model: embeddingConfig.model,
            totalEmbeddings: embedStats.totalEmbeddings,
            totalNodes: nodeCount.count,
            coverage: parseFloat(coverage),
            diagnostics,
          };

          if (!options.json) {
            if (outputOpts.pretty) {
              const { getModelDimensionsFromResona } = await import("../embeddings/embed-config-new");
              const dimensions = getModelDimensionsFromResona(embeddingConfig.model);

              if (showDb) console.log("");
              console.log(`${header(EMOJI.embeddings, `Embedding Statistics [${wsContext.alias}]`)}:\n`);
              console.log(`   Storage: LanceDB (via resona)`);
              console.log(`   Model: ${embeddingConfig.model}`);
              console.log(`   Dimensions: ${dimensions || "auto-detect"}`);
              console.log(`   Total: ${formatNumber(embedStats.totalEmbeddings, true)}`);
              console.log(`   Coverage: ${embedStats.totalEmbeddings}/${nodeCount.count} (${coverage}%)`);
              console.log("");
              console.log("   Database Health:");
              console.log(`     Version: ${diagnostics.version}`);
              console.log(`     Rows: ${formatNumber(diagnostics.totalRows, true)}`);
              if (diagnostics.index) {
                const indexHealth = diagnostics.index.needsRebuild ? "⚠️  needs rebuild" : "✓ healthy";
                console.log(`     Index: ${indexHealth}`);
              }
            } else {
              // Unix mode: TSV key-value output
              console.log(tsv("embeddings_status", "ready"));
              console.log(tsv("embeddings_model", embeddingConfig.model));
              console.log(tsv("embeddings_count", embedStats.totalEmbeddings));
              console.log(tsv("embeddings_coverage", coverage));
            }
          }
        } finally {
          embeddingService.close();
          db.close();
        }
      }
    }

    // Filter stats
    if (showFilter) {
      const db = new Database(dbPath);
      try {
        const filterStats = getFilterStats(db);
        results.filter = filterStats;

        if (!options.json) {
          if (outputOpts.pretty) {
            if (showDb || showEmbed) console.log("");
            console.log(`📋 Content Filter Statistics [${wsContext.alias}]:\n`);
            console.log(`   Total named nodes: ${formatNumber(filterStats.totalNamed, true)}`);
            console.log(`   After default filters: ${formatNumber(filterStats.withDefaultFilters, true)}`);
            console.log(`   Reduction: ${filterStats.reduction}`);
            console.log("");
            console.log("   Default filters applied:");
            console.log("     - Minimum length: 15 characters");
            console.log("     - Exclude timestamp artifacts");
            console.log("     - Exclude system docTypes");
            console.log("");
            console.log("   Entity Detection:");
            console.log(`     Tagged items: ${formatNumber(filterStats.entityStats.entitiesTagged, true)}`);
            console.log(`     Library items: ${formatNumber(filterStats.entityStats.entitiesLibrary, true)}`);
            console.log(`     Total entities: ${formatNumber(filterStats.entityStats.totalEntities, true)} (${filterStats.entityStats.entityPercentage})`);
            console.log("");
            console.log("   Nodes by docType:");
            for (const { docType, count } of filterStats.byDocType.slice(0, 10)) {
              const label = docType || "(no docType)";
              console.log(`     ${label.padEnd(20)} ${formatNumber(count, true).padStart(10)}`);
            }
            if (filterStats.byDocType.length > 10) {
              console.log(`     ... and ${filterStats.byDocType.length - 10} more`);
            }
          } else {
            // Unix mode: TSV key-value output
            console.log(tsv("filter_total_named", filterStats.totalNamed));
            console.log(tsv("filter_after_default", filterStats.withDefaultFilters));
            console.log(tsv("filter_reduction", filterStats.reduction));
            console.log(tsv("filter_entities_tagged", filterStats.entityStats.entitiesTagged));
            console.log(tsv("filter_entities_library", filterStats.entityStats.entitiesLibrary));
            console.log(tsv("filter_entities_total", filterStats.entityStats.totalEntities));
          }
        }
      } finally {
        db.close();
      }
    }

    // JSON output
    if (options.json) {
      console.log(formatJsonOutput(results));
    } else if (outputOpts.pretty) {
      console.log("");
    }
  });

  return stats;
}
