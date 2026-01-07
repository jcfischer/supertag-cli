/**
 * Tests for graph traversal types (Spec 065)
 */

import { describe, expect, it } from 'bun:test';
import {
  RelationshipType,
  RelationshipTypeSchema,
  DirectionSchema,
  RelatedQuerySchema,
  RelationshipMetadataSchema,
  RelatedNodeSchema,
  RelatedResultSchema,
  type RelatedQuery,
  type RelationshipMetadata,
  type RelatedNode,
  type RelatedResult,
} from '../../src/types/graph';

describe('graph-types', () => {
  describe('RelationshipTypeSchema', () => {
    it('should accept valid relationship types', () => {
      expect(RelationshipTypeSchema.parse('child')).toBe('child');
      expect(RelationshipTypeSchema.parse('parent')).toBe('parent');
      expect(RelationshipTypeSchema.parse('reference')).toBe('reference');
      expect(RelationshipTypeSchema.parse('field')).toBe('field');
    });

    it('should reject invalid relationship types', () => {
      expect(() => RelationshipTypeSchema.parse('invalid')).toThrow();
      expect(() => RelationshipTypeSchema.parse('')).toThrow();
    });
  });

  describe('DirectionSchema', () => {
    it('should accept valid directions', () => {
      expect(DirectionSchema.parse('in')).toBe('in');
      expect(DirectionSchema.parse('out')).toBe('out');
      expect(DirectionSchema.parse('both')).toBe('both');
    });

    it('should reject invalid directions', () => {
      expect(() => DirectionSchema.parse('up')).toThrow();
      expect(() => DirectionSchema.parse('')).toThrow();
    });
  });

  describe('RelatedQuerySchema', () => {
    it('should accept valid query with all fields', () => {
      const query: RelatedQuery = {
        nodeId: 'abc123',
        direction: 'both',
        types: ['reference', 'child'],
        depth: 2,
        limit: 50,
      };
      const parsed = RelatedQuerySchema.parse(query);
      expect(parsed.nodeId).toBe('abc123');
      expect(parsed.direction).toBe('both');
      expect(parsed.types).toEqual(['reference', 'child']);
      expect(parsed.depth).toBe(2);
      expect(parsed.limit).toBe(50);
    });

    it('should apply defaults for optional fields', () => {
      const query = { nodeId: 'abc123' };
      const parsed = RelatedQuerySchema.parse(query);
      expect(parsed.direction).toBe('both');
      expect(parsed.types).toEqual(['child', 'parent', 'reference', 'field']);
      expect(parsed.depth).toBe(1);
      expect(parsed.limit).toBe(50);
    });

    it('should require nodeId', () => {
      expect(() => RelatedQuerySchema.parse({})).toThrow();
      expect(() => RelatedQuerySchema.parse({ direction: 'in' })).toThrow();
    });

    it('should reject invalid depth', () => {
      expect(() => RelatedQuerySchema.parse({ nodeId: 'x', depth: -1 })).toThrow();
      expect(() => RelatedQuerySchema.parse({ nodeId: 'x', depth: 10 })).toThrow();
    });

    it('should reject invalid limit', () => {
      expect(() => RelatedQuerySchema.parse({ nodeId: 'x', limit: 0 })).toThrow();
      expect(() => RelatedQuerySchema.parse({ nodeId: 'x', limit: 200 })).toThrow();
    });
  });

  describe('RelationshipMetadataSchema', () => {
    it('should accept valid metadata', () => {
      const metadata: RelationshipMetadata = {
        type: 'reference',
        direction: 'in',
        path: ['abc123', 'def456'],
        distance: 1,
      };
      const parsed = RelationshipMetadataSchema.parse(metadata);
      expect(parsed.type).toBe('reference');
      expect(parsed.direction).toBe('in');
      expect(parsed.path).toEqual(['abc123', 'def456']);
      expect(parsed.distance).toBe(1);
    });

    it('should require all fields', () => {
      expect(() => RelationshipMetadataSchema.parse({ type: 'reference' })).toThrow();
    });
  });

  describe('RelatedNodeSchema', () => {
    it('should accept valid related node', () => {
      const node: RelatedNode = {
        id: 'def456',
        name: 'Related Node',
        relationship: {
          type: 'child',
          direction: 'out',
          path: ['abc123', 'def456'],
          distance: 1,
        },
      };
      const parsed = RelatedNodeSchema.parse(node);
      expect(parsed.id).toBe('def456');
      expect(parsed.name).toBe('Related Node');
      expect(parsed.relationship.type).toBe('child');
    });

    it('should accept optional tags', () => {
      const node: RelatedNode = {
        id: 'def456',
        name: 'Tagged Node',
        tags: ['todo', 'project'],
        relationship: {
          type: 'reference',
          direction: 'in',
          path: ['abc123', 'def456'],
          distance: 1,
        },
      };
      const parsed = RelatedNodeSchema.parse(node);
      expect(parsed.tags).toEqual(['todo', 'project']);
    });
  });

  describe('RelatedResultSchema', () => {
    it('should accept valid result', () => {
      const result: RelatedResult = {
        workspace: 'main',
        sourceNode: {
          id: 'abc123',
          name: 'Source Node',
        },
        related: [],
        count: 0,
        truncated: false,
      };
      const parsed = RelatedResultSchema.parse(result);
      expect(parsed.workspace).toBe('main');
      expect(parsed.sourceNode.id).toBe('abc123');
      expect(parsed.count).toBe(0);
      expect(parsed.truncated).toBe(false);
    });

    it('should accept optional warnings', () => {
      const result: RelatedResult = {
        workspace: 'main',
        sourceNode: { id: 'abc123', name: 'Source' },
        related: [],
        count: 0,
        truncated: false,
        warnings: ['Unknown type: foo'],
      };
      const parsed = RelatedResultSchema.parse(result);
      expect(parsed.warnings).toEqual(['Unknown type: foo']);
    });

    it('should accept result with related nodes', () => {
      const result: RelatedResult = {
        workspace: 'main',
        sourceNode: { id: 'abc123', name: 'Source' },
        related: [
          {
            id: 'def456',
            name: 'Child Node',
            relationship: {
              type: 'child',
              direction: 'out',
              path: ['abc123', 'def456'],
              distance: 1,
            },
          },
        ],
        count: 1,
        truncated: false,
      };
      const parsed = RelatedResultSchema.parse(result);
      expect(parsed.related).toHaveLength(1);
      expect(parsed.related[0].name).toBe('Child Node');
    });
  });

  describe('type constants', () => {
    it('should export ALL_RELATIONSHIP_TYPES', async () => {
      const { ALL_RELATIONSHIP_TYPES } = await import('../../src/types/graph');
      expect(ALL_RELATIONSHIP_TYPES).toEqual(['child', 'parent', 'reference', 'field']);
    });

    it('should export MAX_DEPTH', async () => {
      const { MAX_DEPTH } = await import('../../src/types/graph');
      expect(MAX_DEPTH).toBe(5);
    });

    it('should export MAX_LIMIT', async () => {
      const { MAX_LIMIT } = await import('../../src/types/graph');
      expect(MAX_LIMIT).toBe(100);
    });
  });
});
