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
import { ConfigManager } from "../config/manager";
import { resolveWorkspace } from "../config/paths";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
} from "./helpers";
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

    const config = ConfigManager.getInstance().getConfig();
    const wsContext = resolveWorkspace(options.workspace, config);

    const results: Record<string, unknown> = {};

    // Database stats
    if (showDb) {
      const engine = new TanaQueryEngine(dbPath);
      try {
        const dbStats = await engine.getStatistics();
        results.database = dbStats;

        if (!options.json) {
          console.log(`\n📊 Database Statistics [${wsContext.alias}]:\n`);
          console.log(`   Total Nodes: ${dbStats.totalNodes.toLocaleString()}`);
          console.log(`   Total Supertags: ${dbStats.totalSupertags.toLocaleString()}`);
          console.log(`   Total Fields: ${dbStats.totalFields.toLocaleString()}`);
          console.log(`   Total References: ${dbStats.totalReferences.toLocaleString()}`);
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
          if (showDb) console.log("");
          console.log(`📊 Embedding Statistics [${wsContext.alias}]:\n`);
          console.log("   Status: No embeddings generated yet");
          console.log("");
          console.log("   Run 'supertag embed generate' to create embeddings.");
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
            const { getModelDimensionsFromResona } = await import("../embeddings/embed-config-new");
            const dimensions = getModelDimensionsFromResona(embeddingConfig.model);

            if (showDb) console.log("");
            console.log(`📊 Embedding Statistics [${wsContext.alias}]:\n`);
            console.log(`   Storage: LanceDB (via resona)`);
            console.log(`   Model: ${embeddingConfig.model}`);
            console.log(`   Dimensions: ${dimensions || "auto-detect"}`);
            console.log(`   Total: ${embedStats.totalEmbeddings.toLocaleString()}`);
            console.log(`   Coverage: ${embedStats.totalEmbeddings}/${nodeCount.count} (${coverage}%)`);
            console.log("");
            console.log("   Database Health:");
            console.log(`     Version: ${diagnostics.version}`);
            console.log(`     Rows: ${diagnostics.totalRows.toLocaleString()}`);
            if (diagnostics.index) {
              const indexHealth = diagnostics.index.needsRebuild ? "⚠️  needs rebuild" : "✓ healthy";
              console.log(`     Index: ${indexHealth}`);
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
          if (showDb || showEmbed) console.log("");
          console.log(`📋 Content Filter Statistics [${wsContext.alias}]:\n`);
          console.log(`   Total named nodes: ${filterStats.totalNamed.toLocaleString()}`);
          console.log(`   After default filters: ${filterStats.withDefaultFilters.toLocaleString()}`);
          console.log(`   Reduction: ${filterStats.reduction}`);
          console.log("");
          console.log("   Default filters applied:");
          console.log("     - Minimum length: 15 characters");
          console.log("     - Exclude timestamp artifacts");
          console.log("     - Exclude system docTypes");
          console.log("");
          console.log("   Entity Detection:");
          console.log(`     Tagged items: ${filterStats.entityStats.entitiesTagged.toLocaleString()}`);
          console.log(`     Library items: ${filterStats.entityStats.entitiesLibrary.toLocaleString()}`);
          console.log(`     Total entities: ${filterStats.entityStats.totalEntities.toLocaleString()} (${filterStats.entityStats.entityPercentage})`);
          console.log("");
          console.log("   Nodes by docType:");
          for (const { docType, count } of filterStats.byDocType.slice(0, 10)) {
            const label = docType || "(no docType)";
            console.log(`     ${label.padEnd(20)} ${count.toLocaleString().padStart(10)}`);
          }
          if (filterStats.byDocType.length > 10) {
            console.log(`     ... and ${filterStats.byDocType.length - 10} more`);
          }
        }
      } finally {
        db.close();
      }
    }

    // JSON output
    if (options.json) {
      console.log(formatJsonOutput(results));
    } else {
      console.log("");
    }
  });

  return stats;
}
