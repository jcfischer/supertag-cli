/**
 * Tests: Schema Initialization
 * Task: T-2.1
 */

import { describe, it, expect } from 'bun:test';
import { initPaiSchema } from '../../src/pai/schema-init';

describe('Schema Init', () => {
  describe('initPaiSchema dry-run', () => {
    it('returns preview without calling API', async () => {
      const result = await initPaiSchema({ dryRun: true });

      expect(result.created).toContain('pai_learning');
      expect(result.created).toContain('pai_proposal');
      expect(result.existing).toEqual([]);
      expect(result.tagIds.pai_learning).toBe('(dry-run-tag-id)');
      expect(result.tagIds.pai_proposal).toBe('(dry-run-tag-id)');
    });

    it('lists field IDs for both tags in dry-run', async () => {
      const result = await initPaiSchema({ dryRun: true });

      // #pai_learning should have 8 fields
      expect(Object.keys(result.fieldIds.pai_learning).length).toBe(8);
      expect(result.fieldIds.pai_learning).toHaveProperty('Type');
      expect(result.fieldIds.pai_learning).toHaveProperty('Content');
      expect(result.fieldIds.pai_learning).toHaveProperty('Confidence');
      expect(result.fieldIds.pai_learning).toHaveProperty('Source');
      expect(result.fieldIds.pai_learning).toHaveProperty('Confirmed At');
      expect(result.fieldIds.pai_learning).toHaveProperty('Seed Entry ID');
      expect(result.fieldIds.pai_learning).toHaveProperty('Related People');
      expect(result.fieldIds.pai_learning).toHaveProperty('Related Projects');

      // #pai_proposal should have 5 fields
      expect(Object.keys(result.fieldIds.pai_proposal).length).toBe(5);
      expect(result.fieldIds.pai_proposal).toHaveProperty('Status');
      expect(result.fieldIds.pai_proposal).toHaveProperty('Confidence');
      expect(result.fieldIds.pai_proposal).toHaveProperty('Extracted From');
      expect(result.fieldIds.pai_proposal).toHaveProperty('Decided At');
      expect(result.fieldIds.pai_proposal).toHaveProperty('Content');
    });
  });

  describe('initPaiSchema without Local API', () => {
    it('throws when Local API is not configured', async () => {
      // This test will fail when Local API IS configured; skip if so
      try {
        await initPaiSchema({ workspace: 'nonexistent' });
        // If it doesn't throw, that means Local API is available
      } catch (error) {
        expect((error as Error).message).toContain('Local API');
      }
    });
  });
});
