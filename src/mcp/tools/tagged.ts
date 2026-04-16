/**
 * tana_tagged Tool
 *
 * Find nodes with a specific supertag applied.
 */

import { TanaQueryEngine } from '../../query/tana-query-engine.js';
import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import type { TaggedInput } from '../schemas.js';
import { parseDateRange } from '../schemas.js';
import {
  parseSelectPaths,
  applyProjectionToArray,
} from '../../utils/select-projection.js';
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
  nodes: Partial<Record<string, unknown>>[];
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

    // Build base items
    const items: Record<string, unknown>[] = nodes.map((n) => ({
      id: n.id,
      name: n.name,
      created: n.created,
      updated: n.updated,
    }));

    // Resolve field values when select includes fields.* paths or always for completeness
    const hasFieldSelect = input.select?.some((s) => s.startsWith('fields.'));
    if (hasFieldSelect || !input.select) {
      const db = engine.rawDb;
      const fieldResolver = new FieldResolver(db);
      const nodeIds = nodes.map((n) => n.id);

      // Determine which fields to resolve
      let fieldTarget: string[] | '*';
      if (hasFieldSelect) {
        fieldTarget = input.select!
          .filter((s) => s.startsWith('fields.'))
          .map((s) => s.replace('fields.', ''));
      } else {
        fieldTarget = '*';
      }

      const fieldValuesMap = fieldResolver.resolveFields(nodeIds, fieldTarget);
      for (const item of items) {
        const fields = fieldValuesMap.get(item.id as string) ?? {};
        item.fields = fields;
      }
    }

    // Apply field projection if select is specified
    const projection = parseSelectPaths(input.select);
    const projectedItems = applyProjectionToArray(items, projection);

    return {
      workspace: workspace.alias,
      tagname: tagName,
      nodes: projectedItems,
      count: projectedItems.length,
    };
  } finally {
    engine.close();
  }
}
