/**
 * Graph Traversal Types (Spec 065)
 *
 * Types and schemas for traversing the Tana node graph to find related nodes
 * through parent/child relationships, references, and field links.
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/** Maximum traversal depth allowed */
export const MAX_DEPTH = 5;

/** Maximum results allowed */
export const MAX_LIMIT = 100;

/** Default traversal depth */
export const DEFAULT_DEPTH = 1;

/** Default result limit */
export const DEFAULT_LIMIT = 50;

/** All supported relationship types */
export const ALL_RELATIONSHIP_TYPES = ['child', 'parent', 'reference', 'field'] as const;

// ============================================================================
// Schemas
// ============================================================================

/**
 * Relationship types between nodes
 * - child: Direct children of the node
 * - parent: Direct parent of the node
 * - reference: Inline references ([[node]])
 * - field: Field values that are node references
 */
export const RelationshipTypeSchema = z.enum(['child', 'parent', 'reference', 'field']);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

/**
 * Traversal direction
 * - in: Nodes that reference/contain this node
 * - out: Nodes that this node references/contains
 * - both: Both directions
 */
export const DirectionSchema = z.enum(['in', 'out', 'both']);
export type Direction = z.infer<typeof DirectionSchema>;

/**
 * Input query for graph traversal
 */
export const RelatedQuerySchema = z.object({
  /** Source node ID to traverse from */
  nodeId: z.string().min(1),

  /** Traversal direction: in, out, or both */
  direction: DirectionSchema.default('both'),

  /** Relationship types to include */
  types: z.array(RelationshipTypeSchema).default([...ALL_RELATIONSHIP_TYPES]),

  /** Maximum traversal depth (0-5). 0 means direct connections only. */
  depth: z.number().min(0).max(MAX_DEPTH).default(DEFAULT_DEPTH),

  /** Maximum number of results to return */
  limit: z.number().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});
export type RelatedQuery = z.infer<typeof RelatedQuerySchema>;

/**
 * Metadata about how a node is related to the source
 */
export const RelationshipMetadataSchema = z.object({
  /** Type of relationship */
  type: RelationshipTypeSchema,

  /** Direction relative to source node */
  direction: z.enum(['in', 'out']),

  /** Node IDs from source to this node */
  path: z.array(z.string()),

  /** Number of hops from source */
  distance: z.number().min(0),
});
export type RelationshipMetadata = z.infer<typeof RelationshipMetadataSchema>;

/**
 * A node with its relationship to the source
 */
export const RelatedNodeSchema = z.object({
  /** Node ID */
  id: z.string(),

  /** Node name */
  name: z.string(),

  /** Applied supertags (optional) */
  tags: z.array(z.string()).optional(),

  /** How this node relates to the source */
  relationship: RelationshipMetadataSchema,
});
export type RelatedNode = z.infer<typeof RelatedNodeSchema>;

/**
 * Full traversal result
 */
export const RelatedResultSchema = z.object({
  /** Workspace alias */
  workspace: z.string(),

  /** Source node info */
  sourceNode: z.object({
    id: z.string(),
    name: z.string(),
  }),

  /** Related nodes found */
  related: z.array(RelatedNodeSchema),

  /** Number of results returned */
  count: z.number(),

  /** True if results were truncated due to limit */
  truncated: z.boolean(),

  /** Warnings (unknown types, depth clamped, etc.) */
  warnings: z.array(z.string()).optional(),
});
export type RelatedResult = z.infer<typeof RelatedResultSchema>;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Map from database reference_type to RelationshipType
 */
export const DB_TYPE_MAP: Record<string, RelationshipType> = {
  inline_ref: 'reference',
  parent: 'parent',
  child: 'child',
  // field references use inline_ref type in database
};

/**
 * Convert database reference_type to RelationshipType
 */
export function mapDbType(dbType: string): RelationshipType {
  return DB_TYPE_MAP[dbType] ?? 'reference';
}
