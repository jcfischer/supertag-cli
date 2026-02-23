/**
 * Tests for Relevance Scorer Service
 * Spec F-098: Context Assembler
 */

import { describe, it, expect } from 'bun:test';
import { scoreNode, scoreAndSort } from '../../src/services/relevance-scorer';
import type { ScoringOptions } from '../../src/types/context';

describe('Relevance Scorer', () => {
  const baseOptions: ScoringOptions = {
    sourceNodeId: 'source1',
    embeddingsAvailable: false,
  };

  const optionsWithEmbeddings: ScoringOptions = {
    sourceNodeId: 'source1',
    queryText: 'test query',
    embeddingsAvailable: true,
  };

  describe('scoreNode', () => {
    it('gives distance 0 the highest distance score', () => {
      const score = scoreNode(0, undefined, undefined, baseOptions);
      expect(score.components.graphDistance).toBe(1.0); // 1/(0+1)
    });

    it('gives distance 1 lower distance score than distance 0', () => {
      const score0 = scoreNode(0, undefined, undefined, baseOptions);
      const score1 = scoreNode(1, undefined, undefined, baseOptions);
      expect(score0.total).toBeGreaterThan(score1.total);
    });

    it('decreases score with increasing distance', () => {
      const scores = [0, 1, 2, 3, 4].map(d =>
        scoreNode(d, undefined, undefined, baseOptions).total
      );
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThan(scores[i - 1]);
      }
    });

    it('returns score between 0 and 1', () => {
      const score = scoreNode(2, undefined, undefined, baseOptions);
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(1);
    });

    it('returns 0.5 recency for undefined timestamp', () => {
      const score = scoreNode(1, undefined, undefined, baseOptions);
      expect(score.components.recency).toBe(0.5);
    });

    it('gives recent nodes higher recency score', () => {
      const now = new Date().toISOString();
      const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days ago

      const recentScore = scoreNode(1, undefined, now, baseOptions);
      const oldScore = scoreNode(1, undefined, oldDate, baseOptions);

      expect(recentScore.components.recency).toBeGreaterThan(oldScore.components.recency);
    });

    it('uses 60/40 weights without embeddings', () => {
      const score = scoreNode(0, undefined, undefined, baseOptions);
      // distance=1.0*0.6 + recency=0.5*0.4 = 0.6 + 0.2 = 0.8
      expect(score.total).toBeCloseTo(0.8, 1);
    });

    it('uses 40/35/25 weights with embeddings', () => {
      const score = scoreNode(0, 1.0, undefined, optionsWithEmbeddings);
      // distance=1.0*0.4 + semantic=1.0*0.35 + recency=0.5*0.25 = 0.4 + 0.35 + 0.125 = 0.875
      expect(score.total).toBeCloseTo(0.875, 2);
    });

    it('includes semantic similarity component when available', () => {
      const score = scoreNode(1, 0.8, undefined, optionsWithEmbeddings);
      expect(score.components.semanticSim).toBe(0.8);
    });

    it('omits semantic similarity when embeddings unavailable', () => {
      const score = scoreNode(1, 0.8, undefined, baseOptions);
      expect(score.components.semanticSim).toBeUndefined();
    });
  });

  describe('scoreAndSort', () => {
    it('sorts nodes by total score descending', () => {
      const nodes = [
        { distance: 3, created: undefined },
        { distance: 0, created: undefined },
        { distance: 1, created: undefined },
      ];

      const sorted = scoreAndSort(nodes, baseOptions);
      expect(sorted[0].index).toBe(1); // distance 0
      expect(sorted[1].index).toBe(2); // distance 1
      expect(sorted[2].index).toBe(0); // distance 3
    });

    it('returns scores for all nodes', () => {
      const nodes = [
        { distance: 0 },
        { distance: 1 },
      ];

      const sorted = scoreAndSort(nodes, baseOptions);
      expect(sorted).toHaveLength(2);
    });
  });
});
