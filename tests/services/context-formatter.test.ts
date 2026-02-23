/**
 * Tests for Context Formatter
 * Spec F-098: Context Assembler
 */

import { describe, it, expect } from 'bun:test';
import { formatContext } from '../../src/services/context-formatter';
import type { ContextDocument } from '../../src/types/context';

function makeDoc(overrides: Partial<ContextDocument> = {}): ContextDocument {
  return {
    meta: {
      query: 'test query',
      workspace: 'main',
      lens: 'general',
      tokens: { budget: 4000, used: 1200, utilization: 0.3, nodesIncluded: 2, nodesSummarized: 1 },
      assembledAt: '2026-02-22T18:00:00Z',
      backend: 'sqlite',
      embeddingsAvailable: false,
    },
    nodes: [
      {
        id: 'node1',
        name: 'Test Node',
        content: 'This is test content.',
        tags: ['project'],
        fields: { status: 'active' },
        score: 0.9,
        distance: 0,
        path: [],
      },
      {
        id: 'node2',
        name: 'Related Node',
        content: 'Related content here.',
        tags: ['note'],
        score: 0.6,
        distance: 1,
        path: [],
      },
    ],
    overflow: [
      { id: 'node3', name: 'Overflow Node', tags: ['misc'], score: 0.2 },
    ],
    ...overrides,
  };
}

describe('Context Formatter', () => {
  describe('JSON format', () => {
    it('returns valid JSON', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.meta.query).toBe('test query');
    });

    it('includes all document fields', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'json');
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('meta');
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('overflow');
      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.overflow).toHaveLength(1);
    });

    it('preserves field values', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.nodes[0].fields.status).toBe('active');
    });
  });

  describe('Markdown format', () => {
    it('starts with context header', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'markdown');
      expect(output).toContain('# Context: test query');
    });

    it('includes token usage info', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'markdown');
      expect(output).toContain('1200/4000');
      expect(output).toContain('30%');
    });

    it('includes node headers with tags', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'markdown');
      expect(output).toContain('## Test Node [project]');
    });

    it('includes node content', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'markdown');
      expect(output).toContain('This is test content.');
    });

    it('includes field values', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'markdown');
      expect(output).toContain('**status**: active');
    });

    it('includes overflow section', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'markdown');
      expect(output).toContain('## Also Related');
      expect(output).toContain('Overflow Node');
    });

    it('omits overflow section when no overflow', () => {
      const doc = makeDoc({ overflow: [] });
      const output = formatContext(doc, 'markdown');
      expect(output).not.toContain('## Also Related');
    });

    it('includes embeddings note when unavailable', () => {
      const doc = makeDoc();
      const output = formatContext(doc, 'markdown');
      expect(output).toContain('Embeddings not available');
    });

    it('omits embeddings note when available', () => {
      const doc = makeDoc({
        meta: { ...makeDoc().meta, embeddingsAvailable: true },
      });
      const output = formatContext(doc, 'markdown');
      expect(output).not.toContain('Embeddings not available');
    });
  });
});
