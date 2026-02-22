/**
 * Context Command (Spec F-098: Context Assembler)
 *
 * Assemble AI context from the Tana knowledge graph with token budgeting.
 *
 * Usage:
 *   supertag context "SOC Defender"                         # Search-based context
 *   supertag context abc123def456 --depth 3                 # Direct node ID
 *   supertag context "planning" --lens planning --max-tokens 8000
 *   supertag context "meeting" --lens meeting-prep --format json
 */

import { Command } from 'commander';
import { assembleContext } from '../services/context-assembler';
import { formatContext } from '../services/context-formatter';
import { resolveDbPath, checkDb, addStandardOptions } from './helpers';
import { LENS_TYPES } from '../types/context';

/**
 * Create the context command
 */
export function createContextCommand(): Command {
  const cmd = new Command('context');

  cmd
    .description('Assemble AI context from the Tana knowledge graph')
    .argument('<query>', 'Topic to search for or node ID to start from')
    .option('--depth <n>', 'Traversal depth (1-5, default: 2)', '2')
    .option('--max-tokens <n>', 'Token budget for output (default: 4000)', '4000')
    .option('--include-fields', 'Include field values in context (default)', true)
    .option('--no-include-fields', 'Exclude field values from context')
    .option(
      '--lens <name>',
      `Traversal lens: ${LENS_TYPES.join(', ')} (default: general)`,
      'general',
    );

  // Use standard options but skip --format (context has its own markdown/json via --format from standard)
  // The standard --format already provides the format flag
  addStandardOptions(cmd, { includeFormat: false });

  // Add context-specific format option (markdown|json, different from the universal 6-format system)
  cmd.option('--format <type>', 'Output format: markdown, json (default: markdown)', 'markdown');

  cmd.action(async (query: string, options: Record<string, unknown>) => {
    // Validate workspace/database
    const dbPath = resolveDbPath(options as { dbPath?: string; workspace?: string });
    if (!checkDb(dbPath, options.workspace as string | undefined)) {
      process.exit(1);
    }

    // Parse and validate options
    const depth = parseInt(String(options.depth ?? '2'), 10);
    if (isNaN(depth) || depth < 1 || depth > 5) {
      console.error('Error: --depth must be between 1 and 5');
      process.exit(1);
    }

    const maxTokens = parseInt(String(options.maxTokens ?? '4000'), 10);
    if (isNaN(maxTokens) || maxTokens < 100) {
      console.error('Error: --max-tokens must be at least 100');
      process.exit(1);
    }

    const lens = String(options.lens ?? 'general');
    if (!LENS_TYPES.includes(lens as any)) {
      console.error(`Error: --lens must be one of: ${LENS_TYPES.join(', ')}`);
      process.exit(1);
    }

    const format = String(options.format ?? 'markdown') as 'markdown' | 'json';
    if (format !== 'markdown' && format !== 'json') {
      console.error('Error: --format must be "markdown" or "json"');
      process.exit(1);
    }

    try {
      const doc = await assembleContext(query, {
        workspace: options.workspace as string | undefined,
        depth,
        maxTokens,
        includeFields: options.includeFields !== false,
        lens: lens as any,
        offline: options.offline as boolean | undefined,
      });

      const output = formatContext(doc, format);
      console.log(output);

      if (doc.nodes.length === 0) {
        console.error('\nNo matching nodes found for query.');
        process.exit(0);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });

  return cmd;
}
