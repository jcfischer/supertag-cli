/**
 * Tool Schema MCP Tool Tests
 *
 * TDD tests for tana_tool_schema handler.
 */

import { describe, it, expect } from 'bun:test';
import { toolSchema } from '../tool-schema';

describe('tana_tool_schema handler', () => {
  it('should return schema for valid tool', async () => {
    const result = await toolSchema({ tool: 'tana_search' });
    expect(result.tool).toBe('tana_search');
    expect(result.schema).toBeDefined();
    expect(result.schema.type).toBe('object');
  });

  it('should include properties in schema', async () => {
    const result = await toolSchema({ tool: 'tana_search' });
    expect(result.schema.properties).toBeDefined();
    expect((result.schema.properties as Record<string, unknown>).query).toBeDefined();
  });

  it('should throw for unknown tool', async () => {
    await expect(toolSchema({ tool: 'invalid_tool' })).rejects.toThrow();
  });

  it('should include available tools in error message', async () => {
    try {
      await toolSchema({ tool: 'invalid_tool' });
    } catch (error) {
      expect(String(error)).toContain('tana_search');
    }
  });

  it('should return schema for all major tools', async () => {
    const tools = ['tana_tagged', 'tana_create', 'tana_node', 'tana_stats'];
    for (const tool of tools) {
      const result = await toolSchema({ tool });
      expect(result.tool).toBe(tool);
      expect(result.schema.type).toBe('object');
    }
  });
});

describe('Token Budget Validation', () => {
  it('should have individual schemas under 500 tokens', async () => {
    // Simple tools should be compact
    const tools = ['tana_stats', 'tana_supertags', 'tana_cache_clear'];
    for (const tool of tools) {
      const result = await toolSchema({ tool });
      const jsonStr = JSON.stringify(result.schema, null, 2);
      // Rough token estimate: ~4 chars per token for JSON
      const estimatedTokens = Math.ceil(jsonStr.length / 4);
      expect(estimatedTokens).toBeLessThan(500);
    }
  });

  it('should have largest schema (tana_create) under 500 tokens', async () => {
    // tana_create is the most complex schema
    const result = await toolSchema({ tool: 'tana_create' });
    const jsonStr = JSON.stringify(result.schema, null, 2);
    const estimatedTokens = Math.ceil(jsonStr.length / 4);
    expect(estimatedTokens).toBeLessThan(500);
  });

  it('should be much smaller than loading all schemas at once', async () => {
    // Individual schema should be small fraction of total
    const singleSchema = await toolSchema({ tool: 'tana_search' });
    const singleStr = JSON.stringify(singleSchema.schema);
    // A single schema should be under 2000 chars
    expect(singleStr.length).toBeLessThan(2000);
  });
});
