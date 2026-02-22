/**
 * Entity Resolution — Core Types and Pure Functions
 *
 * Spec: F-100 Entity Resolution
 *
 * Provides a find-or-create primitive with confidence thresholds
 * for AI-maintained knowledge graph workflows. This module contains
 * only pure functions with no I/O dependencies.
 */

import { distance as levenshteinDistance } from 'fastest-levenshtein';

// =============================================================================
// Types
// =============================================================================

/** Match type identifies which strategy found this candidate */
export type MatchType = 'exact' | 'fuzzy' | 'semantic';

/** Details about how the match was scored */
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

// =============================================================================
// Query Normalization
// =============================================================================

/**
 * Normalize a query string for matching.
 * Preserves hyphens and apostrophes (common in names).
 * Preserves Unicode/accented characters.
 */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    // Remove punctuation except hyphens, apostrophes, and commas (for name reversal)
    .replace(/[^\p{L}\p{N}\s\-',]/gu, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================
// Confidence Scoring
// =============================================================================

/** Options for fuzzy confidence calculation */
export interface FuzzyConfidenceOptions {
  sameTag?: boolean;
  isEntity?: boolean;
}

/**
 * Calculate fuzzy match confidence using Levenshtein distance.
 *
 * Base: 1.0 - (distance / max(queryLength, candidateLength))
 * Boosts: +0.10 for matching tag, +0.05 for entity status
 * Capped at 0.95 (only exact match gets 1.0)
 */
export function calculateFuzzyConfidence(
  query: string,
  candidateName: string,
  options: FuzzyConfidenceOptions = {}
): number {
  const q = query.toLowerCase();
  const c = candidateName.toLowerCase();
  const dist = levenshteinDistance(q, c);
  const maxLen = Math.max(q.length, c.length);

  if (maxLen === 0) return 0;

  let score = 1.0 - dist / maxLen;

  if (options.sameTag) score += 0.10;
  if (options.isEntity) score += 0.05;

  return Math.min(0.95, Math.max(0, score));
}

/**
 * Map cosine similarity (0-1) to confidence (0-0.95).
 * Values below 0.5 cosine similarity map to 0 confidence.
 */
export function mapSemanticToConfidence(cosineSimilarity: number): number {
  if (cosineSimilarity < 0.5) return 0;
  return Math.min(0.95, (cosineSimilarity - 0.5) * 1.9);
}

// =============================================================================
// Merge & Deduplication
// =============================================================================

/**
 * Merge candidates from multiple strategies, keeping highest confidence per node ID.
 * Returns sorted by confidence descending, limited to `limit` results.
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

  return limit ? sorted.slice(0, limit) : sorted;
}

// =============================================================================
// Action Determination
// =============================================================================

/**
 * Determine resolution action based on candidates and threshold.
 *
 * - no_match: no candidates above threshold
 * - matched: one candidate clearly above threshold (or top is 0.1+ above second)
 * - ambiguous: multiple candidates near threshold with no clear winner
 */
export function determineAction(
  candidates: ResolvedCandidate[],
  threshold: number
): ResolutionAction {
  const aboveThreshold = candidates.filter((c) => c.confidence >= threshold);

  if (aboveThreshold.length === 0) return 'no_match';
  if (aboveThreshold.length === 1) return 'matched';

  // Multiple candidates: check if top is significantly better
  const [first, second] = aboveThreshold;
  if (first.confidence - second.confidence >= 0.1) return 'matched';

  return 'ambiguous';
}

// =============================================================================
// Name Variants
// =============================================================================

/**
 * Generate name variants for resolution.
 * Handles "Last, First" → "First Last" reversal.
 * Returns original + any variants (deduplicated).
 */
export function generateNameVariants(name: string): string[] {
  const variants = [name];

  // "Last, First" → "First Last"
  if (name.includes(',')) {
    const parts = name.split(',').map((p) => p.trim());
    if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
      variants.push(`${parts[1]} ${parts[0]}`);
    }
  }

  // "First Last" → also try "Last, First" for matching
  const words = name.split(/\s+/);
  if (words.length === 2 && !name.includes(',')) {
    variants.push(`${words[1]}, ${words[0]}`);
  }

  return [...new Set(variants)];
}

// =============================================================================
// Short Query Validation
// =============================================================================

/**
 * Validate that short queries have appropriate constraints.
 * Queries < 3 characters require --exact or --tag to avoid false positives.
 *
 * @returns null if valid, error message if invalid
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
 * Wraps terms in double quotes to prevent FTS5 operator interpretation.
 */
export function escapeFTS5Query(query: string): string {
  // If query contains FTS5 special chars, quote it
  if (/["\*\^():]/.test(query) || /\b(AND|OR|NOT|NEAR)\b/i.test(query)) {
    // Escape internal double quotes
    const escaped = query.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return query;
}
