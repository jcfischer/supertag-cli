/**
 * Schema Command
 * Manage Tana schema registry (sync, list, show supertags)
 *
 * Supports multi-workspace configuration with per-workspace schema caches.
 * Uses Commander.js subcommands for consistent CLI pattern.
 */

import { Command } from 'commander';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { Database } from 'bun:sqlite';
import * as readline from 'readline';
import { SchemaRegistry } from '../schema';
import { UnifiedSchemaService } from '../services/unified-schema-service';
import { SchemaAuditService } from '../services/schema-audit-service';
import { applyFix, writeAuditTrail } from '../services/schema-audit-fixer';
import { DETECTOR_REGISTRY } from '../services/schema-audit-registry';
import type { SchemaFinding, SchemaFindingSeverity, FixResult } from '../types/schema-audit';
import {
  DEFAULT_EXPORT_DIR,
  TANA_CACHE_DIR,
  SCHEMA_CACHE_FILE,
  ensureWorkspaceDir,
} from '../config/paths';
import { resolveWorkspaceContext } from '../config/workspace-resolver';

/**
 * Schema command options
 */
export interface SchemaOptions {
  exportPath?: string;
  verbose?: boolean;
  format?: 'table' | 'json' | 'names';
  workspace?: string;
}

/**
 * Get cached registry or create new one
 * @param workspace - Optional workspace alias or nodeid
 */
export function getSchemaRegistry(workspace?: string): SchemaRegistry {
  const ws = resolveWorkspaceContext({
    workspace,
    requireDatabase: false,
  });
  const schemaPath = ws.schemaPath;

  if (existsSync(schemaPath)) {
    const json = readFileSync(schemaPath, 'utf-8');
    return SchemaRegistry.fromJSON(json);
  }

  // Try to auto-sync from latest export
  const latestExport = findLatestExport(ws.exportDir);
  if (latestExport) {
    return syncSchemaToPath(latestExport, schemaPath, false);
  }

  // Return empty registry
  return new SchemaRegistry();
}

/**
 * Find the latest Tana export file
 */
function findLatestExport(exportDir: string): string | null {
  if (!existsSync(exportDir)) return null;

  const files = Bun.spawnSync(['ls', '-t', exportDir]).stdout.toString().trim().split('\n');
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  if (jsonFiles.length === 0) return null;

  return join(exportDir, jsonFiles[0]);
}

/**
 * Sync schema from Tana export to a specific cache path
 * @param exportPath - Path to Tana export JSON
 * @param schemaPath - Path to write schema cache
 * @param verbose - Show verbose output
 */
export function syncSchemaToPath(exportPath: string, schemaPath: string, verbose: boolean): SchemaRegistry {
  if (!existsSync(exportPath)) {
    throw new Error(`Export file not found: ${exportPath}`);
  }

  if (verbose) {
    console.error(`📥 Loading export from: ${exportPath}`);
  }

  const exportData = JSON.parse(readFileSync(exportPath, 'utf-8'));
  const registry = new SchemaRegistry();
  registry.loadFromExport(exportData);

  // Cache the registry to workspace-specific path
  const cacheDir = dirname(schemaPath);
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  writeFileSync(schemaPath, registry.toJSON());

  const supertags = registry.listSupertags();
  if (verbose) {
    console.error(`✅ Loaded ${supertags.length} supertags`);
    console.error(`📁 Cached to: ${schemaPath}`);
  }

  return registry;
}

/**
 * Sync schema from Tana export (workspace-aware)
 * @param exportPath - Path to Tana export JSON
 * @param verbose - Show verbose output
 * @param workspace - Optional workspace alias or nodeid
 */
export function syncSchema(exportPath: string, verbose: boolean, workspace?: string): SchemaRegistry {
  const ws = resolveWorkspaceContext({
    workspace,
    requireDatabase: false,
  });
  return syncSchemaToPath(exportPath, ws.schemaPath, verbose);
}

/**
 * Get schema registry from database (T-5.1)
 *
 * Creates a SchemaRegistry from the database supertag metadata tables.
 * This is the fallback when no schema-registry.json cache exists.
 *
 * Note: This function remains synchronous because it's called synchronously
 * in getSchemaRegistrySafe(). Cannot use withDatabase() pattern here.
 *
 * @param dbPath - Path to the SQLite database
 * @returns SchemaRegistry loaded from database data
 * @throws Error if database doesn't exist
 */
