/**
 * Capabilities MCP Tool Tests
 *
 * TDD tests for tana_capabilities handler.
 */

import { describe, it, expect } from 'bun:test';
import { capabilities } from '../capabilities';

describe('tana_capabilities handler', () => {
  it('should return all categories when no filter', async () => {
    const result = await capabilities({});
    expect(result.categories).toHaveLength(5);
    expect(result.version).toBeDefined();
  });

  it('should filter by category', async () => {
    const result = await capabilities({ category: 'query' });
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].name).toBe('query');
  });

  it('should include quickActions', async () => {
    const result = await capabilities({});
    expect(result.quickActions).toBeArray();
    expect(result.quickActions.length).toBeGreaterThan(0);
  });

  it('should include tools with examples', async () => {
    const result = await capabilities({});
    const allTools = result.categories.flatMap((c) => c.tools);
    for (const tool of allTools) {
      expect(tool.name).toStartWith('tana_');
      expect(tool.description).toBeDefined();
      expect(tool.example).toBeDefined();
    }
  });
});

describe('Token Budget Validation', () => {
  it('should have capabilities response under 1000 tokens', async () => {
    const result = await capabilities({});
    const jsonStr = JSON.stringify(result, null, 2);
    // Rough token estimate: ~4 chars per token for JSON
    // Target: much smaller than full tool schemas (~2000 tokens)
    const estimatedTokens = Math.ceil(jsonStr.length / 4);
    expect(estimatedTokens).toBeLessThan(1000);
  });

  it('should have filtered response much smaller', async () => {
    const full = await capabilities({});
    const filtered = await capabilities({ category: 'query' });
    const fullStr = JSON.stringify(full);
    const filteredStr = JSON.stringify(filtered);
    // Filtered should be significantly smaller
    expect(filteredStr.length).toBeLessThan(fullStr.length / 2);
  });

  it('should be significantly smaller than full MCP tool list', async () => {
    // The original MCP ListTools response was ~2000 tokens
    // Our capabilities response should be much smaller
    const result = await capabilities({});
    const jsonStr = JSON.stringify(result);
    // Full tool list with schemas is ~8000 chars, we should be under 4000
    expect(jsonStr.length).toBeLessThan(4000);
  });
});
