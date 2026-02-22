/**
 * Relevance Scorer Service (Spec F-098)
 *
 * Scores nodes by relevance using:
 * - Graph distance (closer = more relevant)
 * - Semantic similarity (when embeddings available)
 * - Recency (recently modified = more relevant)
 *
 * Weights:
 *   With embeddings:    40% distance + 35% semantic + 25% recency
 *   Without embeddings: 60% distance + 40% recency
 */

import type { RelevanceScore, ScoringOptions } from '../types/context';

/** Weight configuration for scoring */
const WEIGHTS_WITH_EMBEDDINGS = {
  distance: 0.4,
  semantic: 0.35,
  recency: 0.25,
};

const WEIGHTS_WITHOUT_EMBEDDINGS = {
  distance: 0.6,
  recency: 0.4,
};

/**
 * Calculate relevance score for a node.
 *
 * @param distance - Graph distance from source node (0 = source itself)
 * @param semanticSim - Semantic similarity score (0-1), undefined if not available
 * @param createdTimestamp - Node creation timestamp (ISO string or epoch ms)
 * @param options - Scoring configuration
 * @returns RelevanceScore with total and component breakdown
 */
export function scoreNode(
  distance: number,
  semanticSim: number | undefined,
  createdTimestamp: string | number | undefined,
  options: ScoringOptions,
): RelevanceScore {
  // Distance score: 1/(distance+1) so source node gets 1.0
  const distanceScore = 1 / (distance + 1);

  // Recency score: decay over time (30 days = half-life)
  const recencyScore = calculateRecency(createdTimestamp);

  if (options.embeddingsAvailable && semanticSim !== undefined) {
    const total =
      distanceScore * WEIGHTS_WITH_EMBEDDINGS.distance +
      semanticSim * WEIGHTS_WITH_EMBEDDINGS.semantic +
      recencyScore * WEIGHTS_WITH_EMBEDDINGS.recency;

    return {
      total: Math.min(1, Math.max(0, total)),
      components: {
        graphDistance: distanceScore,
        semanticSim,
        recency: recencyScore,
      },
    };
  }

  const total =
    distanceScore * WEIGHTS_WITHOUT_EMBEDDINGS.distance +
    recencyScore * WEIGHTS_WITHOUT_EMBEDDINGS.recency;

  return {
    total: Math.min(1, Math.max(0, total)),
    components: {
      graphDistance: distanceScore,
      recency: recencyScore,
    },
  };
}

/**
 * Calculate recency score (0-1).
 * Uses exponential decay with 30-day half-life.
 * Returns 0.5 if no timestamp available.
 */
function calculateRecency(timestamp: string | number | undefined): number {
  if (!timestamp) return 0.5;

  const now = Date.now();
  const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;

  if (isNaN(ts)) return 0.5;

  const ageMs = now - ts;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay: score = e^(-age/halfLife)
  const halfLifeDays = 30;
  return Math.exp(-ageDays / halfLifeDays);
}

/**
 * Score and sort nodes by relevance.
 */
export function scoreAndSort(
  nodes: Array<{ distance: number; semanticSim?: number; created?: string }>,
  options: ScoringOptions,
): Array<{ index: number; score: RelevanceScore }> {
  return nodes
    .map((node, index) => ({
      index,
      score: scoreNode(node.distance, node.semanticSim, node.created, options),
    }))
    .sort((a, b) => b.score.total - a.score.total);
}
