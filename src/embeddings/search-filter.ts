/**
 * Search Result Filtering
 *
 * Shared filtering and deduplication logic for semantic search results.
 * Used by CLI, MCP tool, and webhook server.
 */

import type { Database } from "bun:sqlite";
import { withDbRetrySync } from "../db/retry";

/**
 * Raw search result from the embedding service
 */
export interface RawSearchResult {
  nodeId: string;
  distance: number;
}

/**
 * The slice of TanaEmbeddingService that semantic search uses
 */
export interface SemanticEmbeddingService {
  search(query: string, k: number): Promise<Array<RawSearchResult & { similarity: number }>>;
  getStats(): Promise<{ totalEmbeddings: number }>;
  close(): void;
}

/**
 * Injection points for the semantic search surfaces (CLI and MCP)
 */
export interface SemanticSearchDeps {
  /** Skip workspace resolution and use this alias and database */
  workspace?: { alias: string; dbPath: string };
  /** Build the embedding service for a LanceDB path */
  openEmbeddingService?: (lanceDbPath: string) => SemanticEmbeddingService;
}

/**
 * Enriched search result with name and tags
 */
export interface EnrichedSearchResult extends RawSearchResult {
  name: string;
  tags?: string[];
  similarity: number;
}

/**
 * Check if a name looks like reference syntax (e.g., "[[Something]]")
 * These are text artifacts, not actual content nodes
 */
export function isReferenceSyntax(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.includes("[[") && name.includes("]]");
}

/**
 * Create a deduplication key from name and tags
 * Nodes with same name but different tags are kept separate
 */
function getDeduplicationKey(name: string, tags?: string[]): string {
  const normalizedName = name
    .replace(/^\s*-?\s*/, "") // Remove leading whitespace and bullets
    .replace(/\[\[|\]\]/g, "") // Remove brackets
    .trim()
    .toLowerCase();

  // Include sorted tags in the key so "Animal #topic" != "Animal #concept"
  const tagKey = tags ? [...tags].sort().join(",") : "";
  return `${normalizedName}|${tagKey}`;
}

/**
 * Enrich raw search results with node names and tags
 */
export function enrichSearchResults(
  db: Database,
  results: RawSearchResult[]
): EnrichedSearchResult[] {
  const enriched: EnrichedSearchResult[] = [];

  for (const r of results) {
    const node = withDbRetrySync(
      () =>
        db
          .query("SELECT name FROM nodes WHERE id = ?")
          .get(r.nodeId) as { name: string | null } | null,
      "enrichSearchResults getNode"
    );

    if (node) {
      const tags = withDbRetrySync(
        () =>
          db
            .query(
              `SELECT DISTINCT tag_name as name
               FROM tag_applications
               WHERE data_node_id = ?`
            )
            .all(r.nodeId) as { name: string }[],
        "enrichSearchResults getTags"
      );

      enriched.push({
        nodeId: r.nodeId,
        distance: r.distance,
        similarity: 1 - r.distance,
        // nodes.name is nullable in the DB (source/container nodes); the
        // EnrichedSearchResult.name contract is string, so coalesce here to
        // stop null propagating into isReferenceSyntax/getDeduplicationKey.
        name: node.name ?? "",
        tags: tags.length > 0 ? tags.map((t) => t.name) : undefined,
      });
    }
  }

  return enriched;
}

/**
 * Filter out reference-syntax text nodes
 */
export function filterReferenceSyntax(
  results: EnrichedSearchResult[]
): EnrichedSearchResult[] {
  return results.filter((r) => !isReferenceSyntax(r.name));
}

/**
 * Filter results to only include nodes with a specific tag
 * Tag comparison is case-insensitive
 */
export function filterByTag(
  results: EnrichedSearchResult[],
  tagName: string
): EnrichedSearchResult[] {
  const lowerTag = tagName.toLowerCase();
  return results.filter((r) =>
    r.tags?.some((t) => t.toLowerCase() === lowerTag)
  );
}

/**
 * Deduplicate results by name+tags, keeping highest similarity
 * Nodes with same name but different tags are preserved
 */
