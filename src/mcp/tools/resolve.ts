/**
 * tana_resolve MCP Tool
 * Spec: F-100 Entity Resolution
 *
 * Find existing node by name with confidence scoring.
 * Combines fuzzy text matching and semantic similarity for entity resolution.
 */

import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import { withDatabase } from '../../db/with-database.js';
import { resolveEntity } from '../../db/entity-match.js';
import { handleMcpError } from '../error-handler.js';
import type { ResolveInput } from '../schemas.js';

export interface ResolveResponse {
  query: string;
  action: 'matched' | 'ambiguous' | 'no_match';
  candidates: Array<{
    id: string;
    name: string;
    tags: string[];
    confidence: number;
    matchType: 'exact' | 'fuzzy' | 'semantic';
  }>;
  bestMatch: { id: string; name: string; confidence: number } | null;
  embeddingsAvailable: boolean;
}

export async function resolve(input: ResolveInput): Promise<ResolveResponse> {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });

  return withDatabase({ dbPath: workspace.dbPath, readonly: true }, async ({ db }) => {
    const result = await resolveEntity(db, input.name, {
      tag: input.tag,
      threshold: input.threshold,
      limit: input.limit,
      exact: input.exact,
      workspace: input.workspace ?? undefined,
    });

    return {
      query: result.query,
      action: result.action,
      candidates: result.candidates.map((c) => ({
        id: c.id,
        name: c.name,
        tags: c.tags,
        confidence: Math.round(c.confidence * 1000) / 1000,
        matchType: c.matchType,
      })),
      bestMatch: result.bestMatch
        ? {
            id: result.bestMatch.id,
            name: result.bestMatch.name,
            confidence: Math.round(result.bestMatch.confidence * 1000) / 1000,
          }
        : null,
      embeddingsAvailable: result.embeddingsAvailable,
    };
  });
}
