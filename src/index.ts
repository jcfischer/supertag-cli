#!/usr/bin/env bun

/**
 * Tana CLI - Unified PAI Skill for Tana Integration
 *
 * Complete Tana integration with:
 * - WRITE: Create nodes, format, post via Input API
 * - READ: Query indexed data, show node contents
 * - SYNC: Monitor and index Tana exports
 * - SERVER: Webhook server for bidirectional integration
 */

import { Command } from 'commander';
import { formatCommand } from './commands/format';
import { postCommand } from './commands/post';
import { configCommand } from './commands/config';
import { schemaCommand, createSchemaCommand } from './commands/schema';
import { createCommand } from './commands/create';
// Legacy query and show commands removed in v1.0.0 - use harmonized commands:
// - supertag search (replaces query search, query tagged)
// - supertag nodes (replaces show node, query refs, query recent)
// - supertag tags (replaces query tags, query top-tags)
// - supertag stats (replaces query stats)
import { registerSyncCommands } from './commands/sync';
import { registerServerCommands } from './commands/server';
import { createWorkspaceCommand } from './commands/workspace';
import { createEmbedCommand } from './commands/embed';
// Harmonized commands (CLI Harmonization Phase 1)
import { createSearchCommand } from './commands/search';
import { createNodesCommand } from './commands/nodes';
import { createTagsCommand } from './commands/tags';
import { createStatsCommand } from './commands/stats';
import { createSimpleLogger, ensureAllDirs, getAllPaths, getDatabasePath, needsMigration, DATABASE_PATH, TANA_DATA_DIR } from './config/paths';
import { existsSync, copyFileSync } from 'fs';
import { VERSION } from './version';

// Use portable logger (no external dependencies)
export const logger = createSimpleLogger('tana-skill');

// Ensure all directories exist on startup
ensureAllDirs();

const program = new Command();

program
  .name('supertag')
  .description('Supertag CLI - read, write, sync, and serve Tana data')
  .version(VERSION);

/**
 * Format Command
 * Converts JSON to Tana Paste format
 */
program
  .command('format')
  .description('Convert JSON input to Tana Paste format')
  .option('-p, --pretty', 'Pretty print JSON input before conversion')
  .action(async (options) => {
    await formatCommand(options);
  });

/**
 * Post Command
 * Post data to Tana via Input API
 */
program
  .command('post')
  .description('Post data to Tana via Input API')
  .option('-t, --target <node>', 'Target node ID (INBOX, SCHEMA, or specific node ID)')
  .option('--token <token>', 'API token (overrides config)')
  .option('-d, --dry-run', 'Validate but don\'t post (dry run mode)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    await postCommand(options);
  });

/**
 * Config Command
 * Manage configuration
 */
program
  .command('config')
  .description('Manage Tana CLI configuration')
  .option('-s, --show', 'Show current configuration')
  .option('--token <token>', 'Set API token')
  .option('--target <node>', 'Set default target node (INBOX, SCHEMA, or node ID)')
  .option('--endpoint <url>', 'Set API endpoint URL')
  .action(async (options) => {
    await configCommand(options);
  });

/**
 * Schema Command (Commander subcommands)
 * Manage supertag schema registry
 */
program.addCommand(createSchemaCommand());

/**
 * Create Command
 * Create any supertag node dynamically using schema registry
 */
program
  .command('create <supertag> [name]')
  .description('Create any supertag node dynamically. For inline refs use: <span data-inlineref-node="ID">Text</span>')
  .option('-t, --target <node>', 'Target node ID (INBOX, SCHEMA, or specific node ID)')
  .option('--token <token>', 'API token (overrides config)')
  .option('-d, --dry-run', 'Validate but don\'t post (dry run mode)')
  .option('-v, --verbose', 'Verbose output with field mapping details')
  .option('-f, --file <path>', 'Read JSON input from file')
  .option('--json <json>', 'Pass JSON input directly as argument')
  .option('-c, --children <child...>', 'Child nodes: plain text, JSON {"name":"...", "id":"..."} for ref nodes, or text with <span data-inlineref-node="ID">Text</span>')
  .allowUnknownOption(true) // Allow dynamic field options
  .action(async (supertag, name, options, command) => {
    // Parse unknown options as field values
    const allOptions = { ...options };
    const args = command.args || [];

    // Parse remaining args as --field value pairs
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const fieldName = arg.slice(2).replace(/-/g, '');
        const value = args[i + 1];
        if (value && !value.startsWith('--')) {
          allOptions[fieldName] = value;
          i++;
        }
      }
    }

    await createCommand(supertag, name, allOptions);
  });

