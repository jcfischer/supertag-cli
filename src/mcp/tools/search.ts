/**
 * tana_search Tool
 * Spec: F-097 Live Read Backend (T-4.1)
 *
 * Full-text search on Tana node names.
 * Routes through TanaReadBackend: Local API when available, SQLite fallback.
 */

import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import { resolveReadBackend } from '../../api/read-backend-resolver.js';
import { findMeaningfulAncestor } from '../../embeddings/ancestor-resolution.js';
import { withDatabase } from '../../db/with-database.js';
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
  const readBackend = await resolveReadBackend({ workspace: input.workspace });

  const dateRange = parseDateRange(input);
  const results = await readBackend.search(input.query, {
    limit: input.limit || 20,
    ...dateRange,
  });

  const includeAncestor = input.includeAncestor ?? true;

  // Map ReadSearchResult[] to SearchResultItem[]
  // Tags already resolved by the read backend
  const resultsWithTags: SearchResultItem[] = results.map((r) => {
    const item: SearchResultItem = {
      id: r.id,
      name: r.name,
      rank: r.rank ?? 0,
    };

    // Include tags if not raw mode (already in ReadSearchResult)
    if (!input.raw) {
      item.tags = r.tags;
    }

    // For live backend: use breadcrumb for ancestor context
    if (includeAncestor && !input.raw && readBackend.isLive() && r.breadcrumb && r.breadcrumb.length > 1) {
      item.ancestor = {
        id: '',
        name: r.breadcrumb[r.breadcrumb.length - 2] || '',
        tags: [],
      };
      item.pathFromAncestor = r.breadcrumb;
      item.depthFromAncestor = r.breadcrumb.length - 1;
    }

    return item;
  });

  // For SQLite backend: resolve ancestors using findMeaningfulAncestor
  if (!readBackend.isLive() && includeAncestor && !input.raw) {
    withDatabase({ dbPath: workspace.dbPath, readonly: true }, (ctx) => {
      for (const item of resultsWithTags) {
        const ancestorResult = findMeaningfulAncestor(ctx.db, item.id);
        if (ancestorResult && ancestorResult.depth > 0) {
          item.ancestor = ancestorResult.ancestor;
          item.pathFromAncestor = ancestorResult.path;
          item.depthFromAncestor = ancestorResult.depth;
        }
      }
    });
  }

  // Apply field projection if select is specified
  const projection = parseSelectPaths(input.select);
  const projectedResults = applyProjectionToArray(resultsWithTags, projection);

  return {
    workspace: workspace.alias,
    query: input.query,
    results: projectedResults,
    count: projectedResults.length,
  };
}
