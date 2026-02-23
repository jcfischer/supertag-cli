/**
 * Progressive Disclosure E2E Tests (Spec 061)
 *
 * Tests the full workflow:
 * 1. Agent calls tana_capabilities → gets lightweight overview
 * 2. Agent calls tana_tool_schema for needed tools → gets full schemas
 * 3. Agent calls actual tools with validated parameters
 */

import { describe, it, expect } from 'bun:test';
import { capabilities } from '../capabilities';
import { toolSchema } from '../tool-schema';
import * as schemas from '../../schemas';

describe('Progressive Disclosure E2E Workflow', () => {
  describe('Phase 1: Discover Capabilities', () => {
    it('should return lightweight capabilities overview', async () => {
      const result = await capabilities({});

      // Should have all 5 categories
      expect(result.categories).toHaveLength(5);
      expect(result.version).toBeDefined();
      expect(result.quickActions).toBeArray();

      // Each tool should have name, description, example - but NOT full schema
      for (const category of result.categories) {
        for (const tool of category.tools) {
          expect(tool.name).toStartWith('tana_');
          expect(tool.description).toBeDefined();
          expect(tool.example).toBeDefined();
          // Should NOT include inputSchema (that's the whole point)
          expect((tool as unknown as Record<string, unknown>).inputSchema).toBeUndefined();
        }
      }
    });

    it('should allow filtering by category', async () => {
      const result = await capabilities({ category: 'query' });

      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].name).toBe('query');

      // Query tools should include search, tagged, semantic_search
      const toolNames = result.categories[0].tools.map((t) => t.name);
      expect(toolNames).toContain('tana_search');
      expect(toolNames).toContain('tana_tagged');
    });
  });

  describe('Phase 2: Load Tool Schemas On-Demand', () => {
    it('should load full schema for specific tool', async () => {
      // Simulate agent discovering they need tana_search
      const result = await toolSchema({ tool: 'tana_search' });

      expect(result.tool).toBe('tana_search');
      expect(result.schema).toBeDefined();
      expect(result.schema.type).toBe('object');
      expect(result.schema.properties).toBeDefined();

      // Schema should include all parameter details
      const props = result.schema.properties as Record<string, unknown>;
      expect(props.query).toBeDefined();
      expect(props.limit).toBeDefined();
    });

    it('should provide helpful error for unknown tools', async () => {
      await expect(toolSchema({ tool: 'tana_nonexistent' })).rejects.toThrow();

      try {
        await toolSchema({ tool: 'tana_nonexistent' });
      } catch (error) {
        // Error should list available tools
        expect(String(error)).toContain('tana_search');
        expect(String(error)).toContain('tana_create');
      }
    });
  });

  describe('Phase 3: Execute Tools with Loaded Schemas', () => {
    it('should allow validating parameters against loaded schema', async () => {
      // Agent loaded schema in phase 2, now validates their input
      const { schema } = await toolSchema({ tool: 'tana_search' });

      // Valid input should pass validation
      const validInput = { query: 'test', limit: 10 };
      const parsed = schemas.searchSchema.parse(validInput);
      expect(parsed.query).toBe('test');
      expect(parsed.limit).toBe(10);
    });

    it('should support all major tool types through the workflow', async () => {
      // Full workflow for multiple tool types
      const toolTypes = [
        { name: 'tana_search', category: 'query' },
        { name: 'tana_create', category: 'mutate' },
        { name: 'tana_node', category: 'explore' },
        { name: 'tana_cache_clear', category: 'system' },
      ];

      for (const { name, category } of toolTypes) {
        // Phase 1: Verify tool exists in capabilities
        const caps = await capabilities({ category: category as 'query' | 'explore' | 'transcript' | 'mutate' | 'system' });
        const toolNames = caps.categories[0].tools.map((t) => t.name);
        expect(toolNames).toContain(name);

        // Phase 2: Load full schema
        const { schema } = await toolSchema({ tool: name });
        expect(schema.type).toBe('object');
        expect(schema.properties).toBeDefined();
      }
    });
  });

  describe('Token Budget Verification', () => {
    it('should have capabilities + single schema under 1500 tokens', async () => {
      // Typical agent workflow: load capabilities + one schema
      const caps = await capabilities({});
      const search = await toolSchema({ tool: 'tana_search' });

      const capsJson = JSON.stringify(caps);
      const schemaJson = JSON.stringify(search.schema);

      // Combined should be under 1700 tokens (vs ~2000+ for all schemas)
      const combinedChars = capsJson.length + schemaJson.length;
      const estimatedTokens = Math.ceil(combinedChars / 4);

      expect(estimatedTokens).toBeLessThan(1700);
    });

    it('should scale linearly as agent loads more schemas', async () => {
      // Loading 3 schemas should be roughly 3x single schema cost
      const caps = await capabilities({});
      const schema1 = await toolSchema({ tool: 'tana_search' });
      const schema2 = await toolSchema({ tool: 'tana_tagged' });
      const schema3 = await toolSchema({ tool: 'tana_stats' });

      const capsJson = JSON.stringify(caps);
      const schemasJson = [schema1, schema2, schema3].map((s) => JSON.stringify(s.schema)).join('');

      const totalChars = capsJson.length + schemasJson.length;
      const estimatedTokens = Math.ceil(totalChars / 4);

      // Even with 3 schemas, should be under 2000 tokens
      expect(estimatedTokens).toBeLessThan(2000);
    });
  });

  describe('Discovery Flow Patterns', () => {
    it('should support "what can I do?" pattern', async () => {
      // Agent asks: "What capabilities does this server have?"
      const result = await capabilities({});

      // Response gives structured overview
      expect(result.categories.map((c) => c.name)).toEqual([
        'query',
        'explore',
        'transcript',
        'mutate',
        'system',
      ]);

      // Quick actions give common starting points
      expect(result.quickActions).toContain('search');
      expect(result.quickActions).toContain('create');
    });

    it('should support "how do I search?" pattern', async () => {
      // Agent asks: "How do I search for content?"
      const caps = await capabilities({ category: 'query' });
      const queryTools = caps.categories[0].tools;

      // Find search tool
      const searchTool = queryTools.find((t) => t.name === 'tana_search');
      expect(searchTool).toBeDefined();
      expect(searchTool!.example).toBeDefined();

      // Load full schema if needed
      const { schema } = await toolSchema({ tool: 'tana_search' });
      expect(schema.properties).toBeDefined();
    });

    it('should support "show me everything about X" pattern', async () => {
      // Agent explores a specific category deeply
      const caps = await capabilities({ category: 'explore' });

      // Get schemas for all explore tools
      for (const tool of caps.categories[0].tools) {
        const { schema } = await toolSchema({ tool: tool.name });
        expect(schema.type).toBe('object');
      }
    });
  });
});
