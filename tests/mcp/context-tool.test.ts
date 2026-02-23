/**
 * Tests for tana_context MCP Tool
 * Spec F-098: Context Assembler
 */

import { describe, it, expect } from 'bun:test';
import { contextSchema } from '../../src/mcp/schemas';

describe('tana_context MCP Schema', () => {
  it('accepts minimal input with just query', () => {
    const result = contextSchema.parse({ query: 'test topic' });
    expect(result.query).toBe('test topic');
    expect(result.depth).toBe(2);
    expect(result.maxTokens).toBe(4000);
    expect(result.lens).toBe('general');
    expect(result.includeFields).toBe(true);
    expect(result.format).toBe('markdown');
  });

  it('requires query field', () => {
    expect(() => contextSchema.parse({})).toThrow();
  });

  it('rejects empty query', () => {
    expect(() => contextSchema.parse({ query: '' })).toThrow();
  });

  it('accepts all options', () => {
    const result = contextSchema.parse({
      query: 'SOC Defender',
      depth: 3,
      maxTokens: 8000,
      lens: 'coding',
      includeFields: false,
      format: 'json',
      workspace: 'main',
    });

    expect(result.depth).toBe(3);
    expect(result.maxTokens).toBe(8000);
    expect(result.lens).toBe('coding');
    expect(result.includeFields).toBe(false);
    expect(result.format).toBe('json');
    expect(result.workspace).toBe('main');
  });

  it('validates depth range', () => {
    expect(() => contextSchema.parse({ query: 'test', depth: 0 })).toThrow();
    expect(() => contextSchema.parse({ query: 'test', depth: 6 })).toThrow();
    expect(() => contextSchema.parse({ query: 'test', depth: 5 })).not.toThrow();
  });

  it('validates maxTokens minimum', () => {
    expect(() => contextSchema.parse({ query: 'test', maxTokens: 50 })).toThrow();
    expect(() => contextSchema.parse({ query: 'test', maxTokens: 100 })).not.toThrow();
  });

  it('validates lens enum', () => {
    const validLenses = ['general', 'writing', 'coding', 'planning', 'meeting-prep'];
    for (const lens of validLenses) {
      expect(() => contextSchema.parse({ query: 'test', lens })).not.toThrow();
    }
    expect(() => contextSchema.parse({ query: 'test', lens: 'invalid' })).toThrow();
  });

  it('validates format enum', () => {
    expect(() => contextSchema.parse({ query: 'test', format: 'markdown' })).not.toThrow();
    expect(() => contextSchema.parse({ query: 'test', format: 'json' })).not.toThrow();
    expect(() => contextSchema.parse({ query: 'test', format: 'csv' })).toThrow();
  });
});
