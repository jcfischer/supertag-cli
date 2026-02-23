#!/usr/bin/env bun
/**
 * Supertag MCP Server
 *
 * Model Context Protocol server for Tana integration.
 * Enables AI tools (ChatGPT, Cursor, Claude, etc.) to query Tana data.
 *
 * IMPORTANT: MCP uses stdio for JSON-RPC communication.
 * All logging MUST go to stderr, never stdout.
 *
 * Semantic search uses resona/LanceDB (no SQLite extensions needed).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as schemas from './schemas.js';
import { search } from './tools/search.js';
import { tagged } from './tools/tagged.js';
import { stats } from './tools/stats.js';
import { supertags } from './tools/supertags.js';
import { showNode } from './tools/node.js';
import { related } from './tools/related.js';
import { create } from './tools/create.js';
import { sync } from './tools/sync.js';
import { semanticSearch } from './tools/semantic-search.js';
import { fieldValues } from './tools/field-values.js';
import { tableExport } from './tools/table.js';
import { supertagInfo } from './tools/supertag-info.js';
import { transcriptList, transcriptShow, transcriptSearch } from './tools/transcript.js';
import { cacheClear } from './tools/cache.js';
import { capabilities } from './tools/capabilities.js';
import { toolSchema } from './tools/tool-schema.js';
import { batchGet } from './tools/batch-get.js';
import { batchCreate } from './tools/batch-create.js';
import { query } from './tools/query.js';
import { aggregate } from './tools/aggregate.js';
import { timeline, recent } from './tools/timeline.js';
import { handleUpdateNode } from './tools/update.js';
import { handleTagAdd, handleTagRemove } from './tools/tag-operations.js';
import { handleCreateTag } from './tools/tag-create.js';
import { handleSetField, handleSetFieldOption } from './tools/set-field.js';
import { handleTrashNode } from './tools/trash.js';
import { handleDone, handleUndone } from './tools/done.js';
import { VERSION } from '../version.js';
import { createLogger } from '../utils/logger.js';
import { handleMcpError } from './error-handler.js';
import { isToolEnabled, getToolMode, getSlimModeToolCount, getLiteModeToolCount, LITE_TOOL_MAPPING } from './tool-mode.js';
import { initDeltaSyncPoller, type DeltaSyncPoller } from './delta-sync-poller.js';

// CLI flag parsing (highest priority override for tool mode)
if (process.argv.includes('--lite')) {
  process.env.TANA_MCP_TOOL_MODE = 'lite';
} else if (process.argv.includes('--slim')) {
  process.env.TANA_MCP_TOOL_MODE = 'slim';
}

const SERVICE_NAME = process.env.SERVICE_NAME || 'supertag-mcp';

/**
 * MCP-safe logger - configured to write to stderr to avoid interfering with stdio JSON-RPC
 * Uses unified logger with explicit stderr stream for MCP protocol compliance
 */
const logger = createLogger({
  level: process.env.DEBUG ? 'debug' : 'info',
  mode: 'unix',  // Clean format without emojis for log processing
  stream: process.stderr,  // Required for MCP - stdout is reserved for JSON-RPC
}).child(SERVICE_NAME);

