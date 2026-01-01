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
import { addStandardOptions } from './helpers';
import type { OutputFormat } from '../utils/output-formatter';
import type { StandardOptions } from '../types';

export interface BatchGetOptions extends StandardOptions {
  stdin?: boolean;
  select?: string;
  depth?: string;
  format?: OutputFormat;
  header?: boolean;
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
    // Implementation in T-2.5
    console.log('batch get:', ids, options);
  });

  return batch;
}
