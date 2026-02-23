/**
 * Tests for Token Counter Service
 * Spec F-098: Context Assembler
 */

import { describe, it, expect } from 'bun:test';
import { countTokens, countTokensSync, estimateNodeTokens, initTokenCounter } from '../../src/services/token-counter';
import type { ContextNode } from '../../src/types/context';

describe('Token Counter', () => {
  describe('countTokens', () => {
    it('returns 0 for empty string', async () => {
      expect(await countTokens('')).toBe(0);
    });

    it('counts tokens for simple text', async () => {
      const count = await countTokens('Hello, world!');
      // tiktoken or fallback: should be a small positive number
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(20);
    });

    it('counts tokens for longer text', async () => {
      const text = 'The quick brown fox jumps over the lazy dog. This is a test sentence with multiple words that should result in a reasonable token count.';
      const count = await countTokens(text);
      expect(count).toBeGreaterThan(10);
      expect(count).toBeLessThan(100);
    });

    it('handles unicode text', async () => {
      const count = await countTokens('日本語のテスト text with unicode');
      expect(count).toBeGreaterThan(0);
    });

    it('handles markdown with code blocks', async () => {
      const text = '# Header\n\n```typescript\nconst x = 1;\n```\n\nSome text after.';
      const count = await countTokens(text);
      expect(count).toBeGreaterThan(5);
    });

    it('produces consistent results for same input', async () => {
      const text = 'Consistency test string';
      const count1 = await countTokens(text);
      const count2 = await countTokens(text);
      expect(count1).toBe(count2);
    });
  });

  describe('countTokensSync', () => {
    it('returns 0 for empty string', () => {
      expect(countTokensSync('')).toBe(0);
    });

    it('counts tokens for simple text', () => {
      const count = countTokensSync('Hello world');
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('estimateNodeTokens', () => {
    it('estimates tokens for a simple node', async () => {
      const node: ContextNode = {
        id: 'test1',
        name: 'Test Node',
        content: 'Some content here',
        tags: ['tag1'],
        score: 0.5,
        distance: 1,
        path: [],
      };

      const estimate = await estimateNodeTokens(node);
      expect(estimate).toBeGreaterThan(0);
    });

    it('estimates more tokens for node with fields', async () => {
      const nodeWithoutFields: ContextNode = {
        id: 'test1',
        name: 'Test',
        content: 'Content',
        tags: [],
        score: 0.5,
        distance: 0,
        path: [],
      };

      const nodeWithFields: ContextNode = {
        ...nodeWithoutFields,
        fields: {
          status: 'active',
          priority: 'high',
          description: 'A longer description field value that adds more tokens',
        },
      };

      const withoutTokens = await estimateNodeTokens(nodeWithoutFields);
      const withTokens = await estimateNodeTokens(nodeWithFields);
      expect(withTokens).toBeGreaterThan(withoutTokens);
    });
  });

  describe('initTokenCounter', () => {
    it('initializes without error', async () => {
      await expect(initTokenCounter()).resolves.toBeUndefined();
    });
  });
});