const server = new Server(
  {
    name: 'supertag-mcp',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * All tool definitions. Defined outside handlers so both ListTools and
 * CallTool can reference the same canonical list.
 */
const allTools = [
  {
        name: 'tana_search',
        description:
          'Full-text search on Tana node names. Returns matching nodes with their IDs, names, relevance rank, and supertags. By default includes ancestor context: when a match is nested, shows the containing project/meeting/etc with supertag. Use includeAncestor=false to disable.',
        inputSchema: schemas.zodToJsonSchema(schemas.searchSchema),
      },
      {
        name: 'tana_tagged',
        description:
          'Find all nodes with a specific supertag applied (e.g., "todo", "meeting", "contact", "project"). Use tana_supertags first to discover available tags.',
        inputSchema: schemas.zodToJsonSchema(schemas.taggedSchema),
      },
      {
        name: 'tana_stats',
        description:
          'Get database statistics: total nodes, supertags, fields, and references. Useful for understanding the size and structure of a Tana workspace.',
        inputSchema: schemas.zodToJsonSchema(schemas.statsSchema),
      },
      {
        name: 'tana_supertags',
        description:
          'List all available supertags with their usage counts. Helpful for discovering what types of content exist in the workspace (e.g., todos, meetings, people).',
        inputSchema: schemas.zodToJsonSchema(schemas.supertagsSchema),
      },
      {
        name: 'tana_node',
        description:
          'Show full contents of a specific node by ID, including name, fields, tags, and optionally child nodes. Use depth > 0 to include nested children.',
        inputSchema: schemas.zodToJsonSchema(schemas.nodeSchema),
      },
      {
        name: 'tana_related',
        description:
          'Find nodes related to a given node through references, children, and field links. Returns nodes connected within the specified depth with relationship metadata.',
        inputSchema: schemas.zodToJsonSchema(schemas.relatedSchema),
      },
      {
        name: 'tana_create',
        description:
          'Create a new node in Tana with a supertag. Returns nodeId of created node for immediate chaining. For INLINE REFERENCES in text, use: <span data-inlineref-node="NODE_ID">Display Text</span>. IMPORTANT: Never end text with an inline ref - always add text after </span>. For CHILD REFERENCES, use children parameter with {name, id}. Requires schema registry to be synced first. Use dryRun=true to validate without posting.',
        inputSchema: {
          ...schemas.zodToJsonSchema(schemas.createSchema),
          // Override name and children description to document inline references
          properties: {
            ...(schemas.zodToJsonSchema(schemas.createSchema).properties ?? {}),
            name: {
              type: 'string',
              description: 'Node name/title. For inline references, use: <span data-inlineref-node="NODE_ID">Text</span>. IMPORTANT: Never end with an inline ref - add text after. Good: "Meeting with <span data-inlineref-node="abc123">John</span> today". Bad: "Meeting with <span data-inlineref-node="abc123">John</span>"',
            },
            children: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Child node text. For inline refs: <span data-inlineref-node="NODE_ID">Text</span>' },
                  id: { type: 'string', description: 'Optional node ID to create this child as a reference node (dataType: reference)' },
                  dataType: { type: 'string', enum: ['url', 'reference'], description: 'Data type: "url" for clickable links, "reference" for node links (requires id)' },
                  children: { type: 'array', description: 'Nested child nodes (recursive) for hierarchical structures' },
                },
                required: ['name'],
              },
              description: 'Child nodes with NESTED STRUCTURE support. Plain: [{"name": "Child"}]. NESTED: [{"name": "Parent", "children": [{"name": "Sub-item"}, {"name": "Another"}]}]. Reference: {"name": "Link", "id": "abc123"}. URL: {"name": "https://example.com", "dataType": "url"}',
            },
          },
        },
      },
      {
        name: 'tana_sync',
        description:
          'Sync Tana data. action="index" for full reindex from exports, action="status" to check sync status, action="delta" for incremental sync via Local API (fast, fetches only changed nodes since last sync).',
        inputSchema: schemas.zodToJsonSchema(schemas.syncSchema),
      },
      {
        name: 'tana_semantic_search',
        description:
          'Semantic similarity search on Tana nodes using vector embeddings. Finds conceptually related content even without exact keyword matches. Returns nodes ranked by similarity score (0-1). By default, includes ancestor context: when a match is a nested fragment, shows the containing project/meeting/etc with supertag. Use includeContents=true for full node details (fields, children, tags), includeAncestor=false to disable ancestor resolution. Requires embeddings to be generated first (supertag embed generate).',
        inputSchema: schemas.zodToJsonSchema(schemas.semanticSearchSchema),
      },
      {
        name: 'tana_field_values',
        description:
          'Query text-based field values from Tana nodes. Use mode="list" to discover available fields, mode="query" to get values for a specific field (e.g., "Gestern war gut weil"), or mode="search" for full-text search across all field values. Useful for querying structured data like journal entries, project notes, or any field-based content.',
        inputSchema: schemas.zodToJsonSchema(schemas.fieldValuesSchema),
      },
      {
        name: 'tana_supertag_info',
        description:
          'Query supertag inheritance and fields. Use mode="fields" to get field definitions (with includeInherited=true for inherited fields), mode="inheritance" to get parent relationships (with includeAncestors=true for full ancestry chain), or mode="full" for both fields and inheritance. Useful for understanding supertag structure and validating field names.',
        inputSchema: schemas.zodToJsonSchema(schemas.supertagInfoSchema),
      },
      {
        name: 'tana_transcript_list',
        description:
          'List meetings that have transcripts. Returns meeting IDs, names, transcript IDs, and line counts. Use to discover available transcripts before showing or searching.',
        inputSchema: schemas.zodToJsonSchema(schemas.transcriptListSchema),
      },
      {
        name: 'tana_transcript_show',
        description:
          'Show transcript content for a meeting. Returns transcript lines with speaker names, timestamps, and text. Provide either a meeting ID or transcript ID.',
        inputSchema: schemas.zodToJsonSchema(schemas.transcriptShowSchema),
      },
      {
        name: 'tana_transcript_search',
        description:
          'Search within transcript content. Full-text search across all transcript lines. Returns matching lines with speaker info and meeting context.',
        inputSchema: schemas.zodToJsonSchema(schemas.transcriptSearchSchema),
      },
      {
        name: 'tana_cache_clear',
        description:
          'Clear the workspace resolver cache. Use when workspace configuration might have changed (e.g., after adding/removing workspaces or after sync).',
        inputSchema: schemas.zodToJsonSchema(schemas.cacheClearSchema),
      },
      {
        name: 'tana_capabilities',
        description:
          'List available Tana tools with categories and examples. Use this first to discover available operations, then use tana_tool_schema to get full schema for specific tools. Supports filtering by category: query, explore, transcript, mutate, system.',
        inputSchema: schemas.zodToJsonSchema(schemas.capabilitiesSchema),
      },
      {
        name: 'tana_tool_schema',
        description:
          'Get the full JSON schema for a specific Tana tool. Use after tana_capabilities to load detailed parameter information for tools you need.',
        inputSchema: schemas.zodToJsonSchema(schemas.toolSchemaSchema),
      },
      {
        name: 'tana_batch_get',
        description:
          'Fetch multiple nodes by ID in a single request. Returns an array of results in the same order as the input node IDs. Use for efficient batch lookups.',
        inputSchema: schemas.zodToJsonSchema(schemas.batchGetSchema),
      },
      {
        name: 'tana_batch_create',
        description:
          'Create multiple nodes in a single request. Each node requires a supertag and name. Use dryRun=true to validate without creating. Returns per-node results with nodeIds for chaining.',
        inputSchema: schemas.zodToJsonSchema(schemas.batchCreateSchema),
      },
      {
        name: 'tana_query',
        description:
          'Unified query with tag, field, and date filtering. Single tool that replaces multi-step discovery workflows. Supports: find by tag, filter by field values (Status=Done), date ranges (created after 7d), contains (~), exists checks, ordering (-created for descending), and field projection (select). Example: find task where Status=Active and created>7d order by -created limit 20',
        inputSchema: schemas.zodToJsonSchema(schemas.querySchema),
      },
      {
        name: 'tana_aggregate',
        description:
          'Aggregate nodes with grouping and counting. Returns grouped counts, percentages, and nested results. Supports: find by tag, group by field or time period (day/week/month/quarter/year), show percentages, top N groups. Example: { find: "task", groupBy: ["Status"] }',
        inputSchema: schemas.zodToJsonSchema(schemas.aggregateSchema),
      },
      {
        name: 'tana_timeline',
        description:
          'Time-bucketed activity view over a date range. Groups nodes by time period with configurable granularity: hour, day, week, month, quarter, year. Supports relative dates (7d, 1w, 1m) and ISO dates. Returns buckets with counts and sample items. Example: { from: "30d", granularity: "week" }',
        inputSchema: schemas.zodToJsonSchema(schemas.timelineSchema),
      },
      {
        name: 'tana_recent',
        description:
          'Recently created or updated items within a time period. Returns items ordered by most recent activity. Supports period formats: Nh (hours), Nd (days), Nw (weeks), Nm (months). Filter by types (supertags) or activity type (created vs updated). Example: { period: "7d", types: ["meeting", "task"] }',
        inputSchema: schemas.zodToJsonSchema(schemas.recentSchema),
      },
      // Mutation tools (F-094: Local API)
      {
        name: 'tana_update_node',
        description:
          'Update a node name or description. Requires Local API (Tana Desktop running with bearer token configured).',
        inputSchema: schemas.zodToJsonSchema(schemas.updateNodeSchema),
      },
      {
        name: 'tana_tag_add',
        description:
          'Add one or more supertags to a node. Requires Local API.',
        inputSchema: schemas.zodToJsonSchema(schemas.tagAddSchema),
      },
      {
        name: 'tana_tag_remove',
        description:
          'Remove one or more supertags from a node. Requires Local API.',
        inputSchema: schemas.zodToJsonSchema(schemas.tagRemoveSchema),
      },
      {
        name: 'tana_create_tag',
        description:
          'Create a new supertag definition in the workspace. Requires Local API.',
        inputSchema: schemas.zodToJsonSchema(schemas.createTagSchema),
      },
      {
        name: 'tana_set_field',
        description:
          'Set a text field value on a node. Requires Local API.',
        inputSchema: schemas.zodToJsonSchema(schemas.setFieldSchema),
      },
      {
        name: 'tana_set_field_option',
        description:
          'Set a field option (dropdown/select value) on a node. Requires Local API.',
        inputSchema: schemas.zodToJsonSchema(schemas.setFieldOptionSchema),
      },
      {
        name: 'tana_trash_node',
        description:
          'Move a node to trash. Requires Local API.',
        inputSchema: schemas.zodToJsonSchema(schemas.trashNodeSchema),
      },
      {
        name: 'tana_done',
        description:
          'Mark a node as done (checked). Requires Local API.',
        inputSchema: schemas.zodToJsonSchema(schemas.doneSchema),
      },
      {
        name: 'tana_undone',
        description:
          'Mark a node as not done (unchecked). Requires Local API.',
        inputSchema: schemas.zodToJsonSchema(schemas.undoneSchema),
      },
      {
        name: 'tana_context',
        description:
          'Assemble structured AI context from the Tana knowledge graph. Resolves a topic or node ID, walks the graph, scores by relevance, and returns a token-budgeted context document. Supports graph lenses (general, writing, coding, planning, meeting-prep) for task-specific traversal patterns.',
        inputSchema: schemas.zodToJsonSchema(schemas.contextSchema),
      },
];

