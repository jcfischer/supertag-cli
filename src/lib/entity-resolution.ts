/**
 * Entity Resolution - Core Types and Pure Functions
 *
 * Find-or-create primitive with confidence thresholds for AI-maintained
 * knowledge graph workflows. Combines exact, fuzzy, and semantic matching
 * to determine if a node already exists in Tana.
 *
 * Spec: F-100 Entity Resolution
 */

import { distance as levenshtein } from 'fastest-levenshtein';

// =============================================================================
// Types
// =============================================================================

/** Match strategy that found this candidate */
export type MatchType = 'exact' | 'fuzzy' | 'semantic';

/** Raw scoring data for debugging and transparency */
export interface MatchDetails {
  levenshteinDistance?: number;
  ftsRank?: number;
  cosineSimilarity?: number;
}

/** A single candidate match from the resolution pipeline */
export interface ResolvedCandidate {
  id: string;
  name: string;
  tags: string[];
  confidence: number;
  matchType: MatchType;
  matchDetails: MatchDetails;
}

/** Resolution outcome determines next action */
export type ResolutionAction = 'matched' | 'ambiguous' | 'no_match';

/** Complete result from the resolution pipeline */
export interface ResolutionResult {
  query: string;
  normalizedQuery: string;
  candidates: ResolvedCandidate[];
  bestMatch: ResolvedCandidate | null;
  action: ResolutionAction;
  embeddingsAvailable: boolean;
}

/** Options for the resolve operation */
export interface ResolveOptions {
  tag?: string;
  threshold?: number;
  limit?: number;
  exact?: boolean;
  createIfMissing?: boolean;
  workspace?: string;
}

/** Default values */
export const DEFAULTS = {
  threshold: 0.85,
  limit: 5,
} as const;

// =============================================================================
// Query Normalization
// =============================================================================

/**
 * Normalize a query string for matching.
 *
 * - Trims whitespace
 * - Lowercases
 * - Removes punctuation (preserves hyphens, apostrophes, accented letters)
 * - Collapses multiple spaces
 */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    // Remove punctuation except hyphens, apostrophes, and word characters
    // Preserve Unicode letters (accented chars, CJK, etc.)
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================
// Confidence Scoring
// =============================================================================

/**
 * Calculate fuzzy confidence using Levenshtein distance.
 *
 * Formula: 1.0 - (distance / max(queryLength, candidateLength))
 * Boosted by +0.10 for same tag, +0.05 for entity.
 * Capped at 0.95 (only exact match gets 1.0).
 */
export function calculateFuzzyConfidence(
  query: string,
  candidateName: string,
  options: { sameTag?: boolean; isEntity?: boolean } = {}
): number {
  const q = query.toLowerCase();
  const c = candidateName.toLowerCase();
  const dist = levenshtein(q, c);
  const maxLen = Math.max(q.length, c.length);

  if (maxLen === 0) return 0;

  let score = 1.0 - dist / maxLen;

  if (options.sameTag) score += 0.10;
  if (options.isEntity) score += 0.05;

  return Math.min(0.95, Math.max(0, score));
}

/**
 * Map cosine similarity to confidence score.
 *
 * Cosine similarity < 0.5 → 0 confidence.
 * Linear scale: 0.5 → 0, 1.0 → 0.95.
 */
export function mapSemanticToConfidence(cosineSimilarity: number): number {
  if (cosineSimilarity < 0.5) return 0;
  return Math.min(0.95, (cosineSimilarity - 0.5) * 1.9);
}

// =============================================================================
// Merge & Deduplicate
// =============================================================================

/**
 * Combine candidates from multiple match strategies.
 *
 * Deduplicates by node ID, keeping the highest confidence match.
 * Sorts by confidence descending. Applies limit.
 */
export function mergeAndDeduplicate(
  candidates: ResolvedCandidate[],
  limit?: number
): ResolvedCandidate[] {
  const byId = new Map<string, ResolvedCandidate>();

  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing || candidate.confidence > existing.confidence) {
      byId.set(candidate.id, candidate);
    }
  }

  const sorted = Array.from(byId.values()).sort(
    (a, b) => b.confidence - a.confidence
  );

  return limit !== undefined ? sorted.slice(0, limit) : sorted;
}

// =============================================================================
// Action Determination
// =============================================================================

/**
 * Determine resolution action based on candidates and threshold.
 *
 * - 0 above threshold → no_match
 * - 1 above threshold → matched
 * - Multiple: if gap between top two >= 0.1 → matched, else ambiguous
 */
export function determineAction(
  candidates: ResolvedCandidate[],
  threshold: number
): ResolutionAction {
  const aboveThreshold = candidates.filter((c) => c.confidence >= threshold);

  if (aboveThreshold.length === 0) return 'no_match';
  if (aboveThreshold.length === 1) return 'matched';

  const [first, second] = aboveThreshold;
  if (first.confidence - second.confidence >= 0.1) return 'matched';

  return 'ambiguous';
}

// =============================================================================
// Name Variants (Edge Cases)
// =============================================================================

/**
 * Generate name variants for resolution.
 *
 * Handles "Last, First" → "First Last" reversal.
 * Returns original + any variants (deduplicated).
 */
export function generateNameVariants(name: string): string[] {
  const variants = [name];

  // Handle "Last, First" pattern
  if (name.includes(',')) {
    const parts = name.split(',').map((p) => p.trim());
    if (parts.length === 2 && parts[0] && parts[1]) {
      variants.push(`${parts[1]} ${parts[0]}`);
    }
  }

  // Handle "First Last" → try "Last, First" (reverse lookup)
  const words = name.trim().split(/\s+/);
  if (words.length === 2 && !name.includes(',')) {
    variants.push(`${words[1]}, ${words[0]}`);
  }

  return [...new Set(variants)];
}

// =============================================================================
// Short Query Protection
// =============================================================================

/**
 * Validate short queries require --exact or --tag.
 *
 * Returns null if valid, error message if invalid.
 */
export function validateShortQuery(
  normalizedQuery: string,
  options: ResolveOptions
): string | null {
  if (normalizedQuery.length < 3 && !options.exact && !options.tag) {
    return 'Query is too short (< 3 characters). Use --exact or --tag to narrow results.';
  }
  return null;
}

// =============================================================================
// FTS5 Escaping
// =============================================================================

/**
 * Escape special characters for FTS5 queries.
 *
 * Wraps terms in double quotes to prevent FTS5 operator interpretation.
 */
export function escapeFTS5Query(query: string): string {
  // If query contains special FTS5 characters, wrap in double quotes
  const specialChars = /["\*\^\(\):]/;
  if (specialChars.test(query)) {
    // Escape internal double quotes by doubling them
    const escaped = query.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  // Also quote if query contains FTS5 boolean operators
  const ftsOperators = /\b(AND|OR|NOT|NEAR)\b/;
  if (ftsOperators.test(query)) {
    return `"${query}"`;
  }

  return query;
}
