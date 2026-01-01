/**
 * tana_search Tool
 *
 * Full-text search on Tana node names using FTS5.
 */

import { TanaQueryEngine } from '../../query/tana-query-engine.js';
import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import { findMeaningfulAncestor } from '../../embeddings/ancestor-resolution.js';
import type { SearchInput } from '../schemas.js';
import { parseDateRange } from '../schemas.js';
import {
  parseSelectPaths,
  applyProjectionToArray,
} from '../../utils/select-projection.js';

export interface SearchResultItem {
  id: string;
  name: string | null;
  rank: number;
  tags?: string[];
  // Ancestor context (when includeAncestor is true and node has tagged ancestor)
  ancestor?: {
    id: string;
    name: string;
    tags: string[];
  };
  pathFromAncestor?: string[];
  depthFromAncestor?: number;
}

export interface SearchResult {
  workspace: string;
  query: string;
  results: Partial<Record<string, unknown>>[];
  count: number;
}

export async function search(input: SearchInput): Promise<SearchResult> {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });

  const engine = new TanaQueryEngine(workspace.dbPath);

  try {
    // Ensure FTS index exists
    if (!(await engine.hasFTSIndex())) {
      await engine.initializeFTS();
    }

    const dateRange = parseDateRange(input);
    const results = await engine.searchNodes(input.query, {
      limit: input.limit || 20,
      ...dateRange,
    });

    const includeAncestor = input.includeAncestor ?? true;

    // Optionally get tags and ancestor for each result
    const resultsWithTags: SearchResultItem[] = results.map((r) => {
      const item: SearchResultItem = {
        id: r.id,
        name: r.name,
        rank: r.rank,
      };

      // Include tags if not raw mode
      if (!input.raw) {
        item.tags = engine.getNodeTags(r.id);
      }

      // Add ancestor info if enabled
      if (includeAncestor && !input.raw) {
        const ancestorResult = findMeaningfulAncestor(engine.rawDb, r.id);
        if (ancestorResult && ancestorResult.depth > 0) {
          item.ancestor = ancestorResult.ancestor;
          item.pathFromAncestor = ancestorResult.path;
          item.depthFromAncestor = ancestorResult.depth;
        }
      }

      return item;
    });

    // Apply field projection if select is specified
    const projection = parseSelectPaths(input.select);
    const projectedResults = applyProjectionToArray(resultsWithTags, projection);

    return {
      workspace: workspace.alias,
      query: input.query,
      results: projectedResults,
      count: projectedResults.length,
    };
  } finally {
    engine.close();
  }
}
