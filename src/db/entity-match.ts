/**
 * Entity Matching - Database Queries
 *
 * Connects entity resolution to FTS5, Levenshtein, and semantic search.
 * Provides findExactMatches, findFuzzyMatches, and the main resolveEntity orchestrator.
 *
 * Spec: F-100 Entity Resolution (Phase 2)
 */

import type { Database } from 'bun:sqlite';
import { distance as levenshtein } from 'fastest-levenshtein';
import {
  type ResolvedCandidate,
  type ResolutionResult,
  type ResolveOptions,
  normalizeQuery,
  calculateFuzzyConfidence,
  mapSemanticToConfidence,
  mergeAndDeduplicate,
  determineAction,
  generateNameVariants,
  validateShortQuery,
  escapeFTS5Query,
  DEFAULTS,
} from '../lib/entity-resolution';
import { isEntityById } from './entity';
import { withDbRetrySync } from './retry';

// =============================================================================
// Types
// =============================================================================

interface NodeRow {
  id: string;
  name: string | null;
}

interface FtsRow {
  id: string;
  name: string | null;
  rank: number;
}

// =============================================================================
// Exact Matching
// =============================================================================

/**
 * Find nodes with exact name match (case-insensitive).
 * Returns candidates with confidence 1.0.
 */
export function findExactMatches(
  db: Database,
  query: string,
  options: { tag?: string } = {}
): ResolvedCandidate[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  let sql: string;
  const params: (string | number)[] = [];

  if (options.tag) {
    sql = `
      SELECT DISTINCT n.id, n.name
      FROM nodes n
      JOIN tag_applications ta ON n.id = ta.data_node_id
      WHERE LOWER(n.name) = ?
        AND LOWER(ta.tag_name) = LOWER(?)
    `;
    params.push(normalized, options.tag);
  } else {
    sql = `
      SELECT DISTINCT n.id, n.name
      FROM nodes n
      WHERE LOWER(n.name) = ?
    `;
    params.push(normalized);
  }

  const rows = withDbRetrySync(
    () => db.query(sql).all(...params) as NodeRow[],
    'findExactMatches'
  );

  return rows
    .filter((r) => r.name !== null)
    .map((row) => {
      const tags = getNodeTags(db, row.id);
      return {
        id: row.id,
        name: row.name!,
        tags,
        confidence: 1.0,
        matchType: 'exact' as const,
        matchDetails: {},
      };
    });
}

// =============================================================================
// Fuzzy Matching
// =============================================================================

/**
 * Find nodes using FTS5 search + LIKE fallback + Levenshtein distance scoring.
 *
 * Strategy:
 * 1. FTS5 MATCH for word-based matches (fast, handles exact word matches)
 * 2. LIKE for substring matches (catches typos FTS5 misses)
 * 3. Score all candidates with Levenshtein distance
 */
