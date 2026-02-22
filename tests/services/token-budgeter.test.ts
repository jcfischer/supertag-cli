/**
 * Tests for Token Budgeter Service
 * Spec F-098: Context Assembler
 */

import { describe, it, expect } from 'bun:test';
import { pruneToFitBudget, DEFAULT_BUDGET } from '../../src/services/token-budgeter';
import type { ContextNode, TokenBudget } from '../../src/types/context';

function makeNode(id: string, name: string, content: string, score: number): ContextNode {
  return {
    id,
    name,
    content,
    tags: ['test'],
    score,
    distance: 1,
    path: [],
  };
}

describe('Token Budgeter', () => {
  describe('pruneToFitBudget', () => {
    it('includes all nodes when within budget', async () => {
      const nodes = [
        makeNode('1', 'Short', 'Hi', 1.0),
        makeNode('2', 'Also short', 'Hey', 0.8),
      ];

      const budget: TokenBudget = { maxTokens: 10000, headerReserve: 200, minPerNode: 50 };
      const result = await pruneToFitBudget(nodes, budget);

      expect(result.included).toHaveLength(2);
      expect(result.overflow).toHaveLength(0);
    });

    it('prunes nodes that exceed budget', async () => {
      const longContent = 'x '.repeat(2000); // ~1000 tokens
      const nodes = [
        makeNode('1', 'Node 1', longContent, 1.0),
        makeNode('2', 'Node 2', longContent, 0.8),
        makeNode('3', 'Node 3', longContent, 0.5),
      ];

      const budget: TokenBudget = { maxTokens: 1500, headerReserve: 200, minPerNode: 50 };
      const result = await pruneToFitBudget(nodes, budget);

      // Should include at most 1-2 nodes with 1300 available tokens
      expect(result.included.length).toBeLessThanOrEqual(2);
      expect(result.overflow.length).toBeGreaterThan(0);
    });

    it('returns usage statistics', async () => {
      const nodes = [makeNode('1', 'Test', 'Content', 1.0)];
      const budget: TokenBudget = { maxTokens: 4000, headerReserve: 200, minPerNode: 50 };
      const result = await pruneToFitBudget(nodes, budget);

      expect(result.usage.budget).toBe(4000);
      expect(result.usage.used).toBeGreaterThan(0);
      expect(result.usage.utilization).toBeGreaterThan(0);
      expect(result.usage.utilization).toBeLessThanOrEqual(1);
      expect(result.usage.nodesIncluded).toBe(1);
    });

    it('preserves ordering (highest relevance first)', async () => {
      const nodes = [
        makeNode('1', 'Top', 'Content A', 1.0),
        makeNode('2', 'Mid', 'Content B', 0.5),
        makeNode('3', 'Low', 'Content C', 0.2),
      ];

      const budget: TokenBudget = { maxTokens: 10000, headerReserve: 200, minPerNode: 50 };
      const result = await pruneToFitBudget(nodes, budget);

      expect(result.included[0].id).toBe('1');
      expect(result.included[1].id).toBe('2');
    });

    it('creates overflow summaries with correct structure', async () => {
      const longContent = 'x '.repeat(5000);
      const nodes = [
        makeNode('1', 'Included', longContent, 1.0),
        makeNode('2', 'Overflow', longContent, 0.5),
      ];

      const budget: TokenBudget = { maxTokens: 3000, headerReserve: 200, minPerNode: 50 };
      const result = await pruneToFitBudget(nodes, budget);

      if (result.overflow.length > 0) {
        const summary = result.overflow[0];
        expect(summary).toHaveProperty('id');
        expect(summary).toHaveProperty('name');
        expect(summary).toHaveProperty('tags');
        expect(summary).toHaveProperty('score');
      }
    });

    it('handles empty node list', async () => {
      const result = await pruneToFitBudget([], DEFAULT_BUDGET);
      expect(result.included).toHaveLength(0);
      expect(result.overflow).toHaveLength(0);
      expect(result.usage.nodesIncluded).toBe(0);
    });

    it('enforces token budget — output does not exceed budget by more than 10%', async () => {
      const nodes = Array.from({ length: 20 }, (_, i) =>
        makeNode(`n${i}`, `Node ${i}`, 'Some reasonable content for testing purposes.', 1 - i * 0.05)
      );

      const budget: TokenBudget = { maxTokens: 500, headerReserve: 100, minPerNode: 50 };
      const result = await pruneToFitBudget(nodes, budget);

      // Usage should not exceed budget by more than 10%
      expect(result.usage.used).toBeLessThanOrEqual(budget.maxTokens * 1.1);
    });
  });
});
