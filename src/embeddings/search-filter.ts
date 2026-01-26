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
export function isReferenceSyntax(name: string): boolean {
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
  const tagKey = tags ? tags.sort().join(",") : "";
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
          .get(r.nodeId) as { name: string } | null,
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
        name: node.name,
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