export function findFuzzyMatches(
  db: Database,
  query: string,
  options: { tag?: string; limit?: number } = {}
): ResolvedCandidate[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const ftsLimit = 100;
  const escaped = escapeFTS5Query(normalized);
  const seenIds = new Set<string>();
  let rows: FtsRow[] = [];

  // Check if FTS table exists
  const hasFTS = db
    .query(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='nodes_fts'`)
    .get();

  if (hasFTS) {
    // Step 1: FTS5 for word-based matches
    const ftsRows = withDbRetrySync(
      () =>
        db
          .query(
            `SELECT n.id, n.name, fts.rank
             FROM nodes_fts fts
             JOIN nodes n ON n.rowid = fts.rowid
             WHERE nodes_fts MATCH ?
             ORDER BY fts.rank
             LIMIT ?`
          )
          .all(escaped, ftsLimit) as FtsRow[],
      'findFuzzyMatches-fts'
    );
    for (const row of ftsRows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        rows.push(row);
      }
    }
  }

  // Step 2: LIKE-based search for substring/typo matches
  // Use each word in the query as a LIKE pattern to catch fuzzy candidates
  const words = normalized.split(/\s+/).filter((w) => w.length >= 2);
  for (const word of words) {
    const likeRows = withDbRetrySync(
      () =>
        db
          .query(
            `SELECT id, name, 0 as rank
             FROM nodes
             WHERE name IS NOT NULL AND LOWER(name) LIKE ?
             LIMIT ?`
          )
          .all(`%${word}%`, ftsLimit) as FtsRow[],
      'findFuzzyMatches-like'
    );
    for (const row of likeRows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        rows.push(row);
      }
    }
  }

  // Score each candidate with Levenshtein
  const candidates: ResolvedCandidate[] = [];

  for (const row of rows) {
    if (!row.name) continue;

    const tags = getNodeTags(db, row.id);
    const sameTag = options.tag
      ? tags.some((t) => t.toLowerCase() === options.tag!.toLowerCase())
      : false;

    // If tag filter is set and node doesn't have it, skip
    if (options.tag && !sameTag) continue;

    const isEnt = isEntityById(db, row.id);

    const confidence = calculateFuzzyConfidence(normalized, row.name, {
      sameTag,
      isEntity: isEnt,
    });

    if (confidence > 0) {
      candidates.push({
        id: row.id,
        name: row.name,
        tags,
        confidence,
        matchType: 'fuzzy',
        matchDetails: {
          levenshteinDistance: levenshtein(
            normalized,
            row.name.toLowerCase()
          ),
          ftsRank: row.rank,
        },
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// =============================================================================
// Semantic Matching
// =============================================================================

/**
 * Find nodes using vector similarity search.
 * Gracefully degrades when embeddings are unavailable.
 */
export async function findSemanticMatches(
  db: Database,
  query: string,
  options: { tag?: string; limit?: number; workspace?: string } = {}
): Promise<{ candidates: ResolvedCandidate[]; available: boolean }> {
  try {
    const { TanaEmbeddingService } = await import(
      '../embeddings/tana-embedding-service'
    );
    const { resolveWorkspaceContext } = await import(
      '../config/workspace-resolver'
    );

    const ws = resolveWorkspaceContext({ workspace: options.workspace });

    // Check if embeddings DB exists
    const embeddingsPath = ws.dbPath.replace('tana-index.db', 'embeddings');
    const { existsSync } = await import('fs');
    if (!existsSync(embeddingsPath)) {
      return { candidates: [], available: false };
    }

    const service = new TanaEmbeddingService(embeddingsPath);
    const results = await service.search(query, options.limit || 20);

    const candidates: ResolvedCandidate[] = [];
    for (const result of results) {
      const nodeRow = db
        .query('SELECT id, name FROM nodes WHERE id = ?')
        .get(result.nodeId) as NodeRow | null;

      if (!nodeRow || !nodeRow.name) continue;

      const tags = getNodeTags(db, nodeRow.id);

      // Apply tag filter
      if (
        options.tag &&
        !tags.some((t) => t.toLowerCase() === options.tag!.toLowerCase())
      ) {
        continue;
      }

      const confidence = mapSemanticToConfidence(result.similarity);
      if (confidence > 0) {
        candidates.push({
          id: nodeRow.id,
          name: nodeRow.name,
          tags,
          confidence,
          matchType: 'semantic',
          matchDetails: { cosineSimilarity: result.similarity },
        });
      }
    }

    return { candidates, available: true };
  } catch {
    // Graceful degradation: embeddings not available
    return { candidates: [], available: false };
  }
}

// =============================================================================
// Tag Helper
// =============================================================================

/**
 * Get tags applied to a node.
 */
function getNodeTags(db: Database, nodeId: string): string[] {
  const rows = withDbRetrySync(
    () =>
      db
        .query(
          'SELECT DISTINCT tag_name FROM tag_applications WHERE data_node_id = ?'
        )
        .all(nodeId) as Array<{ tag_name: string }>,
    'getNodeTags'
  );
  return rows.map((r) => r.tag_name);
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Resolve an entity: find existing nodes matching the given name.
 *
 * Pipeline: normalize → exact → fuzzy → semantic → merge → filter → action
 */
export async function resolveEntity(
  db: Database,
  query: string,
  options: ResolveOptions = {}
): Promise<ResolutionResult> {
  const threshold = options.threshold ?? DEFAULTS.threshold;
  const limit = options.limit ?? DEFAULTS.limit;
  const normalized = normalizeQuery(query);

  // Short query protection
  const shortError = validateShortQuery(normalized, options);
  if (shortError) {
    return {
      query,
      normalizedQuery: normalized,
      candidates: [],
      bestMatch: null,
      action: 'no_match',
      embeddingsAvailable: false,
    };
  }

  // Generate name variants (handles "Last, First" reversal)
  const variants = generateNameVariants(query);
  const allCandidates: ResolvedCandidate[] = [];
  let embeddingsAvailable = false;

  for (const variant of variants) {
    // Step 1: Exact match
    const exactMatches = findExactMatches(db, variant, { tag: options.tag });
    allCandidates.push(...exactMatches);

    // Fast path: if exact match found and only one, return immediately
    if (exactMatches.length === 1 && !options.exact) {
      // Still check for ambiguity — continue to see if there are more
    }

    if (!options.exact) {
      // Step 2: Fuzzy match
      const fuzzyMatches = findFuzzyMatches(db, variant, {
        tag: options.tag,
        limit: 100,
      });
      allCandidates.push(...fuzzyMatches);

      // Step 3: Semantic match (async)
      const semanticResult = await findSemanticMatches(db, variant, {
        tag: options.tag,
        limit: 20,
        workspace: options.workspace,
      });
      allCandidates.push(...semanticResult.candidates);
      if (semanticResult.available) embeddingsAvailable = true;
    }
  }

  // Step 4: Merge and deduplicate
  const merged = mergeAndDeduplicate(allCandidates, limit);

  // Step 5: Determine action
  const action = determineAction(merged, threshold);

  // Best match: highest confidence above threshold (only if matched)
  const bestMatch =
    action === 'matched' && merged.length > 0 && merged[0].confidence >= threshold
      ? merged[0]
      : null;

  return {
    query,
    normalizedQuery: normalized,
    candidates: merged,
    bestMatch,
    action,
    embeddingsAvailable,
  };
}