export function getSchemaRegistryFromDatabase(dbPath: string): SchemaRegistry {
  const isDebug = process.env.DEBUG_SCHEMA === "1";
  const startTime = Date.now();

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  if (isDebug) {
    console.error(`[schema-debug] getSchemaRegistryFromDatabase: opening ${dbPath}`);
  }

  const db = new Database(dbPath);
  try {
    if (isDebug) {
      console.error(`[schema-debug] getSchemaRegistryFromDatabase: creating UnifiedSchemaService...`);
    }
    const schemaService = new UnifiedSchemaService(db);

    if (isDebug) {
      console.error(`[schema-debug] getSchemaRegistryFromDatabase: calling toSchemaRegistryJSON()...`);
    }
    const jsonStart = Date.now();
    const json = schemaService.toSchemaRegistryJSON();

    if (isDebug) {
      console.error(`[schema-debug] getSchemaRegistryFromDatabase: toSchemaRegistryJSON took ${Date.now() - jsonStart}ms`);
      console.error(`[schema-debug] getSchemaRegistryFromDatabase: parsing JSON (${(json.length / 1024).toFixed(1)} KB)...`);
    }
    const parseStart = Date.now();
    const registry = SchemaRegistry.fromJSON(json);

    if (isDebug) {
      console.error(`[schema-debug] getSchemaRegistryFromDatabase: fromJSON took ${Date.now() - parseStart}ms`);
      console.error(`[schema-debug] getSchemaRegistryFromDatabase: total ${Date.now() - startTime}ms`);
    }

    return registry;
  } finally {
    db.close();
  }
}

/**
 * Execute schema command
 */
export async function schemaCommand(
  subcommand: string | undefined,
  arg: string | undefined,
  options: SchemaOptions,
): Promise<void> {
  switch (subcommand) {
    case 'sync':
      await syncCommand(arg, options);
      break;
    case 'list':
      await listCommand(options);
      break;
    case 'show':
      await showCommand(arg, options);
      break;
    case 'search':
      await searchCommand(arg, options);
      break;
    default:
      console.error('Usage: supertag schema <sync|list|show|search> [args]');
      console.error('');
      console.error('Subcommands:');
      console.error('  sync [path]     Sync schema from Tana export');
      console.error('  list            List all supertags');
      console.error('  show <name>     Show supertag fields');
      console.error('  search <query>  Search supertags by name');
      console.error('');
      console.error('Options:');
      console.error('  --format <fmt>  Output format: table, json, names');
      console.error('  --verbose       Verbose output');
  }
}

/**
 * Sync subcommand
 */
async function syncCommand(path: string | undefined, options: SchemaOptions): Promise<void> {
  // Resolve workspace for export directory
  const ws = resolveWorkspaceContext({
    workspace: options.workspace,
    requireDatabase: false,
  });

  const exportPath = path || options.exportPath || findLatestExport(ws.exportDir);

  if (!exportPath) {
    console.error('❌ No Tana export found. Please provide a path:');
    console.error('   supertag schema sync /path/to/export.json');
    console.error('');
    console.error(`Or place exports in: ${ws.exportDir}`);
    if (options.workspace) {
      console.error(`(workspace: ${options.workspace})`);
    }
    process.exit(1);
  }

  console.error(`🔄 Syncing schema from: ${exportPath}`);
  if (options.workspace) {
    console.error(`   Workspace: ${ws.alias}`);
  }
  const registry = syncSchema(exportPath, options.verbose ?? false, options.workspace);
  const supertags = registry.listSupertags();

  console.log(`✅ Synced ${supertags.length} supertags to cache`);
  console.log(`   Cache: ${ws.schemaPath}`);

  if (options.verbose) {
    console.log('');
    console.log('Top 10 supertags by name:');
    supertags
      .slice(0, 10)
      .forEach(s => console.log(`  - ${s.name} (${s.fields.length} fields)`));
  }
}

/**
 * List subcommand
 */
