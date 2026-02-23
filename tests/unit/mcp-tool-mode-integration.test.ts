/**
 * Tests for MCP Tool Mode Integration (T-5.2, F-095)
 *
 * Verifies that tool mode filtering is integrated into the MCP server:
 * - ListTools handler filters tools based on mode
 * - CallTool handler rejects disabled tools in slim mode
 * - Full mode returns all tools (no filtering)
 * - Startup logging includes tool mode
 *
 * These tests operate on the allTools array and handler logic
 * extracted from src/mcp/index.ts, not on the MCP server itself.
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { isToolEnabled, getSlimModeToolCount, SLIM_MODE_TOOLS } from '../../src/mcp/tool-mode';

/**
 * Simulate the tool definitions array from src/mcp/index.ts.
 * Each entry has at minimum: { name, description, inputSchema }.
 * We use minimal stubs since the test focuses on filtering, not schema validation.
 */
const ALL_TOOL_DEFS = [
  // Query tools (excluded in slim)
  { name: 'tana_search', description: 'Full-text search', inputSchema: {} },
  { name: 'tana_tagged', description: 'Find tagged nodes', inputSchema: {} },
  { name: 'tana_field_values', description: 'Query field values', inputSchema: {} },
  { name: 'tana_batch_get', description: 'Batch fetch nodes', inputSchema: {} },
  { name: 'tana_query', description: 'Unified query', inputSchema: {} },
  { name: 'tana_aggregate', description: 'Aggregate nodes', inputSchema: {} },
  { name: 'tana_timeline', description: 'Time-bucketed view', inputSchema: {} },
  { name: 'tana_recent', description: 'Recent items', inputSchema: {} },
  { name: 'tana_table', description: 'Table export', inputSchema: {} },

  // Explore tools (excluded in slim)
  { name: 'tana_supertags', description: 'List supertags', inputSchema: {} },
  { name: 'tana_stats', description: 'Database stats', inputSchema: {} },
  { name: 'tana_supertag_info', description: 'Supertag info', inputSchema: {} },
  { name: 'tana_node', description: 'Show node', inputSchema: {} },
  { name: 'tana_related', description: 'Related nodes', inputSchema: {} },
  { name: 'tana_context', description: 'Context assembler', inputSchema: {} },
  { name: 'tana_schema_audit', description: 'Schema audit', inputSchema: {} },

  // Transcript tools (excluded in slim)
  { name: 'tana_transcript_list', description: 'List transcripts', inputSchema: {} },
  { name: 'tana_transcript_show', description: 'Show transcript', inputSchema: {} },
  { name: 'tana_transcript_search', description: 'Search transcripts', inputSchema: {} },

  // Semantic search (included in slim)
  { name: 'tana_semantic_search', description: 'Semantic search', inputSchema: {} },

  // Entity resolution (included in slim)
  { name: 'tana_resolve', description: 'Entity resolution', inputSchema: {} },

  // Mutation tools (included in slim)
  { name: 'tana_create', description: 'Create node', inputSchema: {} },
  { name: 'tana_batch_create', description: 'Batch create', inputSchema: {} },
  { name: 'tana_update_node', description: 'Update node', inputSchema: {} },
  { name: 'tana_tag_add', description: 'Add tag', inputSchema: {} },
  { name: 'tana_tag_remove', description: 'Remove tag', inputSchema: {} },
  { name: 'tana_create_tag', description: 'Create tag', inputSchema: {} },
  { name: 'tana_set_field', description: 'Set field', inputSchema: {} },
  { name: 'tana_set_field_option', description: 'Set field option', inputSchema: {} },
  { name: 'tana_trash_node', description: 'Trash node', inputSchema: {} },
  { name: 'tana_done', description: 'Mark done', inputSchema: {} },
  { name: 'tana_undone', description: 'Mark undone', inputSchema: {} },

  // Sync & system (included in slim)
  { name: 'tana_sync', description: 'Trigger sync', inputSchema: {} },
  { name: 'tana_cache_clear', description: 'Clear cache', inputSchema: {} },
  { name: 'tana_capabilities', description: 'List capabilities', inputSchema: {} },
  { name: 'tana_tool_schema', description: 'Tool schema', inputSchema: {} },
];

/**
 * Simulate the ListTools filtering logic that should exist in src/mcp/index.ts.
 * This is what we expect the implementation to look like.
 */
function filterToolsByMode(tools: typeof ALL_TOOL_DEFS, mode: 'full' | 'slim') {
  return tools.filter((t) => isToolEnabled(t.name, mode));
}

/**
 * Simulate the CallTool guard check.
 * Returns an error response if the tool is disabled in the current mode.
 */
function checkToolAccess(toolName: string, mode: 'full' | 'slim'): { allowed: true } | { allowed: false; error: string } {
  if (!isToolEnabled(toolName, mode)) {
    return {
      allowed: false,
      error: `Tool '${toolName}' is disabled in slim mode. Switch to full mode or use tana_semantic_search for queries.`,
    };
  }
  return { allowed: true };
}

