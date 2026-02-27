/**
 * Tests: Context Service
 * Task: T-4.1
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import { getPaiContext } from '../../src/pai/context-service';

describe('Context Service', () => {
  describe('getPaiContext', () => {
    it('returns context from seed.json fallback for matching topic', async () => {
      // Without Tana running, this should fall back to seed.json-only mode
      // This test verifies the fallback path works
      const result = await getPaiContext('German', {
        maxTokens: 2000,
      });

      // Should find learnings about "German" from seed.json
      // Falls back to seed-only if Tana unavailable
      expect(result).toHaveProperty('learnings');
      expect(result).toHaveProperty('relatedNodes');
      expect(result).toHaveProperty('tokenCount');
      expect(Array.isArray(result.learnings)).toBe(true);
    });

    it('returns empty for non-matching topic', async () => {
      const result = await getPaiContext('xyznonexistenttopic12345', {
        maxTokens: 2000,
      });

      expect(result.learnings).toHaveLength(0);
    });

    it('filters by type when specified', async () => {
      const result = await getPaiContext('', {
        maxTokens: 5000,
        type: 'pattern',
      });

      // All returned learnings should be patterns (or empty if no match)
      for (const learning of result.learnings) {
        expect(learning.type).toBe('pattern');
      }
    });

    it('respects token budget', async () => {
      const result = await getPaiContext('', {
        maxTokens: 10, // Very small budget
      });

      // Token count should be small
      expect(result.tokenCount).toBeLessThanOrEqual(50); // Some tolerance
    });

    it('includes token count in response', async () => {
      const result = await getPaiContext('deploy', {
        maxTokens: 2000,
      });

      expect(typeof result.tokenCount).toBe('number');
      expect(result.tokenCount).toBeGreaterThanOrEqual(0);
    });
  });
});
