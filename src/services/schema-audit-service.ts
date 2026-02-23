/**
 * Schema Audit Service (F-101)
 *
 * Main orchestration service for schema analysis.
 * Loads schema, runs detectors, formats report.
 * Read-only — never modifies the database.
 */

import type { Database } from 'bun:sqlite';
import type {
  SchemaAuditReport,
  SchemaFinding,
  SchemaFindingSeverity,
  WorkspaceSchema,
} from '../types/schema-audit';
import { loadWorkspaceSchema } from './schema-audit-loader';
import { runDetectors } from './schema-audit-registry';
import { generateSchemaDocumentation } from './schema-audit-docs';
import { annotateFixable } from './schema-audit-fixer';

export interface AuditOptions {
  tag?: string;
  detectors?: string[];
  includeFixes?: boolean;
  severity?: SchemaFindingSeverity;
}

export class SchemaAuditService {
  constructor(private db: Database) {}

  /**
   * Run full audit on workspace.
   */
  audit(options?: AuditOptions): SchemaAuditReport {
    let schema = loadWorkspaceSchema(this.db);

    // Filter to specific tag hierarchy if requested
    if (options?.tag) {
      schema = this.filterByTag(schema, options.tag);
    }

    let findings = runDetectors(schema, {
      detectors: options?.detectors,
    });

    // Filter by minimum severity
    if (options?.severity) {
      findings = this.filterBySeverity(findings, options.severity);
    }

    // Annotate fixable status for --fix mode
    findings = annotateFixable(findings);

    // Add Tana Paste fix suggestions
    if (options?.includeFixes) {
      findings = findings.map(f => ({
        ...f,
        tanaPaste: this.generateFix(f),
      }));
    }

    const summary = {
      totalSupertags: schema.supertags.length,
      totalFields: schema.fields.length,
      findingsCount: {
        error: findings.filter(f => f.severity === 'error').length,
        warning: findings.filter(f => f.severity === 'warning').length,
        info: findings.filter(f => f.severity === 'info').length,
      },
    };

    return {
      workspace: 'default',
      timestamp: new Date().toISOString(),
      summary,
      findings,
    };
  }

  /**
   * Generate schema documentation.
   */
  generateDocs(): string {
    const schema = loadWorkspaceSchema(this.db);
    return generateSchemaDocumentation(schema);
  }

  /**
   * Filter schema to a specific tag and its hierarchy.
   */
  private filterByTag(schema: WorkspaceSchema, tagName: string): WorkspaceSchema {
    // Find tag by name (case-insensitive)
    const tag = schema.supertags.find(
      s => s.name.toLowerCase() === tagName.toLowerCase()
    );

    if (!tag) {
      return { ...schema, supertags: [], fields: [], tagApplications: [], fieldValues: [] };
    }

    // Collect tag and its descendants
    const tagIds = new Set<string>([tag.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const rel of schema.inheritance) {
        if (tagIds.has(rel.parentTagId) && !tagIds.has(rel.childTagId)) {
          tagIds.add(rel.childTagId);
          changed = true;
        }
      }
    }

    // Also include parents (for inheritance context)
    for (const rel of schema.inheritance) {
      if (tagIds.has(rel.childTagId)) {
        tagIds.add(rel.parentTagId);
      }
    }

    return {
      supertags: schema.supertags.filter(s => tagIds.has(s.id)),
      fields: schema.fields.filter(f => tagIds.has(f.tagId)),
      inheritance: schema.inheritance.filter(
        r => tagIds.has(r.childTagId) || tagIds.has(r.parentTagId)
      ),
      tagApplications: schema.tagApplications.filter(ta => tagIds.has(ta.tagId)),
      fieldValues: schema.fieldValues.filter(fv => tagIds.has(fv.tagId)),
    };
  }

  /**
   * Filter findings by minimum severity level.
   */
  private filterBySeverity(
    findings: SchemaFinding[],
    minSeverity: SchemaFindingSeverity
  ): SchemaFinding[] {
    const levels: Record<SchemaFindingSeverity, number> = {
      error: 3,
      warning: 2,
      info: 1,
    };
    const minLevel = levels[minSeverity];
    return findings.filter(f => levels[f.severity] >= minLevel);
  }

  /**
   * Generate a Tana Paste fix suggestion for a finding.
   */
  private generateFix(finding: SchemaFinding): string | undefined {
    switch (finding.detector) {
      case 'orphan-tags':
        return `// Consider removing supertag "${finding.details.tagName}" (0 instances)`;

      case 'duplicate-fields':
        if (finding.details.fieldName) {
          return `- Parent Supertag #[[shared-${finding.details.fieldName}]]\n  - ${finding.details.fieldName}::`;
        }
        return undefined;

      case 'missing-inheritance':
        return `// Consider creating a shared parent supertag for common fields`;

      default:
        return undefined;
    }
  }
}