describe('MCP Tool Mode Integration (T-5.2)', () => {
  describe('ListTools filtering', () => {
    it('returns all tools in full mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'full');
      expect(filtered.length).toBe(ALL_TOOL_DEFS.length);
    });

    it('returns exactly SLIM_MODE_TOOLS count in slim mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      expect(filtered.length).toBe(getSlimModeToolCount());
    });

    it('only includes SLIM_MODE_TOOLS entries in slim mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      for (const tool of filtered) {
        expect(SLIM_MODE_TOOLS.has(tool.name)).toBe(true);
      }
    });

    it('excludes query-only tools in slim mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      const names = filtered.map((t) => t.name);

      expect(names).not.toContain('tana_search');
      expect(names).not.toContain('tana_tagged');
      expect(names).not.toContain('tana_field_values');
      expect(names).not.toContain('tana_batch_get');
      expect(names).not.toContain('tana_query');
      expect(names).not.toContain('tana_aggregate');
      expect(names).not.toContain('tana_timeline');
      expect(names).not.toContain('tana_recent');
    });

    it('excludes explore tools in slim mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      const names = filtered.map((t) => t.name);

      expect(names).not.toContain('tana_supertags');
      expect(names).not.toContain('tana_stats');
      expect(names).not.toContain('tana_supertag_info');
      expect(names).not.toContain('tana_node');
      expect(names).not.toContain('tana_related');
    });

    it('excludes transcript tools in slim mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      const names = filtered.map((t) => t.name);

      expect(names).not.toContain('tana_transcript_list');
      expect(names).not.toContain('tana_transcript_show');
      expect(names).not.toContain('tana_transcript_search');
    });

    it('includes semantic search in slim mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      const names = filtered.map((t) => t.name);

      expect(names).toContain('tana_semantic_search');
    });

    it('includes all mutation tools in slim mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      const names = filtered.map((t) => t.name);

      expect(names).toContain('tana_create');
      expect(names).toContain('tana_batch_create');
      expect(names).toContain('tana_update_node');
      expect(names).toContain('tana_tag_add');
      expect(names).toContain('tana_tag_remove');
      expect(names).toContain('tana_create_tag');
      expect(names).toContain('tana_set_field');
      expect(names).toContain('tana_set_field_option');
      expect(names).toContain('tana_trash_node');
      expect(names).toContain('tana_done');
      expect(names).toContain('tana_undone');
    });

    it('includes system tools in slim mode', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      const names = filtered.map((t) => t.name);

      expect(names).toContain('tana_sync');
      expect(names).toContain('tana_cache_clear');
      expect(names).toContain('tana_capabilities');
      expect(names).toContain('tana_tool_schema');
    });

    it('preserves tool definitions (description, schema) after filtering', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      const semanticTool = filtered.find((t) => t.name === 'tana_semantic_search');

      expect(semanticTool).toBeDefined();
      expect(semanticTool!.description).toBe('Semantic search');
      expect(semanticTool!.inputSchema).toEqual({});
    });
  });

  describe('CallTool guard check', () => {
    it('allows all tools in full mode', () => {
      for (const tool of ALL_TOOL_DEFS) {
        const result = checkToolAccess(tool.name, 'full');
        expect(result.allowed).toBe(true);
      }
    });

    it('allows slim-mode tools in slim mode', () => {
      const slimToolNames = [
        'tana_semantic_search',
        'tana_create',
        'tana_batch_create',
        'tana_sync',
        'tana_cache_clear',
        'tana_capabilities',
        'tana_tool_schema',
        'tana_update_node',
        'tana_tag_add',
        'tana_tag_remove',
        'tana_create_tag',
        'tana_set_field',
        'tana_set_field_option',
        'tana_trash_node',
        'tana_done',
        'tana_undone',
      ];

      for (const toolName of slimToolNames) {
        const result = checkToolAccess(toolName, 'slim');
        expect(result.allowed).toBe(true);
      }
    });

    it('blocks disabled tools in slim mode', () => {
      const disabledTools = [
        'tana_search',
        'tana_tagged',
        'tana_node',
        'tana_related',
        'tana_transcript_list',
      ];

      for (const toolName of disabledTools) {
        const result = checkToolAccess(toolName, 'slim');
        expect(result.allowed).toBe(false);
      }
    });

    it('returns descriptive error message for blocked tools', () => {
      const result = checkToolAccess('tana_search', 'slim');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error).toContain("Tool 'tana_search' is disabled in slim mode");
        expect(result.error).toContain('tana_semantic_search');
      }
    });

    it('error message mentions switching to full mode', () => {
      const result = checkToolAccess('tana_tagged', 'slim');
      if (!result.allowed) {
        expect(result.error).toContain('full mode');
      }
    });
  });

  describe('Tool count consistency', () => {
    it('ALL_TOOL_DEFS matches the real MCP server tool count', () => {
      // The real server has 36 tools as of F-101
      expect(ALL_TOOL_DEFS.length).toBe(36);
    });

    it('slim mode returns 17 tools (from SLIM_MODE_TOOLS)', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      expect(filtered.length).toBe(17);
    });

    it('slim mode excludes 19 tools', () => {
      const filtered = filterToolsByMode(ALL_TOOL_DEFS, 'slim');
      expect(ALL_TOOL_DEFS.length - filtered.length).toBe(19);
    });
  });
});
