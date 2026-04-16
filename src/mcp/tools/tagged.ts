/**
 * tana_tagged Tool
 *
 * Find nodes with a specific supertag applied.
 */

import { TanaQueryEngine } from '../../query/tana-query-engine.js';
import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import type { TaggedInput } from '../schemas.js';
import { parseDateRange } from '../schemas.js';
import { FieldResolver } from '../../services/field-resolver.js';

export interface TaggedNodeItem {
  id: string;
  name: string | null;
  created: number | null;
  updated: number | null;
}

export interface TaggedResult {
  workspace: string;
  tagname: string;
  nodes: Record<string, unknown>[];
  count: number;
}

export async function tagged(input: TaggedInput): Promise<TaggedResult> {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });

  const engine = new TanaQueryEngine(workspace.dbPath);

  try {
    // Handle case-insensitive matching
    let tagName = input.tagname;
    if (input.caseInsensitive) {
      // Get all tags and find case-insensitive match
      const allTags = await engine.getTagApplicationCounts();
      const match = allTags.find(
        (t) => t.tagName.toLowerCase() === input.tagname.toLowerCase()
      );
      if (match) {
        tagName = match.tagName;
      }
    }

    const dateRange = parseDateRange(input);
    const nodes = await engine.findNodesByTag(tagName, {
      limit: input.limit || 20,
      orderBy: input.orderBy || 'created',
      nameContains: input.query,  // Spec 089: Filter by name
      ...dateRange,
    });

    // Build base items with all fields resolved
    const db = engine.rawDb;
    const fieldResolver = new FieldResolver(db);
    const nodeIds = nodes.map((n) => n.id);
    const fieldValuesMap = fieldResolver.resolveFields(nodeIds, '*');

    const items: Record<string, unknown>[] = nodes.map((n) => ({
      id: n.id,
      name: n.name,
      created: n.created,
      updated: n.updated,
      fields: fieldValuesMap.get(n.id) ?? {},
    }));

    // Apply explicit projection if select is specified
    if (input.select && input.select.length > 0) {
      const coreFields = new Set<string>();
      const requestedFieldNames: string[] = [];
      for (const s of input.select) {
        if (s.startsWith("fields.")) {
          requestedFieldNames.push(s.slice(7));
        } else {
          coreFields.add(s);
        }
      }

      const projected = items.map((item) => {
        const result: Record<string, unknown> = {};

        // Copy requested core fields
        for (const key of coreFields) {
          if (key in item) {
            result[key] = item[key];
          }
        }

        // Build filtered fields object
        const sourceFields = item.fields as Record<string, unknown> | undefined;
        if (sourceFields && requestedFieldNames.length > 0) {
          const filteredFields: Record<string, unknown> = {};
          for (const fname of requestedFieldNames) {
            if (fname in sourceFields) {
              filteredFields[fname] = sourceFields[fname];
            } else {
              const lower = fname.toLowerCase();
              const match = Object.keys(sourceFields).find(
                (k) => k.toLowerCase() === lower
              );
              filteredFields[fname] = match ? sourceFields[match] : null;
            }
          }
          result.fields = filteredFields;
        } else if (requestedFieldNames.length > 0) {
          const nullFields: Record<string, unknown> = {};
          for (const fname of requestedFieldNames) {
            nullFields[fname] = null;
          }
          result.fields = nullFields;
        }

        return result;
      });

      return {
        workspace: workspace.alias,
        tagname: tagName,
        nodes: projected,
        count: projected.length,
      };
    }

    return {
      workspace: workspace.alias,
      tagname: tagName,
      nodes: items,
      count: items.length,
    };
  } finally {
    engine.close();
  }
}