export function deduplicateResults(
  results: EnrichedSearchResult[]
): EnrichedSearchResult[] {
  const seen = new Map<string, EnrichedSearchResult>();

  for (const result of results) {
    const key = getDeduplicationKey(result.name, result.tags);
    const existing = seen.get(key);

    // Keep the result with higher similarity
    if (!existing || result.similarity > existing.similarity) {
      seen.set(key, result);
    }
  }

  // Return in similarity order
  return Array.from(seen.values()).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Calculate how many results to fetch to account for filtering losses
 * Over-fetches by 3x to ensure enough results after filtering/deduplication
 */
export function getOverfetchLimit(requestedLimit: number): number {
  return Math.max(requestedLimit * 3, 50);
}

/**
 * Filter and deduplicate search results
 * - Removes reference-syntax text nodes (names like "[[Something]]")
 * - Deduplicates by name+tags, keeping highest similarity
 * - Trims to requested limit
 *
 * @param db - Database connection
 * @param rawResults - Raw results from embedding service
 * @param limit - Maximum results to return (optional, returns all if not specified)
 */
export function filterAndDeduplicateResults(
  db: Database,
  rawResults: RawSearchResult[],
  limit?: number
): EnrichedSearchResult[] {
  // Enrich with names and tags
  const enriched = enrichSearchResults(db, rawResults);

  // Filter out reference-syntax nodes
  const filtered = filterReferenceSyntax(enriched);

  // Deduplicate by name+tags
  const deduplicated = deduplicateResults(filtered);

  // Apply limit if specified
  if (limit && limit > 0) {
    return deduplicated.slice(0, limit);
  }

  return deduplicated;
}

/**
 * Keep results at or above a similarity threshold (0 or unset keeps all)
 */
export function filterByMinScore<T extends { similarity: number }>(
  results: T[],
  minScore: number | undefined
): T[] {
  if (minScore === undefined || minScore === null || minScore <= 0) {
    return results;
  }
  return results.filter((r) => r.similarity >= minScore);
}

/**
 * Check if a node is deleted: it or any ancestor is owned by the trash
 * (_ownerId ending with '_TRASH')
 */
export function isNodeInTrash(db: Database, nodeId: string): boolean {
  const result = withDbRetrySync(
    () => db
      .query(`
        WITH RECURSIVE ancestor_chain AS (
          SELECT
            id,
            parent_id,
            json_extract(raw_data, '$.props._ownerId') as owner_id,
            0 as level
          FROM nodes
          WHERE id = ?

          UNION ALL

          SELECT
            n.id,
            n.parent_id,
            json_extract(n.raw_data, '$.props._ownerId') as owner_id,
            ac.level + 1
          FROM nodes n
          INNER JOIN ancestor_chain ac ON n.id = ac.parent_id
          WHERE ac.parent_id IS NOT NULL AND ac.level < 50
        )
        SELECT COUNT(*) as has_trash
        FROM ancestor_chain
        WHERE owner_id LIKE '%_TRASH'
      `)
      .get(nodeId) as { has_trash: number } | null,
    "isNodeInTrash"
  );

  return result ? result.has_trash > 0 : false;
}

export interface SemanticSearchPipelineOptions {
  /** Maximum results to return */
  limit: number;
  /** Only keep nodes with this supertag (case-insensitive) */
  tag?: string;
  /** Drop results below this similarity (0-1) */
  minSimilarity?: number;
  /** Prefix the query with [Type: #hint] (F-104) */
  typeHint?: string;
}

/**
 * Semantic search shared by the CLI and the MCP tool, so both return the
 * same nodes in the same order (#98). Callers only add presentation.
 *
 * Order: over-fetch -> enrich -> drop trashed -> drop reference syntax ->
 * tag filter -> dedup by name+tags -> similarity threshold -> limit
 */
export async function runSemanticSearchPipeline(
  embeddingService: Pick<SemanticEmbeddingService, "search">,
  db: Database,
  query: string,
  options: SemanticSearchPipelineOptions
): Promise<EnrichedSearchResult[]> {
  const effectiveQuery = options.typeHint
    ? `[Type: #${options.typeHint}] ${query}`
    : query;

  // A tag filter discards most candidates, so over-fetch harder
  const baseOverfetch = getOverfetchLimit(options.limit);
  const overfetchLimit = options.tag ? baseOverfetch * 3 : baseOverfetch;
  const rawResults = await embeddingService.search(effectiveQuery, overfetchLimit);

  const live = enrichSearchResults(db, rawResults).filter(
    (r) => !isNodeInTrash(db, r.nodeId)
  );
  const named = filterReferenceSyntax(live);
  const tagged = options.tag ? filterByTag(named, options.tag) : named;
  const deduplicated = deduplicateResults(tagged);

  return filterByMinScore(deduplicated, options.minSimilarity).slice(0, options.limit);
}
