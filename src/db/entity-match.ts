/**
 * Entity Match — Database Integration for Entity Resolution
 *
 * Spec: F-100 Entity Resolution
 *
 * Connects to SQLite for exact/fuzzy matching and integrates
 * with the embedding service for semantic matching.
 */

import type { Database } from 'bun:sqlite';
import {
  type ResolvedCandidate,
  type ResolutionResult,
  type ResolveOptions,
  type MatchDetails,
  normalizeQuery,
  calculateFuzzyConfidence,
  mapSemanticToConfidence,
  mergeAndDeduplicate,
  determineAction,
  generateNameVariants,
  validateShortQuery,
  escapeFTS5Query,
} from '../lib/entity-resolution';
import { isEntityById } from './entity';
import { withDbRetrySync } from './retry';

// =============================================================================
// Types
// =============================================================================

interface DbNodeRow {
  id: string;
  name: string | null;
}

interface DbTagRow {
  tag_name: string;
}

// =============================================================================
// Exact Matching
// =============================================================================

/**
 * Find nodes with exact (case-insensitive) name match.
 * Returns candidates with confidence 1.0.
 */
export function findExactMatches(
  db: Database,
  query: string,
  options?: { tag?: string }
): ResolvedCandidate[] {
  let sql: string;
  const params: (string | number)[] = [];

  if (options?.tag) {
    sql = `
      SELECT DISTINCT n.id, n.name
      FROM nodes n
      JOIN tag_applications ta ON n.id = ta.data_node_id
      WHERE LOWER(n.name) = LOWER(?) AND LOWER(ta.tag_name) = LOWER(?)
      LIMIT 50
    `;
    params.push(query, options.tag);
  } else {
    sql = `
      SELECT id, name FROM nodes
      WHERE LOWER(name) = LOWER(?)
      LIMIT 50
    `;
    params.push(query);
  }

  const rows = withDbRetrySync(() =>
    db.query(sql).all(...params)
  ) as DbNodeRow[];

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
 * Find nodes via FTS5 search, then score with Levenshtein distance.
 * Pre-filters with FTS5 to limit candidates before expensive Levenshtein.
 */
export function findFuzzyMatches(
  db: Database,
  query: string,
  options?: { tag?: string; limit?: number }
): ResolvedCandidate[] {
  const limit = options?.limit ?? 100;
  const escaped = escapeFTS5Query(query);

  // Try FTS5 first
  let rows: DbNodeRow[];
  try {
    rows = ftsSearch(db, escaped, limit, options?.tag);
  } catch {
    // FTS5 may fail on certain queries — fall back to LIKE
    rows = likeSearch(db, query, limit, options?.tag);
  }

  if (rows.length === 0) {
    // Also try LIKE as a fallback if FTS returned nothing
    rows = likeSearch(db, query, limit, options?.tag);
  }

  return rows
    .filter((r) => r.name !== null)
    .map((row) => {
      const tags = getNodeTags(db, row.id);
      const sameTag = options?.tag
        ? tags.some((t) => t.toLowerCase() === options.tag!.toLowerCase())
        : false;
      const entity = isEntityById(db, row.id);
      const confidence = calculateFuzzyConfidence(query, row.name!, {
        sameTag,
        isEntity: entity,
      });
      const dist = levenshteinDist(query.toLowerCase(), row.name!.toLowerCase());

      return {
        id: row.id,
        name: row.name!,
        tags,
        confidence,
        matchType: 'fuzzy' as const,
        matchDetails: {
          levenshteinDistance: dist,
        } as MatchDetails,
      };
    })
    .filter((c) => c.confidence > 0);
}

/** FTS5 search helper */
function ftsSearch(
  db: Database,
  escapedQuery: string,
  limit: number,
  tag?: string
): DbNodeRow[] {
  if (tag) {
    return withDbRetrySync(() =>
      db
        .query(
          `SELECT DISTINCT n.id, n.name
           FROM nodes n
           JOIN nodes_fts ON nodes_fts.rowid = n.rowid
           JOIN tag_applications ta ON n.id = ta.data_node_id
           WHERE nodes_fts MATCH ? AND LOWER(ta.tag_name) = LOWER(?)
           LIMIT ?`
        )
        .all(escapedQuery, tag, limit)
    ) as DbNodeRow[];
  }

  return withDbRetrySync(() =>
    db
      .query(
        `SELECT n.id, n.name
         FROM nodes n
         JOIN nodes_fts ON nodes_fts.rowid = n.rowid
         WHERE nodes_fts MATCH ?
         LIMIT ?`
      )
      .all(escapedQuery, limit)
  ) as DbNodeRow[];
}

/** LIKE fallback search helper */
function likeSearch(
  db: Database,
  query: string,
  limit: number,
  tag?: string
): DbNodeRow[] {
  const pattern = `%${query}%`;

  if (tag) {
    return withDbRetrySync(() =>
      db
        .query(
          `SELECT DISTINCT n.id, n.name
           FROM nodes n
           JOIN tag_applications ta ON n.id = ta.data_node_id
           WHERE n.name LIKE ? AND LOWER(ta.tag_name) = LOWER(?)
           LIMIT ?`
        )
        .all(pattern, tag, limit)
    ) as DbNodeRow[];
  }

  return withDbRetrySync(() =>
    db
      .query(
        `SELECT id, name FROM nodes
         WHERE name LIKE ?
         LIMIT ?`
      )
      .all(pattern, limit)
  ) as DbNodeRow[];
}

// =============================================================================
// Semantic Matching
// =============================================================================

/**
 * Find matches via vector similarity search.
 * Returns empty array if embeddings are not available (graceful degradation).
 */
export async function findSemanticMatches(
  query: string,
  options?: { workspace?: string; limit?: number; tag?: string; db?: Database }
): Promise<{ candidates: ResolvedCandidate[]; available: boolean }> {
  try {
    // Dynamic import to avoid hard dependency
    const { TanaEmbeddingService } = await import(
      '../embeddings/tana-embedding-service'
    );
    const { resolveWorkspaceContext } = await import(
      '../config/workspace-resolver'
    );
    const { getModelDimensionsFromResona } = await import(
      '../embeddings/embed-config-new'
    );
    const { existsSync } = await import('node:fs');

    const ws = resolveWorkspaceContext({ workspace: options?.workspace });

    // Check if embedding database exists
    const embedPath = ws.dbPath.replace('tana-index.db', 'embeddings');
    if (!existsSync(embedPath)) {
      return { candidates: [], available: false };
    }

    const dims = getModelDimensionsFromResona();
    const service = new TanaEmbeddingService({
      databasePath: ws.dbPath,
      embeddingDimensions: dims,
    });

    const results = await service.search(query, {
      limit: options?.limit ?? 20,
    });

    const candidates: ResolvedCandidate[] = results.map((r: { id: string; text?: string; similarity?: number; distance?: number }) => {
      const confidence = mapSemanticToConfidence(r.similarity ?? 0);
      const tags = options?.db ? getNodeTags(options.db, r.id) : [];
      return {
        id: r.id,
        name: r.text || r.id,
        tags,
        confidence,
        matchType: 'semantic' as const,
        matchDetails: {
          cosineSimilarity: r.similarity,
        } as MatchDetails,
      };
    });

    // Filter by tag if specified
    const filtered = options?.tag
      ? candidates.filter((c) =>
          c.tags.some((t) => t.toLowerCase() === options.tag!.toLowerCase())
        )
      : candidates;

    return { candidates: filtered.filter((c) => c.confidence > 0), available: true };
  } catch {
    // Embedding service not available or errored — graceful degradation
    return { candidates: [], available: false };
  }
}

// =============================================================================
// Orchestration
// =============================================================================

/**
 * Main entity resolution orchestrator.
 * Runs exact → fuzzy → semantic matching, merges results, determines action.
 */
export async function resolveEntity(
  db: Database,
  name: string,
  options: ResolveOptions = {}
): Promise<ResolutionResult> {
  const threshold = options.threshold ?? 0.85;
  const limit = options.limit ?? 5;
  const normalized = normalizeQuery(name);

  // Validate short queries
  const validationError = validateShortQuery(normalized, options);
  if (validationError) {
    return {
      query: name,
      normalizedQuery: normalized,
      candidates: [],
      bestMatch: null,
      action: 'no_match',
      embeddingsAvailable: false,
    };
  }

  // Generate name variants (handles "Last, First" patterns)
  const variants = generateNameVariants(normalized);

  // Phase 1: Exact match (fast path)
  let allCandidates: ResolvedCandidate[] = [];
  for (const variant of variants) {
    const exactMatches = findExactMatches(db, variant, { tag: options.tag });
    allCandidates.push(...exactMatches);
  }

  // Fast path: if we have a single exact match, we're done
  if (!options.exact) {
    // Phase 2: Fuzzy match
    for (const variant of variants) {
      const fuzzyMatches = findFuzzyMatches(db, variant, {
        tag: options.tag,
        limit: 100,
      });
      allCandidates.push(...fuzzyMatches);
    }

    // Phase 3: Semantic match (optional, may not be available)
    const semanticResult = await findSemanticMatches(normalized, {
      workspace: options.workspace,
      limit: 20,
      tag: options.tag,
      db,
    });
    allCandidates.push(...semanticResult.candidates);

    // Merge and deduplicate
    const merged = mergeAndDeduplicate(allCandidates, limit);
    const action = determineAction(merged, threshold);
    const bestMatch =
      action === 'matched' && merged.length > 0 ? merged[0] : null;

    return {
      query: name,
      normalizedQuery: normalized,
      candidates: merged,
      bestMatch,
      action,
      embeddingsAvailable: semanticResult.available,
    };
  }

  // Exact-only mode
  const merged = mergeAndDeduplicate(allCandidates, limit);
  const action = determineAction(merged, threshold);
  const bestMatch =
    action === 'matched' && merged.length > 0 ? merged[0] : null;

  return {
    query: name,
    normalizedQuery: normalized,
    candidates: merged,
    bestMatch,
    action,
    embeddingsAvailable: false,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/** Get all tag names for a node */
function getNodeTags(db: Database, nodeId: string): string[] {
  try {
    const rows = withDbRetrySync(() =>
      db
        .query('SELECT tag_name FROM tag_applications WHERE data_node_id = ?')
        .all(nodeId)
    ) as DbTagRow[];
    return rows.map((r) => r.tag_name);
  } catch {
    return [];
  }
}

/** Calculate Levenshtein distance (imported from fastest-levenshtein) */
function levenshteinDist(a: string, b: string): number {
  const { distance } = require('fastest-levenshtein');
  return distance(a, b);
}
