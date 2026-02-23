/**
 * tana_schema_audit MCP Tool (F-101)
 *
 * Analyzes supertag schema health: detects redundancy,
 * inconsistencies, and suggests improvements.
 * Read-only — never modifies the database.
 */

import { Database } from 'bun:sqlite';
import { resolveWorkspaceContext } from '../../config/workspace-resolver';
import { SchemaAuditService } from '../../services/schema-audit-service';
import type { SchemaAuditInput } from '../schemas';
import type { SchemaFindingSeverity } from '../../types/schema-audit';

export async function schemaAudit(input: SchemaAuditInput) {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });
  const db = new Database(workspace.dbPath, { readonly: true });

  try {
    const service = new SchemaAuditService(db);

    // Documentation mode
    if (input.generateDocs) {
      const docs = service.generateDocs();
      return { workspace: workspace.alias, documentation: docs };
    }

    // Audit mode
    const report = service.audit({
      tag: input.tag,
      includeFixes: input.includeFixes,
      severity: input.severity as SchemaFindingSeverity | undefined,
    });

    report.workspace = workspace.alias;
    return report;
  } finally {
    db.close();
  }
}
