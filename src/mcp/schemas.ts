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

/**
 * Select schema for field projection
 * Spec: 059-universal-select-parameter
 */
export const selectSchema = z
  .array(z.string())
  .optional()
  .describe('Fields to select in response (e.g., ["id", "name", "fields.Status"]). Omit to return all fields.');

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
  select: selectSchema,
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
  query: z.string().optional().describe('Filter results to nodes whose name contains this text (case-insensitive substring match)'),
  workspace: workspaceSchema,
  limit: limitSchema,
  select: selectSchema,
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
    .optional()
    .describe('Depth of child traversal (0 = no children, 1 = direct children). Auto-expands to 1 for day/calendar pages when not specified.'),
  select: selectSchema,
});
export type NodeInput = z.infer<typeof nodeSchema>;

// tana_related (Spec 065: Graph Traversal)
export const relatedSchema = z.object({
  nodeId: z.string().min(1).describe('Source node ID to find related nodes from'),
  direction: z
    .enum(['in', 'out', 'both'])
    .default('both')
    .describe('Traversal direction: "in" (nodes pointing to this), "out" (this points to), "both"'),
  types: z
    .array(z.enum(['child', 'parent', 'reference', 'field']))
    .default(['child', 'parent', 'reference', 'field'])
    .describe('Relationship types to include: child, parent, reference, field'),
  depth: z
    .number()
    .min(0)
    .max(5)
    .default(1)
    .describe('Maximum traversal depth (0-5). 0 = direct connections only.'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .default(50)
    .describe('Maximum number of related nodes to return (1-100)'),
  workspace: workspaceSchema,
  select: selectSchema,
});
export type RelatedInput = z.infer<typeof relatedSchema>;

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
    .enum(['index', 'status', 'delta'])
    .default('index')
    .describe('Action: "index" full reindex from export, "status" check sync status, "delta" incremental sync via Local API'),
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
  select: selectSchema,
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
  select: selectSchema,
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

// tana_cache_clear
export const cacheClearSchema = z.object({});
export type CacheClearInput = z.infer<typeof cacheClearSchema>;

// tana_capabilities (Spec 061: Progressive Disclosure)
export const capabilitiesSchema = z.object({
  category: z
    .enum(['query', 'explore', 'transcript', 'mutate', 'system'])
    .optional()
    .describe('Filter to specific category of tools'),
});
export type CapabilitiesInput = z.infer<typeof capabilitiesSchema>;

// tana_tool_schema (Spec 061: Progressive Disclosure)
export const toolSchemaSchema = z.object({
  tool: z
    .string()
    .min(1)
    .describe('Tool name to get full schema for (e.g., "tana_search")'),
});
export type ToolSchemaInput = z.infer<typeof toolSchemaSchema>;

// tana_query (Spec 063: Unified Query Language)
/**
 * Where condition for a single field
 * Shorthand: "Done" means { eq: "Done" }
 * Date shorthand: ">7d" means { after: "7d" }, "<7d" means { before: "7d" }
 * Contains shorthand: "~value" means { contains: "value" }
 * Full form: { eq: "Done", contains: "John", after: "7d", before: "today", exists: true, neq: "Active", gt: 5, gte: 1, lt: 100, lte: 50 }
 */
const whereConditionSchema = z.union([
  // Shorthand: "Done" means { eq: "Done" }, ">7d" means { after: "7d" }
  z.string(),
  z.number(),
  // Full condition object
  z.object({
    eq: z.union([z.string(), z.number()]).optional().describe('Exact match'),
    neq: z.union([z.string(), z.number()]).optional().describe('Not equal'),
    contains: z.string().optional().describe('Contains substring or array element'),
    after: z.string().optional().describe('After date (ISO 8601 or relative: today, 7d, 1w)'),
    before: z.string().optional().describe('Before date (ISO 8601 or relative: today, 7d, 1w)'),
    gt: z.number().optional().describe('Greater than'),
    gte: z.number().optional().describe('Greater than or equal'),
    lt: z.number().optional().describe('Less than'),
    lte: z.number().optional().describe('Less than or equal'),
    exists: z.boolean().optional().describe('Field has value'),
  }),
]);

export const querySchema = z.object({
  find: z
    .string()
    .min(1)
    .describe('Supertag to find (e.g., "task", "meeting") or "*" for all nodes'),
  where: z
    .record(z.string(), whereConditionSchema)
    .optional()
    .describe('Filter conditions by field name. Use "parent.tags" or "parent.name" for parent queries.'),
  select: selectSchema,
  orderBy: z
    .string()
    .optional()
    .describe('Field to order by. Prefix with "-" for descending (e.g., "-created")'),
  limit: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum results (default: 100, max: 1000)'),
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe('Skip first N results for pagination'),
  workspace: workspaceSchema,
});
export type QueryInput = z.infer<typeof querySchema>;

// tana_batch_get (Spec 062: Batch Operations)
export const batchGetSchema = z.object({
  nodeIds: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .describe('Array of node IDs to fetch (1-100 IDs)'),
  workspace: workspaceSchema,
  depth: z
    .number()
    .min(0)
    .max(3)
    .default(0)
    .describe('Depth of child traversal (0 = no children, 1 = direct children, etc.). Max 3.'),
  select: selectSchema,
});
export type BatchGetInput = z.infer<typeof batchGetSchema>;

// tana_batch_create (Spec 062: Batch Operations)
// Node definition for batch create (similar to createSchema but in array form)
const batchNodeSchema = z.object({
  supertag: z.string().min(1).describe('Supertag name (e.g., "todo")'),
  name: z.string().min(1).describe('Node name/title'),
  fields: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .describe('Field values as key-value pairs (e.g., {"Status": "Done"})'),
  children: z
    .array(childNodeSchema)
    .optional()
    .describe('Child nodes with optional nesting'),
});

export const batchCreateSchema = z.object({
  nodes: z
    .array(batchNodeSchema)
    .min(1)
    .max(50)
    .describe('Array of node definitions to create (1-50 nodes)'),
  target: z
    .string()
    .optional()
    .describe('Default target node ID for all nodes (INBOX, SCHEMA, or specific node ID)'),
  dryRun: z
    .boolean()
    .default(false)
    .describe('Validate without actually creating nodes'),
  workspace: workspaceSchema,
});
export type BatchCreateInput = z.infer<typeof batchCreateSchema>;

// tana_table (F-099: Bulk Field Extractor)
export const tableSchema = z.object({
  supertag: z.string().min(1).describe('Supertag name to export as table (e.g., "book", "person", "project")'),
  workspace: workspaceSchema,
  fields: z
    .array(z.string())
    .optional()
    .describe('Only include these fields in output (e.g., ["Author", "Year"])'),
  where: z
    .array(z.string())
    .optional()
    .describe('Filter rows by field=value conditions (e.g., ["Status=Read", "Year=2024"])'),
  sort: z
    .string()
    .optional()
    .describe('Sort by field name (e.g., "Author", "name", "id")'),
  direction: z
    .enum(['asc', 'desc'])
    .default('asc')
    .describe('Sort direction'),
  limit: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum rows to return (default: 100)'),
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe('Skip first N rows for pagination'),
  resolveReferences: z
    .boolean()
    .default(true)
    .describe('Resolve reference field IDs to human-readable names (default: true)'),
});
export type TableInput = z.infer<typeof tableSchema>;

// tana_resolve (F-100: Entity Resolution)
export const resolveSchema = z.object({
  name: z.string().min(1).describe('Name to resolve (find matching existing node)'),
  tag: z.string().optional().describe('Filter to specific supertag (e.g., "person", "project")'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.85)
    .describe('Minimum confidence threshold for a match (0-1, default: 0.85)'),
  limit: z
    .number()
    .min(1)
    .max(20)
    .default(5)
    .describe('Maximum candidates to return (default: 5)'),
  exact: z
    .boolean()
    .default(false)
    .describe('Exact match only — no fuzzy or semantic matching'),
  createIfMissing: z
    .boolean()
    .default(false)
    .describe('Return create suggestion when no match found'),
  workspace: workspaceSchema,
});
export type ResolveInput = z.infer<typeof resolveSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZodType = z.ZodType<any, any, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodDef = any;

/**
 * Get the internal definition from a Zod schema (Zod 3.x)
 */
function getZodDef(schema: AnyZodType): ZodDef | undefined {
  // Zod v3 uses _def for internal structure
  return (schema as unknown as { _def?: ZodDef })._def;
}

/**
 * Get the type name from a Zod definition (Zod 3.x uses typeName)
 */
function getTypeName(def: ZodDef): string | undefined {
  return def?.typeName;
}

/**
 * Convert Zod schema to JSON Schema for MCP tool registration
 * Compatible with Zod v3
 */
export function zodToJsonSchema(schema: AnyZodType): Record<string, unknown> {
  const def = getZodDef(schema);
  const typeName = getTypeName(def);

  if (typeName === 'ZodObject' || 'shape' in schema) {
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
  let typeName = getTypeName(def);

  // Unwrap optional/default/nullable/effects using Zod v3 structure
  while (def && ['ZodOptional', 'ZodDefault', 'ZodNullable', 'ZodEffects'].includes(typeName || '')) {
    if (typeName === 'ZodDefault' && def.defaultValue !== undefined) {
      base.default = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
    }

    // For ZodEffects (transform), check the inner schema
    if (typeName === 'ZodEffects' && def.schema) {
      def = getZodDef(def.schema);
      typeName = getTypeName(def);
      continue;
    }

    if (def.innerType) {
      def = getZodDef(def.innerType);
      typeName = getTypeName(def);
    } else {
      break;
    }
  }

  if (!def || !typeName) {
    return { ...base, type: 'string' };
  }

  switch (typeName) {
    case 'ZodString':
      return { ...base, type: 'string' };
    case 'ZodNumber':
      return { ...base, type: 'number' };
    case 'ZodBoolean':
      return { ...base, type: 'boolean' };
    case 'ZodEnum':
      return { ...base, type: 'string', enum: def.values || [] };
    case 'ZodArray':
      if (def.type) {
        return { ...base, type: 'array', items: zodTypeToJsonSchema(def.type) };
      }
      return { ...base, type: 'array' };
    case 'ZodRecord':
      return { ...base, type: 'object', additionalProperties: true };
    case 'ZodUnion':
      if (def.options) {
        const options = def.options
          .filter((opt: AnyZodType) => getZodDef(opt))
          .map((opt: AnyZodType) => zodTypeToJsonSchema(opt));
        return { ...base, oneOf: options };
      }
      return { ...base, type: 'string' };
    case 'ZodLazy':
      // For lazy types (recursive schemas), return a generic object
      // Resolving them would cause infinite recursion
      return { ...base, type: 'object' };
    case 'ZodObject':
      return zodToJsonSchema(zodType);
    default:
      return { ...base, type: 'string' };
  }
}

function isOptional(zodType: AnyZodType): boolean {
  const def = getZodDef(zodType);
  const typeName = getTypeName(def);

  if (!def || !typeName) return false;

  // Check for optional, default, nullable types
  if (['ZodOptional', 'ZodDefault', 'ZodNullable'].includes(typeName)) {
    return true;
  }

  // Handle ZodEffects (transform) - check the inner schema
  if (typeName === 'ZodEffects' && def.schema) {
    return isOptional(def.schema);
  }

  return false;
}

// tana_aggregate (Spec 064: Aggregation Queries)
/**
 * Group-by specification for aggregation
 */
const groupBySpecSchema = z.union([
  // Shorthand: "Status" or "month" - will be parsed by service
  z.string(),
  // Full object form
  z.object({
    field: z.string().optional().describe('Field name to group by'),
    period: z
      .enum(['day', 'week', 'month', 'quarter', 'year'])
      .optional()
      .describe('Time period for date-based grouping'),
    dateField: z
      .enum(['created', 'updated'])
      .optional()
      .describe('Date field to use: "created" or "updated" (default: "created")'),
  }),
]);

/**
 * Aggregation function specification
 */
const aggregateFunctionSchema = z.object({
  fn: z
    .enum(['count', 'sum', 'avg', 'min', 'max'])
    .describe('Aggregation function'),
  field: z
    .string()
    .optional()
    .describe('Field to aggregate (required for sum/avg/min/max)'),
  alias: z
    .string()
    .optional()
    .describe('Alias for the result'),
});

export const aggregateSchema = z.object({
  find: z
    .string()
    .min(1)
    .describe('Supertag to find (e.g., "task", "meeting") or "*" for all nodes'),
  groupBy: z
    .array(groupBySpecSchema)
    .min(1)
    .max(2)
    .describe('Fields to group by (1-2 fields). Strings like "Status" or "month" are auto-parsed.'),
  where: z
    .record(z.string(), whereConditionSchema)
    .optional()
    .describe('Filter conditions by field name'),
  aggregate: z
    .array(aggregateFunctionSchema)
    .optional()
    .default([{ fn: 'count' }])
    .describe('Aggregation functions to apply (default: count)'),
  showPercent: z
    .boolean()
    .optional()
    .default(false)
    .describe('Show percentage of total alongside counts'),
  top: z
    .number()
    .min(1)
    .optional()
    .describe('Return only top N groups by count'),
  limit: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum groups to return (default: 100)'),
  workspace: workspaceSchema,
});
export type AggregateInput = z.infer<typeof aggregateSchema>;

// tana_timeline (Spec 066: Timeline & Temporal Queries)
export const timelineSchema = z.object({
  from: z
    .string()
    .optional()
    .describe('Start date (ISO 8601 or relative: 30d, 1m, 7d, today, yesterday). Default: 30 days ago'),
  to: z
    .string()
    .optional()
    .describe('End date (ISO 8601 or relative). Default: today'),
  granularity: z
    .enum(['hour', 'day', 'week', 'month', 'quarter', 'year'])
    .default('day')
    .describe('Time bucket size for grouping'),
  tag: z
    .string()
    .optional()
    .describe('Filter by supertag name'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .default(10)
    .describe('Maximum items per time bucket'),
  workspace: workspaceSchema,
});
export type TimelineInput = z.infer<typeof timelineSchema>;

// tana_recent (Spec 066: Timeline & Temporal Queries)
export const recentSchema = z.object({
  period: z
    .string()
    .default('24h')
    .describe('Time period to look back: Nh (hours), Nd (days), Nw (weeks), Nm (months), Ny (years). Default: 24h'),
  types: z
    .array(z.string())
    .optional()
    .describe('Filter by supertag names (e.g., ["meeting", "task"])'),
  createdOnly: z
    .boolean()
    .default(false)
    .describe('Only show items created in the period (exclude updated items)'),
  updatedOnly: z
    .boolean()
    .default(false)
    .describe('Only show items updated in the period (exclude newly created)'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum items to return'),
  workspace: workspaceSchema,
});
export type RecentInput = z.infer<typeof recentSchema>;

// =============================================================================
// Mutation Schemas (F-094: Local API)
// =============================================================================

// tana_update_node
export const updateNodeSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID to update'),
  name: z.string().optional().describe('New node name/title (null to clear)'),
  description: z.string().optional().describe('New node description (null to clear)'),
});
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

// tana_tag_add
export const tagAddSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID to add tags to'),
  tagIds: z.array(z.string().min(1)).min(1).describe('Array of supertag IDs to add'),
});
export type TagAddInput = z.infer<typeof tagAddSchema>;

