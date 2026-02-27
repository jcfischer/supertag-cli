/**
 * Sync Command Group - Monitor and index Tana exports
 *
 * Consolidates all tana-sync functionality into main tana CLI
 * Supports multi-workspace configuration via -w/--workspace option
 *
 * Automatically syncs schema registry after indexing exports.
 *
 * Delta-sync (F-095): Use --delta flag with `sync index` for incremental
 * sync via tana-local API instead of full reindex from export files.
 */

import { Command } from "commander";
import { join, dirname } from "path";
import { TanaExportWatcher } from "../monitors/tana-export-monitor";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import {
  getDatabasePath,
  DEFAULT_EXPORT_DIR,
  createSimpleLogger,
  ensureWorkspaceDir,
} from "../config/paths";
import {
  processWorkspaces,
  type ResolvedWorkspace,
} from "../config";
import { resolveWorkspaceContext } from "../config/workspace-resolver";
import { getConfig } from "../config/manager";
import { ConfigManager } from "../config/manager";
import {
  cleanupExports,
  getExportFiles,
} from "../cleanup/cleanup";
import { formatBytes } from "../utils/format";
import { syncSchemaToPath, getSchemaRegistryFromDatabase } from "./schema";
import { DeltaSyncService } from "../services/delta-sync";
import { LocalApiClient } from "../api/local-api-client";
import type { DeltaSyncResult } from "../types/local-api";
import { WatchService } from "../watch/watch-service";
import { Database } from "bun:sqlite";

// Use simple logger for portability (no external dependencies)
const logger = createSimpleLogger('tana-sync');

// Default paths - uses XDG with legacy fallback
const DEFAULT_DB_PATH = getDatabasePath();

/**
 * Resolve paths from options
 * Priority: --db-path/--export-dir > --workspace > default workspace > legacy
 */
function resolvePaths(options: {
  dbPath?: string;
  exportDir?: string;
  workspace?: string;
}): { dbPath: string; exportDir: string; schemaPath: string; alias: string } {
  // Explicit paths take precedence
  if (
    (options.dbPath && options.dbPath !== DEFAULT_DB_PATH) ||
    (options.exportDir && options.exportDir !== DEFAULT_EXPORT_DIR)
  ) {
    // For custom paths, use default workspace for schema cache
    const ws = resolveWorkspaceContext({ requireDatabase: false });
    return {
      dbPath: options.dbPath || DEFAULT_DB_PATH,
      exportDir: options.exportDir || DEFAULT_EXPORT_DIR,
      schemaPath: ws.schemaPath,
      alias: 'custom',
    };
  }

  // Use unified workspace resolver
  const ws = resolveWorkspaceContext({
    workspace: options.workspace,
    requireDatabase: false, // Sync creates/updates the database
  });
  return {
    dbPath: ws.dbPath,
    exportDir: ws.exportDir,
    schemaPath: ws.schemaPath,
    alias: ws.alias,
  };
}

/**
 * Format a relative time string from a millisecond timestamp.
 * Returns human-readable "X minutes ago" style strings.
 */
export function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diffMs = now - timestampMs;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return "just now";
}

/**
 * Print delta-sync result summary to the logger.
 */
function logDeltaSyncResult(result: DeltaSyncResult): void {
  logger.info('Delta-sync complete:');
  logger.info(`  Changed nodes found: ${result.nodesFound}`);
  logger.info(`  Inserted: ${result.nodesInserted}, Updated: ${result.nodesUpdated}, Skipped: ${result.nodesSkipped}`);
  if (result.embeddingsSkipped) {
    logger.info('  Embeddings: skipped (no config)');
  } else {
    logger.info(`  Embeddings: ${result.embeddingsGenerated} generated`);
  }
  logger.info(`  Duration: ${result.durationMs}ms (${result.pages} pages)`);
}

/**
 * Run delta-sync via Local API.
 * Returns the DeltaSyncResult or throws on error.
 */
