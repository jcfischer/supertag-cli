/**
 * MCP Tool Schemas
 *
 * Zod schemas for all Tana MCP tools with descriptions for AI documentation.
 */

import { z } from 'zod';

// Common schemas
// Note: nullable() is needed because some LLMs (like Ollama) send null instead of omitting optional fields
export const workspaceSchema = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? undefined)
  .describe('Workspace alias or node ID (uses default if not specified)');

export const limitSchema = z
  .number()
  .min(1)
  .max(1000)
  .default(20)
  .describe('Maximum number of results to return');

// Date range schemas
export const dateRangeSchema = {
  createdAfter: z
    .string()
    .optional()
    .describe('Filter nodes created after this date (YYYY-MM-DD or ISO 8601)'),
  createdBefore: z
    .string()
    .optional()
    .describe('Filter nodes created before this date (YYYY-MM-DD or ISO 8601)'),
  updatedAfter: z
    .string()
    .optional()
    .describe('Filter nodes updated after this date (YYYY-MM-DD or ISO 8601)'),
  updatedBefore: z
    .string()
    .optional()
    .describe('Filter nodes updated before this date (YYYY-MM-DD or ISO 8601)'),
};

// tana_search
export const searchSchema = z.object({
  query: z.string().min(1).describe('Full-text search query'),
  workspace: workspaceSchema,
  limit: limitSchema,
  raw: z
    .boolean()
    .default(false)
    .describe('Return raw results without supertag enrichment or ancestor resolution'),
  includeAncestor: z
    .boolean()
    .default(true)
    .describe('Include nearest ancestor with supertag for context. When a match is a nested fragment, shows the containing project/meeting/etc.'),
  ...dateRangeSchema,
});
export type SearchInput = z.infer<typeof searchSchema>;

// tana_tagged
export const taggedSchema = z.object({
  tagname: z.string().min(1).describe('Supertag name to filter by (e.g., "todo", "meeting", "contact")'),
  workspace: workspaceSchema,
  limit: limitSchema,
  orderBy: z
    .enum(['created', 'updated'])
    .default('created')
    .describe('Sort order for results'),
  caseInsensitive: z
    .boolean()
    .default(false)
    .describe('Enable case-insensitive tag matching'),
  ...dateRangeSchema,
});
export type TaggedInput = z.infer<typeof taggedSchema>;

// tana_stats
export const statsSchema = z.object({
  workspace: workspaceSchema,
});
export type StatsInput = z.infer<typeof statsSchema>;

// tana_supertags
export const supertagsSchema = z.object({
  workspace: workspaceSchema,
  limit: limitSchema,
});
export type SupertagsInput = z.infer<typeof supertagsSchema>;

// tana_node
export const nodeSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID (e.g., "abc123xyz")'),
  workspace: workspaceSchema,
  depth: z
    .number()
    .min(0)
    .max(10)
    .default(0)
    .describe('Depth of child traversal (0 = no children, 1 = direct children, etc.)'),
});
export type NodeInput = z.infer<typeof nodeSchema>;

// Recursive child node schema for nested structures
interface ChildNode {
  name: string;
  id?: string;
  dataType?: 'url' | 'reference';
  children?: ChildNode[];
}

const childNodeSchema: z.ZodType<ChildNode> = z.lazy(() =>
  z.object({
    name: z.string().describe('Child node name. For inline refs: <span data-inlineref-node="NODE_ID">Text</span>'),
    id: z.string().optional().describe('Optional node ID to create this child as a reference node (dataType: reference)'),
    dataType: z.enum(['url', 'reference']).optional().describe('Data type: "url" for clickable links, "reference" for node links (requires id)'),
    children: z.array(childNodeSchema).optional().describe('Nested child nodes for hierarchical structures'),
  })
);

// tana_create (Phase 2)
export const createSchema = z.object({
  supertag: z
    .string()
    .min(1)
    .describe('Supertag name (e.g., "todo") or comma-separated for multiple'),
  name: z
    .string()
    .min(1)
    .describe(
      'Node name/title. IMPORTANT: Do NOT use [[text^id]] inline reference syntax here - it will appear as plain text. Use the children parameter for references.'
    ),
  fields: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .describe('Field values as key-value pairs (e.g., {"Status": "Done", "Tags": ["urgent"]})'),
  children: z
    .array(childNodeSchema)
    .optional()
    .describe(
      'Child nodes with optional nesting. Plain: [{"name": "Child"}]. Nested: [{"name": "Parent", "children": [{"name": "Sub-item"}]}]. Reference: {"name": "Link", "id": "abc123"}. URL: {"name": "https://...", "dataType": "url"}'
    ),
  workspace: workspaceSchema,
  target: z
    .string()
    .optional()
    .describe('Target node ID (INBOX, SCHEMA, or specific node ID)'),
  dryRun: z
    .boolean()
    .default(false)
    .describe('Validate without actually creating the node'),
});
export type CreateInput = z.infer<typeof createSchema>;

