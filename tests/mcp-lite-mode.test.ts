/**
 * MCP Lite Mode Tests (F-096)
 *
 * Tests for the lite tool mode that complements tana-local MCP.
 * Covers: tool set membership, mapping coverage, capabilities filtering,
 * rejection messages, and regression checks for full/slim modes.
 */

import { describe, it, expect } from 'bun:test';
import {
  LITE_MODE_TOOLS,
  LITE_TOOL_MAPPING,
  SLIM_MODE_TOOLS,
  isToolEnabled,
  getSlimModeToolCount,
  getLiteModeToolCount,
  getExcludedTools,
  type ToolMode,
} from '../src/mcp/tool-mode';
import { getCapabilities, listToolNames, TOOL_METADATA } from '../src/mcp/tool-registry';

// All registered tool names from the tool registry
const ALL_TOOL_NAMES = listToolNames();

// Mutation tools that must NOT be in lite mode
const MUTATION_TOOLS = [
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
];

// =============================================================================
// T-4.1: Tool Mode Unit Tests
// =============================================================================

describe('LITE_MODE_TOOLS set', () => {
  it('has exactly 18 entries', () => {
    expect(LITE_MODE_TOOLS.size).toBe(18);
  });

  it('contains expected query tools (8)', () => {
    const queryTools = [
      'tana_search',
      'tana_semantic_search',
      'tana_query',
      'tana_aggregate',
      'tana_timeline',
      'tana_recent',
      'tana_field_values',
      'tana_table',
    ];
    for (const tool of queryTools) {
      expect(LITE_MODE_TOOLS.has(tool)).toBe(true);
    }
  });

  it('contains expected explore tools (4)', () => {
    const exploreTools = ['tana_batch_get', 'tana_related', 'tana_stats', 'tana_schema_audit'];
    for (const tool of exploreTools) {
      expect(LITE_MODE_TOOLS.has(tool)).toBe(true);
    }
  });

  it('contains expected transcript tools (3)', () => {
    const transcriptTools = [
      'tana_transcript_list',
      'tana_transcript_show',
      'tana_transcript_search',
    ];
    for (const tool of transcriptTools) {
      expect(LITE_MODE_TOOLS.has(tool)).toBe(true);
    }
  });

  it('contains expected system tools (3)', () => {
    const systemTools = ['tana_sync', 'tana_cache_clear', 'tana_capabilities'];
    for (const tool of systemTools) {
      expect(LITE_MODE_TOOLS.has(tool)).toBe(true);
    }
  });

  it('does NOT contain any mutation tools (zero CRUD overlap)', () => {
    for (const tool of MUTATION_TOOLS) {
      expect(LITE_MODE_TOOLS.has(tool)).toBe(false);
    }
  });

  it('does NOT contain tana_tool_schema', () => {
    expect(LITE_MODE_TOOLS.has('tana_tool_schema')).toBe(false);
  });

  it('does NOT contain tana_node (tana-local has read_node)', () => {
    expect(LITE_MODE_TOOLS.has('tana_node')).toBe(false);
  });

  it('does NOT contain tana_supertags (tana-local has list_tags)', () => {
    expect(LITE_MODE_TOOLS.has('tana_supertags')).toBe(false);
  });

  it('does NOT contain tana_tagged (tana-local has search_nodes hasType)', () => {
    expect(LITE_MODE_TOOLS.has('tana_tagged')).toBe(false);
  });

  it('does NOT contain tana_supertag_info (tana-local has get_tag_schema)', () => {
    expect(LITE_MODE_TOOLS.has('tana_supertag_info')).toBe(false);
  });
});

describe('isToolEnabled() for lite mode', () => {
  it('returns true for included tools', () => {
    expect(isToolEnabled('tana_search', 'lite')).toBe(true);
    expect(isToolEnabled('tana_semantic_search', 'lite')).toBe(true);
    expect(isToolEnabled('tana_aggregate', 'lite')).toBe(true);
    expect(isToolEnabled('tana_transcript_search', 'lite')).toBe(true);
    expect(isToolEnabled('tana_capabilities', 'lite')).toBe(true);
  });

  it('returns false for excluded tools', () => {
    expect(isToolEnabled('tana_create', 'lite')).toBe(false);
    expect(isToolEnabled('tana_node', 'lite')).toBe(false);
    expect(isToolEnabled('tana_supertags', 'lite')).toBe(false);
    expect(isToolEnabled('tana_update_node', 'lite')).toBe(false);
    expect(isToolEnabled('tana_tool_schema', 'lite')).toBe(false);
  });
});

