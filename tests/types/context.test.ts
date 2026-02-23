/**
 * Tests for Context Types and Schemas
 * Spec F-098: Context Assembler
 */

import { describe, it, expect } from 'bun:test';
import { ContextOptionsSchema, LensTypeSchema, LENS_TYPES } from '../../src/types/context';

describe('Context Types', () => {
  describe('LENS_TYPES', () => {
    it('contains 5 lens types', () => {
      expect(LENS_TYPES).toHaveLength(5);
    });

    it('includes all expected types', () => {
      expect(LENS_TYPES).toContain('general');
      expect(LENS_TYPES).toContain('writing');
      expect(LENS_TYPES).toContain('coding');
      expect(LENS_TYPES).toContain('planning');
      expect(LENS_TYPES).toContain('meeting-prep');
    });
  });

  describe('LensTypeSchema', () => {
    it('accepts valid lens types', () => {
      for (const type of LENS_TYPES) {
        expect(() => LensTypeSchema.parse(type)).not.toThrow();
      }
    });

    it('rejects invalid lens types', () => {
      expect(() => LensTypeSchema.parse('invalid')).toThrow();
    });
  });

  describe('ContextOptionsSchema', () => {
    it('accepts minimal input', () => {
      const result = ContextOptionsSchema.parse({});
      expect(result.depth).toBe(2);
      expect(result.maxTokens).toBe(4000);
      expect(result.includeFields).toBe(true);
      expect(result.lens).toBe('general');
      expect(result.format).toBe('markdown');
    });

    it('accepts full input', () => {
      const result = ContextOptionsSchema.parse({
        workspace: 'books',
        depth: 3,
        maxTokens: 8000,
        includeFields: false,
        lens: 'coding',
        format: 'json',
      });

      expect(result.workspace).toBe('books');
      expect(result.depth).toBe(3);
      expect(result.maxTokens).toBe(8000);
      expect(result.includeFields).toBe(false);
      expect(result.lens).toBe('coding');
      expect(result.format).toBe('json');
    });

    it('rejects depth below 1', () => {
      expect(() => ContextOptionsSchema.parse({ depth: 0 })).toThrow();
    });

    it('rejects depth above 5', () => {
      expect(() => ContextOptionsSchema.parse({ depth: 6 })).toThrow();
    });

    it('rejects maxTokens below 100', () => {
      expect(() => ContextOptionsSchema.parse({ maxTokens: 50 })).toThrow();
    });

    it('rejects invalid lens', () => {
      expect(() => ContextOptionsSchema.parse({ lens: 'invalid' })).toThrow();
    });

    it('rejects invalid format', () => {
      expect(() => ContextOptionsSchema.parse({ format: 'csv' })).toThrow();
    });
  });
});