async function listCommand(options: SchemaOptions): Promise<void> {
  const registry = getSchemaRegistry(options.workspace);
  const supertags = registry.listSupertags();

  if (supertags.length === 0) {
    console.error('No supertags found. Run "supertag schema sync" first.');
    process.exit(1);
  }

  switch (options.format) {
    case 'json':
      console.log(JSON.stringify(supertags, null, 2));
      break;
    case 'names':
      supertags.forEach(s => console.log(s.name));
      break;
    default:
      console.log(`Found ${supertags.length} supertags:\n`);
      // Sort by name and show with field count
      supertags
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(s => {
          const fieldCount = s.fields.length;
          const fieldInfo = fieldCount > 0 ? ` (${fieldCount} fields)` : '';
          console.log(`  ${s.name}${fieldInfo}`);
        });
  }
}

/**
 * Show subcommand
 */
async function showCommand(name: string | undefined, options: SchemaOptions): Promise<void> {
  if (!name) {
    console.error('Usage: supertag schema show <supertag-name>');
    process.exit(1);
  }

  const registry = getSchemaRegistry(options.workspace);
  const supertag = registry.getSupertag(name);

  if (!supertag) {
    console.error(`❌ Supertag not found: ${name}`);
    console.error('');
    // Suggest similar names
    const similar = registry.searchSupertags(name);
    if (similar.length > 0) {
      console.error('Did you mean:');
      similar.slice(0, 5).forEach(s => console.error(`  - ${s.name}`));
    }
    process.exit(1);
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(supertag, null, 2));
    return;
  }

  console.log(`Supertag: ${supertag.name}`);
  console.log(`ID: ${supertag.id}`);
  if (supertag.description) {
    console.log(`Description: ${supertag.description}`);
  }

  // Show inheritance chain
  if (supertag.extends && supertag.extends.length > 0) {
    const parentNames = supertag.extends
      .map(id => registry.getSupertagById(id)?.name || id)
      .join(', ');
    console.log(`Extends: ${parentNames}`);
  }
  console.log('');

  // Get all fields including inherited ones
  const allFields = registry.getFields(name);
  const ownFieldIds = new Set(supertag.fields.map(f => f.attributeId));

  if (allFields.length === 0) {
    console.log('No fields defined.');
    return;
  }

  // Show own fields first
  if (supertag.fields.length > 0) {
    console.log(`Own Fields (${supertag.fields.length}):`);
    for (const field of supertag.fields) {
      const typeInfo = field.dataType ? ` [${field.dataType}]` : '';
      console.log(`  - ${field.name}${typeInfo}`);
      console.log(`    ID: ${field.attributeId}`);
      if (field.description) {
        console.log(`    ${field.description}`);
      }
    }
  }

  // Show inherited fields
  const inheritedFields = allFields.filter(f => !ownFieldIds.has(f.attributeId));
  if (inheritedFields.length > 0) {
    console.log('');
    console.log(`Inherited Fields (${inheritedFields.length}):`);
    for (const field of inheritedFields) {
      const typeInfo = field.dataType ? ` [${field.dataType}]` : '';
      console.log(`  - ${field.name}${typeInfo}`);
      console.log(`    ID: ${field.attributeId}`);
      if (field.description) {
        console.log(`    ${field.description}`);
      }
    }
  }

  // Show CLI example with some fields
  console.log('');
  console.log('Example usage:');
  const exampleFields = allFields.slice(0, 3);
  const fieldArgs = exampleFields
    .map(f => `--${f.normalizedName} "value"`)
    .join(' ');
  console.log(`  supertag create ${supertag.normalizedName} "Node name" ${fieldArgs}`);
}

/**
 * Search subcommand
 */
async function searchCommand(query: string | undefined, options: SchemaOptions): Promise<void> {
  if (!query) {
    console.error('Usage: supertag schema search <query>');
    process.exit(1);
  }

  const registry = getSchemaRegistry(options.workspace);
  const matches = registry.searchSupertags(query);

  if (matches.length === 0) {
    console.log(`No supertags matching: ${query}`);
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(matches, null, 2));
    return;
  }

  console.log(`Found ${matches.length} matching supertags:\n`);
  matches.forEach(s => {
    const fieldCount = s.fields.length;
    const fieldInfo = fieldCount > 0 ? ` (${fieldCount} fields)` : '';
    console.log(`  ${s.name}${fieldInfo}`);
  });
}