/**
 * Register command groups
 */
registerSyncCommands(program);    // supertag sync monitor|index|status
registerServerCommands(program);  // supertag server start|stop|status
program.addCommand(createWorkspaceCommand());  // supertag workspace list|add|remove|set-default|show
program.addCommand(createEmbedCommand());     // supertag embed config|generate|stats

/**
 * Harmonized commands (CLI Harmonization Phase 1)
 * Object-action pattern for consistent CLI experience.
 */
program.addCommand(createSearchCommand());    // supertag search <query> [--semantic] [--tag]
program.addCommand(createNodesCommand());     // supertag nodes show|refs|recent
program.addCommand(createTagsCommand());      // supertag tags list|top|show
program.addCommand(createStatsCommand());     // supertag stats [--db] [--embed] [--filter]

/**
 * Help text with examples
 */
program.on('--help', () => {
  console.log('');
  console.log('Command Groups:');
  console.log('');
  console.log('  WRITE (Input API):');
  console.log('    supertag create <tag> [name]   Create nodes with supertags');
  console.log('    supertag format                Convert JSON to Tana Paste');
  console.log('    supertag post                  Post raw payload to Tana');
  console.log('');
  console.log('  SEARCH (Unified):');
  console.log('    supertag search <query>        Full-text search (default)');
  console.log('    supertag search <q> --semantic Semantic/vector search');
  console.log('    supertag search <q> --tag <t>  Find nodes by supertag');
  console.log('');
  console.log('  NODES:');
  console.log('    supertag nodes show <id>       Display node contents');
  console.log('    supertag nodes refs <id>       Show node references');
  console.log('    supertag nodes recent          Recently updated nodes');
  console.log('');
  console.log('  TAGS:');
  console.log('    supertag tags list             List all supertags');
  console.log('    supertag tags top              Most used supertags');
  console.log('    supertag tags show <name>      Show tag schema');
  console.log('');
  console.log('  STATS:');
  console.log('    supertag stats                 All statistics');
  console.log('    supertag stats --db            Database stats only');
  console.log('    supertag stats --embed         Embedding stats only');
  console.log('    supertag stats --filter        Filter breakdown');
  console.log('');
  console.log('  EXPORT (Separate Tool):');
  console.log('    supertag-export login          First-time login setup');
  console.log('    supertag-export run            Export workspace JSON');
  console.log('    supertag-export run --all      Export all workspaces');
  console.log('    supertag-export status         Show export config');
  console.log('');
  console.log('  SYNC (Export Indexing):');
  console.log('    supertag sync index            Index latest export');
  console.log('    supertag sync monitor --watch  Watch for new exports');
  console.log('    supertag sync status           Show sync status');
  console.log('    supertag sync cleanup          Remove old export files');
  console.log('');
  console.log('  SERVER (Webhooks):');
  console.log('    supertag server start          Start webhook server');
  console.log('    supertag server stop           Stop daemon server');
  console.log('    supertag server status         Check server status');
  console.log('');
  console.log('  EMBEDDINGS:');
  console.log('    supertag embed config          Configure embedding provider');
  console.log('    supertag embed generate        Generate node embeddings');
  console.log('    supertag embed stats           Show embedding statistics');
  console.log('    supertag search --semantic     Semantic search (use search command)');
  console.log('');
  console.log('  CONFIG:');
  console.log('    supertag config --show         Show configuration');
  console.log('    supertag config --token <tok>  Set API token');
  console.log('    supertag schema sync           Sync supertag schema');
  console.log('    supertag schema list           List all supertags');
  console.log('');
  console.log('  WORKSPACES:');
  console.log('    supertag workspace list        List all workspaces');
  console.log('    supertag workspace add <id>    Add a workspace');
  console.log('    supertag workspace remove <a>  Remove a workspace');
  console.log('    supertag workspace set-default Set default workspace');
  console.log('    supertag workspace show        Show workspace details');
  console.log('');
  console.log('Examples:');
  console.log('');
  console.log('  # Create a todo');
  console.log('  supertag create todo "Buy groceries" --status active --duedate 2025-12-31');
  console.log('');
  console.log('  # Search for nodes');
  console.log('  supertag search "meeting notes"');
  console.log('');
  console.log('  # Semantic search');
  console.log('  supertag search "project ideas" --semantic');
  console.log('');
  console.log('  # Find nodes by tag');
  console.log('  supertag search "meeting" --tag day');
  console.log('');
  console.log('  # Show node details');
  console.log('  supertag nodes show <node-id>');
  console.log('');
  console.log('  # Index latest Tana export');
  console.log('  supertag sync index');
  console.log('');
  console.log('  # Start webhook server');
  console.log('  supertag server start --daemon');
  console.log('');
  console.log('Get your API token from:');
  console.log('  https://app.tana.inc/?bundle=settings&panel=api');
  console.log('');
});

