/**
 * Embed Commands
 *
 * Commands for managing vector embeddings:
 * - embed config: Configure embedding provider
 * - embed generate: Generate embeddings for nodes
 * - embed stats: Show embedding statistics
 * - embed filter-stats: Show content filter stats
 * - embed maintain: Database maintenance
 *
 * Note: embed search was removed in v1.0.0 - use 'supertag search --semantic' instead.
 *
 * Uses resona/LanceDB for vector storage (no sqlite-vec extension needed).
 */

import { Command } from "commander";
import { Database } from "bun:sqlite";
import {
  getDatabasePath,
  resolveWorkspace,
  getEnabledWorkspaces,
} from "../config/paths";
import type { WorkspaceContext } from "../types";
import { ConfigManager } from "../config/manager";
import {
  tsv,
  EMOJI,
  header,
} from "../utils/format";
import { resolveOutputOptions } from "../utils/output-options";
import { addStandardOptions } from "./helpers";
import {
  buildContentFilterQuery,
  getFilterableNodeCount,
  getFilterStats,
  DEFAULT_FILTER_OPTIONS,
  type ContentFilterOptions,
} from "../embeddings/content-filter";
import {
  getNodeContents,
  getNodeContentsWithDepth,
  formatNodeOutput,
  formatNodeWithDepth,
  type NodeContents,
} from "./show";
import { findMeaningfulAncestor } from "../embeddings/ancestor-resolution";
import { batchContextualizeNodes, contextualizeNodesWithFields } from "../embeddings/contextualize";
import { filterAndDeduplicateResults, getOverfetchLimit } from "../embeddings/search-filter";
import { existsSync } from "node:fs";

/**
 * Get workspace context for display
 */
function getWorkspaceContext(workspace?: string): WorkspaceContext {
  const config = ConfigManager.getInstance().getConfig();
  return resolveWorkspace(workspace, config);
}

/**
 * Create embed command group
 */