describe('isToolEnabled() regression (full mode)', () => {
  it('returns true for ALL tools in full mode', () => {
    for (const toolName of ALL_TOOL_NAMES) {
      expect(isToolEnabled(toolName, 'full')).toBe(true);
    }
  });
});

describe('isToolEnabled() regression (slim mode)', () => {
  it('returns true for slim tools', () => {
    expect(isToolEnabled('tana_semantic_search', 'slim')).toBe(true);
    expect(isToolEnabled('tana_create', 'slim')).toBe(true);
    expect(isToolEnabled('tana_sync', 'slim')).toBe(true);
  });

  it('returns false for excluded slim tools', () => {
    expect(isToolEnabled('tana_search', 'slim')).toBe(false);
    expect(isToolEnabled('tana_aggregate', 'slim')).toBe(false);
  });
});

describe('getLiteModeToolCount()', () => {
  it('returns 18', () => {
    expect(getLiteModeToolCount()).toBe(18);
  });
});

describe('getSlimModeToolCount() regression', () => {
  it('returns the slim tool count', () => {
    expect(getSlimModeToolCount()).toBe(SLIM_MODE_TOOLS.size);
  });
});

describe('getExcludedTools()', () => {
  it('returns empty array for full mode', () => {
    expect(getExcludedTools('full', ALL_TOOL_NAMES)).toEqual([]);
  });

  it('excludes correct count for lite mode', () => {
    const excluded = getExcludedTools('lite', ALL_TOOL_NAMES);
    expect(excluded.length).toBe(ALL_TOOL_NAMES.length - 17);
  });

  it('excludes correct count for slim mode', () => {
    const excluded = getExcludedTools('slim', ALL_TOOL_NAMES);
    expect(excluded.length).toBe(ALL_TOOL_NAMES.length - SLIM_MODE_TOOLS.size);
  });
});

// =============================================================================
// T-4.1 continued: LITE_TOOL_MAPPING tests
// =============================================================================

describe('LITE_TOOL_MAPPING', () => {
  it('covers all excluded tools', () => {
    const excluded = getExcludedTools('lite', ALL_TOOL_NAMES);
    for (const tool of excluded) {
      expect(LITE_TOOL_MAPPING[tool]).toBeDefined();
    }
  });

  it('keys are disjoint from LITE_MODE_TOOLS', () => {
    for (const key of Object.keys(LITE_TOOL_MAPPING)) {
      expect(LITE_MODE_TOOLS.has(key)).toBe(false);
    }
  });

  it('union of LITE_MODE_TOOLS and LITE_TOOL_MAPPING keys covers all tools', () => {
    const liteTools = new Set(LITE_MODE_TOOLS);
    const mappingKeys = new Set(Object.keys(LITE_TOOL_MAPPING));
    const combined = new Set([...liteTools, ...mappingKeys]);
    for (const toolName of ALL_TOOL_NAMES) {
      expect(combined.has(toolName)).toBe(true);
    }
  });

  it('maps mutation tools to tana-local equivalents', () => {
    expect(LITE_TOOL_MAPPING['tana_create']).toBe('import_tana_paste');
    expect(LITE_TOOL_MAPPING['tana_update_node']).toBe('edit_node');
    expect(LITE_TOOL_MAPPING['tana_done']).toBe('check_node');
    expect(LITE_TOOL_MAPPING['tana_undone']).toBe('uncheck_node');
    expect(LITE_TOOL_MAPPING['tana_trash_node']).toBe('trash_node');
  });

  it('maps read tools to tana-local equivalents', () => {
    expect(LITE_TOOL_MAPPING['tana_node']).toBe('read_node');
    expect(LITE_TOOL_MAPPING['tana_supertags']).toBe('list_tags');
    expect(LITE_TOOL_MAPPING['tana_supertag_info']).toBe('get_tag_schema');
    expect(LITE_TOOL_MAPPING['tana_tagged']).toBe('search_nodes (hasType filter)');
  });
});

// =============================================================================
// T-4.2: Capabilities Integration Tests
// =============================================================================

