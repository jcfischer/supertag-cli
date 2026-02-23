/**
 * Tests for Lens Configuration
 * Spec F-098: Context Assembler
 */

import { describe, it, expect } from 'bun:test';
import { getLensConfig, applyLensBoosts, LENS_CONFIGS } from '../../src/services/lens-config';
import { LENS_TYPES } from '../../src/types/context';
import type { ContextNode } from '../../src/types/context';

function makeNode(name: string, tags: string[], score: number): ContextNode {
  return {
    id: `node-${name}`,
    name,
    content: '',
    tags,
    score,
    distance: 1,
    path: [],
  };
}

describe('Lens Configuration', () => {
  describe('LENS_CONFIGS', () => {
    it('defines all 5 lens types', () => {
      expect(Object.keys(LENS_CONFIGS)).toHaveLength(5);
      for (const type of LENS_TYPES) {
        expect(LENS_CONFIGS[type]).toBeDefined();
      }
    });

    it('each lens has required properties', () => {
      for (const [name, config] of Object.entries(LENS_CONFIGS)) {
        expect(config.name).toBe(name);
        expect(config.priorityTypes.length).toBeGreaterThan(0);
        expect(config.maxDepth).toBeGreaterThanOrEqual(1);
        expect(config.maxDepth).toBeLessThanOrEqual(5);
      }
    });

    it('general lens uses all relationship types', () => {
      const general = LENS_CONFIGS.general;
      expect(general.priorityTypes).toContain('child');
      expect(general.priorityTypes).toContain('parent');
      expect(general.priorityTypes).toContain('reference');
      expect(general.priorityTypes).toContain('field');
    });

    it('coding lens includes field and reference types', () => {
      const coding = LENS_CONFIGS.coding;
      expect(coding.priorityTypes).toContain('reference');
      expect(coding.priorityTypes).toContain('field');
    });

    it('meeting-prep lens boosts person and meeting tags', () => {
      const meetingPrep = LENS_CONFIGS['meeting-prep'];
      expect(meetingPrep.boostTags).toContain('person');
      expect(meetingPrep.boostTags).toContain('meeting');
    });

    it('planning lens includes relevant fields', () => {
      const planning = LENS_CONFIGS.planning;
      expect(planning.includeFields).toContain('status');
      expect(planning.includeFields).toContain('due');
    });
  });

  describe('getLensConfig', () => {
    it('returns config for valid lens', () => {
      const config = getLensConfig('coding');
      expect(config.name).toBe('coding');
    });

    it('returns general config', () => {
      const config = getLensConfig('general');
      expect(config.name).toBe('general');
    });
  });

  describe('applyLensBoosts', () => {
    it('boosts nodes with matching tags', () => {
      const nodes = [
        makeNode('spec', ['spec', 'code'], 0.5),
        makeNode('unrelated', ['note'], 0.5),
      ];

      const boosted = applyLensBoosts(nodes, 'coding');
      const specNode = boosted.find(n => n.name === 'spec');
      const unrelatedNode = boosted.find(n => n.name === 'unrelated');

      expect(specNode!.score).toBeGreaterThan(unrelatedNode!.score);
    });

    it('does not boost nodes without matching tags', () => {
      const nodes = [makeNode('plain', ['other'], 0.5)];
      const boosted = applyLensBoosts(nodes, 'coding');
      expect(boosted[0].score).toBe(0.5);
    });

    it('caps score at 1.0', () => {
      const nodes = [makeNode('high', ['spec'], 0.95)];
      const boosted = applyLensBoosts(nodes, 'coding');
      expect(boosted[0].score).toBeLessThanOrEqual(1.0);
    });

    it('does not modify nodes for lens without boost tags', () => {
      const nodes = [makeNode('any', ['child'], 0.5)];
      const boosted = applyLensBoosts(nodes, 'general');
      expect(boosted[0].score).toBe(0.5);
    });

    it('is case-insensitive for tag matching', () => {
      const nodes = [makeNode('meeting', ['Meeting', 'PERSON'], 0.5)];
      const boosted = applyLensBoosts(nodes, 'meeting-prep');
      expect(boosted[0].score).toBeGreaterThan(0.5);
    });
  });
});