async function runDeltaSync(dbPath: string): Promise<DeltaSyncResult> {
  // Step 1: Get Local API config
  const config = ConfigManager.getInstance();
  const localApiConfig = config.getLocalApiConfig();

  if (!localApiConfig.bearerToken) {
    throw new Error(
      "No bearer token configured. Set it with: supertag config set localApi.bearerToken <token>"
    );
  }

  // Step 2: Create client and check health
  const client = new LocalApiClient({
    endpoint: localApiConfig.endpoint,
    bearerToken: localApiConfig.bearerToken,
  });

  let healthy: boolean;
  try {
    healthy = await client.health();
  } catch (error) {
    throw new Error(
      `Tana Desktop is not running or Local API is disabled. Start Tana Desktop and enable Local API in Settings. (${error instanceof Error ? error.message : String(error)})`
    );
  }

  if (!healthy) {
    throw new Error(
      "Tana Desktop is not running or Local API is disabled. Start Tana Desktop and enable Local API in Settings."
    );
  }

  // Step 3: Create DeltaSyncService and run sync
  const deltaSyncService = new DeltaSyncService({
    dbPath,
    localApiClient: client,
  });

  try {
    return await deltaSyncService.sync();
  } finally {
    deltaSyncService.close();
  }
}

export function registerSyncCommands(program: Command): void {
  const sync = program
    .command("sync")
    .description("Monitor and index Tana exports");

  sync
    .command("monitor")
    .description("Monitor export directory for changes")
    .option("--watch", "Continuously watch for new exports", false)
    .option("-w, --workspace <alias>", "Workspace alias or nodeid")
    .option("--export-dir <path>", "Export directory path (overrides workspace)")
    .option("--db-path <path>", "Database path (overrides workspace)")
    .option("--debounce <ms>", "Debounce delay in milliseconds", "1000")
    .action(async (options) => {
      const paths = resolvePaths(options);

      logger.info(`Workspace: ${paths.alias}`);
      logger.info(`Export directory: ${paths.exportDir}`);
      logger.info(`Database: ${paths.dbPath}`);

      if (!existsSync(paths.exportDir)) {
        logger.error(`Export directory does not exist: ${paths.exportDir}`);
        logger.error(`Create it or specify --export-dir`);
        process.exit(1);
      }

      // Ensure workspace directory exists (for database storage)
      ensureWorkspaceDir(paths.alias);

      const watcher = new TanaExportWatcher({
        exportDir: paths.exportDir,
        dbPath: paths.dbPath,
        debounceMs: parseInt(options.debounce),
      });

      watcher.on("indexed", (result) => {
        logger.info(`Indexed: ${result.exportFile}`);
        if (result.nodesAdded !== undefined || result.nodesModified !== undefined) {
          logger.info(`Changes: +${result.nodesAdded || 0} added, ~${result.nodesModified || 0} modified, -${result.nodesDeleted || 0} deleted`);
        }
        logger.info(`Total Nodes: ${result.nodesIndexed.toLocaleString()}`);
        logger.info(`Supertags: ${result.supertagsIndexed.toLocaleString()}`);
        logger.info(`Fields: ${result.fieldsIndexed.toLocaleString()}`);
        logger.info(`References: ${result.referencesIndexed.toLocaleString()}`);
        logger.info(`Tag Applications: ${result.tagApplicationsIndexed.toLocaleString()}`);
        logger.info(`Duration: ${result.durationMs}ms`);

        // Sync schema registry from the same export
        try {
          const exportFullPath = join(paths.exportDir, result.exportFile);
          const registry = syncSchemaToPath(exportFullPath, paths.schemaPath, false);
          logger.info(`Schema: ${registry.listSupertags().length} supertags synced`);
        } catch (schemaError) {
          logger.warn(`Schema sync failed: ${schemaError}`);
        }
      });

      watcher.on("error", (error) => {
        logger.error('Watcher error', error);
      });

      if (options.watch) {
        logger.info('Watching for new exports... (press Ctrl+C to stop)');
        watcher.start();

        process.on("SIGINT", () => {
          logger.info('Stopping watcher...');
          watcher.stop();
          process.exit(0);
        });

        await new Promise(() => {});
      } else {
        logger.info('Indexing latest export...');
        try {
          const result = await watcher.indexLatest();
          process.exit(0);
        } catch (error) {
          logger.error('Index failed', error as Error);
          process.exit(1);
        }
      }
    });

  sync
    .command("index")
    .description("Manually index latest export")
    .option("-w, --workspace <alias>", "Workspace alias or nodeid")
    .option("--all", "Index all enabled workspaces")
    .option("--delta", "Run incremental delta-sync via Local API instead of full reindex")
    .option("--export-dir <path>", "Export directory path (overrides workspace)")
    .option("--db-path <path>", "Database path (overrides workspace)")
    .action(async (options) => {
      // Handle --delta mode (F-095 T-3.1)
      if (options.delta) {
        const paths = resolvePaths(options);
        logger.info(`Workspace: ${paths.alias}`);
        logger.info(`Database: ${paths.dbPath}`);
        logger.info('Running delta-sync via Local API...');

        try {
          const result = await runDeltaSync(paths.dbPath);
          logDeltaSyncResult(result);
          process.exit(0);
        } catch (error) {
          logger.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      }

      // Handle --all option for batch indexing
      if (options.all) {
        const batchResult = await processWorkspaces(
          { all: true, continueOnError: true },
          async (ws: ResolvedWorkspace) => {
            logger.info(`\n--- Workspace: ${ws.alias} ---`);

            if (!existsSync(ws.exportDir)) {
              throw new Error(`Export directory does not exist: ${ws.exportDir}`);
            }

            // Ensure workspace directory exists
            ensureWorkspaceDir(ws.alias);

            const watcher = new TanaExportWatcher({
              exportDir: ws.exportDir,
              dbPath: ws.dbPath,
            });

            try {
              const result = await watcher.indexLatest();
              logger.info(`Indexed: ${result.exportFile}`);
              logger.info(`Nodes: ${result.nodesIndexed.toLocaleString()}`);
              logger.info(`Duration: ${result.durationMs}ms`);

              // Sync schema registry from the same export
              try {
                const exportFullPath = join(ws.exportDir, result.exportFile);
                const registry = syncSchemaToPath(exportFullPath, ws.schemaPath, false);
                logger.info(`Schema: ${registry.listSupertags().length} supertags`);
              } catch (schemaError) {
                logger.warn(`Schema sync failed: ${schemaError}`);
              }

              return result;
            } finally {
              watcher.close();
            }
          }
        );

        if (batchResult.results.length === 0) {
          logger.error('No enabled workspaces configured');
          logger.error('Add workspaces with: tana workspace add <nodeid> --alias <name>');
          process.exit(1);
        }

        logger.info(`\n=== Batch Index Complete ===`);
        logger.info(`Success: ${batchResult.successful}, Failed: ${batchResult.failed}`);
        process.exit(batchResult.failed > 0 ? 1 : 0);
      }

      // Single workspace index
      const paths = resolvePaths(options);

      logger.info(`Workspace: ${paths.alias}`);
      logger.info(`Export directory: ${paths.exportDir}`);
      logger.info(`Database: ${paths.dbPath}`);

      if (!existsSync(paths.exportDir)) {
        logger.error(`Export directory does not exist: ${paths.exportDir}`);
        process.exit(1);
      }

      // Ensure workspace directory exists (for database storage)
      ensureWorkspaceDir(paths.alias);

      const watcher = new TanaExportWatcher({
        exportDir: paths.exportDir,
        dbPath: paths.dbPath,
      });

      logger.info('Indexing latest export...');
      try {
        const result = await watcher.indexLatest();
        logger.info(`Indexed: ${result.exportFile}`);
        if (result.nodesAdded !== undefined || result.nodesModified !== undefined) {
          logger.info(`Changes: +${result.nodesAdded || 0} added, ~${result.nodesModified || 0} modified, -${result.nodesDeleted || 0} deleted`);
        }
        logger.info(`Total Nodes: ${result.nodesIndexed.toLocaleString()}`);
        logger.info(`Supertags: ${result.supertagsIndexed.toLocaleString()}`);
        logger.info(`Fields: ${result.fieldsIndexed.toLocaleString()}`);
        logger.info(`References: ${result.referencesIndexed.toLocaleString()}`);
        logger.info(`Tag Applications: ${result.tagApplicationsIndexed.toLocaleString()}`);
        logger.info(`Duration: ${result.durationMs}ms (${(result.durationMs / 1000).toFixed(2)}s)`);

        // Generate schema registry from database (includes targetSupertag data)
        logger.info('Syncing schema registry...');
        const isDebug = process.env.DEBUG_SCHEMA === "1";
        try {
          if (isDebug) {
            logger.info('[schema-debug] Opening database and creating service...');
          }
          const schemaStart = Date.now();
          const registry = getSchemaRegistryFromDatabase(paths.dbPath);
          if (isDebug) {
            logger.info(`[schema-debug] getSchemaRegistryFromDatabase took ${Date.now() - schemaStart}ms`);
            logger.info('[schema-debug] Writing schema cache file...');
          }
          // Write the registry to the schema cache file
          const schemaDir = dirname(paths.schemaPath);
          if (!existsSync(schemaDir)) {
            mkdirSync(schemaDir, { recursive: true });
          }
          const writeStart = Date.now();
          const json = registry.toJSON();
          if (isDebug) {
            logger.info(`[schema-debug] registry.toJSON() took ${Date.now() - writeStart}ms (${(json.length / 1024).toFixed(1)} KB)`);
          }
          writeFileSync(paths.schemaPath, json);
          if (isDebug) {
            logger.info(`[schema-debug] File write took ${Date.now() - writeStart}ms`);
            logger.info(`[schema-debug] Total schema sync: ${Date.now() - schemaStart}ms`);
          }
          logger.info(`Schema: ${registry.listSupertags().length} supertags synced to ${paths.schemaPath}`);
        } catch (schemaError) {
          logger.warn(`Schema sync failed: ${schemaError}`);
        }

        watcher.close();
        process.exit(0);
      } catch (error) {
        logger.error('Index failed', error as Error);
        watcher.close();
        process.exit(1);
      }
    });

  sync
    .command("status")
    .description("Show sync status")
    .option("-w, --workspace <alias>", "Workspace alias or nodeid")
    .option("--all", "Show status for all enabled workspaces")
    .option("--export-dir <path>", "Export directory path (overrides workspace)")
    .option("--db-path <path>", "Database path (overrides workspace)")
    .action(async (options) => {
      // Handle --all option
      if (options.all) {
        const batchResult = await processWorkspaces(
          { all: true, continueOnError: true },
          async (ws: ResolvedWorkspace) => {
            logger.info(`--- ${ws.alias} ---`);
            logger.info(`  Export dir: ${ws.exportDir}`);
            logger.info(`  Database: ${ws.dbPath}`);
            logger.info(`  Export exists: ${existsSync(ws.exportDir) ? 'Yes' : 'No'}`);
            logger.info(`  Database exists: ${existsSync(ws.dbPath) ? 'Yes' : 'No'}`);
            logger.info('');
            return { alias: ws.alias };
          }
        );

        if (batchResult.results.length === 0) {
          logger.info('No enabled workspaces configured');
        } else {
          logger.info(`Status for ${batchResult.results.length} enabled workspace(s):\n`);
        }
        return;
      }

      const paths = resolvePaths(options);

      logger.info(`Workspace: ${paths.alias}`);
      logger.info(`Export directory: ${paths.exportDir}`);
      logger.info(`Database: ${paths.dbPath}`);

      if (!existsSync(paths.exportDir)) {
        logger.error(`Export directory does not exist: ${paths.exportDir}`);
        process.exit(1);
      }

      const watcher = new TanaExportWatcher({
        exportDir: paths.exportDir,
        dbPath: paths.dbPath,
      });

      const status = watcher.getStatus();

      logger.info('Status:');
      logger.info(`Watching: ${status.watching ? "Yes" : "No"}`);
      logger.info(`Export dir: ${status.exportDir}`);
      logger.info(`Database: ${status.dbPath}`);
      logger.info(`Latest export: ${status.latestExport || "None found"}`);
      logger.info(`Last indexed: ${status.lastIndexed ? new Date(status.lastIndexed).toLocaleString() : "Never"}`);

      watcher.close();

      // Delta-sync status (F-095 T-3.2)
      if (existsSync(paths.dbPath)) {
        try {
          const deltaSyncService = new DeltaSyncService({
            dbPath: paths.dbPath,
            // Dummy client - only used for status reporting, not syncing
            localApiClient: { searchNodes: async () => [], health: async () => false },
          });

          const deltaStatus = deltaSyncService.getStatus();
          deltaSyncService.close();

          logger.info('Delta Sync:');
          if (deltaStatus.lastDeltaSync !== null) {
            const dateStr = new Date(deltaStatus.lastDeltaSync).toLocaleString();
            const relativeStr = formatRelativeTime(deltaStatus.lastDeltaSync);
            logger.info(`  Last delta-sync: ${dateStr} (${relativeStr})`);
          } else {
            logger.info('  Last delta-sync: Never');
          }
          logger.info(`  Nodes synced: ${deltaStatus.lastDeltaNodesCount}`);
          if (deltaStatus.totalNodes > 0) {
            const coverage = deltaStatus.embeddingCoverage.toFixed(1);
            logger.info(`  Embedding coverage: ${coverage}% (${deltaStatus.totalNodes.toLocaleString()} nodes)`);
          }
        } catch {
          // Delta-sync status is optional, don't fail the command
        }
      }
    });

  sync
    .command("cleanup")
    .description("Remove old export files, keeping only the most recent")
    .option("-w, --workspace <alias>", "Workspace alias or nodeid")
    .option("--all", "Clean up all enabled workspaces")
    .option("-k, --keep <count>", "Number of files to keep (uses config default if not specified)")
    .option("-d, --dry-run", "Show what would be deleted without deleting", false)
    .option("--export-dir <path>", "Export directory path (overrides workspace)")
    .action(async (options) => {
      // Get cleanup config for defaults
      const cleanupConfig = getConfig().getCleanupConfig();

      // Use CLI option if provided, otherwise use config default
      const keepCount = options.keep ? parseInt(options.keep) : (cleanupConfig.keepCount ?? 3);

      if (isNaN(keepCount) || keepCount < 1) {
        logger.error("Invalid --keep value. Must be a positive integer.");
        process.exit(1);
      }

      // Handle --all option for batch cleanup
      if (options.all) {
        if (options.dryRun) {
          logger.info("(dry-run mode - no files will be deleted)");
        }

        const batchResult = await processWorkspaces(
          { all: true, continueOnError: true },
          async (ws: ResolvedWorkspace) => {
            logger.info(`--- Workspace: ${ws.alias} ---`);

            if (!existsSync(ws.exportDir)) {
              logger.warn(`Export directory does not exist: ${ws.exportDir}`);
              logger.warn(`Skipping workspace ${ws.alias}`);
              return { deleted: 0, bytesFreed: 0, kept: 0, skipped: true };
            }

            const result = cleanupExports(ws.exportDir, {
              keepCount,
              dryRun: options.dryRun,
            });

            if (result.error) {
              throw new Error(result.error);
            }

            const exportFiles = getExportFiles(ws.exportDir);
            logger.info(`  Total files: ${exportFiles.length}`);
            logger.info(`  Keeping: ${result.kept.length} newest`);

            if (result.deleted.length > 0) {
              logger.info(
                `  ${options.dryRun ? "Would delete" : "Deleted"}: ${result.deleted.length} files (${formatBytes(result.bytesFreed)})`
              );
              for (const file of result.deleted) {
                logger.info(`    - ${file}`);
              }
            } else {
              logger.info("  Nothing to clean up");
            }
            logger.info("");

            return {
              deleted: result.deleted.length,
              bytesFreed: result.bytesFreed,
              kept: result.kept.length,
              skipped: false,
            };
          }
        );

        if (batchResult.results.length === 0) {
          logger.error("No enabled workspaces configured");
          process.exit(1);
        }

        // Aggregate totals from successful results
        let totalDeleted = 0;
        let totalBytesFreed = 0;
        for (const r of batchResult.results) {
          if (r.success && r.result && !r.result.skipped) {
            totalDeleted += r.result.deleted;
            totalBytesFreed += r.result.bytesFreed;
          }
        }

        logger.info("=== Cleanup Complete ===");
        logger.info(
          `Total ${options.dryRun ? "would delete" : "deleted"}: ${totalDeleted} files (${formatBytes(totalBytesFreed)})`
        );
        process.exit(0);
      }

      // Single workspace cleanup
      const paths = resolvePaths(options);

      logger.info(`Workspace: ${paths.alias}`);
      logger.info(`Export directory: ${paths.exportDir}`);
      if (options.dryRun) {
        logger.info("(dry-run mode - no files will be deleted)");
      }

      if (!existsSync(paths.exportDir)) {
        logger.error(`Export directory does not exist: ${paths.exportDir}`);
        process.exit(1);
      }

      const exportFiles = getExportFiles(paths.exportDir);
      logger.info(`\nTotal export files: ${exportFiles.length}`);
      logger.info(`Keeping: ${keepCount} newest files`);

      const result = cleanupExports(paths.exportDir, {
        keepCount,
        dryRun: options.dryRun,
      });

      if (result.error) {
        logger.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (result.deleted.length === 0) {
        logger.info("\nNothing to clean up.");
        process.exit(0);
      }

      logger.info(
        `\n${options.dryRun ? "Would delete" : "Deleted"}: ${result.deleted.length} files (${formatBytes(result.bytesFreed)})`
      );

      for (const file of result.deleted) {
        logger.info(`  - ${file}`);
      }

      logger.info(`\nKept: ${result.kept.length} files`);
      for (const file of result.kept) {
        logger.info(`  + ${file}`);
      }

      process.exit(0);
    });

  // =========================================================================
  // F-103: sync watch subcommand
  // =========================================================================

  sync
    .command("watch")
    .description("Continuously watch for Tana changes via Local API")
    .option("-w, --workspace <alias>", "Workspace alias (default: main)")
    .option("-i, --interval <seconds>", "Poll interval in seconds (default: 30, min: 5)", "30")
    .option("-t, --filter-tag <tag>", "Only watch changes on nodes with this supertag")
    .option("--on-change <command>", "Execute command on any change")
    .option("--on-create <command>", "Execute command on new nodes")
    .option("--on-modify <command>", "Execute command on modified nodes")
    .option("--on-delete <command>", "Execute command on deleted/trashed nodes")
    .option("--event-log <path>", "Custom event log path (JSONL)")
    .option("--dry-run", "Detect changes without executing hooks", false)
    .option("--max-failures <n>", "Exit after N consecutive poll failures (default: 10)", "10")
    .option("--db-path <path>", "Database path override")
    .action(async (options) => {
      // Resolve workspace
      let resolvedPaths: { dbPath: string; alias: string };
      try {
        const paths = resolvePaths(options);
        resolvedPaths = paths;
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      // Validate and clamp interval
      let interval = parseInt(options.interval, 10);
      if (isNaN(interval) || interval < 5) {
        if (!isNaN(interval) && interval > 0) {
          process.stderr.write(`[supertag watch] WARNING: --interval ${interval} is below minimum (5). Clamping to 5.\n`);
        }
        interval = 5;
      }

      // Validate Local API availability
      const config = ConfigManager.getInstance();
      const localApiConfig = config.getLocalApiConfig();

      if (!localApiConfig.bearerToken) {
        logger.error("No bearer token configured. Set it with: supertag config set localApi.bearerToken <token>");
        process.exit(1);
      }

      const client = new LocalApiClient({
        endpoint: localApiConfig.endpoint,
        bearerToken: localApiConfig.bearerToken,
      });

      try {
        const healthy = await client.health();
        if (!healthy) {
          logger.error("Local API not available. Watch mode requires Tana Desktop.");
          logger.error("Start Tana Desktop and enable Local API in Settings.");
          process.exit(1);
        }
      } catch {
        logger.error("Local API not available. Watch mode requires Tana Desktop.");
        logger.error("Start Tana Desktop and enable Local API in Settings.");
        process.exit(1);
      }

      // Set up DeltaSyncService and WatchService
      const db = new Database(resolvedPaths.dbPath);
      const deltaSyncService = new DeltaSyncService({
        dbPath: resolvedPaths.dbPath,
        localApiClient: client,
      });

      const watchOptions = {
        workspace: resolvedPaths.alias,
        interval,
        filterTag: options.filterTag,
        onChangeCmd: options.onChange,
        onCreateCmd: options.onCreate,
        onModifyCmd: options.onModify,
        onDeleteCmd: options.onDelete,
        eventLogPath: options.eventLog,
        dryRun: options.dryRun,
        maxConsecutiveFailures: parseInt(options.maxFailures, 10) || 10,
      };

      const service = new WatchService(watchOptions, {
        deltaSyncService,
        db,
      });

      try {
        await service.start();
      } finally {
        deltaSyncService.close();
        db.close();
      }
    });
}
