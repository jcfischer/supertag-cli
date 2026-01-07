/**
 * Related Command (Spec 065: Graph Traversal)
 *
 * Find nodes related to a given node through references, children, and field links.
 *
 * Usage:
 *   supertag related <nodeId>                    # Find all related nodes
 *   supertag related <nodeId> --direction in     # Incoming references only
 *   supertag related <nodeId> --direction out    # Outgoing references only
 *   supertag related <nodeId> --types child,reference   # Filter by type
 *   supertag related <nodeId> --depth 2          # Multi-hop traversal
 */

import { Command } from 'commander';
import { GraphTraversalService } from '../services/graph-traversal';
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
  parseSelectOption,
} from './helpers';
import {
  parseSelectPaths,
  applyProjection,
} from '../utils/select-projection';
import { resolveOutputOptions, resolveOutputFormat } from '../utils/output-options';
import { createFormatter, type OutputFormat } from '../utils/output-formatter';
import { tsv, EMOJI, header } from '../utils/format';
import type { StandardOptions } from '../types';
import type { RelationshipType, RelatedResult, RelatedNode } from '../types/graph';
import { ALL_RELATIONSHIP_TYPES } from '../types/graph';

interface RelatedOptions extends StandardOptions {
  direction?: 'in' | 'out' | 'both';
  types?: string;
  select?: string;
  format?: OutputFormat;
  header?: boolean;
}

/**
 * Create the related command
 */
export function createRelatedCommand(): Command {
  const cmd = new Command('related');

  cmd
    .description('Find nodes related to a given node through references and children')
    .argument('<nodeId>', 'Source node ID to find related nodes from')
    .option(
      '-d, --direction <dir>',
      'Traversal direction: in, out, or both (default: both)',
      'both'
    )
    .option(
      '-t, --types <types>',
      'Relationship types to include (comma-separated: child,parent,reference,field)',
      'child,parent,reference,field'
    )
    .option('--depth <n>', 'Maximum traversal depth (0-5, default: 1)', '1')
    .option('--select <fields>', 'Select specific fields to output (comma-separated)');

  addStandardOptions(cmd, { defaultLimit: '50' });

  cmd.action(async (nodeId: string, options: RelatedOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);

    // Parse direction
    const direction = validateDirection(options.direction);

    // Parse types
    const types = parseTypes(options.types);

    // Parse depth
    const depth = Math.min(5, Math.max(0, parseInt(String(options.depth || '1'), 10)));

    // Parse limit
    const limit = Math.min(100, parseInt(String(options.limit || '50'), 10));

    const service = new GraphTraversalService(dbPath);

    try {
      const result = await service.traverse(
        {
          nodeId,
          direction,
          types,
          depth,
          limit,
        },
        options.workspace || 'main'
      );

      // Output based on format
      outputResult(result, format, projection, selectFields, options.header);
    } catch (error) {
      console.error(`❌ Error: ${(error as Error).message}`);
      process.exit(1);
    } finally {
      service.close();
    }
  });

  return cmd;
}

/**
 * Validate and normalize direction parameter
 */
function validateDirection(dir?: string): 'in' | 'out' | 'both' {
  if (!dir || dir === 'both') return 'both';
  if (dir === 'in') return 'in';
  if (dir === 'out') return 'out';
  console.error(`❌ Invalid direction: ${dir}. Must be 'in', 'out', or 'both'.`);
  process.exit(1);
}

/**
 * Parse comma-separated types string into array
 */
function parseTypes(typesStr?: string): RelationshipType[] {
  if (!typesStr) {
    return [...ALL_RELATIONSHIP_TYPES];
  }

  const validTypes = new Set(ALL_RELATIONSHIP_TYPES);
  const types: RelationshipType[] = [];

  for (const t of typesStr.split(',').map((s) => s.trim().toLowerCase())) {
    if (validTypes.has(t as RelationshipType)) {
      types.push(t as RelationshipType);
    } else if (t) {
      console.error(`⚠️ Unknown relationship type: ${t}`);
    }
  }

  return types.length > 0 ? types : [...ALL_RELATIONSHIP_TYPES];
}

/**
 * Output result in the specified format
 */
function outputResult(
  result: RelatedResult,
  format: OutputFormat,
  projection: ReturnType<typeof parseSelectPaths>,
  selectFields: string[] | undefined,
  noHeader?: boolean
): void {
  // Table format: use rich pretty output
  if (format === 'table') {
    outputTableFormat(result);
    return;
  }

  // JSON formats with --select apply projection
  if (selectFields && selectFields.length > 0) {
    if (format === 'json' || format === 'minimal' || format === 'jsonl') {
      const projected = applyProjection(result, projection);
      console.log(formatJsonOutput(projected));
      return;
    }
  }

  // Use formatter for other formats
  const formatter = createFormatter({
    format,
    noHeader,
  });

  // Build rows for CSV/IDs/etc
  const headers = ['id', 'name', 'type', 'direction', 'distance', 'tags'];
  const rows = result.related.map((node) => [
    node.id,
    node.name,
    node.relationship.type,
    node.relationship.direction,
    String(node.relationship.distance),
    node.tags?.join(', ') || '',
  ]);

  formatter.table(headers, rows);
  formatter.finalize();
}

/**
 * Output in pretty table format
 */
function outputTableFormat(result: RelatedResult): void {
  const { sourceNode, related, count, truncated } = result;

  console.log(`\n${header(EMOJI.link, `Related to: ${sourceNode.name || sourceNode.id}`)}:\n`);

  if (related.length === 0) {
    console.log('  No related nodes found.');
    return;
  }

  // Group by direction
  const outbound = related.filter((n) => n.relationship.direction === 'out');
  const inbound = related.filter((n) => n.relationship.direction === 'in');

  if (outbound.length > 0) {
    console.log(`📤 Outgoing (${outbound.length}):`);
    for (const node of outbound) {
      const { relationship } = node;
      const tags = node.tags?.length ? ` [${node.tags.join(', ')}]` : '';
      const distance = relationship.distance > 1 ? ` (${relationship.distance} hops)` : '';
      console.log(`  → ${node.name || node.id}${tags}`);
      console.log(`     Type: ${relationship.type}${distance}`);
    }
  }

  if (inbound.length > 0) {
    if (outbound.length > 0) console.log('');
    console.log(`📥 Incoming (${inbound.length}):`);
    for (const node of inbound) {
      const { relationship } = node;
      const tags = node.tags?.length ? ` [${node.tags.join(', ')}]` : '';
      const distance = relationship.distance > 1 ? ` (${relationship.distance} hops)` : '';
      console.log(`  ← ${node.name || node.id}${tags}`);
      console.log(`     Type: ${relationship.type}${distance}`);
    }
  }

  console.log(`\nTotal: ${count}${truncated ? ' (truncated)' : ''}`);
}
