/**
 * tana_field_values Tool
 *
 * Query and search field values extracted from Tana tuple structures.
 * Supports three modes: list (available fields), query (by field name), search (FTS).
 */

import { Database } from "bun:sqlite";
import { resolveWorkspace } from "../../config/paths.js";
import { ConfigManager } from "../../config/manager.js";
import {
  getAvailableFieldNames,
  queryFieldValuesByFieldName,
  queryFieldValuesFTS,
  type FieldValueResult,
  type FieldNameCount,
} from "../../db/field-query.js";

export interface FieldValuesInput {
  mode: "list" | "query" | "search";
  fieldName?: string;
  query?: string;
  workspace?: string;
  limit?: number;
  offset?: number;
  createdAfter?: string;
  createdBefore?: string;
}

export interface FieldValuesResult {
  workspace: string;
  mode: "list" | "query" | "search";
  fields?: FieldNameCount[];
  results?: FieldValueResult[];
  count: number;
}

/**
 * Convert date string to timestamp
 */
function parseDate(dateStr: string): number {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD or ISO 8601`);
  }
  return date.getTime();
}

export async function fieldValues(input: FieldValuesInput): Promise<FieldValuesResult> {
  const config = ConfigManager.getInstance().getConfig();
  const workspace = resolveWorkspace(input.workspace, config);

  const db = new Database(workspace.dbPath, { readonly: true });

  try {
    const { mode } = input;

    switch (mode) {
      case "list": {
        // T-5.1: List available field names with counts
        const fields = getAvailableFieldNames(db);
        return {
          workspace: workspace.alias,
          mode: "list",
          fields,
          count: fields.length,
        };
      }

      case "query": {
        // T-5.2: Query values for a specific field
        if (!input.fieldName) {
          throw new Error("fieldName is required for query mode");
        }

        const options: {
          limit?: number;
          offset?: number;
          createdAfter?: number;
          createdBefore?: number;
        } = {
          limit: input.limit ?? 100,
          offset: input.offset ?? 0,
        };

        if (input.createdAfter) {
          options.createdAfter = parseDate(input.createdAfter);
        }
        if (input.createdBefore) {
          options.createdBefore = parseDate(input.createdBefore);
        }

        const results = queryFieldValuesByFieldName(db, input.fieldName, options);
        return {
          workspace: workspace.alias,
          mode: "query",
          results,
          count: results.length,
        };
      }

      case "search": {
        // T-5.3: Full-text search across field values
        if (!input.query) {
          throw new Error("query is required for search mode");
        }

        const results = queryFieldValuesFTS(db, input.query, {
          fieldName: input.fieldName,
          limit: input.limit ?? 50,
        });

        return {
          workspace: workspace.alias,
          mode: "search",
          results,
          count: results.length,
        };
      }

      default:
        throw new Error(`Unknown mode: ${mode}`);
    }
  } finally {
    db.close();
  }
}