// tana_sync (Phase 2)
export const syncSchema = z.object({
  action: z
    .enum(['index', 'status'])
    .default('index')
    .describe('Action to perform: "index" to reindex, "status" to check sync status'),
  workspace: workspaceSchema,
});
export type SyncInput = z.infer<typeof syncSchema>;

// tana_field_values
export const fieldValuesSchema = z.object({
  mode: z
    .enum(['list', 'query', 'search'])
    .describe('Operation mode: "list" shows available fields, "query" gets values for a field, "search" does FTS'),
  fieldName: z
    .string()
    .optional()
    .describe('Field name to query (required for "query" mode, optional filter for "search" mode)'),
  query: z
    .string()
    .optional()
    .describe('Search query for FTS (required for "search" mode)'),
  workspace: workspaceSchema,
  limit: limitSchema,
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe('Offset for pagination'),
  ...dateRangeSchema,
});
export type FieldValuesInput = z.infer<typeof fieldValuesSchema>;

// tana_supertag_info
export const supertagInfoSchema = z.object({
  tagname: z.string().min(1).describe('Supertag name to query (e.g., "todo", "meeting", "contact")'),
  mode: z
    .enum(['fields', 'inheritance', 'full'])
    .default('fields')
    .describe('Query mode: "fields" for field definitions, "inheritance" for parent relationships, "full" for both'),
  includeInherited: z
    .boolean()
    .default(false)
    .describe('Include inherited fields from parent tags (only applies to "fields" and "full" modes)'),
  includeAncestors: z
    .boolean()
    .default(false)
    .describe('Include full ancestor chain with depth info (only applies to "inheritance" mode)'),
  workspace: workspaceSchema,
  // Internal: for testing only, not exposed in MCP schema
  _dbPath: z.string().optional(),
});
export type SupertagInfoInput = z.infer<typeof supertagInfoSchema>;

// tana_semantic_search
export const semanticSearchSchema = z.object({
  query: z.string().min(1).describe('Natural language search query for semantic similarity matching'),
  workspace: workspaceSchema,
  limit: limitSchema,
  minSimilarity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Minimum similarity threshold (0-1). Results below this similarity are excluded.'),
  raw: z
    .boolean()
    .default(false)
    .describe('Return raw results without supertag enrichment or ancestor resolution'),
  includeContents: z
    .boolean()
    .default(false)
    .describe('Include full node contents (fields, children, tags) in results. Provides richer context but larger response.'),
  depth: z
    .number()
    .min(0)
    .max(3)
    .default(0)
    .describe('Child traversal depth when includeContents is true (0 = no children, 1 = direct children, etc.). Max 3.'),
  includeAncestor: z
    .boolean()
    .default(true)
    .describe('Include nearest ancestor with supertag for context. When a match is a nested fragment, shows the containing project/meeting/etc.'),
});
export type SemanticSearchInput = z.infer<typeof semanticSearchSchema>;

// tana_transcript_list
export const transcriptListSchema = z.object({
  workspace: workspaceSchema,
  limit: limitSchema,
});
export type TranscriptListInput = z.infer<typeof transcriptListSchema>;

// tana_transcript_show
export const transcriptShowSchema = z.object({
  id: z.string().min(1).describe('Meeting or transcript node ID'),
  workspace: workspaceSchema,
  limit: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum number of transcript lines to return'),
});
export type TranscriptShowInput = z.infer<typeof transcriptShowSchema>;

// tana_transcript_search
export const transcriptSearchSchema = z.object({
  query: z.string().min(1).describe('Full-text search query for transcript content'),
  workspace: workspaceSchema,
  limit: limitSchema,
});
export type TranscriptSearchInput = z.infer<typeof transcriptSearchSchema>;

