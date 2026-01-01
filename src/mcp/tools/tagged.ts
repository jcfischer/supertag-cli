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
      ...dateRange,
    });

    const items: TaggedNodeItem[] = nodes.map((n) => ({
      id: n.id,
      name: n.name,
      created: n.created,
      updated: n.updated,
    }));

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
