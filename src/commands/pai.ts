/**
 * PAI Commands
 * Spec: F-105 PAI Memory Integration
 * Tasks: T-2.2, T-3.3, T-4.2, T-5.2
 *
 * CLI command group: supertag pai {sync, context, freshness, schema init}
 */

import { Command } from 'commander';

/**
 * Create the `supertag pai` command group with all subcommands.
 */
export function createPaiCommand(): Command {
  const pai = new Command('pai');
  pai.description('PAI memory integration — sync learnings, retrieve context, check freshness');

  // =========================================================================
  // supertag pai schema init
  // =========================================================================
  const schema = pai.command('schema');
  schema.description('Manage PAI supertag schemas');

  schema
    .command('init')
    .description('Create #pai_learning and #pai_proposal supertags in Tana workspace')
    .option('-w, --workspace <alias>', 'Workspace alias')
    .option('-d, --dry-run', 'Show what would be created without calling API')
    .action(async (options) => {
      try {
        const { initPaiSchema } = await import('../pai/schema-init');
        const result = await initPaiSchema({
          workspace: options.workspace,
          dryRun: options.dryRun,
        });

        if (result.created.length > 0) {
          for (const tag of result.created) {
            const fieldCount = Object.keys(result.fieldIds[tag] || {}).length;
            console.log(`  Created #${tag} (${fieldCount} fields)`);
          }
        }
        if (result.existing.length > 0) {
          for (const tag of result.existing) {
            console.log(`  Existing #${tag} (already created)`);
          }
        }

        if (options.dryRun) {
          console.log('\n  (dry-run mode — no changes made)');
        } else {
          console.log('\n  Supertags ready. Run `supertag pai sync` to sync learnings.');
        }
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // =========================================================================
  // supertag pai sync
  // =========================================================================
  const syncCmd = pai
    .command('sync')
    .description('Sync confirmed learnings from seed.json to Tana as #pai_learning nodes')
    .option('--seed-path <path>', 'Path to seed.json (default: ~/.pai/seed.json)')
    .option('-w, --workspace <alias>', 'Workspace alias')
    .option('-d, --dry-run', 'Preview sync without creating nodes')
    .option('-f, --force', 'Re-sync all entries, not just incremental')
    .option('--format <type>', 'Output format: table|json|csv|jsonl');

  syncCmd.action(async (options) => {
    try {
      const { syncLearnings } = await import('../pai/sync-service');
      const result = await syncLearnings({
        seedPath: options.seedPath,
        workspace: options.workspace,
        dryRun: options.dryRun,
        force: options.force,
      });

      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Table output
      if (result.entries.length > 0) {
        console.log('');
        const maxContent = 50;
        for (const entry of result.entries) {
          const content = entry.seedId;
          const links = entry.entityLinks.map((l) => `${l.tagType}:${l.entityName}`).join(', ') || '—';
          console.log(`  ${padRight(entry.action, 8)} | ${padRight(content, maxContent)} | ${links}`);
        }
        console.log('');
      }

      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} created`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      const summary = parts.length > 0 ? parts.join(', ') : 'nothing to sync';
      console.log(`  Summary: ${result.total} entries (${summary}), ${result.failed} failed`);

      if (options.dryRun) {
        console.log('  (dry-run mode — no changes made)');
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

  // =========================================================================
  // supertag pai context <topic>
  // =========================================================================
  const contextCmd = pai
    .command('context <topic>')
    .description('Retrieve learnings related to a topic using graph context')
    .option('--max-tokens <n>', 'Token budget for context', '2000')
    .option('--type <type>', 'Filter by learning type: pattern|insight|self_knowledge')
    .option('-w, --workspace <alias>', 'Workspace alias')
    .option('--format <type>', 'Output format: markdown|json', 'markdown');

  contextCmd.action(async (topic: string, options) => {
    try {
      const { getPaiContext } = await import('../pai/context-service');
      const maxTokens = parseInt(String(options.maxTokens), 10) || 2000;
      const result = await getPaiContext(topic, {
        maxTokens,
        type: options.type,
        workspace: options.workspace,
      });

      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Markdown output
      console.log(`\n## PAI Context: "${topic}"\n`);

      if (result.learnings.length > 0) {
        console.log(`### Learnings (${result.learnings.length} results)\n`);
        for (const learning of result.learnings) {
          const linked = learning.linkedTo.length > 0
            ? `\n  Linked to: ${learning.linkedTo.join(', ')}`
            : '';
          const freshness = `\n  Freshness: ${learning.freshness}`;
          console.log(`- [${learning.type}] ${learning.content}${linked}${freshness}\n`);
        }
      } else {
        console.log('No learnings found for this topic.\n');
      }

      if (result.relatedNodes.length > 0) {
        console.log(`### Related Tana Context\n`);
        for (const node of result.relatedNodes) {
          const modified = node.lastModified ? ` (last modified: ${node.lastModified})` : '';
          console.log(`- #${node.type} ${node.name}${modified}`);
        }
        console.log('');
      }

      console.log(`Token count: ~${result.tokenCount}`);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

  // =========================================================================
  // supertag pai freshness
  // =========================================================================
  const freshnessCmd = pai
    .command('freshness')
    .description('Check learning freshness using graph activity')
    .option('--threshold <days>', 'Days before marking stale', '30')
    .option('--type <type>', 'Filter by learning type: pattern|insight|self_knowledge')
    .option('-w, --workspace <alias>', 'Workspace alias')
    .option('--format <type>', 'Output format: table|json');

  freshnessCmd.action(async (options) => {
    try {
      const { assessFreshness } = await import('../pai/freshness-service');
      const threshold = parseInt(String(options.threshold), 10) || 30;
      const results = await assessFreshness({
        threshold,
        type: options.type,
        workspace: options.workspace,
      });

      if (options.format === 'json') {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      // Table output
      if (results.length > 0) {
        console.log('');
        console.log('  Status  | Type            | Content                              | Confirmed   | Graph Activity | Days');
        console.log('  --------|-----------------|--------------------------------------|-------------|----------------|-----');
        for (const r of results) {
          const content = r.content.length > 36 ? r.content.slice(0, 33) + '...' : r.content;
          const confirmed = r.confirmedAt.slice(0, 10);
          const graph = r.graphActivity ? r.graphActivity.slice(0, 10) : '—';
          console.log(`  ${padRight(r.status, 7)} | ${padRight(r.type, 15)} | ${padRight(content, 36)} | ${confirmed}  | ${padRight(graph, 14)} | ${r.daysSinceActive}`);
        }
        console.log('');
      }

      const fresh = results.filter((r) => r.status === 'fresh').length;
      const stale = results.filter((r) => r.status === 'stale').length;
      const unknown = results.filter((r) => r.status === 'unknown').length;
      console.log(`  Summary: ${fresh} fresh, ${stale} stale, ${unknown} unknown (no Tana link)`);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

  return pai;
}

// =============================================================================
// Helpers
// =============================================================================

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}
