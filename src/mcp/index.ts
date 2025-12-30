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
import { create } from './tools/create.js';
import { sync } from './tools/sync.js';
import { semanticSearch } from './tools/semantic-search.js';
import { fieldValues } from './tools/field-values.js';
import { supertagInfo } from './tools/supertag-info.js';
import { transcriptList, transcriptShow, transcriptSearch } from './tools/transcript.js';
import { VERSION } from '../version.js';

const SERVICE_NAME = process.env.SERVICE_NAME || 'supertag-mcp';

/**
 * MCP-safe logger - writes to stderr to avoid interfering with stdio JSON-RPC
 */
const logger = {
  info: (...args: unknown[]) => console.error(`[${SERVICE_NAME}]`, ...args),
  warn: (...args: unknown[]) => console.error(`[${SERVICE_NAME}] WARN:`, ...args),
  error: (...args: unknown[]) => console.error(`[${SERVICE_NAME}] ERROR:`, ...args),
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) console.error(`[${SERVICE_NAME}] DEBUG:`, ...args);
  },
};

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

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.info('Listing available tools');

  return {
    tools: [
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
        name: 'tana_create',
        description:
          'Create a new node in Tana with a supertag. For INLINE REFERENCES in text, use: <span data-inlineref-node="NODE_ID">Display Text</span>. IMPORTANT: Never end text with an inline ref - always add text after </span>. For CHILD REFERENCES, use children parameter with {name, id}. Requires schema registry to be synced first. Use dryRun=true to validate without posting.',
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
          'Trigger reindex of Tana exports or check sync status. Use action="index" to reindex, action="status" to check when last indexed.',
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
    ],
  };
});

// Execute tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  logger.info('Tool called', { tool: name });

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
    throw error;
  }
});

async function main() {
  logger.info('Starting Supertag MCP server', {
    version: VERSION,
    serviceName: SERVICE_NAME,
  });

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Supertag MCP server running');
  } catch (error) {
    logger.error('Failed to start MCP server', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
