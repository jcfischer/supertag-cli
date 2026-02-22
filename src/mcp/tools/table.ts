/**
 * tana_table MCP Tool (F-099: Bulk Field Extractor)
 *
 * Export all instances of a supertag as a table with resolved field values.
 * Returns structured JSON with both raw IDs and resolved names for references.
 */

import { resolveWorkspaceContext } from "../../config/workspace-resolver.js";
import { withDatabase } from "../../db/with-database.js";
import {
  exportTable,
  type TableExportOptions,
  type ExportRow,
} from "../../db/table-export.js";

export interface TableInput {
  /** Supertag name to export */
  supertag: string;
  /** Workspace alias */
  workspace?: string;
  /** Only include these fields */
  fields?: string[];
  /** Filter rows by field=value */
  where?: string[];
  /** Sort by field name */
  sort?: string;
  /** Sort direction */
  direction?: "asc" | "desc";
  /** Maximum rows to return */
  limit?: number;
  /** Skip first N rows */
  offset?: number;
  /** Resolve reference IDs to names (default: true) */
  resolveReferences?: boolean;
  /** Internal: for testing only */
  _dbPath?: string;
}

export interface TableResultRow {
  id: string;
  name: string;
  [fieldName: string]: unknown;
}

export interface TableResult {
  workspace: string;
  supertag: string;
  columns: string[];
  rows: TableResultRow[];
  totalCount: number;
  hasMore: boolean;
}

/**
 * Build a structured result row from an ExportRow.
 * Reference fields include both resolved names and raw IDs.
 */
function buildResultRow(row: ExportRow, columns: string[]): TableResultRow {
  const result: TableResultRow = {
    id: row.id,
    name: row.name,
  };

  for (const col of columns) {
    const field = row.fields[col];
    if (!field || (field.raw === "" && !field.resolved)) {
      result[col] = null;
    } else if (field.resolved) {
      result[col] = {
        value: field.resolved,
        raw: field.raw,
        type: field.type,
      };
    } else {
      result[col] = field.raw;
    }
  }

  return result;
}

export async function tableExport(input: TableInput): Promise<TableResult> {
  // Allow direct dbPath for testing
  let dbPath: string;
  let workspaceAlias: string;
  if (input._dbPath) {
    dbPath = input._dbPath;
    workspaceAlias = "test";
  } else {
    const workspace = resolveWorkspaceContext({ workspace: input.workspace });
    dbPath = workspace.dbPath;
    workspaceAlias = workspace.alias;
  }

  return withDatabase({ dbPath, readonly: true }, (ctx) => {
    const options: TableExportOptions = {
      fields: input.fields,
      where: input.where,
      sort: input.sort,
      direction: input.direction,
      limit: input.limit ?? 100,
      offset: input.offset ?? 0,
      resolveReferences: input.resolveReferences ?? true,
    };

    const result = exportTable(ctx.db, input.supertag, options);

    return {
      workspace: workspaceAlias,
      supertag: result.supertag,
      columns: result.columns,
      rows: result.rows.map((row) => buildResultRow(row, result.columns)),
      totalCount: result.totalCount,
      hasMore: result.hasMore,
    };
  });
}
