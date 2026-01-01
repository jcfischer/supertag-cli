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