/**
 * Create schema command with Commander subcommands
 * Modern pattern following CLI Harmonization
 */
export function createSchemaCommand(): Command {
  const schema = new Command('schema');
  schema.description('Manage supertag schema registry');

  // schema sync [path]
  schema
    .command('sync')
    .description('Sync schema from Tana export')
    .argument('[path]', 'Path to Tana export JSON file')
    .option('-w, --workspace <alias>', 'Workspace alias or nodeid')
    .option('-v, --verbose', 'Verbose output')
    .action(async (path: string | undefined, opts: { workspace?: string; verbose?: boolean }) => {
      await syncCommand(path, {
        workspace: opts.workspace,
        verbose: opts.verbose,
      });
    });

  // schema list
  schema
    .command('list')
    .description('List all supertags')
    .option('-w, --workspace <alias>', 'Workspace alias or nodeid')
    .option('--format <fmt>', 'Output format: table, json, names', 'table')
    .action(async (opts: { workspace?: string; format?: 'table' | 'json' | 'names' }) => {
      await listCommand({
        workspace: opts.workspace,
        format: opts.format,
      });
    });

  // schema show <name>
  schema
    .command('show')
    .description('Show supertag fields and details')
    .argument('<name>', 'Supertag name')
    .option('-w, --workspace <alias>', 'Workspace alias or nodeid')
    .option('--format <fmt>', 'Output format: table, json', 'table')
    .action(async (name: string, opts: { workspace?: string; format?: 'table' | 'json' }) => {
      await showCommand(name, {
        workspace: opts.workspace,
        format: opts.format,
      });
    });

  // schema search <query>
  schema
    .command('search')
    .description('Search supertags by name')
    .argument('<query>', 'Search query')
    .option('-w, --workspace <alias>', 'Workspace alias or nodeid')
    .option('--format <fmt>', 'Output format: table, json', 'table')
    .action(async (query: string, opts: { workspace?: string; format?: 'table' | 'json' }) => {
      await searchCommand(query, {
        workspace: opts.workspace,
        format: opts.format,
      });
    });

  // schema audit
  schema
    .command('audit')
    .description('Analyze supertag schema health: detect redundancy, inconsistencies, and suggest improvements')
    .option('-w, --workspace <alias>', 'Workspace alias or nodeid')
    .option('--format <fmt>', 'Output format: table, json, markdown', 'table')
    .option('-t, --tag <name>', 'Audit single supertag and its hierarchy')
    .option('-d, --detector <names>', 'Run specific detector(s), comma-separated')
    .option('--fix', 'Auto-fix safe issues (interactive confirmation per finding)')
    .option('--yes', 'Apply all safe fixes without prompting (use with --fix)')
    .option('--docs', 'Generate schema documentation instead of audit')
    .option('--severity <level>', 'Minimum severity: error, warning, info')
    .action(async (opts: {
      workspace?: string;
      format?: 'table' | 'json' | 'markdown';
      tag?: string;
      detector?: string;
      fix?: boolean;
      yes?: boolean;
      docs?: boolean;
      severity?: string;
    }) => {
      await auditCommand(opts);
    });

  return schema;
}

/**
 * Audit subcommand
 */
