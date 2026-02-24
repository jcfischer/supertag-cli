/**
 * Graph Enricher (F-104)
 *
 * Enriches node text with graph context (supertag types + field values)
 * before embedding. Produces enriched text in the format:
 *   [Type: #tag] [Field: value] [Field: value] Node name
 *
 * This improves semantic search quality for typed queries like
 * "find AI projects" vs "find AI topics".
 */

import type { Database } from "bun:sqlite";
import type {
  GraphAwareEnrichmentConfig,
  EnrichedContextualizedNode,
} from "../types/enrichment";
import { ENRICHMENT_VERSION } from "../types/enrichment";
import { getConfigForTag } from "./enrichment-config";

/** Maximum character length for a single field value in enrichment */
const MAX_FIELD_VALUE_LENGTH = 50;

/** SQLite variable limit — batch queries in chunks of this size */
const SQLITE_CHUNK_SIZE = 900;

/**
 * Enrich a single node with graph context.
 *
 * Queries tag_applications and field_values for the node,
 * then builds enriched text with [Type: #tag] [Field: value] prefix.
 */
export function enrichNodeWithGraphContext(
  db: Database,
  nodeId: string,
  nodeName: string,
  config: GraphAwareEnrichmentConfig
): EnrichedContextualizedNode {
  // 1. Lookup supertags
  const tags = db
    .query(
      `SELECT DISTINCT tag_name FROM tag_applications WHERE data_node_id = ?`
    )
    .all(nodeId) as Array<{ tag_name: string }>;

  if (tags.length === 0) {
    // No supertag — return plain text, not enriched
    return buildUnenrichedNode(nodeId, nodeName);
  }

  const tagNames = tags.map((t) => t.tag_name);

  // 2. Determine which fields to include based on config
  const fieldsToInclude: Array<{ name: string; value: string }> = [];
  let maxFields = config.defaults.maxFieldsPerTag;

  // Use first tag's config for enrichment decisions
  const primaryTagConfig = getConfigForTag(config, tagNames[0]);
  if (primaryTagConfig === null) {
    // Enrichment disabled for primary tag
    return buildUnenrichedNode(nodeId, nodeName);
  }

  if (primaryTagConfig.maxFieldsPerTag !== undefined) {
    maxFields = primaryTagConfig.maxFieldsPerTag;
  }

  // 3. Query field values for this node
  const fieldRows = db
    .query(
      `SELECT field_name, value_text FROM field_values
       WHERE parent_id = ?
       ORDER BY value_order ASC`
    )
    .all(nodeId) as Array<{ field_name: string; value_text: string }>;

  // 4. Filter fields based on config
  for (const row of fieldRows) {
    if (fieldsToInclude.length >= maxFields) break;

    // If override specifies field names, only include those
    if (primaryTagConfig.includeFields && primaryTagConfig.includeFields.length > 0) {
      const fieldNameLower = row.field_name.toLowerCase();
      const included = primaryTagConfig.includeFields.some(
        (f) => f.toLowerCase() === fieldNameLower
      );
      if (!included) continue;
    }

    // Truncate long field values
    const value =
      row.value_text.length > MAX_FIELD_VALUE_LENGTH
        ? row.value_text.slice(0, MAX_FIELD_VALUE_LENGTH) + "…"
        : row.value_text;

    fieldsToInclude.push({ name: row.field_name, value });
  }

  // 5. Build enriched text
  const parts: string[] = [];

  // Type prefix
  if (config.defaults.includeTagName) {
    const typeStr = tagNames.map((t) => `#${t}`).join(", ");
    parts.push(`[Type: ${typeStr}]`);
  }

  // Field prefixes
  for (const field of fieldsToInclude) {
    parts.push(`[${field.name}: ${field.value}]`);
  }

  // Node name
  parts.push(nodeName);

  const enrichedText = parts.join(" ");

  return {
    nodeId,
    nodeName,
    ancestorId: null,
    ancestorName: null,
    ancestorTags: tagNames,
    contextText: enrichedText,
    enriched: true,
    enrichmentVersion: ENRICHMENT_VERSION,
    enrichedTextRaw: enrichedText,
    enrichmentTags: tagNames,
    enrichmentFields: fieldsToInclude,
  };
}

/**
 * Batch-enrich nodes with graph context for efficient embedding generation.
 *
 * Processes nodes in chunks of 900 (SQLite variable limit) and caches
 * tag configs to avoid repeated resolution.
 */
