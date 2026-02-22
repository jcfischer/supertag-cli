/**
 * Resolve Command (F-100: Entity Resolution)
 *
 * Find-or-create primitive with confidence thresholds.
 * Searches for existing nodes matching a name, with optional tag filtering,
 * fuzzy matching, and semantic similarity.
 *
 * Usage:
 *   supertag resolve "Daniel Miessler"                 # Basic resolution
 *   supertag resolve "Daniel" --tag person              # Type-filtered
 *   supertag resolve "Daniel Miessler" --exact          # Exact match only
 *   supertag resolve "Daniel" --threshold 0.9           # Custom threshold
 *   cat names.txt | supertag resolve --batch --tag person  # Batch mode
 */

import { Command } from 'commander';
import { Database } from 'bun:sqlite';
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
} from './helpers';
import { resolveOutputOptions, resolveOutputFormat } from '../utils/output-options';
import { createFormatter, type OutputFormat } from '../utils/output-formatter';
import { tsv, EMOJI, header } from '../utils/format';
import { resolveEntity } from '../db/entity-match';
import type { ResolutionResult, ResolvedCandidate } from '../lib/entity-resolution';
import type { StandardOptions } from '../types';
import { configureDbForConcurrency } from '../db/retry';

interface ResolveOptions extends StandardOptions {
  tag?: string;
  threshold?: string;
  exact?: boolean;
  batch?: boolean;
  createIfMissing?: boolean;
  format?: OutputFormat;
  header?: boolean;
}

/**
 * Create the resolve command
 */
export function createResolveCommand(): Command {
  const cmd = new Command('resolve');

  cmd
    .description('Find existing nodes by name with confidence scoring (entity resolution)')
    .argument('[name]', 'Name to resolve (omit for --batch mode)')
    .option('--tag <supertag>', 'Filter to specific supertag')
    .option('--threshold <float>', 'Minimum confidence threshold (0-1, default: 0.85)', '0.85')
    .option('--exact', 'Exact match only (no fuzzy or semantic)')
    .option('--batch', 'Process names from stdin (one per line)')
    .option('--create-if-missing', 'Print create suggestion when no match found')
    .option('-n, --limit <n>', 'Max candidates to return (default: 5)', '5');

  addStandardOptions(cmd, { defaultLimit: '5' });

  cmd.action(async (name: string | undefined, options: ResolveOptions) => {
    if (options.batch) {
      await handleBatch(options);
      return;
    }

    if (!name) {
      console.error('Error: name argument is required (or use --batch for stdin)');
      process.exit(1);
    }

    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    configureDbForConcurrency(db);

    try {
      const result = await resolveEntity(db, name, {
        tag: options.tag,
        threshold: parseFloat(options.threshold || '0.85'),
        limit: parseInt(options.limit || '5', 10),
        exact: options.exact,
        workspace: options.workspace,
      });

      const format = resolveOutputFormat(options);
      outputResult(result, format, options);
    } finally {
      db.close();
    }
  });

  return cmd;
}

/**
 * Handle batch mode: read names from stdin, resolve each
 */
async function handleBatch(options: ResolveOptions): Promise<void> {
  const dbPath = resolveDbPath(options);
  if (!checkDb(dbPath, options.workspace)) {
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  configureDbForConcurrency(db);

  try {
    // Read stdin
    const input = await Bun.stdin.text();
    const names = input
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (names.length === 0) {
      console.error('No names provided on stdin');
      process.exit(1);
    }

    const format = resolveOutputFormat(options);
    const results: ResolutionResult[] = [];

    // Process in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < names.length; i += chunkSize) {
      const chunk = names.slice(i, i + chunkSize);
      for (const name of chunk) {
        const result = await resolveEntity(db, name, {
          tag: options.tag,
          threshold: parseFloat(options.threshold || '0.85'),
          limit: parseInt(options.limit || '5', 10),
          exact: options.exact,
          workspace: options.workspace,
        });
        results.push(result);
      }
      // Progress indicator
      if (names.length > chunkSize) {
        const processed = Math.min(i + chunkSize, names.length);
        process.stderr.write(`\rResolved ${processed}/${names.length}...`);
      }
    }

    if (names.length > chunkSize) {
      process.stderr.write('\n');
    }

    if (format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else if (format === 'jsonl') {
      for (const r of results) {
        console.log(JSON.stringify(r));
      }
    } else if (format === 'csv') {
      console.log('query,action,best_match_id,best_match_name,confidence,match_type');
      for (const r of results) {
        const bm = r.bestMatch;
        console.log(
          [
            csvEscape(r.query),
            r.action,
            bm?.id ?? '',
            csvEscape(bm?.name ?? ''),
            bm?.confidence?.toFixed(3) ?? '',
            bm?.matchType ?? '',
          ].join(',')
        );
      }
    } else if (format === 'ids') {
      for (const r of results) {
        if (r.bestMatch) {
          console.log(r.bestMatch.id);
        }
      }
    } else {
      // Table format
      for (const r of results) {
        outputResult(r, 'table', options);
        console.log('');
      }
    }
  } finally {
    db.close();
  }
}

/**
 * Output a single resolution result
 */
function outputResult(
  result: ResolutionResult,
  format: OutputFormat | string,
  options: ResolveOptions
): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (format === 'jsonl') {
    console.log(JSON.stringify(result));
    return;
  }

  if (format === 'ids') {
    if (result.bestMatch) {
      console.log(result.bestMatch.id);
    }
    return;
  }

  if (format === 'csv') {
    console.log('id,name,confidence,match_type,tags');
    for (const c of result.candidates) {
      console.log(
        [
          c.id,
          csvEscape(c.name),
          c.confidence.toFixed(3),
          c.matchType,
          csvEscape(c.tags.join(';')),
        ].join(',')
      );
    }
    return;
  }

  if (format === 'minimal') {
    console.log(
      JSON.stringify({
        query: result.query,
        action: result.action,
        bestMatch: result.bestMatch
          ? { id: result.bestMatch.id, name: result.bestMatch.name, confidence: result.bestMatch.confidence }
          : null,
      })
    );
    return;
  }

  // Default: table format
  const actionEmoji =
    result.action === 'matched'
      ? '✅'
      : result.action === 'ambiguous'
        ? '⚠️'
        : '❌';

  console.log(`${actionEmoji} ${result.action.toUpperCase()}: "${result.query}"`);

  if (!result.embeddingsAvailable && !options.exact) {
    console.log('  ℹ️  Semantic search unavailable (no embeddings)');
  }

  if (result.candidates.length === 0) {
    console.log('  No matches found.');
    if (options.createIfMissing) {
      const tagHint = options.tag ? ` --tag ${options.tag}` : '';
      console.log(`  💡 Create with: supertag create${tagHint} "${result.query}"`);
    }
    return;
  }

  for (const c of result.candidates) {
    const matchIcon =
      c.matchType === 'exact'
        ? '🎯'
        : c.matchType === 'fuzzy'
          ? '🔍'
          : '🧠';
    const tagStr = c.tags.length > 0 ? ` [${c.tags.map((t) => `#${t}`).join(' ')}]` : '';
    const conf = (c.confidence * 100).toFixed(1);
    console.log(`  ${matchIcon} ${conf}% ${c.name}${tagStr}  (${c.id})`);
  }

  if (result.action === 'ambiguous' && options.createIfMissing) {
    console.log('  ⚠️  Ambiguous match — refusing to create. Narrow with --tag or --threshold.');
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