// tana_tag_remove
export const tagRemoveSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID to remove tags from'),
  tagIds: z.array(z.string().min(1)).min(1).describe('Array of supertag IDs to remove'),
});
export type TagRemoveInput = z.infer<typeof tagRemoveSchema>;

// tana_create_tag
export const createTagSchema = z.object({
  name: z.string().min(1).describe('Name for the new supertag'),
  description: z.string().optional().describe('Optional description for the tag'),
  color: z.string().optional().describe('Optional color for the tag'),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

// tana_set_field
export const setFieldSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID to set field on'),
  attributeId: z.string().min(1).describe('Field attribute ID'),
  content: z.string().describe('Field value content'),
});
export type SetFieldInput = z.infer<typeof setFieldSchema>;

// tana_set_field_option
export const setFieldOptionSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID to set field option on'),
  attributeId: z.string().min(1).describe('Field attribute ID'),
  optionId: z.string().min(1).describe('Option ID to set'),
});
export type SetFieldOptionInput = z.infer<typeof setFieldOptionSchema>;

// tana_trash_node
export const trashNodeSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID to move to trash'),
});
export type TrashNodeInput = z.infer<typeof trashNodeSchema>;

// tana_done
export const doneSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID to mark as done'),
});
export type DoneInput = z.infer<typeof doneSchema>;

// tana_undone
export const undoneSchema = z.object({
  nodeId: z.string().min(1).describe('Tana node ID to mark as not done'),
});
export type UndoneInput = z.infer<typeof undoneSchema>;

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
