/**
 * tana_resolve Tool
 * Spec: F-100 Entity Resolution (T-4.2)
 *
 * Find existing nodes by name with confidence scoring.
 * Returns ranked candidates for find-or-create workflows.
 */

import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import { withDatabase } from '../../db/with-database.js';
import { resolveEntity } from '../../db/entity-match.js';
import type { ResolveInput } from '../schemas.js';

export interface ResolveResult {
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
  created?: { suggestion: string };
}

export async function resolve(input: ResolveInput): Promise<ResolveResult> {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });

  return withDatabase(
    { dbPath: workspace.dbPath, readonly: true },
    async (ctx) => {
      const result = await resolveEntity(ctx.db, input.name, {
        tag: input.tag,
        threshold: input.threshold,
        limit: input.limit,
        exact: input.exact,
        workspace: input.workspace ?? undefined,
      });

      const response: ResolveResult = {
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
              confidence:
                Math.round(result.bestMatch.confidence * 1000) / 1000,
            }
          : null,
        embeddingsAvailable: result.embeddingsAvailable,
      };

      // Handle create-if-missing
      if (input.createIfMissing && result.action === 'no_match' && input.tag) {
        response.created = {
          suggestion: `Use tana_create with supertag="${input.tag}" and name="${input.name}"`,
        };
      } else if (input.createIfMissing && result.action === 'ambiguous') {
        response.created = {
          suggestion:
            'Ambiguous match — cannot auto-create. Use tag filter to narrow candidates.',
        };
      }

      return response;
    }
  );
}