async function auditCommand(opts: {
  workspace?: string;
  format?: 'table' | 'json' | 'markdown';
  tag?: string;
  detector?: string;
  fix?: boolean;
  yes?: boolean;
  docs?: boolean;
  severity?: string;
}): Promise<void> {
  const ws = resolveWorkspaceContext({ workspace: opts.workspace });

  if (!existsSync(ws.dbPath)) {
    console.error(`❌ Database not found: ${ws.dbPath}`);
    console.error(`   Run 'supertag sync index --workspace ${ws.alias}' first`);
    process.exit(1);
  }

  // Validate --detector names
  let detectors: string[] | undefined;
  if (opts.detector) {
    detectors = opts.detector.split(',').map(d => d.trim());
    const validNames = DETECTOR_REGISTRY.map(d => d.name);
    const invalid = detectors.filter(d => !validNames.includes(d));
    if (invalid.length > 0) {
      console.error(`❌ Unknown detector(s): ${invalid.join(', ')}`);
      console.error(`   Available: ${validNames.join(', ')}`);
      process.exit(1);
    }
  }

  // Open read-write only when --fix is present
  const db = new Database(ws.dbPath, { readonly: !opts.fix });
  try {
    const service = new SchemaAuditService(db);

    // Documentation mode
    if (opts.docs) {
      const docs = service.generateDocs();
      console.log(docs);
      return;
    }

    // Audit mode
    const severity = opts.severity as SchemaFindingSeverity | undefined;
    const report = service.audit({
      tag: opts.tag,
      detectors,
      includeFixes: opts.fix,
      severity,
    });

    report.workspace = ws.alias;

    // Print the audit report first
    switch (opts.format) {
      case 'json':
        if (!opts.fix) {
          console.log(JSON.stringify(report, null, 2));
        }
        break;

      case 'markdown':
        printMarkdownReport(report);
        break;

      default:
        printTableReport(report);
        break;
    }

    // Fix mode: apply safe fixes
    if (opts.fix && report.findings.length > 0) {
      const results = await applyFixes(db, report.findings, ws.alias, opts.yes ?? false);

      // Print fix summary
      printFixSummary(results);

      // Write audit trail
      const logDir = join(dirname(ws.dbPath), 'audit-trail');
      const logFile = writeAuditTrail(ws.alias, results, logDir);
      if (logFile) {
        console.error(`\n📝 Audit trail: ${logFile}`);
      }

      // JSON output includes fix results
      if (opts.format === 'json') {
        console.log(JSON.stringify({ ...report, fixResults: results }, null, 2));
      }
    }

    // Exit code 1 if errors found (and not fixed)
    if (report.summary.findingsCount.error > 0 && !opts.fix) {
      process.exit(1);
    }
  } finally {
    db.close();
  }
}

/**
 * Apply fixes for fixable findings, with optional interactive confirmation.
 */
async function applyFixes(
  db: Database,
  findings: SchemaFinding[],
  workspace: string,
  autoConfirm: boolean,
): Promise<FixResult[]> {
  const fixableFindings = findings.filter(f => f.fixable);
  const nonFixableFindings = findings.filter(f => !f.fixable);

  if (fixableFindings.length === 0) {
    console.error('\nℹ️  No auto-fixable issues found.');
    if (nonFixableFindings.length > 0) {
      console.error(`   ${nonFixableFindings.length} finding(s) require manual resolution.`);
    }
    return [];
  }

  console.error(`\n🔧 Found ${fixableFindings.length} fixable issue(s):`);

  // Show non-fixable findings with skip reasons
  if (nonFixableFindings.length > 0) {
    console.error(`\n⏭️  Skipping ${nonFixableFindings.length} non-fixable finding(s):`);
    for (const f of nonFixableFindings) {
      console.error(`   • ${f.message}`);
      if (f.skipReason) {
        console.error(`     ↳ ${f.skipReason}`);
      }
    }
  }

  const results: FixResult[] = [];

  if (autoConfirm) {
    // --yes mode: apply all fixes without prompting
    console.error('\n⚡ Applying all safe fixes (--yes mode)...\n');
    for (const finding of fixableFindings) {
      const result = applyFix(db, finding);
      results.push(result);
      if (result.success) {
        console.error(`  ✅ ${result.action}`);
      } else {
        console.error(`  ❌ ${finding.message}: ${result.error}`);
      }
    }
  } else {
    // Interactive mode: confirm each fix
    console.error('');
    for (const finding of fixableFindings) {
      const confirmed = await confirmFix(finding);
      if (confirmed) {
        const result = applyFix(db, finding);
        results.push(result);
        if (result.success) {
          console.error(`  ✅ ${result.action}`);
        } else {
          console.error(`  ❌ ${finding.message}: ${result.error}`);
        }
      } else {
        results.push({ finding, action: 'skipped by user', success: false });
        console.error(`  ⏭️  Skipped`);
      }
    }
  }

  return results;
}

