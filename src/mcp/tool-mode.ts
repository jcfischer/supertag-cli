/**
 * MCP Tool Mode Filter (T-5.1, F-095; F-096)
 *
 * Filters MCP tools based on configured tool mode:
 * - 'full': All tools enabled (default)
 * - 'slim': Only essential tools (semantic search, mutations, sync, system)
 * - 'lite': Complement tana-local — analytics, search, offline only (no CRUD)
 *
 * Slim mode reduces context window usage by excluding read-only query,
 * explore, and transcript tools that are redundant when delta-sync
 * provides fresh data via semantic search.
 *
 * Lite mode (F-096) is for users running tana-local MCP alongside supertag-mcp.
 * It excludes all CRUD/mutation tools and read tools that tana-local provides,
 * keeping only analytics, search, transcript, and offline capabilities.
 */

import { ConfigManager } from '../config/manager';

/** Valid MCP tool modes */
export type ToolMode = 'full' | 'slim' | 'lite';

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
 * Tools enabled in lite mode (F-096).
 *
 * Complements tana-local MCP — only tools that tana-local does NOT provide:
 * - Query: FTS5 ranked search, semantic search, unified query, aggregation, timeline, recent, field values
 * - Explore: batch lookups, graph traversal, statistics
 * - Transcript: list, show, search
 * - System: sync, cache, capabilities
 */
export const LITE_MODE_TOOLS: Set<string> = new Set([
  // Query (7)
  'tana_search',
  'tana_semantic_search',
  'tana_query',
  'tana_aggregate',
  'tana_timeline',
  'tana_recent',
  'tana_field_values',

  // Explore (3)
  'tana_batch_get',
  'tana_related',
  'tana_stats',

  // Transcript (3)
  'tana_transcript_list',
  'tana_transcript_show',
  'tana_transcript_search',

  // System (3)
  'tana_sync',
  'tana_cache_clear',
  'tana_capabilities',
]);

/**
 * Maps excluded lite-mode tools to their tana-local MCP equivalents.
 * Used in rejection messages to guide users to the right tool.
 */
export const LITE_TOOL_MAPPING: Record<string, string> = {
  tana_create: 'import_tana_paste',
  tana_batch_create: 'import_tana_paste',
  tana_update_node: 'edit_node',
  tana_tag_add: 'tag (action: add)',
  tana_tag_remove: 'tag (action: remove)',
  tana_create_tag: 'create_tag',
  tana_set_field: 'set_field_content',
  tana_set_field_option: 'set_field_option',
  tana_trash_node: 'trash_node',
  tana_done: 'check_node',
  tana_undone: 'uncheck_node',
  tana_node: 'read_node',
  tana_supertags: 'list_tags',
  tana_supertag_info: 'get_tag_schema',
  tana_tagged: 'search_nodes (hasType filter)',
  tana_tool_schema: 'tana_capabilities',
};

/**
 * Check if a tool is enabled for the given mode.
 *
 * @param toolName - MCP tool name (e.g., 'tana_search')
 * @param mode - 'full' enables all tools, 'slim'/'lite' enable subsets
 * @returns true if the tool should be registered
 */
export function isToolEnabled(toolName: string, mode: ToolMode): boolean {
  if (mode === 'full') return true;
  if (mode === 'lite') return LITE_MODE_TOOLS.has(toolName);
  return SLIM_MODE_TOOLS.has(toolName);
}

/**
 * Get the current tool mode from configuration.
 *
 * @returns 'full', 'slim', or 'lite' based on ConfigManager
 */
export function getToolMode(): ToolMode {
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
 * Get the number of tools in lite mode.
 *
 * @returns Count of tools in LITE_MODE_TOOLS set
 */
export function getLiteModeToolCount(): number {
  return LITE_MODE_TOOLS.size;
}

/**
 * Get tool names that would be excluded for a given mode.
 *
 * @param mode - 'full', 'slim', or 'lite'
 * @param allToolNames - Complete list of tool names to filter against
 * @returns Array of tool names excluded in the given mode
 */
export function getExcludedTools(mode: ToolMode, allToolNames: string[]): string[] {
  if (mode === 'full') return [];
  if (mode === 'lite') return allToolNames.filter((name) => !LITE_MODE_TOOLS.has(name));
  return allToolNames.filter((name) => !SLIM_MODE_TOOLS.has(name));
}
