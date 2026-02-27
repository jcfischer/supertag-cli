/**
 * Tests: Seed.json Reader
 * Task: T-1.2
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import {
  readSeedFile,
  getConfirmedLearnings,
  getNewLearningsSince,
} from '../../src/pai/seed-reader';

const FIXTURE_PATH = join(import.meta.dir, '../fixtures/pai/seed-fixture.json');

describe('Seed Reader', () => {
  describe('readSeedFile', () => {
    it('parses valid seed.json fixture', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      expect(seed.learned.patterns).toHaveLength(3);
      expect(seed.learned.insights).toHaveLength(2);
      expect(seed.learned.selfKnowledge).toHaveLength(1);
    });

    it('preserves identity section', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      expect(seed.identity).toBeDefined();
      expect((seed.identity as Record<string, unknown>)?.principalName).toBe('Jens-Christian');
    });

    it('throws for missing file', () => {
      expect(() => readSeedFile('/nonexistent/path/seed.json')).toThrow('seed.json not found');
    });

    it('preserves unknown fields', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      expect(seed.version).toBe('2.1');
    });
  });

  describe('getConfirmedLearnings', () => {
    it('extracts all confirmed entries across categories', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      const learnings = getConfirmedLearnings(seed);

      // 3 patterns + 2 insights + 1 self_knowledge = 6
      expect(learnings).toHaveLength(6);
    });

    it('correctly labels learning types', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      const learnings = getConfirmedLearnings(seed);

      const types = learnings.map((l) => l.type);
      expect(types.filter((t) => t === 'pattern')).toHaveLength(3);
      expect(types.filter((t) => t === 'insight')).toHaveLength(2);
      expect(types.filter((t) => t === 'self_knowledge')).toHaveLength(1);
    });

    it('populates seedId from entry id', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      const learnings = getConfirmedLearnings(seed);

      expect(learnings[0].seedId).toBe('pat_abc123');
    });

    it('includes tags from entries', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      const learnings = getConfirmedLearnings(seed);

      const first = learnings.find((l) => l.seedId === 'pat_abc123');
      expect(first?.tags).toEqual(['communication', 'language']);
    });

    it('returns empty array for empty categories', () => {
      const emptySeed = {
        learned: {
          patterns: [],
          insights: [],
          selfKnowledge: [],
        },
      } as ReturnType<typeof readSeedFile>;

      const learnings = getConfirmedLearnings(emptySeed);
      expect(learnings).toEqual([]);
    });
  });

  describe('getNewLearningsSince', () => {
    it('filters entries confirmed after lastSync', () => {
      const seed = readSeedFile(FIXTURE_PATH);

      // Only entries after Feb 15 should be included
      const newLearnings = getNewLearningsSince(seed, '2026-02-15T12:00:00Z');

      // pat_ghi789 (Feb 20), ins_mno345 (Feb 18) = 2 entries
      expect(newLearnings.length).toBeGreaterThanOrEqual(2);
      for (const l of newLearnings) {
        expect(l.confirmedAt > '2026-02-15T12:00:00Z').toBe(true);
      }
    });

    it('returns all entries if lastSync is empty', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      const all = getNewLearningsSince(seed, '');
      expect(all).toHaveLength(6);
    });

    it('returns empty array if all entries are before lastSync', () => {
      const seed = readSeedFile(FIXTURE_PATH);
      const none = getNewLearningsSince(seed, '2099-01-01T00:00:00Z');
      expect(none).toEqual([]);
    });
  });
});
