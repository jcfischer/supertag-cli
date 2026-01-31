/**
 * Tana Dump Type Definitions
 *
 * TypeScript/Zod schemas ported from Python Pydantic models
 * Source: jcf-tana-helper/service/service/tana_types.py
 *
 * These types represent the complete structure of Tana JSON exports,
 * including metadata for supertags, fields, inline references, and graph relationships.
 */

import { z } from "zod";

/**
 * Props Schema
 * Properties for a Tana node
 *
 * NOTE: _flags is the entity detection flag from Tana:
 * - _flags % 2 === 1 means the node is an "entity" (interesting node)
 * - Based on Tana developer insights from Odin Urdland
 *
 * Using .passthrough() to preserve any additional underscore-prefixed props
 * that may exist in the export (e.g., _view, _imageHeight, _imageWidth, etc.)
 */
export const PropsSchema = z.object({
  created: z.number().optional(), // Optional: some imported workspaces (e.g. Roam) lack this
  name: z.string().optional(),
  description: z.string().optional(),
  _ownerId: z.string().optional(),
  _metaNodeId: z.string().optional(),
  _docType: z.string().optional(),
  _sourceId: z.string().optional(),
  _flags: z.number().optional(), // Entity flag: LSB=1 means entity
  _entityOverride: z.boolean().optional(), // User override for entity status
  view: z.string().optional(),
  editMode: z.boolean().default(false),
  done: z.union([z.boolean(), z.number(), z.null()]).optional(),
  _done: z.union([z.number(), z.boolean()]).optional(), // Completion timestamp in milliseconds or boolean
}).passthrough(); // Preserve additional underscore-prefixed props

/**
 * NodeDump Schema
 * Complete node structure from Tana export
 */
export const NodeDumpSchema = z.object({
  id: z.string(),
  props: PropsSchema,
  // touchCounts and modifiedTs can be arrays OR JSON strings (real-world data variance)
  touchCounts: z.union([z.array(z.number()), z.string()]).optional(),
  modifiedTs: z.union([z.array(z.number()), z.string()]).optional(),
  children: z.array(z.string()).optional(),
  associationMap: z.record(z.string(), z.string()).optional(),
  underConstruction: z.boolean().optional(),
  inbound_refs: z.array(z.string()).default([]),
  outbound_refs: z.array(z.string()).default([]),
  color: z.string().optional(),
});

/**
 * Visualizer Schema
 * Configuration for graph visualization
 * Controls which linkages are included in graph analysis
 */
export const VisualizerSchema = z.object({
  include_tag_tag_links: z.boolean().default(true),
  include_node_tag_links: z.boolean().default(true),
  include_inline_refs: z.boolean().default(true),
  include_inline_ref_nodes: z.boolean().default(true),
});

/**
 * TanaDump Schema
 * Top-level structure of Tana JSON export
 */
export const TanaDumpSchema = z.object({
  formatVersion: z.number(),
  docs: z.array(NodeDumpSchema),
  editors: z.array(z.tuple([z.string(), z.number()])),
  workspaces: z.record(z.string(), z.string()),
  lastTxid: z.number().optional(),
  lastFbKey: z.string().optional(),
  optimisticTransIds: z.array(z.any()).optional(),
  currentWorkspaceId: z.string().optional(),
  visualize: VisualizerSchema.optional(),
});

// Inferred TypeScript types from Zod schemas
export type Props = z.infer<typeof PropsSchema>;
export type NodeDump = z.infer<typeof NodeDumpSchema>;
export type Visualizer = z.infer<typeof VisualizerSchema>;
export type TanaDump = z.infer<typeof TanaDumpSchema>;

/**
 * Graph Analysis Types
 * These types represent the extracted graph structure
 */

/**
 * Supertag Tuple
 * Represents a detected supertag in the Tana graph
 * Identified by SYS_A13 + SYS_T01 children pattern
 */
export interface SupertagTuple {
  nodeId: string;
  tagName: string;
  tagId: string;
  superclasses: string[]; // parent supertags
  color?: string;
}

/**
 * Field Tuple
 * Represents a detected field definition
 * Identified by SYS_A13 + SYS_T02 children pattern
 */
export interface FieldTuple {
  nodeId: string;
  fieldName: string;
  fieldId: string;
}

/**
 * Inline Reference
 * Represents inline references extracted from node names
 * Pattern: <span data-inlineref-node="NODE_ID"></span>
 */
export interface InlineReference {
  sourceNodeId: string;
  targetNodeIds: string[];
  type: 'inline_ref' | 'inline_ref_indirect';
}

/**
 * Tag Application
 * Represents a supertag applied to a data node
 * Identified by SYS_A13 children WITHOUT SYS_T01 or SYS_T02
 * (Those would be tag/field definitions, not applications)
 */
export interface TagApplication {
  tupleNodeId: string;  // The tuple node containing the tag application
  dataNodeId: string;   // The actual data node that has this tag
  tagId: string;        // The supertag definition node ID
  tagName: string;      // Resolved tag name
}

/**
 * Tana Graph
 * Complete parsed graph structure with relationships
 */
export interface TanaGraph {
  nodes: Map<string, NodeDump>;
  trash: Map<string, NodeDump>;
  supertags: Map<string, SupertagTuple>;
  fields: Map<string, FieldTuple>;
  inlineRefs: InlineReference[];
  tagColors: Map<string, string>;
  tagApplications: TagApplication[];
}