export function createEmbedCommand(): Command {
  const embed = new Command("embed");
  embed.description("Manage vector embeddings for semantic search");

  /**
   * embed config - Configure embedding model (uses ConfigManager, not database)
   */
  const configCmd = embed
    .command("config")
    .description("Configure embedding model for semantic search")
    .option("-s, --show", "Show current configuration")
    .option("-m, --model <model>", "Model name (e.g., mxbai-embed-large)")
    .option("-e, --endpoint <url>", "Custom Ollama endpoint URL");

  addStandardOptions(configCmd, { defaultLimit: "1" });

  configCmd.action(async (options: { show?: boolean; model?: string; endpoint?: string; pretty?: boolean; json?: boolean }) => {
      const configManager = ConfigManager.getInstance();
      const outputOpts = resolveOutputOptions(options);

      // Show current configuration
      if (options.show || (!options.model && !options.endpoint)) {
        const { getModelDimensionsFromResona } = await import("../embeddings/embed-config-new");
        const embeddingConfig = configManager.getEmbeddingConfig();

        if (options.json) {
          console.log(JSON.stringify(embeddingConfig || { status: "not_configured" }, null, 2));
          return;
        }

        if (!embeddingConfig) {
          if (outputOpts.pretty) {
            const { formatEmbeddingConfigDisplay } = await import("../embeddings/embed-config-new");
            console.log(formatEmbeddingConfigDisplay(embeddingConfig));
          } else {
            console.log(tsv("status", "not_configured"));
          }
          return;
        }

        const dimensions = getModelDimensionsFromResona(embeddingConfig.model);

        if (outputOpts.pretty) {
          console.log(`\n${header(EMOJI.embeddings, "Embedding Configuration")}:\n`);
          console.log(`   Model: ${embeddingConfig.model}`);
          console.log(`   Dimensions: ${dimensions || "auto-detect"}`);
          console.log(`   Endpoint: ${embeddingConfig.endpoint || "http://localhost:11434"}`);
          console.log(`   Storage: LanceDB (via resona)`);
          console.log("");
        } else {
          // Unix mode: TSV key-value output
          console.log(tsv("model", embeddingConfig.model));
          console.log(tsv("dimensions", dimensions || "auto"));
          console.log(tsv("endpoint", embeddingConfig.endpoint || "http://localhost:11434"));
        }
        return;
      }

      // Update configuration
      const updates: { model?: string; endpoint?: string } = {};

      if (options.model) {
        const { validateEmbeddingModel, getModelDimensionsFromResona } = await import("../embeddings/embed-config-new");

        if (!validateEmbeddingModel(options.model)) {
          console.log(`⚠️  Warning: Model "${options.model}" is not a known model.`);
          console.log("   Dimensions will be auto-detected when generating embeddings.");
          console.log("");
        } else {
          const dims = getModelDimensionsFromResona(options.model);
          console.log(`✓ Model: ${options.model} (${dims} dimensions)`);
        }
        updates.model = options.model;
      }

      if (options.endpoint) {
        console.log(`✓ Endpoint: ${options.endpoint}`);
        updates.endpoint = options.endpoint;
      }

      if (Object.keys(updates).length > 0) {
        configManager.setEmbeddingConfig(updates);
        console.log("");
        console.log("✅ Configuration updated");
        console.log("");

        // Show updated config
        const { formatEmbeddingConfigDisplay } = await import("../embeddings/embed-config-new");
        const embeddingConfig = configManager.getEmbeddingConfig();
        console.log(formatEmbeddingConfigDisplay(embeddingConfig));
      }
    });

  /**
   * embed generate - Generate embeddings for nodes
   */
  embed
    .command("generate")
    .description("Generate embeddings for indexed nodes")
    .option("-w, --workspace <alias>", "Workspace to process (default: default workspace)")
    .option("--all-workspaces", "Process all enabled workspaces")
    .option("-a, --all", "Regenerate all embeddings (ignore cache)")
    .option("-l, --limit <n>", "Limit number of nodes to process")
    .option("-t, --tag <tag>", "Only embed nodes with specific supertag")
    .option("--min-length <n>", "Minimum name length (default: 15)", "15")
    .option("--include-all", "Include all nodes (bypass content filters)")
    .option("--include-timestamps", "Include timestamp-like nodes")
    .option("--include-system", "Include system docTypes (tuple, metanode, etc.)")
    .option("--include-fields", "Include field values in embedding context")
    .option("-v, --verbose", "Verbose output")
    .option("--lance-batch-size <n>", "LanceDB write batch size (default: 5000)")
    .action(async (options) => {
      // Handle --all-workspaces
      if (options.allWorkspaces) {
        const appConfig = ConfigManager.getInstance().getConfig();
        const workspaces = getEnabledWorkspaces(appConfig);

        if (workspaces.length === 0) {
          console.log("❌ No workspaces configured");
          console.log("Add workspaces with: supertag workspace add <id> --alias <name>");
          return;
        }

        console.log(`📊 Processing ${workspaces.length} workspaces...\n`);

        for (const ws of workspaces) {
          console.log(`\n━━━ Workspace: ${ws.alias} ━━━`);
          await processWorkspaceEmbeddings(ws.alias, options);
        }

        console.log("\n✅ All workspaces processed");
        return;
      }

      // Single workspace mode
      await processWorkspaceEmbeddings(options.workspace, options);
    });

  /**
   * Process embeddings for a single workspace (uses TanaEmbeddingService with resona/LanceDB)
   */
  async function processWorkspaceEmbeddings(workspace: string | undefined, options: any) {
    const wsContext = getWorkspaceContext(workspace);

    // Get embedding config from ConfigManager (not database)
    const configManager = ConfigManager.getInstance();
    const embeddingConfig = configManager.getEmbeddingConfig();

    if (options.verbose) {
      console.log(`   Workspace: ${wsContext.alias}`);
      console.log(`   Database: ${wsContext.dbPath}`);
      console.log("");
    }

    // Get model dimensions from resona
    const { getModelDimensionsFromResona } = await import("../embeddings/embed-config-new");
    const dimensions = getModelDimensionsFromResona(embeddingConfig.model);

    console.log(`📊 Embedding Configuration`);
    console.log(`   Model: ${embeddingConfig.model}`);
    console.log(`   Dimensions: ${dimensions || "auto-detect"}`);
    console.log(`   Endpoint: ${embeddingConfig.endpoint || "http://localhost:11434"}`);
    console.log(`   Storage: LanceDB (via resona)`);
    console.log("");

    // Check Ollama health before starting
    try {
      const endpoint = embeddingConfig.endpoint || "http://localhost:11434";
      const response = await fetch(`${endpoint}/api/tags`);
      if (!response.ok) {
        console.log("❌ Ollama not available");
        console.log("");
        console.log("Make sure Ollama is running:");
        console.log("  ollama serve");
        return;
      }

      // Check if model is available
      const data = await response.json() as { models: Array<{ name: string }> };
      const modelName = embeddingConfig.model;
      const modelAvailable = data.models?.some((m: { name: string }) =>
        m.name === modelName || m.name.startsWith(`${modelName}:`)
      );

      if (!modelAvailable) {
        console.log(`❌ Model "${modelName}" not found in Ollama`);
        console.log("");
        console.log("Install the model with:");
        console.log(`  ollama pull ${modelName}`);
        return;
      }
    } catch (error) {
      console.log("❌ Cannot connect to Ollama");
      console.log("");
      console.log("Make sure Ollama is running:");
      console.log("  ollama serve");
      return;
    }

    // Check if SQLite database exists
    if (!existsSync(wsContext.dbPath)) {
      console.log(`❌ Database not found: ${wsContext.dbPath}`);
      console.log("");
      console.log("Run 'supertag sync' first to index the workspace.");
      return;
    }

    // Open SQLite database for querying nodes (content filtering uses SQLite)
    const db = new Database(wsContext.dbPath);

    try {
      // Build content filter options
      const filterOptions: ContentFilterOptions = {
        minLength: options.includeAll ? undefined : parseInt(options.minLength),
        excludeTimestamps: !options.includeAll && !options.includeTimestamps,
        excludeSystemTypes: !options.includeAll && !options.includeSystem,
        tag: options.tag,
        limit: options.limit ? parseInt(options.limit) : undefined,
        includeAll: options.includeAll,
      };

      // Build query with content filters
      const { query, params } = buildContentFilterQuery(filterOptions);

      const nodes = db.query(query).all(...params) as Array<{
        id: string;
        name: string;
      }>;

      if (nodes.length === 0) {
        console.log("No nodes found to embed");
        return;
      }

      // Show filter info
      if (options.verbose) {
        const totalNamed = db
          .query("SELECT COUNT(*) as count FROM nodes WHERE name IS NOT NULL")
          .get() as { count: number };
        console.log("📋 Content Filtering:");
        console.log(`   Total named nodes: ${totalNamed.count.toLocaleString()}`);
        console.log(`   After filtering: ${nodes.length.toLocaleString()}`);
        console.log(`   Filters applied:`);
        if (!options.includeAll) {
          console.log(`     - Min length: ${options.minLength} chars`);
          if (!options.includeTimestamps) console.log("     - Excluding timestamp artifacts");
          if (!options.includeSystem) console.log("     - Excluding system docTypes");
        } else {
          console.log("     - None (include-all mode)");
        }
        if (options.tag) console.log(`     - Tag filter: ${options.tag}`);
        console.log("");
      }

      console.log(`📊 Processing ${nodes.length.toLocaleString()} nodes...`);
      console.log("");

      // Contextualize nodes - add ancestor context for better embeddings
      console.log("   Contextualizing nodes...");
      const contextualizedNodes = options.includeFields
        ? contextualizeNodesWithFields(db, nodes, { includeFields: true })
        : batchContextualizeNodes(db, nodes);

      // Count how many have ancestor context
      const withAncestor = contextualizedNodes.filter(n => n.ancestorId !== null).length;
      const withOwnTag = contextualizedNodes.filter(n => n.ancestorId === null && n.ancestorTags.length > 0).length;
      console.log(`   With ancestor context: ${withAncestor.toLocaleString()}`);
      console.log(`   With own tag: ${withOwnTag.toLocaleString()}`);
      console.log(`   No context: ${(nodes.length - withAncestor - withOwnTag).toLocaleString()}`);
      if (options.includeFields) {
        console.log(`   Field enrichment: enabled`);
      }
      console.log("");

      // Create TanaEmbeddingService (uses resona/LanceDB)
      const { TanaEmbeddingService } = await import("../embeddings/tana-embedding-service");
      const lanceDbPath = wsContext.dbPath.replace(/\.db$/, ".lance");
      const embeddingService = new TanaEmbeddingService(lanceDbPath, {
        model: embeddingConfig.model,
        endpoint: embeddingConfig.endpoint,
      });

      try {
        // Process with progress reporting
        const startTime = Date.now();
        let lastLine = "";

        console.log("   Starting embedding process...");

        const result = await embeddingService.embedNodes(contextualizedNodes, {
          forceAll: options.all,
          progressInterval: 50, // More frequent updates
          onProgress: (progress) => {
            const pct = ((progress.processed + progress.errors + progress.skipped) / progress.total * 100).toFixed(1);
            const rateStr = progress.rate ? `${progress.rate.toFixed(1)}/s` : "...";
            const eta = progress.rate && progress.rate > 0
              ? Math.ceil((progress.total - progress.processed - progress.errors - progress.skipped) / progress.rate)
              : 0;
            const etaStr = eta > 0 ? `ETA: ${Math.floor(eta / 60)}m${eta % 60}s` : "";

            // Clear previous line and write progress
            const errStr = progress.errors > 0 ? ` | Err: ${progress.errors}` : '';
            const line = `   ⏳ ${pct}% | Processed: ${progress.processed.toLocaleString()}${errStr} | ${rateStr} | ${etaStr}`;
            if (process.stdout.isTTY) {
              process.stdout.write(`\r${line.padEnd(lastLine.length)}`);
            } else if (progress.processed % 1000 === 0) {
              // For non-TTY, print every 1000
              console.log(line.trim());
            }
            lastLine = line;
          },
        });

        // Clear progress line
        if (process.stdout.isTTY) {
          process.stdout.write("\r" + " ".repeat(lastLine.length) + "\r");
        }

        const duration = Date.now() - startTime;

        console.log("✅ Embedding complete");
        console.log(`   Processed: ${result.processed.toLocaleString()}`);
        console.log(`   Skipped: ${result.skipped.toLocaleString()} (unchanged)`);
        if (result.errors > 0) {
          console.log(`   Errors: ${result.errors}`);
          if (result.errorSamples && result.errorSamples.length > 0) {
            console.log(`   Error samples:`);
            for (const sample of result.errorSamples.slice(0, 5)) {
              console.log(`     - ${sample}`);
            }
          }
        }
        console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);

        const stats = await embeddingService.getStats();
        console.log(`   Total embeddings: ${stats.totalEmbeddings.toLocaleString()}`);
      } finally {
        embeddingService.close();
      }
    } finally {
      db.close();
    }
  }

  // Note: embed search command removed in v1.0.0
  // Use 'supertag search <query> --semantic' instead

  /**
   * embed stats - Show embedding statistics (uses TanaEmbeddingService with resona/LanceDB)
   */
  embed
    .command("stats")
    .description("Show embedding statistics")
    .option("-w, --workspace <alias>", "Workspace to check (default: default workspace)")
    .action(async (options) => {
      const wsContext = getWorkspaceContext(options.workspace);

      // Get embedding config from ConfigManager
      const configManager = ConfigManager.getInstance();
      const embeddingConfig = configManager.getEmbeddingConfig();

      // Get model dimensions from resona
      const { getModelDimensionsFromResona } = await import("../embeddings/embed-config-new");
      const dimensions = getModelDimensionsFromResona(embeddingConfig.model);

      // Check if databases exist
      if (!existsSync(wsContext.dbPath)) {
        console.log(`❌ Database not found: ${wsContext.dbPath}`);
        console.log("");
        console.log("Run 'supertag sync' first to index the workspace.");
        return;
      }

      const lanceDbPath = wsContext.dbPath.replace(/\.db$/, ".lance");
      if (!existsSync(lanceDbPath)) {
        console.log(`📊 Embedding Statistics [${wsContext.alias}]`);
        console.log("");
        console.log(`Workspace:    ${wsContext.alias}`);
        console.log(`Database:     ${wsContext.dbPath}`);
        console.log(`Storage:      LanceDB (via resona)`);
        console.log(`Model:        ${embeddingConfig.model}`);
        console.log(`Dimensions:   ${dimensions || "auto-detect"}`);
        console.log("");
        console.log("Status:       No embeddings generated yet");
        console.log("");
        console.log("Run 'supertag embed generate' to create embeddings.");
        return;
      }

      // Create TanaEmbeddingService for stats
      const { TanaEmbeddingService } = await import("../embeddings/tana-embedding-service");
      const embeddingService = new TanaEmbeddingService(lanceDbPath, {
        model: embeddingConfig.model,
        endpoint: embeddingConfig.endpoint,
      });

      // Open SQLite database for node stats
      const db = new Database(wsContext.dbPath);

      try {
        const stats = await embeddingService.getStats();
        const diagnostics = await embeddingService.getDiagnostics();

        console.log(`📊 Embedding Statistics [${wsContext.alias}]`);
        console.log("");
        console.log(`Workspace:    ${wsContext.alias}`);
        console.log(`Database:     ${wsContext.dbPath}`);
        console.log(`Storage:      LanceDB (via resona)`);
        console.log(`Model:        ${embeddingConfig.model}`);
        console.log(`Dimensions:   ${dimensions || "auto-detect"}`);
        console.log("");
        console.log(`Total:        ${stats.totalEmbeddings.toLocaleString()}`);

        // Get node count for coverage
        const nodeCount = db
          .query("SELECT COUNT(*) as count FROM nodes WHERE name IS NOT NULL")
          .get() as { count: number };
        const coverage = nodeCount.count > 0
          ? ((stats.totalEmbeddings / nodeCount.count) * 100).toFixed(1)
          : "0.0";
        console.log("");
        console.log(
          `Coverage:     ${stats.totalEmbeddings}/${nodeCount.count} (${coverage}%)`
        );

        // Show content filter stats
        const filterStats = getFilterStats(db);
        console.log("");
        console.log("Content Filter Stats:");
        console.log(`  All named nodes:   ${filterStats.totalNamed.toLocaleString()}`);
        console.log(`  After filtering:   ${filterStats.withDefaultFilters.toLocaleString()}`);
        console.log(`  Reduction:         ${filterStats.reduction}`);

        // Show entity stats
        console.log("");
        const hasNativeFlags = filterStats.entityStats.entitiesWithOverride > 0 || filterStats.entityStats.entitiesAutomatic > 0;
        console.log(`Entity Detection (${hasNativeFlags ? '_flags from export' : 'inferred from tags/library'}):`);
        if (hasNativeFlags) {
          console.log(`  With override:     ${filterStats.entityStats.entitiesWithOverride.toLocaleString()}`);
          console.log(`  Automatic (_flags): ${filterStats.entityStats.entitiesAutomatic.toLocaleString()}`);
        }
        console.log(`  Tagged items:      ${filterStats.entityStats.entitiesTagged.toLocaleString()}`);
        console.log(`  Library items:     ${filterStats.entityStats.entitiesLibrary.toLocaleString()}`);
        console.log(`  Total entities:    ${filterStats.entityStats.totalEntities.toLocaleString()} (${filterStats.entityStats.entityPercentage} of nodes)`);
        console.log(`  Entities + filters: ${filterStats.entitiesWithFilters.toLocaleString()}`);

        // Show database diagnostics
        console.log("");
        console.log("Database Health:");
        console.log(`  Version:       ${diagnostics.version}`);
        console.log(`  Rows:          ${diagnostics.totalRows.toLocaleString()}`);
        if (diagnostics.index) {
          const indexHealth = diagnostics.index.needsRebuild ? "⚠️  needs rebuild" : "✓ healthy";
          console.log(`  Index:         ${indexHealth}`);
          console.log(`    Indexed:     ${diagnostics.index.numIndexedRows.toLocaleString()}`);
          console.log(`    Unindexed:   ${diagnostics.index.numUnindexedRows.toLocaleString()} (${diagnostics.index.stalePercent.toFixed(1)}%)`);
        } else {
          console.log(`  Index:         not created`);
        }
      } finally {
        embeddingService.close();
        db.close();
      }
    });

  /**
   * embed filter-stats - Show content filtering statistics
   */
  embed
    .command("filter-stats")
    .description("Show content filtering statistics and breakdown by docType")
    .option("-w, --workspace <alias>", "Workspace to check (default: default workspace)")
    .action(async (options) => {
      const wsContext = getWorkspaceContext(options.workspace);

      // Check if database exists
      if (!existsSync(wsContext.dbPath)) {
        console.log(`❌ Database not found: ${wsContext.dbPath}`);
        console.log("");
        console.log("Run 'supertag sync' first to index the workspace.");
        return;
      }

      // Open SQLite database (no extensions needed for filter stats)
      const db = new Database(wsContext.dbPath);

      try {
        const filterStats = getFilterStats(db);

        console.log(`📋 Content Filter Statistics [${wsContext.alias}]`);
        console.log("");
        console.log(`Workspace:             ${wsContext.alias}`);
        console.log(`Total named nodes:     ${filterStats.totalNamed.toLocaleString()}`);
        console.log(`After default filters: ${filterStats.withDefaultFilters.toLocaleString()}`);
        console.log(`Reduction:             ${filterStats.reduction}`);
        console.log("");
        console.log("Default filters applied:");
        console.log("  - Minimum length: 15 characters");
        console.log("  - Exclude timestamp artifacts (1970-01-01...)");
        console.log("  - Exclude system docTypes (tuple, metanode, etc.)");
        console.log("");
        console.log("Node counts by docType:");
        console.log("");
        for (const { docType, count } of filterStats.byDocType) {
          const label = docType || "(no docType)";
          const isSystem = docType && [
            "tuple", "metanode", "viewDef", "search", "command",
            "hotkey", "tagDef", "attrDef", "associatedData",
            "visual", "journalPart", "group", "chatbot", "workspace"
          ].includes(docType);
          const marker = isSystem ? " [excluded]" : "";
          console.log(`  ${label.padEnd(20)} ${count.toLocaleString().padStart(10)}${marker}`);
        }

        // Show entity stats
        console.log("");
        const hasNativeFlags = filterStats.entityStats.entitiesWithOverride > 0 || filterStats.entityStats.entitiesAutomatic > 0;
        console.log(`Entity Detection (${hasNativeFlags ? '_flags from export' : 'inferred from tags/library'}):`);
        if (hasNativeFlags) {
          console.log(`  With override:     ${filterStats.entityStats.entitiesWithOverride.toLocaleString()}`);
          console.log(`  Automatic (_flags): ${filterStats.entityStats.entitiesAutomatic.toLocaleString()}`);
        }
        console.log(`  Tagged items:      ${filterStats.entityStats.entitiesTagged.toLocaleString()}`);
        console.log(`  Library items:     ${filterStats.entityStats.entitiesLibrary.toLocaleString()}`);
        console.log(`  Total entities:    ${filterStats.entityStats.totalEntities.toLocaleString()} (${filterStats.entityStats.entityPercentage} of nodes)`);
        console.log(`  Entities + filters: ${filterStats.entitiesWithFilters.toLocaleString()}`);
      } finally {
        db.close();
      }
    });

  /**
   * embed maintain - Run database maintenance (compaction, index rebuild, cleanup)
   */
  embed
    .command("maintain")
    .description("Run LanceDB maintenance (compaction, index rebuild, cleanup)")
    .option("-w, --workspace <alias>", "Workspace to maintain (default: default workspace)")
    .option("--skip-compact", "Skip fragment compaction")
    .option("--skip-index", "Skip index rebuild")
    .option("--skip-cleanup", "Skip old version cleanup")
    .option("--retention-days <n>", "Days to retain old versions (default: 7)", "7")
    .option("-v, --verbose", "Verbose output")
    .action(async (options) => {
      const wsContext = getWorkspaceContext(options.workspace);

      // Get embedding config from ConfigManager
      const configManager = ConfigManager.getInstance();
      const embeddingConfig = configManager.getEmbeddingConfig();

      console.log(`🔧 Running maintenance [${wsContext.alias}]`);
      console.log("");

      // Check if LanceDB exists
      const lanceDbPath = wsContext.dbPath.replace(/\.db$/, ".lance");
      if (!existsSync(lanceDbPath)) {
        console.log(`❌ No embeddings found for workspace "${wsContext.alias}".`);
        console.log("");
        console.log("Run 'supertag embed generate' first to create embeddings.");
        return;
      }

      // Create TanaEmbeddingService
      const { TanaEmbeddingService } = await import("../embeddings/tana-embedding-service");
      const embeddingService = new TanaEmbeddingService(lanceDbPath, {
        model: embeddingConfig.model,
        endpoint: embeddingConfig.endpoint,
      });

      try {
        // Show diagnostics before maintenance
        if (options.verbose) {
          const beforeDiag = await embeddingService.getDiagnostics();
          console.log("Before maintenance:");
          console.log(`  Rows: ${beforeDiag.totalRows.toLocaleString()}`);
          console.log(`  Version: ${beforeDiag.version}`);
          if (beforeDiag.index) {
            console.log(`  Index: ${beforeDiag.index.numIndexedRows} indexed, ${beforeDiag.index.numUnindexedRows} unindexed (${beforeDiag.index.stalePercent.toFixed(1)}%)`);
          }
          console.log("");
        }

        // Run maintenance with progress reporting
        const result = await embeddingService.maintain({
          skipCompaction: options.skipCompact,
          skipIndex: options.skipIndex,
          skipCleanup: options.skipCleanup,
          retentionDays: parseInt(options.retentionDays),
          onProgress: (step: string, details?: string) => {
            if (details) {
              console.log(`   ${step} (${details})`);
            } else {
              console.log(`   ${step}`);
            }
          },
        });

        console.log("");
        console.log("✅ Maintenance complete");
        console.log(`   Duration: ${(result.durationMs / 1000).toFixed(2)}s`);

        if (result.compaction) {
          console.log(`   Compaction: ${result.compaction.fragmentsRemoved} fragments merged, ${result.compaction.filesCreated} files created`);
        }

        if (result.indexRebuilt) {
          console.log("   Index: rebuilt");
        } else if (result.indexStats) {
          console.log(`   Index: healthy (${result.indexStats.numIndexedRows} indexed)`);
        }

        if (result.cleanup) {
          const kb = (result.cleanup.bytesRemoved / 1024).toFixed(1);
          console.log(`   Cleanup: ${result.cleanup.versionsRemoved} old versions, ${kb} KB freed`);
        }

        // Show diagnostics after maintenance
        if (options.verbose) {
          console.log("");
          const afterDiag = await embeddingService.getDiagnostics();
          console.log("After maintenance:");
          console.log(`  Rows: ${afterDiag.totalRows.toLocaleString()}`);
          console.log(`  Version: ${afterDiag.version}`);
          if (afterDiag.index) {
            console.log(`  Index: ${afterDiag.index.numIndexedRows} indexed, ${afterDiag.index.numUnindexedRows} unindexed (${afterDiag.index.stalePercent.toFixed(1)}%)`);
          }
        }
      } finally {
        embeddingService.close();
      }
    });

  return embed;
}