// Zod v4 internal type definition
interface ZodDef {
  type: string;
  innerType?: { _zod?: { def: ZodDef } };
  defaultValue?: unknown;
  entries?: Record<string, unknown>;
  element?: { _zod?: { def: ZodDef } };
  options?: Array<{ _zod?: { def: ZodDef } }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZodType = z.ZodType<any, any, any>;

function getZodDef(schema: AnyZodType): ZodDef | undefined {
  // Zod v4 uses _zod.def for internal structure
  return (schema as unknown as { _zod?: { def: ZodDef } })._zod?.def;
}

/**
 * Convert Zod schema to JSON Schema for MCP tool registration
 * Compatible with Zod v4
 */
export function zodToJsonSchema(schema: AnyZodType): Record<string, unknown> {
  const def = getZodDef(schema);

  if (def?.type === 'object' || 'shape' in schema) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as AnyZodType;
      properties[key] = zodTypeToJsonSchema(zodValue);

      // Check if required (not optional and not has default)
      if (!isOptional(zodValue)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: 'object' };
}

function zodTypeToJsonSchema(zodType: AnyZodType): Record<string, unknown> {
  const description = zodType.description;
  const base: Record<string, unknown> = {};

  if (description) {
    base.description = description;
  }

  // Get the internal definition
  let def = getZodDef(zodType);

  // Unwrap optional/default/nullable/pipe using Zod v4 structure
  while (def && ['optional', 'default', 'nullable', 'pipe'].includes(def.type)) {
    if (def.type === 'default' && def.defaultValue !== undefined) {
      base.default = def.defaultValue;
    }

    // For pipe (transform), check 'in' schema
    if (def.type === 'pipe') {
      const pipeDef = def as unknown as { in?: { _zod?: { def: ZodDef } } };
      if (pipeDef.in?._zod?.def) {
        def = pipeDef.in._zod.def;
        continue;
      }
    }

    if (def.innerType?._zod?.def) {
      def = def.innerType._zod.def;
    } else {
      break;
    }
  }

  if (!def) {
    return { ...base, type: 'string' };
  }

  switch (def.type) {
    case 'string':
      return { ...base, type: 'string' };
    case 'number':
      return { ...base, type: 'number' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'enum':
      return { ...base, type: 'string', enum: def.entries ? Object.values(def.entries) : [] };
    case 'array':
      if (def.element?._zod?.def) {
        const elementType = { _zod: { def: def.element._zod.def } } as AnyZodType;
        return { ...base, type: 'array', items: zodTypeToJsonSchema(elementType) };
      }
      return { ...base, type: 'array' };
    case 'record':
      return { ...base, type: 'object', additionalProperties: true };
    case 'union':
      if (def.options) {
        const options = def.options
          .filter(opt => opt._zod?.def)
          .map(opt => zodTypeToJsonSchema({ _zod: { def: opt._zod!.def } } as AnyZodType));
        return { ...base, oneOf: options };
      }
      return { ...base, type: 'string' };
    default:
      return { ...base, type: 'string' };
  }
}

function isOptional(zodType: AnyZodType): boolean {
  const def = getZodDef(zodType);
  if (!def) return false;

  // Check for optional, default, nullable types
  if (['optional', 'default', 'nullable'].includes(def.type)) {
    return true;
  }

  // Handle pipe (transform) - check the 'in' schema
  if (def.type === 'pipe') {
    const pipeDef = def as unknown as { in?: { _zod?: { def: ZodDef } } };
    if (pipeDef.in?._zod?.def) {
      return isOptional({ _zod: { def: pipeDef.in._zod.def } } as AnyZodType);
    }
  }

  return false;
}

/**
 * Parse date range strings into UNIX timestamps (ms)
 */
export function parseDateRange(input: {
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
}): {
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
} {
  const result: {
    createdAfter?: number;
    createdBefore?: number;
    updatedAfter?: number;
    updatedBefore?: number;
  } = {};

  const parseDate = (dateStr: string): number => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD or ISO 8601`);
    }
    return date.getTime();
  };

  if (input.createdAfter) {
    result.createdAfter = parseDate(input.createdAfter);
  }
  if (input.createdBefore) {
    result.createdBefore = parseDate(input.createdBefore);
  }
  if (input.updatedAfter) {
    result.updatedAfter = parseDate(input.updatedAfter);
  }
  if (input.updatedBefore) {
    result.updatedBefore = parseDate(input.updatedBefore);
  }

  return result;
}
