/**
 * Tool Registry for Progressive Disclosure
 *
 * Centralizes MCP tool metadata for the progressive disclosure pattern.
 * Provides lightweight capabilities inventory and on-demand schema loading.
 *
 * Spec: 061-progressive-disclosure
 */

// =============================================================================
// Types
// =============================================================================

/** Valid category names for tool grouping */
export type CategoryName = 'query' | 'explore' | 'transcript' | 'mutate' | 'system';

/** Lightweight tool info for capabilities response */
export interface ToolSummary {
  name: string;
  description: string;
  example?: string;
}

/** Tool category grouping */
export interface ToolCategory {
  name: CategoryName;
  description: string;
  tools: ToolSummary[];
}

/** Full tool metadata including category assignment */
export interface ToolMetadata {
  name: string;
  description: string;
  category: CategoryName;
  example?: string;
}

/** Capabilities response structure */
export interface CapabilitiesResponse {
  version: string;
  categories: ToolCategory[];
  quickActions: string[];
}

// =============================================================================
// Constants
// =============================================================================

/** Category descriptions for capabilities response */
export const CATEGORY_DESCRIPTIONS: Record<CategoryName, string> = {
  query: 'Find and search nodes',
  explore: 'Explore workspace structure',
  transcript: 'Meeting transcript operations',
  mutate: 'Create and modify data',
  system: 'System and meta operations',
};

/** Quick actions for common operations */
export const QUICK_ACTIONS: string[] = ['search', 'create', 'tagged', 'show'];

/** Complete tool metadata registry */
export const TOOL_METADATA: ToolMetadata[] = [
  // Query tools
  {
    name: 'tana_search',
    description: 'Full-text search on node names',
    category: 'query',
    example: 'Find all notes mentioning TypeScript',
  },
  {
    name: 'tana_tagged',
    description: 'Find nodes by supertag',
    category: 'query',
    example: 'List all #todo items',
  },
  {
    name: 'tana_semantic_search',
    description: 'Vector similarity search',
    category: 'query',
    example: 'Find conceptually related content',
  },
  {
    name: 'tana_field_values',
    description: 'Query field values',
    category: 'query',
    example: 'Get all Status field values',
  },

  // Explore tools
  {
    name: 'tana_supertags',
    description: 'List available supertags',
    category: 'explore',
    example: 'Show all supertags with counts',
  },
  {
    name: 'tana_stats',
    description: 'Database statistics',
    category: 'explore',
    example: 'Get node and tag counts',
  },
  {
    name: 'tana_supertag_info',
    description: 'Supertag fields and inheritance',
    category: 'explore',
    example: 'Show fields for #meeting tag',
  },
  {
    name: 'tana_node',
    description: 'Show node details',
    category: 'explore',
    example: 'Get full contents of a node',
  },

  // Transcript tools
  {
    name: 'tana_transcript_list',
    description: 'List meetings with transcripts',
    category: 'transcript',
    example: 'Show all recorded meetings',
  },
  {
    name: 'tana_transcript_show',
    description: 'Show transcript content',
    category: 'transcript',
    example: 'View transcript for a meeting',
  },
  {
    name: 'tana_transcript_search',
    description: 'Search within transcripts',
    category: 'transcript',
    example: 'Find mentions in transcripts',
  },

  // Mutate tools
  {
    name: 'tana_create',
    description: 'Create new node with supertag',
    category: 'mutate',
    example: 'Create a new #todo item',
  },
  {
    name: 'tana_sync',
    description: 'Reindex or check sync status',
    category: 'mutate',
    example: 'Trigger database reindex',
  },

  // System tools
  {
    name: 'tana_cache_clear',
    description: 'Clear workspace cache',
    category: 'system',
    example: 'Refresh workspace data',
  },
  {
    name: 'tana_capabilities',
    description: 'List available tools (this tool)',
    category: 'system',
    example: 'Discover available operations',
  },
  {
    name: 'tana_tool_schema',
    description: 'Get full schema for a tool',
    category: 'system',
    example: 'Load detailed tana_search schema',
  },
];