/**
 * Paths Command
 * Show all configuration paths
 */
program
  .command('paths')
  .description('Show all configuration and data paths')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const paths = getAllPaths();
    const currentDb = getDatabasePath();
    const migration = needsMigration();

    if (options.json) {
      console.log(JSON.stringify({ ...paths, currentDatabase: currentDb, migrationNeeded: migration.needed }, null, 2));
    } else {
      console.log('\n📁 Supertag CLI Paths:\n');
      console.log(`   Config:     ${paths.configDir}`);
      console.log(`   Data:       ${paths.dataDir}`);
      console.log(`   Cache:      ${paths.cacheDir}`);
      console.log(`   Logs:       ${paths.logDir}`);
      console.log(`   Database:   ${paths.database}`);
      console.log(`   Exports:    ${paths.exportDir}`);
      console.log(`   Schema:     ${paths.schemaCache}`);
      console.log(`   Browser:    ${paths.browserData}`);
      console.log('');
      console.log('📊 Database Status:');
      console.log(`   Current:    ${currentDb}`);
      if (migration.needed) {
        console.log(`   ⚠️  Using legacy location. Run 'supertag migrate' to move to XDG path.`);
      } else if (currentDb === paths.database) {
        console.log(`   ✅ Using portable XDG location`);
      }
      console.log('');
    }
  });

/**
 * Migrate Command
 * Migrate database from legacy to XDG location
 */
program
  .command('migrate')
  .description('Migrate database from legacy to XDG location')
  .option('--dry-run', 'Show what would be done without doing it')
  .action((options) => {
    const migration = needsMigration();

    if (!migration.needed) {
      console.log('✅ No migration needed. Database already at XDG location.');
      return;
    }

    console.log('\n🔄 Database Migration:\n');
    console.log(`   From: ${migration.from}`);
    console.log(`   To:   ${migration.to}`);
    console.log('');

    if (options.dryRun) {
      console.log('   (dry-run mode - no changes made)');
      return;
    }

    try {
      // Ensure target directory exists
      ensureAllDirs();

      // Copy database (don't delete original as safety)
      copyFileSync(migration.from!, migration.to!);

      console.log('✅ Database copied successfully!');
      console.log('');
      console.log('   The original database was preserved at the legacy location.');
      console.log('   Once verified, you can delete it manually:');
      console.log(`   rm "${migration.from}"`);
      console.log('');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  });

/**
 * Main entry point
 */
async function main() {
  // Parse and execute commands
  program.parse();
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
