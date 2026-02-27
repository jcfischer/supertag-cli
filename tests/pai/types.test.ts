/**
 * Tests: PAI Type Definitions
 * Task: T-1.1
 */

import { describe, it, expect } from 'bun:test';
import {
  SeedFileSchema,
  SeedEntrySchema,
  SeedProposalSchema,
  PaiMappingSchema,
  LEARNING_TYPES,
} from '../../src/types/pai';
import fixture from '../fixtures/pai/seed-fixture.json';

describe('PAI Types', () => {
  describe('LEARNING_TYPES', () => {
    it('contains pattern, insight, self_knowledge', () => {
      expect(LEARNING_TYPES).toContain('pattern');
      expect(LEARNING_TYPES).toContain('insight');
      expect(LEARNING_TYPES).toContain('self_knowledge');
      expect(LEARNING_TYPES).toHaveLength(3);
    });
  });

  describe('SeedEntrySchema', () => {
    it('validates a valid entry', () => {
      const entry = {
        id: 'test123',
        content: 'Test content',
        source: 'session-1',
        extractedAt: '2026-01-01T00:00:00Z',
        confirmedAt: '2026-01-01T01:00:00Z',
        confirmed: true,
        tags: ['test'],
      };
      const result = SeedEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('defaults tags to empty array if missing', () => {
      const entry = {
        id: 'test123',
        content: 'Test content',
        source: 'session-1',
        extractedAt: '2026-01-01T00:00:00Z',
        confirmedAt: '2026-01-01T01:00:00Z',
        confirmed: true,
      };
      const result = SeedEntrySchema.parse(entry);
      expect(result.tags).toEqual([]);
    });

    it('preserves unknown fields via passthrough', () => {
      const entry = {
        id: 'test123',
        content: 'Test',
        source: 'session',
        extractedAt: '2026-01-01T00:00:00Z',
        confirmedAt: '2026-01-01T01:00:00Z',
        confirmed: true,
        customField: 'preserved',
      };
      const result = SeedEntrySchema.parse(entry);
      expect((result as Record<string, unknown>).customField).toBe('preserved');
    });
  });

  describe('SeedProposalSchema', () => {
    it('validates a valid proposal', () => {
      const proposal = {
        id: 'prop123',
        type: 'pattern',
        content: 'Test proposal',
        source: 'session-1',
        extractedAt: '2026-01-01T00:00:00Z',
        status: 'pending',
      };
      const result = SeedProposalSchema.safeParse(proposal);
      expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
      const proposal = {
        id: 'prop123',
        type: 'pattern',
        content: 'Test',
        source: 'session',
        extractedAt: '2026-01-01T00:00:00Z',
        status: 'invalid_status',
      };
      const result = SeedProposalSchema.safeParse(proposal);
      expect(result.success).toBe(false);
    });
  });

  describe('SeedFileSchema', () => {
    it('validates the test fixture', () => {
      const result = SeedFileSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('validates fixture has correct structure', () => {
      const parsed = SeedFileSchema.parse(fixture);
      expect(parsed.learned.patterns).toHaveLength(3);
      expect(parsed.learned.insights).toHaveLength(2);
      expect(parsed.learned.selfKnowledge).toHaveLength(1);
      expect(parsed.state!.proposals).toHaveLength(2);
    });

    it('preserves unknown fields via passthrough', () => {
      const seedWithExtra = {
        ...fixture,
        unknownTopLevel: 'preserved',
      };
      const result = SeedFileSchema.parse(seedWithExtra);
      expect((result as Record<string, unknown>).unknownTopLevel).toBe('preserved');
    });

    it('handles empty categories', () => {
      const minimal = {
        learned: {
          patterns: [],
          insights: [],
          selfKnowledge: [],
        },
      };
      const result = SeedFileSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.learned.patterns).toEqual([]);
      }
    });

    it('handles missing optional fields', () => {
      const minimal = {
        learned: {
          patterns: [],
        },
      };
      const result = SeedFileSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.learned.insights).toEqual([]);
        expect(result.data.learned.selfKnowledge).toEqual([]);
      }
    });
  });

  describe('PaiMappingSchema', () => {
    it('validates a valid mapping', () => {
      const mapping = {
        version: 1,
        workspace: 'main',
        lastSync: '2026-01-01T00:00:00Z',
        mappings: {
          'seed-abc': 'tana-xyz',
        },
      };
      const result = PaiMappingSchema.safeParse(mapping);
      expect(result.success).toBe(true);
    });

    it('validates mapping with schema section', () => {
      const mapping = {
        version: 1,
        workspace: 'main',
        lastSync: '',
        mappings: {},
        schema: {
          paiLearningTagId: 'tag123',
          paiProposalTagId: 'tag456',
          fieldIds: {
            pai_learning: { Type: 'field1', Content: 'field2' },
          },
        },
      };
      const result = PaiMappingSchema.safeParse(mapping);
      expect(result.success).toBe(true);
    });

    it('rejects wrong version', () => {
      const mapping = {
        version: 2,
        workspace: 'main',
        lastSync: '',
        mappings: {},
      };
      const result = PaiMappingSchema.safeParse(mapping);
      expect(result.success).toBe(false);
    });
  });
});
