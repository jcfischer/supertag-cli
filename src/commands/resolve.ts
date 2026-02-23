/**
 * Entity Resolution CLI Command
 *
 * `supertag resolve <name>` - find existing nodes matching a name.
 * Returns candidates with confidence scores for find-or-create workflows.
 *
 * Spec: F-100 Entity Resolution (Phase 3)
 */

import { Command } from 'commander';
import { resolveWorkspaceContext } from '../config/workspace-resolver';
import { withDatabase } from '../db/with-database';
import { resolveEntity } from '../db/entity-match';
import { resolveOutputOptions, resolveOutputFormat } from '../utils/output-options';
import { createFormatter, type OutputFormat } from '../utils/output-formatter';
import { addStandardOptions } from './helpers';
import { DEFAULTS } from '../lib/entity-resolution';
import type { StandardOptions } from '../types';

interface ResolveOptions extends StandardOptions {
  tag?: string;
  threshold?: string;
  exact?: boolean;
  createIfMissing?: boolean;
  batch?: boolean;
  format?: OutputFormat;
  header?: boolean;
}

/**
 * Create the resolve command
 */
export function createResolveCommand(): Command {
  const resolve = new Command('resolve');

  resolve
    .description(
      'Find existing nodes by name with confidence scoring. Returns ranked candidates for find-or-create workflows.'
    )
    .argument('[name]', 'Name to resolve (required unless --batch)')
    .option('-t, --tag <supertag>', 'Filter to specific supertag (e.g., person, project)')
    .option(
      '--threshold <float>',
      `Minimum confidence threshold (0-1, default: ${DEFAULTS.threshold})`
    )
    .option('--exact', 'Exact match only, no fuzzy or semantic matching')
    .option(
      '--create-if-missing',
      'Print creation suggestion if no match found (requires --tag)'
    )
    .option(
      '--batch',
      'Batch mode: read names from stdin (one per line)'
    );

  addStandardOptions(resolve, {
    defaultLimit: String(DEFAULTS.limit),
    includeFormat: true,
  });

  resolve.action(async (name: string | undefined, options: ResolveOptions) => {
    if (options.batch) {
      await handleBatch(options);
      return;
    }

    if (!name) {
      console.error('❌ Name is required. Use: supertag resolve <name>');
      console.error('   For batch mode: echo "names" | supertag resolve --batch');
      process.exit(1);
    }

    await handleSingle(name, options);
  });

  return resolve;
}

/**
 * Handle single name resolution
 */
async function handleSingle(name: string, options: ResolveOptions): Promise<void> {
  const threshold = options.threshold ? parseFloat(options.threshold) : undefined;
  const limit = options.limit ? parseInt(String(options.limit), 10) : undefined;
  const format = resolveOutputFormat(options);

  const ws = resolveWorkspaceContext({ workspace: options.workspace });

  await withDatabase({ dbPath: ws.dbPath, readonly: true }, async (ctx) => {
    const result = await resolveEntity(ctx.db, name, {
      tag: options.tag,
      threshold,
      limit,
      exact: options.exact,
      workspace: options.workspace,
    });

    // Handle create-if-missing
    if (options.createIfMissing && result.action === 'no_match') {
      if (!options.tag) {
        console.error('❌ --create-if-missing requires --tag to specify the supertag');
        process.exit(1);
      }
      console.log(
        `💡 No match found. Create with: supertag create --tag ${options.tag} --name "${name}"`
      );
    } else if (options.createIfMissing && result.action === 'ambiguous') {
      console.error(
        '⚠️  Ambiguous match — cannot auto-create. Review candidates and use --tag to narrow.'
      );
    }

    // Format output
    if (format === 'json' || format === 'jsonl') {
      console.log(JSON.stringify(result, null, format === 'json' ? 2 : 0));
      return;
    }

    if (format === 'ids') {
      if (result.bestMatch) {
        console.log(result.bestMatch.id);
      }
      return;
    }

    if (format === 'csv') {
      const headerRow = options.header !== false ? 'id,name,confidence,matchType,tags\n' : '';
      const rows = result.candidates
        .map(
          (c) =>
            `${c.id},${csvEscape(c.name)},${c.confidence.toFixed(3)},${c.matchType},"${c.tags.join('; ')}"`
        )
        .join('\n');
      process.stdout.write(headerRow + rows + '\n');
      return;
    }

    // Default: table format
    printTableOutput(result);
  });
}

/**
 * Handle batch mode: read names from stdin
 */
async function handleBatch(options: ResolveOptions): Promise<void> {
  const format = resolveOutputFormat(options);
  const threshold = options.threshold ? parseFloat(options.threshold) : undefined;
  const limit = options.limit ? parseInt(String(options.limit), 10) : undefined;

  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  const input = Buffer.concat(chunks).toString('utf-8');
  const names = input
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (names.length === 0) {
    console.error('❌ No names provided. Pipe names to stdin (one per line).');
    process.exit(1);
  }

  const ws = resolveWorkspaceContext({ workspace: options.workspace });

  await withDatabase({ dbPath: ws.dbPath, readonly: true }, async (ctx) => {
    const results = [];

    for (const name of names) {
      const result = await resolveEntity(ctx.db, name, {
        tag: options.tag,
        threshold,
        limit,
        exact: options.exact,
        workspace: options.workspace,
      });
      results.push(result);

      // Stream output for non-JSON formats
      if (format === 'jsonl') {
        console.log(JSON.stringify(result));
      }
    }

    if (format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else if (format !== 'jsonl') {
      // Summary for table format
      const matched = results.filter((r) => r.action === 'matched').length;
      const ambiguous = results.filter((r) => r.action === 'ambiguous').length;
      const noMatch = results.filter((r) => r.action === 'no_match').length;
      console.log(`\n📊 Batch results: ${matched} matched, ${ambiguous} ambiguous, ${noMatch} no match`);
    }
  });
}

/**
 * Print table-formatted output
 */
function printTableOutput(result: Awaited<ReturnType<typeof resolveEntity>>): void {
  const actionEmoji = {
    matched: '✅',
    ambiguous: '⚠️',
    no_match: '❌',
  };

  console.log(
    `\n${actionEmoji[result.action]} ${result.action.toUpperCase()} — "${result.query}"`
  );

  if (!result.embeddingsAvailable) {
    console.log('   ℹ️  Semantic search unavailable (no embeddings)');
  }

  if (result.candidates.length === 0) {
    console.log('   No candidates found.');
    return;
  }

  console.log('');

  for (const [i, c] of result.candidates.entries()) {
    const confBar = '█'.repeat(Math.round(c.confidence * 10));
    const confPad = '░'.repeat(10 - Math.round(c.confidence * 10));
    const tagStr = c.tags.length > 0 ? ` #${c.tags.join(' #')}` : '';
    const marker = result.bestMatch?.id === c.id ? ' ← best' : '';

    console.log(
      `   ${i + 1}. [${confBar}${confPad}] ${(c.confidence * 100).toFixed(1)}% ${c.matchType.padEnd(8)} ${c.name}${tagStr}${marker}`
    );
    console.log(`      ID: ${c.id}`);
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
