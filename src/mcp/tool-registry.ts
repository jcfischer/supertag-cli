/**
 * Tool Registry for Progressive Disclosure
 *
 * Centralizes MCP tool metadata for the progressive disclosure pattern.
 * Provides lightweight capabilities inventory and on-demand schema loading.
 *
 * Spec: 061-progressive-disclosure
 */

import { VERSION } from '../version.js';
import * as schemas from './schemas.js';

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
  {
    name: 'tana_batch_get',
    description: 'Fetch multiple nodes by ID',
    category: 'query',
    example: 'Get 5 nodes in a single request',
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
    name: 'tana_batch_create',
    description: 'Create multiple nodes in one request',
    category: 'mutate',
    example: 'Create 10 #todo items at once',
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

// =============================================================================
// Schema Registry (maps tool names to their Zod schemas)
// =============================================================================

const TOOL_SCHEMAS: Record<string, ReturnType<typeof schemas.zodToJsonSchema>> = {
  tana_search: schemas.zodToJsonSchema(schemas.searchSchema),
  tana_tagged: schemas.zodToJsonSchema(schemas.taggedSchema),
  tana_semantic_search: schemas.zodToJsonSchema(schemas.semanticSearchSchema),
  tana_field_values: schemas.zodToJsonSchema(schemas.fieldValuesSchema),
  tana_batch_get: schemas.zodToJsonSchema(schemas.batchGetSchema),
  tana_batch_create: schemas.zodToJsonSchema(schemas.batchCreateSchema),
  tana_supertags: schemas.zodToJsonSchema(schemas.supertagsSchema),
  tana_stats: schemas.zodToJsonSchema(schemas.statsSchema),
  tana_supertag_info: schemas.zodToJsonSchema(schemas.supertagInfoSchema),
  tana_node: schemas.zodToJsonSchema(schemas.nodeSchema),
  tana_transcript_list: schemas.zodToJsonSchema(schemas.transcriptListSchema),
  tana_transcript_show: schemas.zodToJsonSchema(schemas.transcriptShowSchema),
  tana_transcript_search: schemas.zodToJsonSchema(schemas.transcriptSearchSchema),
  tana_create: schemas.zodToJsonSchema(schemas.createSchema),
  tana_sync: schemas.zodToJsonSchema(schemas.syncSchema),
  tana_cache_clear: schemas.zodToJsonSchema(schemas.cacheClearSchema),
  tana_capabilities: schemas.zodToJsonSchema(schemas.capabilitiesSchema),
  tana_tool_schema: schemas.zodToJsonSchema(schemas.toolSchemaSchema),
};

// =============================================================================
// Schema Cache (session-level caching)
// =============================================================================

const schemaCache = new Map<string, Record<string, unknown>>();

// =============================================================================
// Public API
// =============================================================================

/**
 * Get lightweight capabilities inventory
 */
export function getCapabilities(filter?: { category?: CategoryName }): CapabilitiesResponse {
  const categoryNames: CategoryName[] = ['query', 'explore', 'transcript', 'mutate', 'system'];
  const filteredCategories = filter?.category ? [filter.category] : categoryNames;

  const categories: ToolCategory[] = filteredCategories.map((categoryName) => {
    const tools = TOOL_METADATA.filter((t) => t.category === categoryName).map(
      (t): ToolSummary => ({
        name: t.name,
        description: t.description,
        example: t.example,
      })
    );

    return {
      name: categoryName,
      description: CATEGORY_DESCRIPTIONS[categoryName],
      tools,
    };
  });

  return {
    version: VERSION,
    categories,
    quickActions: QUICK_ACTIONS,
  };
}

/**
 * Get full JSON schema for a tool (cached)
 */
export function getToolSchema(toolName: string): Record<string, unknown> | null {
  // Check cache first
  if (schemaCache.has(toolName)) {
    return schemaCache.get(toolName)!;
  }

  // Get schema from registry
  const schema = TOOL_SCHEMAS[toolName];
  if (!schema) {
    return null;
  }

  // Cache and return
  schemaCache.set(toolName, schema);
  return schema;
}

/**
 * Check if tool exists
 */
export function hasTools(toolName: string): boolean {
  return TOOL_METADATA.some((t) => t.name === toolName);
}

/**
 * List all tool names
 */
export function listToolNames(): string[] {
  return TOOL_METADATA.map((t) => t.name);
}
