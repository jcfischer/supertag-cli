/**
 * tana_related MCP Tool Tests (Spec 065)
 *
 * Tests for the related MCP tool schema validation.
 * Integration tests for the handler use GraphTraversalService directly.
 */

import { describe, it, expect } from 'bun:test';
import { relatedSchema } from '../../src/mcp/schemas';
import type { RelatedInput } from '../../src/mcp/schemas';

describe('tana_related MCP tool', () => {
  describe('relatedSchema validation', () => {
    it('should accept minimal input with defaults', () => {
      const input = { nodeId: 'abc123' };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.direction).toBe('both');
        expect(result.data.depth).toBe(1);
        expect(result.data.limit).toBe(50);
        expect(result.data.types).toEqual(['child', 'parent', 'reference', 'field']);
      }
    });

    it('should accept full input', () => {
      const input: RelatedInput = {
        nodeId: 'abc123',
        direction: 'out',
        types: ['child', 'reference'],
        depth: 2,
        limit: 20,
        workspace: 'main',
      };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid direction', () => {
      const input = { nodeId: 'abc123', direction: 'invalid' };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject depth > 5', () => {
      const input = { nodeId: 'abc123', depth: 10 };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject limit > 100', () => {
      const input = { nodeId: 'abc123', limit: 200 };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid relationship types', () => {
      const input = { nodeId: 'abc123', types: ['invalid'] };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept empty types array', () => {
      const input = { nodeId: 'abc123', types: [] };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should require nodeId', () => {
      const input = { direction: 'out' };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject empty nodeId', () => {
      const input = { nodeId: '' };
      const result = relatedSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('relatedSchema descriptions', () => {
    it('should have description for nodeId', () => {
      // Verify that descriptions are set for MCP documentation
      const shape = relatedSchema.shape;
      expect(shape.nodeId.description).toContain('node');
    });

    it('should have description for direction', () => {
      const shape = relatedSchema.shape;
      // Description is on the inner schema for default types
      expect(shape.direction._def.innerType?.description || shape.direction.description).toBeDefined();
    });
  });
});
