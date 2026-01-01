/**
 * Tool Registry Tests
 *
 * TDD tests for the progressive disclosure tool registry.
 * Tests types, metadata, getCapabilities(), and getToolSchema().
 */

import { describe, it, expect } from 'bun:test';
import type {
  ToolCategory,
  ToolSummary,
  ToolMetadata,
  CapabilitiesResponse,
} from '../tool-registry';
import { TOOL_METADATA, CATEGORY_DESCRIPTIONS, QUICK_ACTIONS } from '../tool-registry';

describe('Tool Registry Types', () => {
  describe('ToolSummary', () => {
    it('should have required name and description', () => {
      const summary: ToolSummary = {
        name: 'tana_search',
        description: 'Full-text search',
      };
      expect(summary.name).toBe('tana_search');
      expect(summary.description).toBe('Full-text search');
    });

    it('should allow optional example field', () => {
      const summary: ToolSummary = {
        name: 'tana_search',
        description: 'Full-text search',
        example: 'Find all notes about TypeScript',
      };
      expect(summary.example).toBe('Find all notes about TypeScript');
    });
  });

  describe('ToolCategory', () => {
    it('should have name, description, and tools array', () => {
      const category: ToolCategory = {
        name: 'query',
        description: 'Find and search nodes',
        tools: [{ name: 'tana_search', description: 'Full-text search' }],
      };
      expect(category.name).toBe('query');
      expect(category.tools).toHaveLength(1);
    });

    it('should only allow valid category names', () => {
      const validNames: ToolCategory['name'][] = [
        'query',
        'explore',
        'transcript',
        'mutate',
        'system',
      ];
      expect(validNames).toHaveLength(5);
    });
  });

  describe('ToolMetadata', () => {
    it('should include category assignment', () => {
      const metadata: ToolMetadata = {
        name: 'tana_search',
        description: 'Full-text search',
        category: 'query',
        example: 'Find notes about TypeScript',
      };
      expect(metadata.category).toBe('query');
    });
  });

  describe('CapabilitiesResponse', () => {
    it('should have version, categories, and quickActions', () => {
      const response: CapabilitiesResponse = {
        version: '0.7.0',
        categories: [],
        quickActions: ['search', 'create'],
      };
      expect(response.version).toBeDefined();
      expect(response.categories).toBeArray();
      expect(response.quickActions).toBeArray();
    });
  });
});

describe('TOOL_METADATA', () => {
  it('should contain all 14 existing tools', () => {
    const expectedTools = [
      'tana_search',
      'tana_tagged',
      'tana_semantic_search',
      'tana_field_values',
      'tana_supertags',
      'tana_stats',
      'tana_supertag_info',
      'tana_node',
      'tana_transcript_list',
      'tana_transcript_show',
      'tana_transcript_search',
      'tana_create',
      'tana_sync',
      'tana_cache_clear',
    ];
    const toolNames = TOOL_METADATA.map((t) => t.name);
    for (const expected of expectedTools) {
      expect(toolNames).toContain(expected);
    }
  });

  it('should include 2 new progressive disclosure tools', () => {
    const toolNames = TOOL_METADATA.map((t) => t.name);
    expect(toolNames).toContain('tana_capabilities');
    expect(toolNames).toContain('tana_tool_schema');
  });

  it('should have valid category for each tool', () => {
    const validCategories = ['query', 'explore', 'transcript', 'mutate', 'system'];
    for (const tool of TOOL_METADATA) {
      expect(validCategories).toContain(tool.category);
    }
  });

  it('should have example for each tool', () => {
    for (const tool of TOOL_METADATA) {
      expect(tool.example).toBeDefined();
      expect(tool.example!.length).toBeGreaterThan(10);
    }
  });

  it('should categorize query tools correctly', () => {
    const queryTools = TOOL_METADATA.filter((t) => t.category === 'query');
    const queryNames = queryTools.map((t) => t.name);
    expect(queryNames).toContain('tana_search');
    expect(queryNames).toContain('tana_tagged');
    expect(queryNames).toContain('tana_semantic_search');
    expect(queryNames).toContain('tana_field_values');
  });

  it('should categorize explore tools correctly', () => {
    const exploreTools = TOOL_METADATA.filter((t) => t.category === 'explore');
    const exploreNames = exploreTools.map((t) => t.name);
    expect(exploreNames).toContain('tana_supertags');
    expect(exploreNames).toContain('tana_stats');
    expect(exploreNames).toContain('tana_supertag_info');
    expect(exploreNames).toContain('tana_node');
  });

  it('should categorize transcript tools correctly', () => {
    const transcriptTools = TOOL_METADATA.filter((t) => t.category === 'transcript');
    const transcriptNames = transcriptTools.map((t) => t.name);
    expect(transcriptNames).toContain('tana_transcript_list');
    expect(transcriptNames).toContain('tana_transcript_show');
    expect(transcriptNames).toContain('tana_transcript_search');
  });

  it('should categorize mutate tools correctly', () => {
    const mutateTools = TOOL_METADATA.filter((t) => t.category === 'mutate');
    const mutateNames = mutateTools.map((t) => t.name);
    expect(mutateNames).toContain('tana_create');
    expect(mutateNames).toContain('tana_sync');
  });

  it('should categorize system tools correctly', () => {
    const systemTools = TOOL_METADATA.filter((t) => t.category === 'system');
    const systemNames = systemTools.map((t) => t.name);
    expect(systemNames).toContain('tana_cache_clear');
    expect(systemNames).toContain('tana_capabilities');
    expect(systemNames).toContain('tana_tool_schema');
  });
});

describe('CATEGORY_DESCRIPTIONS', () => {
  it('should have descriptions for all 5 categories', () => {
    expect(CATEGORY_DESCRIPTIONS.query).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.explore).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.transcript).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.mutate).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.system).toBeDefined();
  });
});

describe('QUICK_ACTIONS', () => {
  it('should contain common operations', () => {
    expect(QUICK_ACTIONS).toContain('search');
    expect(QUICK_ACTIONS).toContain('create');
  });

  it('should have 3-5 quick actions', () => {
    expect(QUICK_ACTIONS.length).toBeGreaterThanOrEqual(3);
    expect(QUICK_ACTIONS.length).toBeLessThanOrEqual(5);
  });
});