// List available tools (filtered by tool mode)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const mode = getToolMode();
  const filteredTools = allTools.filter((t) => isToolEnabled(t.name, mode));
  logger.info(`Listing tools: ${filteredTools.length} available (mode: ${mode})`);

  return { tools: filteredTools };
});

// Execute tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const mode = getToolMode();
  logger.info('Tool called', { tool: name, mode });

  // Guard: reject disabled tools in slim/lite mode
  if (!isToolEnabled(name, mode)) {
    logger.warn('Tool disabled in current mode', { tool: name, mode });
    const mapping = LITE_TOOL_MAPPING[name];
    const suggestion = mode === 'lite' && mapping
      ? ` Use tana-local's '${mapping}' instead.`
      : '';
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: `Tool '${name}' is not available in ${mode} mode.${suggestion} Switch to full mode for standalone access.`,
      }],
    };
  }

  try {
    let result: unknown;

    switch (name) {
      case 'tana_search': {
        const validated = schemas.searchSchema.parse(args);
        result = await search(validated);
        break;
      }
      case 'tana_tagged': {
        const validated = schemas.taggedSchema.parse(args);
        result = await tagged(validated);
        break;
      }
      case 'tana_stats': {
        const validated = schemas.statsSchema.parse(args);
        result = await stats(validated);
        break;
      }
      case 'tana_supertags': {
        const validated = schemas.supertagsSchema.parse(args);
        result = await supertags(validated);
        break;
      }
      case 'tana_node': {
        const validated = schemas.nodeSchema.parse(args);
        result = await showNode(validated);
        break;
      }
      case 'tana_related': {
        const validated = schemas.relatedSchema.parse(args);
        result = await related(validated);
        break;
      }
      case 'tana_create': {
        const validated = schemas.createSchema.parse(args);
        result = await create(validated);
        break;
      }
      case 'tana_sync': {
        const validated = schemas.syncSchema.parse(args);
        result = await sync(validated);
        break;
      }
      case 'tana_semantic_search': {
        const validated = schemas.semanticSearchSchema.parse(args);
        result = await semanticSearch(validated);
        break;
      }
      case 'tana_field_values': {
        const validated = schemas.fieldValuesSchema.parse(args);
        result = await fieldValues(validated);
        break;
      }
      case 'tana_table': {
        const validated = schemas.tableSchema.parse(args);
        result = await tableExport(validated);
        break;
      }
      case 'tana_supertag_info': {
        const validated = schemas.supertagInfoSchema.parse(args);
        result = await supertagInfo(validated);
        break;
      }
      case 'tana_transcript_list': {
        const validated = schemas.transcriptListSchema.parse(args);
        result = await transcriptList(validated);
        break;
      }
      case 'tana_transcript_show': {
        const validated = schemas.transcriptShowSchema.parse(args);
        result = await transcriptShow(validated);
        break;
      }
      case 'tana_transcript_search': {
        const validated = schemas.transcriptSearchSchema.parse(args);
        result = await transcriptSearch(validated);
        break;
      }
      case 'tana_cache_clear': {
        const validated = schemas.cacheClearSchema.parse(args);
        result = await cacheClear(validated);
        break;
      }
      case 'tana_capabilities': {
        const validated = schemas.capabilitiesSchema.parse(args);
        result = await capabilities(validated);
        break;
      }
      case 'tana_tool_schema': {
        const validated = schemas.toolSchemaSchema.parse(args);
        result = await toolSchema(validated);
        break;
      }
      case 'tana_batch_get': {
        const validated = schemas.batchGetSchema.parse(args);
        result = await batchGet(validated);
        break;
      }
      case 'tana_batch_create': {
        const validated = schemas.batchCreateSchema.parse(args);
        result = await batchCreate(validated);
        break;
      }
      case 'tana_query': {
        const validated = schemas.querySchema.parse(args);
        result = await query(validated);
        break;
      }
      case 'tana_aggregate': {
        const validated = schemas.aggregateSchema.parse(args);
        result = await aggregate(validated);
        break;
      }
      case 'tana_timeline': {
        const validated = schemas.timelineSchema.parse(args);
        result = await timeline(validated);
        break;
      }
      case 'tana_recent': {
        const validated = schemas.recentSchema.parse(args);
        result = await recent(validated);
        break;
      }
      // Mutation tools (F-094: Local API)
      case 'tana_update_node': {
        const validated = schemas.updateNodeSchema.parse(args);
        result = await handleUpdateNode(validated);
        break;
      }
      case 'tana_tag_add': {
        const validated = schemas.tagAddSchema.parse(args);
        result = await handleTagAdd(validated);
        break;
      }
      case 'tana_tag_remove': {
        const validated = schemas.tagRemoveSchema.parse(args);
        result = await handleTagRemove(validated);
        break;
      }
      case 'tana_create_tag': {
        const validated = schemas.createTagSchema.parse(args);
        result = await handleCreateTag(validated);
        break;
      }
      case 'tana_set_field': {
        const validated = schemas.setFieldSchema.parse(args);
        result = await handleSetField(validated);
        break;
      }
      case 'tana_set_field_option': {
        const validated = schemas.setFieldOptionSchema.parse(args);
        result = await handleSetFieldOption(validated);
        break;
      }
      case 'tana_trash_node': {
        const validated = schemas.trashNodeSchema.parse(args);
        result = await handleTrashNode(validated);
        break;
      }
      case 'tana_done': {
        const validated = schemas.doneSchema.parse(args);
        result = await handleDone(validated);
        break;
      }
      case 'tana_undone': {
        const validated = schemas.undoneSchema.parse(args);
        result = await handleUndone(validated);
        break;
      }
      case 'tana_context': {
        const validated = schemas.contextSchema.parse(args);
        const { contextTool } = await import('./tools/context');
        const contextOutput = await contextTool(validated);
        // Context tool returns formatted string directly — return as text content
        return {
          content: [{ type: 'text' as const, text: contextOutput }],
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    logger.info('Tool executed successfully', { tool: name });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Tool execution failed', { tool: name, error: message });

    // Return structured error response instead of throwing
    return handleMcpError(error);
  }
});

/**
 * Module-level reference to the active delta-sync poller.
 * Exported so the sync tool can call triggerNow() for action='delta'.
 */
export let activePoller: DeltaSyncPoller | null = null;

async function main() {
  const mode = getToolMode();
  logger.info('Starting Supertag MCP server', {
    version: VERSION,
    serviceName: SERVICE_NAME,
    toolMode: mode,
    toolCount: mode === 'slim' ? getSlimModeToolCount() : mode === 'lite' ? getLiteModeToolCount() : allTools.length,
  });

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Supertag MCP server running', { mode });

    // Initialize delta-sync poller if Local API is configured (F-095 T-4.2)
    try {
      const { ConfigManager } = await import('../config/manager.js');
      const { resolveWorkspaceContext } = await import('../config/workspace-resolver.js');
      const { LocalApiClient } = await import('../api/local-api-client.js');
      const config = ConfigManager.getInstance();
      const localApiConfig = config.getLocalApiConfig();
      const syncInterval = config.getDeltaSyncInterval();

      const poller = initDeltaSyncPoller({
        localApiConfig,
        syncInterval,
        dbPath: resolveWorkspaceContext({ requireDatabase: false }).dbPath,
        embeddingConfig: config.getEmbeddingConfig(),
        logger,
        localApiClientFactory: (cfg) => new LocalApiClient(cfg),
      });

      if (poller) {
        activePoller = poller;
      }
    } catch (pollerError) {
      // Non-fatal: MCP server continues without delta-sync
      logger.warn('Delta-sync poller initialization skipped', {
        error: String(pollerError),
      });
    }
  } catch (error) {
    logger.error('Failed to start MCP server', { error: String(error) });
    process.exit(1);
  }
}

// Cleanup on shutdown
process.on('SIGINT', () => {
  activePoller?.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  activePoller?.stop();
  process.exit(0);
});

main().catch((error) => {
  logger.error('Fatal error', { error: String(error) });
  process.exit(1);
});
