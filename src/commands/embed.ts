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
import {
  getDatabasePath,
} from "../config/paths";
import {
  processWorkspaces,
} from "../config";
import { withDatabase } from "../db/with-database";
import { resolveWorkspaceContext, type ResolvedWorkspace } from "../config/workspace-resolver";
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
function getWorkspaceContext(workspace?: string): ResolvedWorkspace {
  return resolveWorkspaceContext({
    workspace,
    requireDatabase: false,
  });
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
    .option("--include-transcripts", "Include transcript content (90K+ lines, normally excluded)")
    .option("--include-fields", "Include field values in embedding context")
    .option("-v, --verbose", "Verbose output")
    .option("--lance-batch-size <n>", "LanceDB write batch size (default: 5000)")
    .action(async (options) => {
      // Handle --all-workspaces
      if (options.allWorkspaces) {
        const batchResult = await processWorkspaces(
          { all: true, continueOnError: true },
          async (ws: ResolvedWorkspace) => {
            console.log(`\n━━━ Workspace: ${ws.alias} ━━━`);
            await processWorkspaceEmbeddings(ws.alias, options);
            return { alias: ws.alias };
          }
        );

        if (batchResult.results.length === 0) {
          console.log("❌ No workspaces configured");
          console.log("Add workspaces with: supertag workspace add <id> --alias <name>");
          return;
        }

        console.log(`\n✅ All workspaces processed (${batchResult.successful} succeeded, ${batchResult.failed} failed)`);
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

    // Build content filter options
    const filterOptions: ContentFilterOptions = {
      minLength: options.includeAll ? undefined : parseInt(options.minLength),
      excludeTimestamps: !options.includeAll && !options.includeTimestamps,
      excludeSystemTypes: !options.includeAll && !options.includeSystem,
      includeTranscripts: options.includeTranscripts,
      tag: options.tag,
      limit: options.limit ? parseInt(options.limit) : undefined,
      includeAll: options.includeAll,
    };

    // Query nodes and contextualize within database context
    const contextualizedNodes = await withDatabase({ dbPath: wsContext.dbPath, readonly: true }, (ctx) => {
      // Build query with content filters
      const { query, params } = buildContentFilterQuery(filterOptions);

      const nodes = ctx.db.query(query).all(...params) as Array<{
        id: string;
        name: string;
      }>;

      if (nodes.length === 0) {
        return null;
      }

      // Show filter info
      if (options.verbose) {
        const totalNamed = ctx.db
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
          if (!options.includeTranscripts) console.log("     - Excluding transcripts");
          else console.log("     - Including transcript content");
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
      const contextualized = options.includeFields
        ? contextualizeNodesWithFields(ctx.db, nodes, { includeFields: true })
        : batchContextualizeNodes(ctx.db, nodes);

      // Count how many have ancestor context
      const withAncestor = contextualized.filter(n => n.ancestorId !== null).length;
      const withOwnTag = contextualized.filter(n => n.ancestorId === null && n.ancestorTags.length > 0).length;
      console.log(`   With ancestor context: ${withAncestor.toLocaleString()}`);
      console.log(`   With own tag: ${withOwnTag.toLocaleString()}`);
      console.log(`   No context: ${(nodes.length - withAncestor - withOwnTag).toLocaleString()}`);
      if (options.includeFields) {
        console.log(`   Field enrichment: enabled`);
      }
      console.log("");

      return contextualized;
    });

    if (!contextualizedNodes) {
      console.log("No nodes found to embed");
      return;
    }

    // Create TanaEmbeddingService (uses resona/LanceDB) - separate from SQLite
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

        // Get node stats from SQLite database
        const dbStats = await withDatabase({ dbPath: wsContext.dbPath, readonly: true }, (ctx) => {
          const nodeCount = ctx.db
            .query("SELECT COUNT(*) as count FROM nodes WHERE name IS NOT NULL")
            .get() as { count: number };
          const filterStats = getFilterStats(ctx.db);
          return { nodeCount, filterStats };
        });

        const coverage = dbStats.nodeCount.count > 0
          ? ((stats.totalEmbeddings / dbStats.nodeCount.count) * 100).toFixed(1)
          : "0.0";
        console.log("");
        console.log(
          `Coverage:     ${stats.totalEmbeddings}/${dbStats.nodeCount.count} (${coverage}%)`
        );

        // Show content filter stats
        console.log("");
        console.log("Content Filter Stats:");
        console.log(`  All named nodes:   ${dbStats.filterStats.totalNamed.toLocaleString()}`);
        console.log(`  After filtering:   ${dbStats.filterStats.withDefaultFilters.toLocaleString()}`);
        console.log(`  Reduction:         ${dbStats.filterStats.reduction}`);

        // Show entity stats
        console.log("");
        const hasNativeFlags = dbStats.filterStats.entityStats.entitiesWithOverride > 0 || dbStats.filterStats.entityStats.entitiesAutomatic > 0;
        console.log(`Entity Detection (${hasNativeFlags ? '_flags from export' : 'inferred from tags/library'}):`);
        if (hasNativeFlags) {
          console.log(`  With override:     ${dbStats.filterStats.entityStats.entitiesWithOverride.toLocaleString()}`);
          console.log(`  Automatic (_flags): ${dbStats.filterStats.entityStats.entitiesAutomatic.toLocaleString()}`);
        }
        console.log(`  Tagged items:      ${dbStats.filterStats.entityStats.entitiesTagged.toLocaleString()}`);
        console.log(`  Library items:     ${dbStats.filterStats.entityStats.entitiesLibrary.toLocaleString()}`);
        console.log(`  Total entities:    ${dbStats.filterStats.entityStats.totalEntities.toLocaleString()} (${dbStats.filterStats.entityStats.entityPercentage} of nodes)`);
        console.log(`  Entities + filters: ${dbStats.filterStats.entitiesWithFilters.toLocaleString()}`);

        // Show database diagnostics
        const diskSize = embeddingService.getDiskSize();
        const fragmentCount = embeddingService.getFragmentCount();

        console.log("");
        console.log("Database Health:");
        console.log(`  Rows:          ${diagnostics.totalRows.toLocaleString()}`);
        console.log(`  Disk Size:     ${diskSize.formatted}`);
        console.log(`  Version:       ${diagnostics.version}`);
        console.log(`  Fragments:     ${fragmentCount.toLocaleString()}`);
        if (diagnostics.index) {
          const indexHealth = diagnostics.index.needsRebuild ? "⚠️  needs rebuild" : "✓ healthy";
          console.log(`  Index:         ${indexHealth} (${diagnostics.index.numIndexedRows.toLocaleString()} indexed, ${diagnostics.index.numUnindexedRows.toLocaleString()} unindexed)`);
        } else {
          console.log(`  Index:         not created`);
        }
      } finally {
        embeddingService.close();
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

      await withDatabase({ dbPath: wsContext.dbPath, readonly: true }, (ctx) => {
        const filterStats = getFilterStats(ctx.db);

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
      });
    });

  /**
   * embed maintain - Run database maintenance (compaction, index rebuild, cleanup)
   */
  embed
    .command("maintain")
    .description("Run LanceDB maintenance (compaction, index rebuild, stale cleanup)")
    .option("-w, --workspace <alias>", "Workspace to maintain (default: default workspace)")
    .option("--skip-compact", "Skip fragment compaction")
    .option("--skip-index", "Skip index rebuild")
    .option("--skip-cleanup", "Skip old version cleanup")
    .option("--stale", "Run only stale embedding cleanup")
    .option("--dry-run", "Report what would be done without making changes")
    .option("--retention-days <n>", "Days to retain old versions (default: 7)", "7")
    .option("-v, --verbose", "Verbose output")
    .action(async (options) => {
      const wsContext = getWorkspaceContext(options.workspace);

      // Get embedding config from ConfigManager
      const configManager = ConfigManager.getInstance();
      const embeddingConfig = configManager.getEmbeddingConfig();

      const dryRun = !!options.dryRun;
      const staleOnly = !!options.stale;

      console.log(`🔧 ${dryRun ? "[DRY RUN] " : ""}Running maintenance [${wsContext.alias}]`);
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
        // Capture before metrics
        const beforeDiag = await embeddingService.getDiagnostics();
        const beforeDiskSize = embeddingService.getDiskSize();
        const beforeFragments = embeddingService.getFragmentCount();

        console.log("Before:");
        console.log(`  Rows:        ${beforeDiag.totalRows.toLocaleString()}`);
        console.log(`  Disk Size:   ${beforeDiskSize.formatted}`);
        console.log(`  Fragments:   ${beforeFragments.toLocaleString()}`);

        // Compute stale count (needed for before metrics and stale cleanup)
        let staleCount = 0;
        let validNodeIds: Set<string> | null = null;

        if (existsSync(wsContext.dbPath)) {
          const embeddedIds = await embeddingService.getEmbeddedIds();
          validNodeIds = await withDatabase({ dbPath: wsContext.dbPath, readonly: true }, (ctx) => {
            const rows = ctx.db.query("SELECT id FROM nodes WHERE name IS NOT NULL").all() as { id: string }[];
            return new Set(rows.map(r => r.id));
          });
          staleCount = embeddedIds.filter(id => !validNodeIds!.has(id)).length;
          const stalePercent = beforeDiag.totalRows > 0
            ? ((staleCount / beforeDiag.totalRows) * 100).toFixed(1)
            : "0.0";
          console.log(`  Stale:       ${staleCount.toLocaleString()} (${stalePercent}%)`);
        }

        console.log("");

        // --- Stale embedding cleanup ---
        let staleRemoved = 0;
        if (validNodeIds && staleCount > 0) {
          if (dryRun) {
            console.log(`   Would remove ${staleCount.toLocaleString()} stale embeddings`);
          } else {
            console.log(`   Removing stale embeddings... (${staleCount.toLocaleString()} to remove)`);
            staleRemoved = await embeddingService.cleanup([...validNodeIds]);
            console.log(`   ✓ Removed ${staleRemoved.toLocaleString()} stale embeddings`);
          }
        } else if (validNodeIds) {
          console.log("   No stale embeddings found");
        }

        // If --stale flag, skip resona maintenance operations
        if (!staleOnly) {
          // --- Resona maintenance (compaction, index, version cleanup) ---
          if (dryRun) {
            if (!options.skipCompact) {
              console.log(`   Would compact ${beforeFragments.toLocaleString()} fragments`);
            }
            if (!options.skipIndex) {
              if (beforeDiag.index) {
                console.log(`   Would rebuild index (${beforeDiag.index.stalePercent.toFixed(1)}% stale)`);
              } else {
                console.log("   Would create ANN index");
              }
            }
            if (!options.skipCleanup) {
              console.log(`   Would clean old versions (retention: ${options.retentionDays} days)`);
            }
          } else {
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

            if (result.compaction) {
              console.log(`   ✓ Compaction complete (${result.compaction.fragmentsRemoved} fragments merged)`);
            }
            if (result.indexRebuilt) {
              console.log(`   ✓ Index rebuilt (${result.indexStats?.numIndexedRows.toLocaleString() ?? "?"} rows indexed)`);
            } else if (result.indexStats) {
              console.log(`   ✓ Index healthy (${result.indexStats.numIndexedRows.toLocaleString()} indexed)`);
            }
            if (result.cleanup) {
              console.log(`   ✓ Cleanup complete (${result.cleanup.versionsRemoved} versions removed)`);
            }
          }
        }

        // --- After metrics ---
        console.log("");
        if (!dryRun) {
          const afterDiag = await embeddingService.getDiagnostics();
          const afterDiskSize = embeddingService.getDiskSize();
          const afterFragments = embeddingService.getFragmentCount();

          // Recompute stale count after cleanup
          let afterStaleCount = 0;
          if (validNodeIds) {
            const afterEmbeddedIds = await embeddingService.getEmbeddedIds();
            afterStaleCount = afterEmbeddedIds.filter(id => !validNodeIds!.has(id)).length;
          }

          console.log("After:");
          console.log(`  Rows:        ${afterDiag.totalRows.toLocaleString()}`);
          console.log(`  Disk Size:   ${afterDiskSize.formatted}`);
          console.log(`  Fragments:   ${afterFragments.toLocaleString()}`);
          console.log(`  Stale:       ${afterStaleCount.toLocaleString()}`);

          // Show savings
          const savedBytes = beforeDiskSize.bytes - afterDiskSize.bytes;
          if (savedBytes > 0) {
            const { formatBytes: fmtBytes } = await import("../embeddings/tana-embedding-service");
            console.log(`  Saved:       ${fmtBytes(savedBytes)}`);
          }
        }

        console.log("");
        console.log(`✅ ${dryRun ? "[DRY RUN] " : ""}Maintenance complete`);
      } finally {
        embeddingService.close();
      }
    });

  return embed;
}
