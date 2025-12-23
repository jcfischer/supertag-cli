/**
 * Workspace Management Commands
 *
 * Commands for managing multiple Tana workspaces:
 * - list: Show all configured workspaces
 * - add: Add a new workspace
 * - remove: Remove a workspace
 * - set-default: Set the default workspace
 * - show: Show details about a workspace
 */

import { Command } from 'commander';
import { getConfig } from '../config/manager';
import {
  resolveWorkspace,
  getWorkspaceDir,
  getWorkspaceDatabasePath,
  getWorkspaceSchemaPath,
  getWorkspaceExportDir,
} from '../config/paths';
import { existsSync } from 'fs';
import {
  tsv,
  EMOJI,
  header,
} from '../utils/format';
import { resolveOutputOptions } from '../utils/output-options';
import { addStandardOptions } from './helpers';

/**
 * Create the workspace command group
 */
export function createWorkspaceCommand(): Command {
  const workspace = new Command('workspace')
    .description('Manage Tana workspaces');

  // List all workspaces
  const listCmd = workspace
    .command('list')
    .description('List all configured workspaces');

  addStandardOptions(listCmd, { defaultLimit: "100" });

  listCmd.action((options: { pretty?: boolean; json?: boolean }) => {
      const config = getConfig();
      const workspaces = config.getAllWorkspaces();
      const defaultWs = config.getDefaultWorkspace();
      const outputOpts = resolveOutputOptions(options);

      if (Object.keys(workspaces).length === 0) {
        if (outputOpts.pretty) {
          console.log('No workspaces configured.');
          console.log('\nDiscover workspaces automatically:');
          console.log('  supertag-export discover --add');
          console.log('\nOr add manually:');
          console.log('  tana workspace add <rootFileId> --alias <name>');
        }
        return;
      }

      if (options.json) {
        const result = Object.entries(workspaces).map(([alias, ws]) => ({
          alias,
          rootFileId: ws.rootFileId,
          name: ws.name,
          enabled: ws.enabled,
          isDefault: alias === defaultWs,
          dbExists: existsSync(getWorkspaceDatabasePath(alias)),
        }));
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (outputOpts.pretty) {
        // Pretty mode: emoji header, detailed output
        console.log(`\n${header(EMOJI.workspace, 'Configured workspaces')}:\n`);
        for (const [alias, ws] of Object.entries(workspaces)) {
          const isDefault = alias === defaultWs ? ' (default)' : '';
          const status = ws.enabled ? '✓' : '○';
          const name = ws.name ? ` "${ws.name}"` : '';
          console.log(`  ${status} ${alias}${name}${isDefault}`);
          console.log(`      rootFileId: ${ws.rootFileId}`);
          if (ws.nodeid) {
            console.log(`      nodeid: ${ws.nodeid}`);
          }

          // Check if database exists
          const dbPath = getWorkspaceDatabasePath(alias);
          const dbExists = existsSync(dbPath);
          console.log(`      database: ${dbExists ? 'exists' : 'not synced'}`);
          console.log('');
        }
      } else {
        // Unix mode: TSV output
        // Format: alias\trootFileId\tenabled\tdefault\tdb_exists
        for (const [alias, ws] of Object.entries(workspaces)) {
          const isDefault = alias === defaultWs ? "yes" : "no";
          const dbExists = existsSync(getWorkspaceDatabasePath(alias)) ? "yes" : "no";
          const enabled = ws.enabled ? "yes" : "no";
          console.log(tsv(alias, ws.rootFileId, enabled, isDefault, dbExists));
        }
      }
    });

  // Add a workspace
  workspace
    .command('add <rootFileId>')
    .description('Add a new workspace (use supertag-export discover to find rootFileId)')
    .option('-a, --alias <alias>', 'Alias for the workspace (defaults to rootFileId)')
    .option('-n, --name <name>', 'Human-readable display name')
    .option('--nodeid <id>', 'Node ID from Tana URLs (optional, for deep links)')
    .option('--disabled', 'Add as disabled (excluded from batch operations)')
    .action((rootFileId: string, options: { alias?: string; name?: string; nodeid?: string; disabled?: boolean }) => {
      const config = getConfig();
      const alias = options.alias || rootFileId;

      // Check if alias already exists
      const existing = config.getWorkspace(alias);
      if (existing) {
        console.error(`Error: Workspace "${alias}" already exists`);
        console.error(`  rootFileId: ${existing.config.rootFileId}`);
        process.exit(1);
      }

      // Check if rootFileId is already registered
      const existingRootFileId = config.getWorkspace(rootFileId);
      if (existingRootFileId && existingRootFileId.alias !== alias) {
        console.error(`Error: rootFileId "${rootFileId}" is already registered as "${existingRootFileId.alias}"`);
        process.exit(1);
      }

      config.addWorkspace(alias, rootFileId, {
        name: options.name,
        nodeid: options.nodeid,
        enabled: !options.disabled,
      });

      console.log(`Added workspace "${alias}"`);
      console.log(`  rootFileId: ${rootFileId}`);
      if (options.nodeid) {
        console.log(`  nodeid: ${options.nodeid}`);
      }
      if (options.name) {
        console.log(`  name: ${options.name}`);
      }
      console.log(`  enabled: ${!options.disabled}`);
      console.log(`  data dir: ${getWorkspaceDir(alias)}`);

      // Set as default if first workspace
      if (Object.keys(config.getAllWorkspaces()).length === 1) {
        config.setDefaultWorkspace(alias);
        console.log(`\nSet as default workspace`);
      }
    });

  // Update a workspace
  workspace
    .command('update <alias>')
    .description('Update workspace properties')
    .option('-r, --rootfileid <id>', 'Update root file ID')
    .option('--nodeid <id>', 'Node ID from Tana URLs (for deep links)')
    .option('-n, --name <name>', 'Human-readable display name')
    .action((alias: string, options: { rootfileid?: string; nodeid?: string; name?: string }) => {
      const config = getConfig();
      const workspace = config.getWorkspace(alias);

      if (!workspace) {
        console.error(`Error: Workspace "${alias}" not found`);
        process.exit(1);
      }

      if (!options.rootfileid && !options.nodeid && !options.name) {
        console.error('Error: Provide at least one option to update (--rootfileid, --nodeid, or --name)');
        process.exit(1);
      }

      config.updateWorkspace(alias, {
        rootFileId: options.rootfileid,
        nodeid: options.nodeid,
        name: options.name,
      });

      console.log(`Updated workspace "${alias}"`);
      if (options.rootfileid) {
        console.log(`  rootFileId: ${options.rootfileid}`);
      }
      if (options.nodeid) {
        console.log(`  nodeid: ${options.nodeid}`);
      }
      if (options.name) {
        console.log(`  name: ${options.name}`);
      }
    });

  // Remove a workspace
  workspace
    .command('remove <alias>')
    .description('Remove a workspace from configuration')
    .option('--delete-data', 'Also delete workspace data (database, cache)')
    .action(async (alias: string, options: { deleteData?: boolean }) => {
      const config = getConfig();
      const workspace = config.getWorkspace(alias);

      if (!workspace) {
        console.error(`Error: Workspace "${alias}" not found`);
        process.exit(1);
      }

      const dbPath = getWorkspaceDatabasePath(workspace.alias);
      const dataExists = existsSync(dbPath);

      if (options.deleteData && dataExists) {
        const { rm } = await import('fs/promises');
        const wsDir = getWorkspaceDir(workspace.alias);
        try {
          await rm(wsDir, { recursive: true });
          console.log(`Deleted workspace data: ${wsDir}`);
        } catch (error) {
          console.error(`Warning: Failed to delete workspace data: ${error}`);
        }
      } else if (dataExists && !options.deleteData) {
        console.log(`Note: Workspace data preserved at ${getWorkspaceDir(workspace.alias)}`);
        console.log(`Use --delete-data to remove it`);
      }

      config.removeWorkspace(alias);
      console.log(`Removed workspace "${alias}" from configuration`);
    });

  // Set default workspace
  workspace
    .command('set-default <alias>')
    .description('Set the default workspace for all operations')
    .action((alias: string) => {
      const config = getConfig();

      if (!config.setDefaultWorkspace(alias)) {
        console.error(`Error: Workspace "${alias}" not found`);
        console.error('\nConfigured workspaces:');
        for (const [a, ws] of Object.entries(config.getAllWorkspaces())) {
          console.error(`  - ${a} (${ws.rootFileId})`);
        }
        process.exit(1);
      }

      console.log(`Default workspace set to "${alias}"`);
    });

  // Show workspace details
  workspace
    .command('show [alias]')
    .description('Show details about a workspace')
    .action((alias?: string) => {
      const config = getConfig();
      const configData = config.getConfig();

      // If no alias, show default or first workspace
      let targetAlias = alias;
      if (!targetAlias) {
        targetAlias = config.getDefaultWorkspace();
        if (!targetAlias) {
          const workspaces = Object.keys(config.getAllWorkspaces());
          if (workspaces.length === 0) {
            console.log('No workspaces configured.');
            return;
          }
          targetAlias = workspaces[0];
        }
      }

      const workspace = config.getWorkspace(targetAlias);
      if (!workspace) {
        console.error(`Error: Workspace "${targetAlias}" not found`);
        process.exit(1);
      }

      const isDefault = targetAlias === config.getDefaultWorkspace();
      const ctx = resolveWorkspace(targetAlias, configData);

      console.log(`Workspace: ${workspace.alias}${isDefault ? ' (default)' : ''}`);
      console.log(`  Display name: ${workspace.config.name || '(not set)'}`);
      console.log(`  Root File ID: ${workspace.config.rootFileId}`);
      console.log(`  Node ID: ${workspace.config.nodeid || '(not set)'}`);
      console.log(`  Enabled: ${workspace.config.enabled}`);
      console.log('');
      console.log('Paths:');
      console.log(`  Database: ${ctx.dbPath}`);
      console.log(`    exists: ${existsSync(ctx.dbPath)}`);
      console.log(`  Schema cache: ${ctx.schemaPath}`);
      console.log(`    exists: ${existsSync(ctx.schemaPath)}`);
      console.log(`  Export dir: ${ctx.exportDir}`);
      console.log(`    exists: ${existsSync(ctx.exportDir)}`);
      if (workspace.config.nodeid) {
        console.log('');
        console.log('Tana URL:');
        console.log(`  https://app.tana.inc/?nodeid=${workspace.config.nodeid}`);
      }
    });

  // Enable a workspace
  workspace
    .command('enable <alias>')
    .description('Enable a workspace for batch operations')
    .action((alias: string) => {
      const config = getConfig();
      if (!config.setWorkspaceEnabled(alias, true)) {
        console.error(`Error: Workspace "${alias}" not found`);
        process.exit(1);
      }
      console.log(`Workspace "${alias}" enabled`);
    });

  // Disable a workspace
  workspace
    .command('disable <alias>')
    .description('Disable a workspace from batch operations')
    .action((alias: string) => {
      const config = getConfig();
      if (!config.setWorkspaceEnabled(alias, false)) {
        console.error(`Error: Workspace "${alias}" not found`);
        process.exit(1);
      }
      console.log(`Workspace "${alias}" disabled`);
    });

  return workspace;
}