export function batchEnrichNodesWithGraphContext(
  db: Database,
  nodes: Array<{ id: string; name: string }>,
  config: GraphAwareEnrichmentConfig
): EnrichedContextualizedNode[] {
  if (nodes.length === 0) return [];

  const results: EnrichedContextualizedNode[] = [];

  // Process in chunks to respect SQLite variable limit
  for (let i = 0; i < nodes.length; i += SQLITE_CHUNK_SIZE) {
    const chunk = nodes.slice(i, i + SQLITE_CHUNK_SIZE);
    const chunkResults = batchEnrichChunk(db, chunk, config);
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Process a single chunk of nodes (up to SQLITE_CHUNK_SIZE).
 * Uses batch queries for tags and fields.
 */
function batchEnrichChunk(
  db: Database,
  nodes: Array<{ id: string; name: string }>,
  config: GraphAwareEnrichmentConfig
): EnrichedContextualizedNode[] {
  const nodeIds = nodes.map((n) => n.id);
  const nodeMap = new Map(nodes.map((n) => [n.id, n.name]));

  // Batch query: tags for all nodes in chunk
  const placeholders = nodeIds.map(() => "?").join(",");

  const tagRows = db
    .query(
      `SELECT data_node_id, tag_name FROM tag_applications
       WHERE data_node_id IN (${placeholders})`
    )
    .all(...nodeIds) as Array<{ data_node_id: string; tag_name: string }>;

  // Group tags by node
  const tagsByNode = new Map<string, string[]>();
  for (const row of tagRows) {
    const existing = tagsByNode.get(row.data_node_id) || [];
    if (!existing.includes(row.tag_name)) {
      existing.push(row.tag_name);
    }
    tagsByNode.set(row.data_node_id, existing);
  }

  // Batch query: field values for all nodes in chunk
  const fieldRows = db
    .query(
      `SELECT parent_id, field_name, value_text, value_order FROM field_values
       WHERE parent_id IN (${placeholders})
       ORDER BY value_order ASC`
    )
    .all(...nodeIds) as Array<{
    parent_id: string;
    field_name: string;
    value_text: string;
    value_order: number;
  }>;

  // Group fields by node
  const fieldsByNode = new Map<
    string,
    Array<{ field_name: string; value_text: string }>
  >();
  for (const row of fieldRows) {
    const existing = fieldsByNode.get(row.parent_id) || [];
    existing.push({
      field_name: row.field_name,
      value_text: row.value_text,
    });
    fieldsByNode.set(row.parent_id, existing);
  }

  // Cache tag configs
  const tagConfigCache = new Map<
    string,
    ReturnType<typeof getConfigForTag>
  >();

  // Build enriched nodes
  const results: EnrichedContextualizedNode[] = [];

  for (const node of nodes) {
    const tags = tagsByNode.get(node.id) || [];
    const nodeName = nodeMap.get(node.id)!;

    if (tags.length === 0) {
      results.push(buildUnenrichedNode(node.id, nodeName));
      continue;
    }

    // Get config for primary tag (cached)
    const primaryTag = tags[0];
    if (!tagConfigCache.has(primaryTag)) {
      tagConfigCache.set(primaryTag, getConfigForTag(config, primaryTag));
    }
    const tagConfig = tagConfigCache.get(primaryTag)!;

    if (tagConfig === null) {
      results.push(buildUnenrichedNode(node.id, nodeName));
      continue;
    }

    const maxFields =
      tagConfig.maxFieldsPerTag ?? config.defaults.maxFieldsPerTag;
    const nodeFields = fieldsByNode.get(node.id) || [];

    // Filter and truncate fields
    const fieldsToInclude: Array<{ name: string; value: string }> = [];
    for (const field of nodeFields) {
      if (fieldsToInclude.length >= maxFields) break;

      if (
        tagConfig.includeFields &&
        tagConfig.includeFields.length > 0
      ) {
        const fieldNameLower = field.field_name.toLowerCase();
        const included = tagConfig.includeFields.some(
          (f) => f.toLowerCase() === fieldNameLower
        );
        if (!included) continue;
      }

      const value =
        field.value_text.length > MAX_FIELD_VALUE_LENGTH
          ? field.value_text.slice(0, MAX_FIELD_VALUE_LENGTH) + "…"
          : field.value_text;

      fieldsToInclude.push({ name: field.field_name, value });
    }

    // Build enriched text
    const parts: string[] = [];

    if (config.defaults.includeTagName) {
      const typeStr = tags.map((t) => `#${t}`).join(", ");
      parts.push(`[Type: ${typeStr}]`);
    }

    for (const field of fieldsToInclude) {
      parts.push(`[${field.name}: ${field.value}]`);
    }

    parts.push(nodeName);

    const enrichedText = parts.join(" ");

    results.push({
      nodeId: node.id,
      nodeName,
      ancestorId: null,
      ancestorName: null,
      ancestorTags: tags,
      contextText: enrichedText,
      enriched: true,
      enrichmentVersion: ENRICHMENT_VERSION,
      enrichedTextRaw: enrichedText,
      enrichmentTags: tags,
      enrichmentFields: fieldsToInclude,
    });
  }

  return results;
}

/**
 * Build an unenriched node (plain text, no graph context)
 */
function buildUnenrichedNode(
  nodeId: string,
  nodeName: string
): EnrichedContextualizedNode {
  return {
    nodeId,
    nodeName,
    ancestorId: null,
    ancestorName: null,
    ancestorTags: [],
    contextText: nodeName,
    enriched: false,
    enrichmentVersion: ENRICHMENT_VERSION,
    enrichedTextRaw: nodeName,
    enrichmentTags: [],
    enrichmentFields: [],
  };
}
