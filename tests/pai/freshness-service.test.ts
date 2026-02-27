/**
 * Tests: Freshness Service
 * Task: T-5.1
 */

import { describe, it, expect } from 'bun:test';
import { assessFreshness } from '../../src/pai/freshness-service';

describe('Freshness Service', () => {
  describe('assessFreshness', () => {
    it('returns freshness results from seed.json', async () => {
      // Without Tana, falls back to timestamp-only mode
      const results = await assessFreshness({
        threshold: 30,
      });

      // Should return results for all confirmed learnings
      expect(Array.isArray(results)).toBe(true);

      for (const result of results) {
        expect(result).toHaveProperty('seedId');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('confirmedAt');
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('daysSinceActive');
        expect(['fresh', 'stale', 'unknown']).toContain(result.status);
      }
    });

    it('filters by type', async () => {
      const results = await assessFreshness({
        threshold: 30,
        type: 'pattern',
      });

      for (const result of results) {
        expect(result.type).toBe('pattern');
      }
    });

    it('uses threshold for freshness determination', async () => {
      // Very small threshold — everything should be stale
      const results = await assessFreshness({
        threshold: 0,
      });

      for (const result of results) {
        if (result.status !== 'unknown') {
          expect(result.status).toBe('stale');
        }
      }
    });

    it('returns empty array when seed.json not available', async () => {
      // With a non-existent seed path, should return empty
      const results = await assessFreshness({
        seedPath: '/tmp/nonexistent-pai-seed-12345/seed.json',
        threshold: 30,
      });

      expect(results).toEqual([]);
    });

    it('calculates daysSinceActive correctly', async () => {
      const results = await assessFreshness({ threshold: 9999 });

      for (const result of results) {
        expect(result.daysSinceActive).toBeGreaterThanOrEqual(0);
        expect(typeof result.daysSinceActive).toBe('number');
      }
    });
  });
});
