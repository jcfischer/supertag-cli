/**
 * Tests for MCP Tool Mode Filter (T-5.1, F-095)
 *
 * Verifies tool mode filtering logic:
 * - Full mode enables all tools
 * - Slim mode enables only essential tools (semantic search, mutations, sync, system)
 * - Correct excluded tool calculation
 */

import { describe, it, expect } from 'bun:test';
import {
  SLIM_MODE_TOOLS,
  isToolEnabled,
  getToolMode,
  getSlimModeToolCount,
  getExcludedTools,
} from '../../src/mcp/tool-mode';

// Known tools from tool-registry.ts for testing
const ALL_TOOL_NAMES = [
  'tana_search',
  'tana_tagged',
  'tana_semantic_search',
  'tana_field_values',
  'tana_batch_get',
  'tana_query',
  'tana_aggregate',
  'tana_timeline',
  'tana_recent',
  'tana_supertags',
  'tana_stats',
  'tana_supertag_info',
  'tana_node',
  'tana_related',
  'tana_transcript_list',
  'tana_transcript_show',
  'tana_transcript_search',
  'tana_create',
  'tana_batch_create',
  'tana_sync',
  'tana_update_node',
  'tana_tag_add',
  'tana_tag_remove',
  'tana_create_tag',
  'tana_set_field',
  'tana_set_field_option',
  'tana_trash_node',
  'tana_done',
  'tana_undone',
  'tana_cache_clear',
  'tana_capabilities',
  'tana_tool_schema',
];

