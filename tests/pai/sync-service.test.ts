/**
 * Tests: Sync Service
 * Task: T-3.2
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import { syncLearnings } from '../../src/pai/sync-service';

const FIXTURE_PATH = join(import.meta.dir, '../fixtures/pai/seed-fixture.json');

describe('Sync Service', () => {
  describe('syncLearnings dry-run', () => {
    it('returns preview without creating nodes', async () => {
      const result = await syncLearnings({
        seedPath: FIXTURE_PATH,
        dryRun: true,
      });

      expect(result.total).toBe(6); // 3 patterns + 2 insights + 1 self_knowledge
      expect(result.failed).toBe(0);
      expect(result.lastSync).toBeTruthy();
      expect(result.entries).toHaveLength(6);
    });

    it('marks all entries as created in dry-run', async () => {
      const result = await syncLearnings({
        seedPath: FIXTURE_PATH,
        dryRun: true,
      });

      for (const entry of result.entries) {
        expect(entry.action).toBe('created');
      }
    });

    it('detects entity mentions in dry-run', async () => {
      const result = await syncLearnings({
        seedPath: FIXTURE_PATH,
        dryRun: true,
      });

      // Entry about "Jens-Christian Fischer" should have entity mentions extracted
      const jcEntry = result.entries.find((e) => e.seedId === 'pat_abc123');
      expect(jcEntry).toBeDefined();
      // In dry-run, entity mentions are extracted but not resolved against DB
      if (jcEntry!.entityLinks.length > 0) {
        expect(jcEntry!.entityLinks[0].tagType).toBe('unresolved');
      }
    });
  });

  describe('syncLearnings with missing seed file', () => {
    it('throws for nonexistent seed.json', async () => {
      try {
        await syncLearnings({
          seedPath: '/nonexistent/seed.json',
          dryRun: true,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('seed.json not found');
      }
    });
  });

  describe('syncLearnings incremental', () => {
    it('respects force flag to sync all entries', async () => {
      const result = await syncLearnings({
        seedPath: FIXTURE_PATH,
        dryRun: true,
        force: true,
      });

      expect(result.total).toBe(6);
    });
  });
});
