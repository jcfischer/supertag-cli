/**
 * MCP Tool Mode Filter (T-5.1, F-095)
 *
 * Filters MCP tools based on configured tool mode:
 * - 'full': All tools enabled (default)
 * - 'slim': Only essential tools (semantic search, mutations, sync, system)
 *
 * Slim mode reduces context window usage by excluding read-only query,
 * explore, and transcript tools that are redundant when delta-sync
 * provides fresh data via semantic search.
 */

import { ConfigManager } from '../config/manager';

/**
 * Tools enabled in slim mode.
 *
 * Categories:
 * - Semantic search: primary query mechanism with delta-sync
 * - Mutation tools: create, update, tag, field operations
 * - Sync & system: sync trigger, cache, capabilities, schema
 */
export const SLIM_MODE_TOOLS: Set<string> = new Set([
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
]);

/**
 * Check if a tool is enabled for the given mode.
 *
 * @param toolName - MCP tool name (e.g., 'tana_search')
 * @param mode - 'full' enables all tools, 'slim' enables only SLIM_MODE_TOOLS
 * @returns true if the tool should be registered
 */
export function isToolEnabled(toolName: string, mode: 'full' | 'slim'): boolean {
  if (mode === 'full') return true;
  return SLIM_MODE_TOOLS.has(toolName);
}

/**
 * Get the current tool mode from configuration.
 *
 * @returns 'full' or 'slim' based on ConfigManager
 */
export function getToolMode(): 'full' | 'slim' {
  return ConfigManager.getInstance().getMcpToolMode();
}

/**
 * Get the number of tools in slim mode.
 *
 * @returns Count of tools in SLIM_MODE_TOOLS set
 */
export function getSlimModeToolCount(): number {
  return SLIM_MODE_TOOLS.size;
}

/**
 * Get tool names that would be excluded for a given mode.
 *
 * @param mode - 'full' or 'slim'
 * @param allToolNames - Complete list of tool names to filter against
 * @returns Array of tool names excluded in the given mode
 */
export function getExcludedTools(mode: 'full' | 'slim', allToolNames: string[]): string[] {
  if (mode === 'full') return [];
  return allToolNames.filter((name) => !SLIM_MODE_TOOLS.has(name));
}