describe('MCP Tool Mode Filter (T-5.1)', () => {
  describe('SLIM_MODE_TOOLS set', () => {
    it('contains all expected slim mode tools', () => {
      const expectedTools = [
        // Semantic search
        'tana_semantic_search',
        // Mutation tools
        'tana_create',
        'tana_batch_create',
        'tana_update_node',
        'tana_tag_add',
        'tana_tag_remove',
        'tana_create_tag',
        'tana_set_field',
        'tana_set_field_option',
        'tana_trash_node',
        'tana_done',
        'tana_undone',
        // Sync & system
        'tana_sync',
        'tana_cache_clear',
        'tana_capabilities',
        'tana_tool_schema',
      ];

      for (const tool of expectedTools) {
        expect(SLIM_MODE_TOOLS.has(tool)).toBe(true);
      }
    });

    it('does not contain query-only tools', () => {
      const queryOnlyTools = [
        'tana_search',
        'tana_tagged',
        'tana_field_values',
        'tana_batch_get',
        'tana_query',
        'tana_aggregate',
        'tana_timeline',
        'tana_recent',
      ];

      for (const tool of queryOnlyTools) {
        expect(SLIM_MODE_TOOLS.has(tool)).toBe(false);
      }
    });

    it('does not contain explore tools', () => {
      const exploreTools = [
        'tana_supertags',
        'tana_stats',
        'tana_supertag_info',
        'tana_node',
        'tana_related',
      ];

      for (const tool of exploreTools) {
        expect(SLIM_MODE_TOOLS.has(tool)).toBe(false);
      }
    });

    it('does not contain transcript tools', () => {
      const transcriptTools = [
        'tana_transcript_list',
        'tana_transcript_show',
        'tana_transcript_search',
      ];

      for (const tool of transcriptTools) {
        expect(SLIM_MODE_TOOLS.has(tool)).toBe(false);
      }
    });

    it('is a Set<string> type', () => {
      expect(SLIM_MODE_TOOLS).toBeInstanceOf(Set);
    });
  });

  describe('isToolEnabled', () => {
    it('returns true for all tools in full mode', () => {
      for (const tool of ALL_TOOL_NAMES) {
        expect(isToolEnabled(tool, 'full')).toBe(true);
      }
    });

    it('returns true for unknown tools in full mode', () => {
      expect(isToolEnabled('tana_unknown_future_tool', 'full')).toBe(true);
    });

    it('returns true for slim-mode tools in slim mode', () => {
      const slimTools = [
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

      for (const tool of slimTools) {
        expect(isToolEnabled(tool, 'slim')).toBe(true);
      }
    });

    it('returns false for non-slim tools in slim mode', () => {
      const nonSlimTools = [
        'tana_search',
        'tana_tagged',
        'tana_field_values',
        'tana_batch_get',
        'tana_query',
        'tana_aggregate',
        'tana_timeline',
        'tana_recent',
        'tana_supertags',
        'tana_stats',
        'tana_supertag_info',
        'tana_node',
        'tana_related',
        'tana_transcript_list',
        'tana_transcript_show',
        'tana_transcript_search',
      ];

      for (const tool of nonSlimTools) {
        expect(isToolEnabled(tool, 'slim')).toBe(false);
      }
    });

    it('returns false for unknown tools in slim mode', () => {
      expect(isToolEnabled('tana_unknown_future_tool', 'slim')).toBe(false);
    });
  });

  describe('getSlimModeToolCount', () => {
    it('returns the correct count of slim mode tools', () => {
      const count = getSlimModeToolCount();
      // 1 semantic + 11 mutation + 4 sync/system = 16
      expect(count).toBe(16);
    });

    it('matches the SLIM_MODE_TOOLS set size', () => {
      expect(getSlimModeToolCount()).toBe(SLIM_MODE_TOOLS.size);
    });
  });

  describe('getExcludedTools', () => {
    it('returns empty array for full mode', () => {
      const excluded = getExcludedTools('full', ALL_TOOL_NAMES);
      expect(excluded).toEqual([]);
    });

    it('returns correct excluded tools for slim mode', () => {
      const excluded = getExcludedTools('slim', ALL_TOOL_NAMES);

      // Should include query-only, explore, and transcript tools
      expect(excluded).toContain('tana_search');
      expect(excluded).toContain('tana_tagged');
      expect(excluded).toContain('tana_field_values');
      expect(excluded).toContain('tana_batch_get');
      expect(excluded).toContain('tana_query');
      expect(excluded).toContain('tana_aggregate');
      expect(excluded).toContain('tana_timeline');
      expect(excluded).toContain('tana_recent');
      expect(excluded).toContain('tana_supertags');
      expect(excluded).toContain('tana_stats');
      expect(excluded).toContain('tana_supertag_info');
      expect(excluded).toContain('tana_node');
      expect(excluded).toContain('tana_related');
      expect(excluded).toContain('tana_transcript_list');
      expect(excluded).toContain('tana_transcript_show');
      expect(excluded).toContain('tana_transcript_search');
    });

    it('does not exclude slim-mode tools', () => {
      const excluded = getExcludedTools('slim', ALL_TOOL_NAMES);

      expect(excluded).not.toContain('tana_semantic_search');
      expect(excluded).not.toContain('tana_create');
      expect(excluded).not.toContain('tana_batch_create');
      expect(excluded).not.toContain('tana_sync');
      expect(excluded).not.toContain('tana_cache_clear');
      expect(excluded).not.toContain('tana_capabilities');
      expect(excluded).not.toContain('tana_tool_schema');
    });

    it('returns correct count of excluded tools', () => {
      const excluded = getExcludedTools('slim', ALL_TOOL_NAMES);
      // Total (32) - Slim (16) = 16 excluded
      expect(excluded.length).toBe(ALL_TOOL_NAMES.length - getSlimModeToolCount());
    });

    it('handles empty allToolNames gracefully', () => {
      const excluded = getExcludedTools('slim', []);
      expect(excluded).toEqual([]);
    });

    it('handles full mode with empty allToolNames', () => {
      const excluded = getExcludedTools('full', []);
      expect(excluded).toEqual([]);
    });
  });

  describe('getToolMode', () => {
    it('returns a valid mode string (full or slim)', () => {
      const mode = getToolMode();
      expect(['full', 'slim']).toContain(mode);
    });
  });
});