/**
 * Ask user for confirmation to apply a fix (interactive mode).
 */
async function confirmFix(finding: SchemaFinding): Promise<boolean> {
  const severityIcon: Record<string, string> = {
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };
  const icon = severityIcon[finding.severity] || '•';

  console.error(`\n${icon} ${finding.message}`);
  if (finding.details.suggestion) {
    console.error(`  → ${finding.details.suggestion}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise<boolean>((resolve) => {
    rl.question('  Fix this? [y/N] ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Print summary of applied fixes.
 */
function printFixSummary(results: FixResult[]): void {
  const applied = results.filter(r => r.success);
  const skipped = results.filter(r => !r.success);

  console.error(`\n📊 Fix Summary:`);
  console.error(`   Applied: ${applied.length}`);
  console.error(`   Skipped: ${skipped.length}`);

  if (applied.length > 0) {
    console.error('\n   Applied fixes:');
    for (const r of applied) {
      console.error(`   • ${r.action}`);
    }
  }
}

function printTableReport(report: import('../types/schema-audit').SchemaAuditReport): void {
  const { summary, findings } = report;

  console.log(`\nSchema Audit Report — ${report.workspace}`);
  console.log(`Supertags: ${summary.totalSupertags} | Fields: ${summary.totalFields}`);
  console.log(`Findings: ${summary.findingsCount.error} errors, ${summary.findingsCount.warning} warnings, ${summary.findingsCount.info} info\n`);

  if (findings.length === 0) {
    console.log('✅ No issues found');
    return;
  }

  const severityIcon: Record<string, string> = {
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };

  for (const finding of findings) {
    const icon = severityIcon[finding.severity] || '•';
    console.log(`${icon} [${finding.severity.toUpperCase()}] ${finding.message}`);
    if (finding.details.usageLocations && finding.details.usageLocations.length > 0) {
      for (const loc of finding.details.usageLocations) {
        const fieldPart = loc.fieldId
          ? ` → ${loc.fieldName || '?'} (${loc.fieldId})`
          : '';
        const typePart = loc.dataType ? `: ${loc.dataType}` : '';
        console.log(`  → ${loc.tagName}#${loc.tagId}${fieldPart}${typePart}`);
      }
    }
    if (finding.details.suggestion) {
      console.log(`  → ${finding.details.suggestion}`);
    }
    if (finding.tanaPaste) {
      console.log(`  📋 Fix: ${finding.tanaPaste}`);
    }
  }
}

function printMarkdownReport(report: import('../types/schema-audit').SchemaAuditReport): void {
  const { summary, findings } = report;

  console.log(`# Schema Audit Report — ${report.workspace}\n`);
  console.log(`| Metric | Count |`);
  console.log(`|--------|-------|`);
  console.log(`| Supertags | ${summary.totalSupertags} |`);
  console.log(`| Fields | ${summary.totalFields} |`);
  console.log(`| Errors | ${summary.findingsCount.error} |`);
  console.log(`| Warnings | ${summary.findingsCount.warning} |`);
  console.log(`| Info | ${summary.findingsCount.info} |`);
  console.log('');

  if (findings.length === 0) {
    console.log('No issues found.');
    return;
  }

  console.log('## Findings\n');
  for (const finding of findings) {
    console.log(`### ${finding.severity.toUpperCase()}: ${finding.message}`);
    console.log(`- Detector: ${finding.detector}`);
    if (finding.details.usageLocations && finding.details.usageLocations.length > 0) {
      console.log('- Locations:');
      for (const loc of finding.details.usageLocations) {
        const fieldPart = loc.fieldId
          ? ` → ${loc.fieldName || '?'} (\`${loc.fieldId}\`)`
          : '';
        const typePart = loc.dataType ? `: ${loc.dataType}` : '';
        console.log(`  - \`${loc.tagName}\`#\`${loc.tagId}\`${fieldPart}${typePart}`);
      }
    }
    if (finding.details.suggestion) {
      console.log(`- Suggestion: ${finding.details.suggestion}`);
    }
    if (finding.tanaPaste) {
      console.log(`- Fix: \`${finding.tanaPaste}\``);
    }
    console.log('');
  }
}
