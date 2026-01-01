/**
 * Batch Command Group
 *
 * Provides batch operations for efficient multi-node access:
 * - batch get <ids...>   - Fetch multiple nodes by ID
 * - batch create         - Create multiple nodes (T-3.6)
 *
 * Usage:
 *   supertag batch get id1 id2 id3           # Fetch nodes by ID
 *   supertag batch get id1 id2 --depth 2     # Include children
 *   supertag batch get --stdin < ids.txt     # Read IDs from stdin
 *   echo "id1\nid2" | supertag batch get --stdin
 *
 * Spec: 062-batch-operations
 */

import { Command } from 'commander';
import {
  addStandardOptions,
  resolveDbPath,
  checkDb,
  formatJsonOutput,
  parseSelectOption,
} from './helpers';
import {
  parseSelectPaths,
  applyProjection,
} from '../utils/select-projection';
import { batchGetNodes } from '../services/batch-operations';
import { resolveOutputFormat } from '../utils/output-options';
import { createFormatter, type OutputFormat } from '../utils/output-formatter';
import { formatDateISO } from '../utils/format';
import type { StandardOptions } from '../types';

export interface BatchGetOptions extends StandardOptions {
  stdin?: boolean;
  select?: string;
  depth?: string;
  format?: OutputFormat;
  header?: boolean;
  // Test-only options (internal)
  _dbPath?: string;
  _stdinContent?: string;
}

export interface BatchGetResponse {
  results: Array<{
    id: string;
    node: Partial<Record<string, unknown>> | null;
    error?: string;
  }>;
  found: number;
  missing: number;
}

/**
 * Read stdin content (for testing, can be mocked via _stdinContent)
 */
async function readStdin(mockContent?: string): Promise<string> {
  if (mockContent !== undefined) {
    return mockContent;
  }

  // Read from actual stdin
  const chunks: Buffer[] = [];
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Parse IDs from stdin content
 * - Splits by newlines
 * - Filters empty lines
 * - Trims whitespace
 */
function parseStdinIds(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Execute batch get operation
 * Exported for testing and reuse
 */
export async function executeBatchGet(
  ids: string[],
  options: BatchGetOptions
): Promise<BatchGetResponse> {
  // Collect all node IDs (positional + stdin)
  let allIds = [...ids];

  if (options.stdin) {
    const stdinContent = await readStdin(options._stdinContent);
    const stdinIds = parseStdinIds(stdinContent);
    allIds = [...allIds, ...stdinIds];
  }

  // Resolve database path (use test path if provided)
  const dbPath = options._dbPath || resolveDbPath(options);

  // Parse options
  const depth = options.depth ? parseInt(options.depth, 10) : 0;
  const selectFields = parseSelectOption(options.select);
  const projection = parseSelectPaths(selectFields);

  // Fetch nodes
  const results = batchGetNodes(dbPath, allIds, { depth });

  // Apply projection
  const transformedResults = results.map((result) => ({
    id: result.id,
    node: result.node ? applyProjection(result.node, projection) : null,
    error: result.error,
  }));

  // Count found and missing
  const found = results.filter((r) => r.node !== null).length;
  const missing = results.length - found;

  return {
    results: transformedResults,
    found,
    missing,
  };
}

/**
 * Create the batch command group
 */
export function createBatchCommand(): Command {
  const batch = new Command('batch');
  batch.description('Batch operations for multiple nodes');

  // batch get <ids...>
  const getCmd = batch
    .command('get [ids...]')
    .description('Fetch multiple nodes by ID in a single request')
    .option('--stdin', 'Read node IDs from stdin (one per line)')
    .option('--select <fields>', 'Select specific fields (comma-separated, e.g., id,name,tags)')
    .option('-d, --depth <n>', 'Depth of child traversal (0-3)', '0');

  addStandardOptions(getCmd, {
    includeLimit: false, // No limit needed - max 100 enforced by validation
  });

  getCmd.action(async (ids: string[], options: BatchGetOptions) => {
    // Validate database exists
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    try {
      const result = await executeBatchGet(ids, options);
      const format = resolveOutputFormat(options);

      // JSON formats
      if (format === 'json' || format === 'jsonl' || format === 'minimal') {
        if (format === 'jsonl') {
          // JSON Lines: one result per line
          for (const r of result.results) {
            console.log(JSON.stringify(r));
          }
        } else if (format === 'minimal') {
          // Minimal: just id, name, tags per node
          const minimal = result.results.map((r) => ({
            id: r.id,
            name: r.node ? (r.node as { name?: string }).name : null,
            tags: r.node ? (r.node as { tags?: string[] }).tags : null,
          }));
          console.log(formatJsonOutput(minimal));
        } else {
          // Full JSON
          console.log(formatJsonOutput(result));
        }
        return;
      }

      // IDs format: just output IDs
      if (format === 'ids') {
        for (const r of result.results) {
          if (r.node) {
            console.log(r.id);
          }
        }
        return;
      }

      // Table format: pretty output
      if (format === 'table') {
        console.log(`\n📦 Batch Get Results: ${result.found} found, ${result.missing} missing\n`);
        for (const r of result.results) {
          if (r.node) {
            const node = r.node as { name?: string; tags?: string[]; created?: number };
            console.log(`✓ ${r.id}`);
            if (node.name) console.log(`  Name: ${node.name}`);
            if (node.tags?.length) console.log(`  Tags: ${node.tags.join(', ')}`);
          } else {
            console.log(`✗ ${r.id} (not found)`);
          }
        }
        return;
      }

      // CSV format
      const formatter = createFormatter({
        format,
        noHeader: options.header === false,
      });

      const headers = ['id', 'name', 'tags', 'found'];
      const rows = result.results.map((r) => {
        const node = r.node as { name?: string; tags?: string[] } | null;
        return [
          r.id,
          node?.name || '',
          node?.tags?.join(';') || '',
          r.node ? 'true' : 'false',
        ];
      });

      formatter.table(headers, rows);
      formatter.finalize();
    } catch (error) {
      console.error(`❌ Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

  return batch;
}
