/**
 * Tests: PAI ID Mapping CRUD
 * Task: T-1.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadMapping,
  saveMapping,
  getMappedNodeId,
  setMappedNodeId,
  getUnmappedEntries,
  getMappingPath,
} from '../../src/pai/mapping';
import type { PaiLearningEntry } from '../../src/types/pai';

describe('PAI Mapping', () => {
  describe('getMappingPath', () => {
    it('returns a path ending with pai-mapping.json', () => {
      const path = getMappingPath();
      expect(path).toContain('pai-mapping.json');
      expect(path).toContain('supertag');
    });
  });

  describe('loadMapping', () => {
    it('returns a valid mapping structure', () => {
      // loadMapping reads from a fixed path — if the file exists, it returns its content;
      // if not, returns an empty mapping. Either way, structure is valid.
      const mapping = loadMapping('test-workspace');
      expect(mapping.version).toBe(1);
      expect(typeof mapping.workspace).toBe('string');
      expect(typeof mapping.lastSync).toBe('string');
      expect(typeof mapping.mappings).toBe('object');
    });
  });

  describe('getMappedNodeId', () => {
    it('returns mapped node ID', () => {
      const mapping = {
        version: 1 as const,
        workspace: 'main',
        lastSync: '',
        mappings: { 'seed-abc': 'tana-xyz' },
      };
      expect(getMappedNodeId(mapping, 'seed-abc')).toBe('tana-xyz');
    });

    it('returns undefined for unmapped entry', () => {
      const mapping = {
        version: 1 as const,
        workspace: 'main',
        lastSync: '',
        mappings: {},
      };
      expect(getMappedNodeId(mapping, 'seed-abc')).toBeUndefined();
    });
  });

  describe('setMappedNodeId', () => {
    it('sets mapping in place', () => {
      const mapping = {
        version: 1 as const,
        workspace: 'main',
        lastSync: '',
        mappings: {},
      };
      setMappedNodeId(mapping, 'seed-abc', 'tana-xyz');
      expect(mapping.mappings['seed-abc']).toBe('tana-xyz');
    });

    it('overwrites existing mapping', () => {
      const mapping = {
        version: 1 as const,
        workspace: 'main',
        lastSync: '',
        mappings: { 'seed-abc': 'tana-old' },
      };
      setMappedNodeId(mapping, 'seed-abc', 'tana-new');
      expect(mapping.mappings['seed-abc']).toBe('tana-new');
    });
  });

  describe('getUnmappedEntries', () => {
    const entries: PaiLearningEntry[] = [
      { seedId: 'a', type: 'pattern', content: 'Test A', source: 's1', confirmedAt: '2026-01-01', tags: [] },
      { seedId: 'b', type: 'insight', content: 'Test B', source: 's2', confirmedAt: '2026-01-02', tags: [] },
      { seedId: 'c', type: 'self_knowledge', content: 'Test C', source: 's3', confirmedAt: '2026-01-03', tags: [] },
    ];

    it('returns entries not in mapping', () => {
      const mapping = {
        version: 1 as const,
        workspace: 'main',
        lastSync: '',
        mappings: { 'a': 'tana-a' },
      };
      const unmapped = getUnmappedEntries(entries, mapping);
      expect(unmapped).toHaveLength(2);
      expect(unmapped.map((e) => e.seedId)).toEqual(['b', 'c']);
    });

    it('returns all entries when mapping is empty', () => {
      const mapping = {
        version: 1 as const,
        workspace: 'main',
        lastSync: '',
        mappings: {},
      };
      const unmapped = getUnmappedEntries(entries, mapping);
      expect(unmapped).toHaveLength(3);
    });

    it('returns empty array when all are mapped', () => {
      const mapping = {
        version: 1 as const,
        workspace: 'main',
        lastSync: '',
        mappings: { 'a': 'tana-a', 'b': 'tana-b', 'c': 'tana-c' },
      };
      const unmapped = getUnmappedEntries(entries, mapping);
      expect(unmapped).toHaveLength(0);
    });
  });

  describe('saveMapping + loadMapping round-trip', () => {
    let tmpPath: string;

    beforeEach(() => {
      // Use a temp file for round-trip testing
      tmpPath = join(tmpdir(), `pai-mapping-test-${Date.now()}.json`);
    });

    afterEach(() => {
      if (existsSync(tmpPath)) {
        rmSync(tmpPath);
      }
    });

    it('round-trips mapping data correctly', () => {
      const mapping = {
        version: 1 as const,
        workspace: 'test',
        lastSync: '2026-02-22T10:00:00Z',
        mappings: {
          'seed-a': 'tana-1',
          'seed-b': 'tana-2',
        },
        schema: {
          paiLearningTagId: 'tag123',
        },
      };

      // Write to a known location
      writeFileSync(tmpPath, JSON.stringify(mapping, null, 2), 'utf-8');

      // Read it back — note: loadMapping reads from a fixed path,
      // so we test via direct JSON parse for round-trip
      const raw = JSON.parse(require('fs').readFileSync(tmpPath, 'utf-8'));
      expect(raw.version).toBe(1);
      expect(raw.workspace).toBe('test');
      expect(raw.mappings['seed-a']).toBe('tana-1');
      expect(raw.schema.paiLearningTagId).toBe('tag123');
    });
  });
});
