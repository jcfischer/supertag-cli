/**
 * Schema Audit Fixer (Issue #57)
 *
 * Applies safe, reversible fixes for schema audit findings.
 * Only handles clearly safe operations:
 * - Orphan tags (zero instances) → remove from schema tables
 * - Unused fields (zero fill rate) → remove from supertag_fields
 *
 * Non-fixable findings (type mismatches, duplicate fields) are skipped
 * with an explanation of why manual resolution is needed.
 */

import type { Database } from 'bun:sqlite';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { SchemaFinding, FixResult, AuditTrailEntry } from '../types/schema-audit';

/** Detectors whose findings can be auto-fixed */
const FIXABLE_DETECTORS = new Set(['orphan-tags', 'unused-fields']);

/** Reasons why specific detectors cannot be auto-fixed */
const SKIP_REASONS: Record<string, string> = {
  'type-mismatch': 'Conflicting field types require manual decision on which type to keep',
  'duplicate-fields': 'Merging fields across unrelated tags requires architectural decision',
  'missing-inheritance': 'Creating parent supertags requires manual schema design',
  'low-usage-tags': 'Low-usage tags may still be intentional; review manually',
  'fill-rate': 'Low fill rate may be expected for optional fields',
};

/**
 * Annotate findings with fixable status.
 * Call this after running detectors to mark which findings can be auto-fixed.
 */
export function annotateFixable(findings: SchemaFinding[]): SchemaFinding[] {
  return findings.map(f => ({
    ...f,
    fixable: FIXABLE_DETECTORS.has(f.detector),
    skipReason: FIXABLE_DETECTORS.has(f.detector) ? undefined : SKIP_REASONS[f.detector],
  }));
}

/**
 * Apply a single fix to the database.
 *
 * @param db - Writable database connection
 * @param finding - The finding to fix
 * @returns FixResult describing what was done
 */
export function applyFix(db: Database, finding: SchemaFinding): FixResult {
  if (!FIXABLE_DETECTORS.has(finding.detector)) {
    return {
      finding,
      action: 'skipped',
      success: false,
      error: SKIP_REASONS[finding.detector] || 'Not a fixable finding',
    };
  }

  try {
    switch (finding.detector) {
      case 'orphan-tags':
        return fixOrphanTag(db, finding);
      case 'unused-fields':
        return fixUnusedField(db, finding);
      default:
        return { finding, action: 'skipped', success: false, error: 'Unknown detector' };
    }
  } catch (error) {
    return {
      finding,
      action: 'failed',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove an orphan tag (zero instances) from schema tables.
 */
function fixOrphanTag(db: Database, finding: SchemaFinding): FixResult {
  const tagId = finding.details.tagId;
  if (!tagId) {
    return { finding, action: 'skipped', success: false, error: 'No tagId in finding details' };
  }

  // Double-check: verify the tag still has zero instances
  const count = db.query(
    `SELECT COUNT(*) as cnt FROM tag_applications WHERE tag_id = ?`
  ).get(tagId) as { cnt: number } | null;

  if (count && count.cnt > 0) {
    return {
      finding,
      action: 'skipped',
      success: false,
      error: `Tag now has ${count.cnt} instances, no longer orphaned`,
    };
  }

  // Remove from supertag_fields first (child references)
  const fieldsDeleted = db.query(
    `DELETE FROM supertag_fields WHERE tag_id = ?`
  ).run(tagId);

  // Remove from supertag_metadata
  const metaDeleted = db.query(
    `DELETE FROM supertag_metadata WHERE tag_id = ?`
  ).run(tagId);

  // Remove from supertag_parents
  db.query(
    `DELETE FROM supertag_parents WHERE child_tag_id = ? OR parent_tag_id = ?`
  ).run(tagId, tagId);

  return {
    finding,
    action: `Removed orphan tag "${finding.details.tagName}" (${fieldsDeleted.changes} fields, ${metaDeleted.changes} metadata rows)`,
    success: true,
  };
}

/**
 * Remove an unused field (zero fill rate) from supertag_fields.
 */
function fixUnusedField(db: Database, finding: SchemaFinding): FixResult {
  const { fieldName, tagId, tagName } = finding.details;
  if (!fieldName || !tagId) {
    return { finding, action: 'skipped', success: false, error: 'Missing fieldName or tagId in finding details' };
  }

  // Double-check: verify the field still has zero populated values
  const hasValues = db.query(`
    SELECT COUNT(*) as cnt FROM field_values fv
    JOIN tag_applications ta ON ta.data_node_id = fv.parent_id
    WHERE fv.field_name = ? AND ta.tag_id = ?
  `).get(fieldName, tagId) as { cnt: number } | null;

  if (hasValues && hasValues.cnt > 0) {
    return {
      finding,
      action: 'skipped',
      success: false,
      error: `Field now has ${hasValues.cnt} values, no longer unused`,
    };
  }

  const result = db.query(
    `DELETE FROM supertag_fields WHERE field_name = ? AND tag_id = ?`
  ).run(fieldName, tagId);

  return {
    finding,
    action: `Removed unused field "${fieldName}" from "${tagName}" (${result.changes} rows)`,
    success: true,
  };
}

/**
 * Write audit trail log of all applied fixes.
 *
 * @param workspace - Workspace alias
 * @param results - Fix results to log
 * @param logDir - Directory for audit trail files
 */
export function writeAuditTrail(
  workspace: string,
  results: FixResult[],
  logDir: string,
): string {
  const successfulFixes = results.filter(r => r.success);
  if (successfulFixes.length === 0) return '';

  const entries: AuditTrailEntry[] = successfulFixes.map(r => ({
    timestamp: new Date().toISOString(),
    workspace,
    action: r.action,
    detector: r.finding.detector,
    details: r.finding.details as Record<string, unknown>,
  }));

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const logFile = join(logDir, `schema-audit-fixes-${new Date().toISOString().slice(0, 10)}.jsonl`);

  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';

  // Append to existing log file
  const existing = existsSync(logFile)
    ? Bun.file(logFile).text()
    : Promise.resolve('');

  // Use sync write for simplicity in CLI context
  writeFileSync(logFile, lines, { flag: 'a' });

  return logFile;
}
