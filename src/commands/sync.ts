/**
 * Sync Command Group - Monitor and index Tana exports
 *
 * Consolidates all tana-sync functionality into main tana CLI
 * Supports multi-workspace configuration via -w/--workspace option
 *
 * Automatically syncs schema registry after indexing exports.
 */

import { Command } from "commander";
import { join } from "path";
import { TanaExportWatcher } from "../monitors/tana-export-monitor";
import { existsSync, mkdirSync } from "fs";
import {
  getDatabasePath,
  DEFAULT_EXPORT_DIR,
  createSimpleLogger,
  resolveWorkspace,
  getEnabledWorkspaces,
  ensureWorkspaceDir,
} from "../config/paths";
import { getConfig } from "../config/manager";
import {
  cleanupExports,
  getExportFiles,
  formatBytes,
} from "../cleanup/cleanup";
import { syncSchemaToPath } from "./schema";

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
    // For custom paths, use default schema cache
    const config = getConfig().getConfig();
    const ctx = resolveWorkspace(undefined, config);
    return {
      dbPath: options.dbPath || DEFAULT_DB_PATH,
      exportDir: options.exportDir || DEFAULT_EXPORT_DIR,
      schemaPath: ctx.schemaPath,
      alias: 'custom',
    };
  }

  // Resolve workspace
  const config = getConfig().getConfig();
  const ctx = resolveWorkspace(options.workspace, config);
  return {
    dbPath: ctx.dbPath,
    exportDir: ctx.exportDir,
    schemaPath: ctx.schemaPath,
    alias: ctx.alias,
  };
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
    .option("--export-dir <path>", "Export directory path (overrides workspace)")
    .option("--db-path <path>", "Database path (overrides workspace)")
    .action(async (options) => {
      // Handle --all option for batch indexing
      if (options.all) {
        const config = getConfig().getConfig();
        const workspaces = getEnabledWorkspaces(config);

        if (workspaces.length === 0) {
          logger.error('No enabled workspaces configured');
          logger.error('Add workspaces with: tana workspace add <nodeid> --alias <name>');
          process.exit(1);
        }

        logger.info(`Indexing ${workspaces.length} enabled workspace(s)...`);
        let successCount = 0;
        let failCount = 0;

        for (const ws of workspaces) {
          logger.info(`\n--- Workspace: ${ws.alias} ---`);

          if (!existsSync(ws.exportDir)) {
            logger.warn(`Export directory does not exist: ${ws.exportDir}`);
            logger.warn(`Skipping workspace ${ws.alias}`);
            failCount++;
            continue;
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

            successCount++;
          } catch (error) {
            logger.error(`Index failed for ${ws.alias}:`, error as Error);
            failCount++;
          } finally {
            watcher.close();
          }
        }

        logger.info(`\n=== Batch Index Complete ===`);
        logger.info(`Success: ${successCount}, Failed: ${failCount}`);
        process.exit(failCount > 0 ? 1 : 0);
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

        // Sync schema registry from the same export
        logger.info('Syncing schema registry...');
        try {
          const exportFullPath = join(paths.exportDir, result.exportFile);
          const registry = syncSchemaToPath(exportFullPath, paths.schemaPath, false);
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
    .action((options) => {
      // Handle --all option
      if (options.all) {
        const config = getConfig().getConfig();
        const workspaces = getEnabledWorkspaces(config);

        if (workspaces.length === 0) {
          logger.info('No enabled workspaces configured');
          return;
        }

        logger.info(`Status for ${workspaces.length} enabled workspace(s):\n`);

        for (const ws of workspaces) {
          logger.info(`--- ${ws.alias} ---`);
          logger.info(`  Export dir: ${ws.exportDir}`);
          logger.info(`  Database: ${ws.dbPath}`);
          logger.info(`  Export exists: ${existsSync(ws.exportDir) ? 'Yes' : 'No'}`);
          logger.info(`  Database exists: ${existsSync(ws.dbPath) ? 'Yes' : 'No'}`);
          logger.info('');
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
    });

  sync
    .command("cleanup")
    .description("Remove old export files, keeping only the most recent")
    .option("-w, --workspace <alias>", "Workspace alias or nodeid")
    .option("--all", "Clean up all enabled workspaces")
    .option("-k, --keep <count>", "Number of files to keep (uses config default if not specified)")
    .option("-d, --dry-run", "Show what would be deleted without deleting", false)
    .option("--export-dir <path>", "Export directory path (overrides workspace)")
    .action((options) => {
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
        const config = getConfig().getConfig();
        const workspaces = getEnabledWorkspaces(config);

        if (workspaces.length === 0) {
          logger.error("No enabled workspaces configured");
          process.exit(1);
        }

        logger.info(`Cleaning up ${workspaces.length} enabled workspace(s)...`);
        if (options.dryRun) {
          logger.info("(dry-run mode - no files will be deleted)");
        }
        logger.info("");

        let totalDeleted = 0;
        let totalBytesFreed = 0;

        for (const ws of workspaces) {
          logger.info(`--- Workspace: ${ws.alias} ---`);

          if (!existsSync(ws.exportDir)) {
            logger.warn(`Export directory does not exist: ${ws.exportDir}`);
            logger.warn(`Skipping workspace ${ws.alias}`);
            continue;
          }

          const result = cleanupExports(ws.exportDir, {
            keepCount,
            dryRun: options.dryRun,
          });

          if (result.error) {
            logger.error(`Error: ${result.error}`);
            continue;
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
            totalDeleted += result.deleted.length;
            totalBytesFreed += result.bytesFreed;
          } else {
            logger.info("  Nothing to clean up");
          }
          logger.info("");
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
}
