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
import { isToolEnabled, type ToolMode } from './tool-mode.js';

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
  mode?: string;
  categories: ToolCategory[];
  quickActions: string[];
}

// =============================================================================
// Constants
// =============================================================================

/** Category descriptions for capabilities response */
export const CATEGORY_DESCRIPTIONS: Record<CategoryName, string> = {
  query: 'Find nodes',
  explore: 'Explore structure',
  transcript: 'Transcripts',
  mutate: 'Modify data',
  system: 'System',
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
    example: 'Search TypeScript notes',
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
    example: 'Find related content',
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
    example: 'Get 5 nodes',
  },
  {
    name: 'tana_query',
    description: 'Unified query with tag, field, and date filtering',
    category: 'query',
    example: 'Find active tasks',
  },
  {
    name: 'tana_aggregate',
    description: 'Group and count nodes',
    category: 'query',
    example: 'Count tasks by Status',
  },
  {
    name: 'tana_timeline',
    description: 'Time-bucketed activity',
    category: 'query',
    example: 'Last 30 days by week',
  },
  {
    name: 'tana_recent',
    description: 'Recently created or updated items',
    category: 'query',
    example: 'Last 24 hours: { period: "24h" }',
  },
  {
    name: 'tana_table',
    description: 'Export supertag instances as a table',
    category: 'query',
    example: 'Export #book table',
  },
  {
    name: 'tana_resolve',
    description: 'Find existing node by name with confidence scoring',
    category: 'query',
    example: 'Find #person named Daniel',
  },
  {
    name: 'tana_graph_query',
    description: 'Graph query with traversal',
    category: 'query',
    example: 'FIND person CONNECTED TO project',
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
  {
    name: 'tana_related',
    description: 'Find nodes related via references and children',
    category: 'explore',
    example: 'Find all nodes connected to a project',
  },
  {
    name: 'tana_context',
    description: 'Assemble graph context',
    category: 'explore',
    example: 'Context for project X',
  },
  {
    name: 'tana_schema_audit',
    description: 'Audit supertag schema health',
    category: 'explore',
    example: 'Find schema warnings',
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
    description: 'Create node with supertag',
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
  {
    name: 'tana_update_node',
    description: 'Update node name or description',
    category: 'mutate',
    example: 'Rename a node or change its description',
  },
  {
    name: 'tana_tag_add',
    description: 'Add supertags to a node',
    category: 'mutate',
    example: 'Tag a node with #project',
  },
  {
    name: 'tana_tag_remove',
    description: 'Remove supertags from a node',
    category: 'mutate',
    example: 'Untag a node',
  },
  {
    name: 'tana_create_tag',
    description: 'Create a new supertag definition',
    category: 'mutate',
    example: 'Create a new #sprint supertag',
  },
  {
    name: 'tana_set_field',
    description: 'Set or append a field value on a node',
    category: 'mutate',
    example: 'Append a note to a multi-value field',
  },
  {
    name: 'tana_set_field_option',
    description: 'Set or append a field option',
    category: 'mutate',
    example: 'Append an option to a multi-value field',
  },
  {
    name: 'tana_trash_node',
    description: 'Move a node to trash',
    category: 'mutate',
    example: 'Delete a node by moving to trash',
  },
  {
    name: 'tana_done',
    description: 'Mark a node as done (checked)',
    category: 'mutate',
    example: 'Complete a todo item',
  },
  {
    name: 'tana_undone',
    description: 'Mark a node as not done (unchecked)',
    category: 'mutate',
    example: 'Reopen a completed item',
  },

  // PAI tools
  {
    name: 'tana_pai_sync',
    description: 'Sync PAI learnings from seed.json to Tana',
    category: 'mutate',
    example: 'Sync learnings',
  },
  {
    name: 'tana_pai_context',
    description: 'Get PAI topic context',
    category: 'query',
    example: 'Context for TypeScript',
  },
  {
    name: 'tana_pai_freshness',
    description: 'Assess PAI freshness',
    category: 'query',
    example: 'Check stale learnings',
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
  tana_related: schemas.zodToJsonSchema(schemas.relatedSchema),
  tana_context: schemas.zodToJsonSchema(schemas.contextSchema),
  tana_transcript_list: schemas.zodToJsonSchema(schemas.transcriptListSchema),
  tana_transcript_show: schemas.zodToJsonSchema(schemas.transcriptShowSchema),
  tana_transcript_search: schemas.zodToJsonSchema(schemas.transcriptSearchSchema),
  tana_create: schemas.zodToJsonSchema(schemas.createSchema),
  tana_sync: schemas.zodToJsonSchema(schemas.syncSchema),
  tana_cache_clear: schemas.zodToJsonSchema(schemas.cacheClearSchema),
  tana_capabilities: schemas.zodToJsonSchema(schemas.capabilitiesSchema),
  tana_tool_schema: schemas.zodToJsonSchema(schemas.toolSchemaSchema),
  tana_query: schemas.zodToJsonSchema(schemas.querySchema),
  tana_aggregate: schemas.zodToJsonSchema(schemas.aggregateSchema),
  tana_timeline: schemas.zodToJsonSchema(schemas.timelineSchema),
  tana_recent: schemas.zodToJsonSchema(schemas.recentSchema),
  tana_update_node: schemas.zodToJsonSchema(schemas.updateNodeSchema),
  tana_tag_add: schemas.zodToJsonSchema(schemas.tagAddSchema),
  tana_tag_remove: schemas.zodToJsonSchema(schemas.tagRemoveSchema),
  tana_create_tag: schemas.zodToJsonSchema(schemas.createTagSchema),
  tana_set_field: schemas.zodToJsonSchema(schemas.setFieldSchema),
  tana_set_field_option: schemas.zodToJsonSchema(schemas.setFieldOptionSchema),
  tana_trash_node: schemas.zodToJsonSchema(schemas.trashNodeSchema),
  tana_done: schemas.zodToJsonSchema(schemas.doneSchema),
  tana_undone: schemas.zodToJsonSchema(schemas.undoneSchema),
  tana_table: schemas.zodToJsonSchema(schemas.tableSchema),
  tana_resolve: schemas.zodToJsonSchema(schemas.resolveSchema),
  tana_schema_audit: schemas.zodToJsonSchema(schemas.schemaAuditSchema),
  tana_graph_query: schemas.zodToJsonSchema(schemas.graphQuerySchema),
  tana_pai_sync: schemas.zodToJsonSchema(schemas.paiSyncSchema),
  tana_pai_context: schemas.zodToJsonSchema(schemas.paiContextSchema),
  tana_pai_freshness: schemas.zodToJsonSchema(schemas.paiFreshnessSchema),
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
export function getCapabilities(filter?: { category?: CategoryName; mode?: ToolMode }): CapabilitiesResponse {
  const categoryNames: CategoryName[] = ['query', 'explore', 'transcript', 'mutate', 'system'];
  const filteredCategories = filter?.category ? [filter.category] : categoryNames;
  const mode = filter?.mode ?? 'full';

  const categories: ToolCategory[] = filteredCategories.map((categoryName) => {
    const tools = TOOL_METADATA
      .filter((t) => t.category === categoryName && isToolEnabled(t.name, mode))
      .map(
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
    mode: mode !== 'full' ? mode : undefined,
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