describe('getCapabilities() with mode filtering', () => {
  it('full mode returns all tools', () => {
    const caps = getCapabilities({ mode: 'full' });
    const totalTools = caps.categories.reduce((sum, c) => sum + c.tools.length, 0);
    expect(totalTools).toBe(ALL_TOOL_NAMES.length);
    expect(caps.mode).toBeUndefined();
  });

  it('lite mode returns only 17 tools', () => {
    const caps = getCapabilities({ mode: 'lite' });
    const totalTools = caps.categories.reduce((sum, c) => sum + c.tools.length, 0);
    expect(totalTools).toBe(17);
    expect(caps.mode).toBe('lite');
  });

  // Note: category counts follow TOOL_METADATA assignments, not conceptual grouping.
  // tana_batch_get is in 'query', tana_sync is in 'mutate' per the registry.
  it('lite mode: query category has 9 tools (includes batch_get, table)', () => {
    const caps = getCapabilities({ category: 'query', mode: 'lite' });
    const queryCategory = caps.categories.find((c) => c.name === 'query');
    expect(queryCategory?.tools.length).toBe(9);
  });

  it('lite mode: explore category has 2 tools (stats, related)', () => {
    const caps = getCapabilities({ category: 'explore', mode: 'lite' });
    const exploreCategory = caps.categories.find((c) => c.name === 'explore');
    expect(exploreCategory?.tools.length).toBe(2);
  });

  it('lite mode: transcript category has 3 tools', () => {
    const caps = getCapabilities({ category: 'transcript', mode: 'lite' });
    const transcriptCategory = caps.categories.find((c) => c.name === 'transcript');
    expect(transcriptCategory?.tools.length).toBe(3);
  });

  it('lite mode: mutate category has 1 tool (tana_sync only)', () => {
    const caps = getCapabilities({ category: 'mutate', mode: 'lite' });
    const mutateCategory = caps.categories.find((c) => c.name === 'mutate');
    expect(mutateCategory?.tools.length).toBe(1);
    expect(mutateCategory?.tools[0].name).toBe('tana_sync');
  });

  it('lite mode: system category has 2 tools (no tana_tool_schema)', () => {
    const caps = getCapabilities({ category: 'system', mode: 'lite' });
    const systemCategory = caps.categories.find((c) => c.name === 'system');
    expect(systemCategory?.tools.length).toBe(2);
    const toolNames = systemCategory?.tools.map((t) => t.name) ?? [];
    expect(toolNames).not.toContain('tana_tool_schema');
    expect(toolNames).toContain('tana_capabilities');
  });

  it('full mode capabilities unchanged (regression)', () => {
    const caps = getCapabilities({ mode: 'full' });
    const mutateCategory = caps.categories.find((c) => c.name === 'mutate');
    expect(mutateCategory!.tools.length).toBeGreaterThan(0);
  });

  it('no mode parameter defaults to full', () => {
    const caps = getCapabilities();
    const totalTools = caps.categories.reduce((sum, c) => sum + c.tools.length, 0);
    expect(totalTools).toBe(ALL_TOOL_NAMES.length);
  });
});

// =============================================================================
// T-4.3: Rejection Message Tests
// =============================================================================

describe('Rejection message content', () => {
  // Test the rejection logic directly (mirrors index.ts guard)
  function buildRejectionMessage(toolName: string, mode: ToolMode): string {
    const mapping = LITE_TOOL_MAPPING[toolName];
    const suggestion =
      mode === 'lite' && mapping ? ` Use tana-local's '${mapping}' instead.` : '';
    return `Tool '${toolName}' is not available in ${mode} mode.${suggestion} Switch to full mode for standalone access.`;
  }

  it('lite mode: tana_create mentions import_tana_paste', () => {
    const msg = buildRejectionMessage('tana_create', 'lite');
    expect(msg).toContain('import_tana_paste');
    expect(msg).toContain('lite mode');
    expect(msg).toContain('tana-local');
  });

  it('lite mode: tana_node mentions read_node', () => {
    const msg = buildRejectionMessage('tana_node', 'lite');
    expect(msg).toContain('read_node');
    expect(msg).toContain('tana-local');
  });

  it('lite mode: tana_done mentions check_node', () => {
    const msg = buildRejectionMessage('tana_done', 'lite');
    expect(msg).toContain('check_node');
  });

  it('lite mode: includes switch to full mode suggestion', () => {
    const msg = buildRejectionMessage('tana_create', 'lite');
    expect(msg).toContain('Switch to full mode');
  });

  it('slim mode: generic message without tana-local suggestion', () => {
    const msg = buildRejectionMessage('tana_search', 'slim');
    expect(msg).not.toContain('tana-local');
    expect(msg).toContain('slim mode');
    expect(msg).toContain('Switch to full mode');
  });

  it('all excluded lite tools produce a mapping suggestion', () => {
    const excluded = getExcludedTools('lite', ALL_TOOL_NAMES);
    for (const tool of excluded) {
      const msg = buildRejectionMessage(tool, 'lite');
      expect(msg).toContain('tana-local');
    }
  });
});
