/**
 * Visualization Types
 *
 * TypeScript interfaces and Zod schemas for supertag inheritance visualization.
 * These types are shared by all visualization renderers (Mermaid, DOT, JSON, etc.)
 */

import { z } from "zod";

/**
 * A field definition for UML-style display
 */
export const VisualizationFieldSchema = z.object({
  /** Field name (e.g., "Title", "Date") */
  name: z.string().min(1),
  /** Data type (text, date, reference, url, number, checkbox) */
  dataType: z.string().optional(),
  /** Whether this field is inherited from a parent tag */
  inherited: z.boolean(),
  /** Origin tag name if inherited */
  originTag: z.string().optional(),
});

export type VisualizationField = z.infer<typeof VisualizationFieldSchema>;

/**
 * A single supertag in the visualization graph
 */
export const VisualizationNodeSchema = z.object({
  /** tagDef node ID */
  id: z.string().min(1),
  /** Display name (e.g., "meeting") */
  name: z.string().min(1),
  /** Own fields count (not inherited) */
  fieldCount: z.number().int().nonnegative(),
  /** Tag applications count */
  usageCount: z.number().int().nonnegative(),
  /** From Tana (hex or color name) */
  color: z.string().optional(),
  /** Has no parents */
  isOrphan: z.boolean(),
  /** Has no children */
  isLeaf: z.boolean(),
  /** Field details for UML-style display (optional, enriched by getDataWithFields) */
  fields: z.array(VisualizationFieldSchema).optional(),
});

export type VisualizationNode = z.infer<typeof VisualizationNodeSchema>;

/**
 * An inheritance relationship (child extends parent)
 */
export const VisualizationLinkSchema = z.object({
  /** Child tag ID */
  source: z.string().min(1),
  /** Parent tag ID */
  target: z.string().min(1),
});

export type VisualizationLink = z.infer<typeof VisualizationLinkSchema>;

/**
 * Graph metadata for display
 */
export const VisualizationMetadataSchema = z.object({
  totalTags: z.number().int().nonnegative(),
  totalLinks: z.number().int().nonnegative(),
  maxDepth: z.number().int().nonnegative(),
  /** If filtered by --root */
  rootTag: z.string().optional(),
  /** ISO timestamp */
  generatedAt: z.string(),
  workspace: z.string(),
});

export type VisualizationMetadata = z.infer<typeof VisualizationMetadataSchema>;

/**
 * Core visualization data structure shared by all renderers
 */
export const VisualizationDataSchema = z.object({
  nodes: z.array(VisualizationNodeSchema),
  links: z.array(VisualizationLinkSchema),
  metadata: VisualizationMetadataSchema,
});

export type VisualizationData = z.infer<typeof VisualizationDataSchema>;

/**
 * Options for filtering visualization
 */
export const VisualizationOptionsSchema = z.object({
  /** Filter to subtree from this tag */
  root: z.string().optional(),
  /** Max traversal depth */
  depth: z.number().int().nonnegative().optional(),
  /** Minimum tag applications */
  minUsage: z.number().int().nonnegative().optional(),
  /** Include tags with no parents */
  includeOrphans: z.boolean().optional(),
  workspace: z.string().optional(),
});

export type VisualizationOptions = z.infer<typeof VisualizationOptionsSchema>;

/**
 * Supported output formats
 */
export type VisualizationFormat = "mermaid" | "dot" | "json" | "html" | "3d" | "svg" | "pdf";

/**
 * Mermaid renderer options
 */
export interface MermaidRenderOptions {
  /** Flowchart direction */
  direction?: "TD" | "BT" | "LR" | "RL";
  /** Show field details in node labels */
  showFields?: boolean;
  /** Show inherited fields (requires showFields) */
  showInheritedFields?: boolean;
  /** Show usage count in node labels */
  showUsageCount?: boolean;
}

/**
 * DOT (Graphviz) renderer options
 */
export interface DOTRenderOptions {
  /** Graph rank direction */
  rankdir?: "TB" | "BT" | "LR" | "RL";
  /** Show field details in node labels */
  showFields?: boolean;
  /** Show inherited fields (requires showFields) */
  showInheritedFields?: boolean;
  /** Use colors from Tana */
  useColors?: boolean;
}

/**
 * JSON renderer options
 */
export interface JSONRenderOptions {
  /** Pretty-print with indentation */
  pretty?: boolean;
}

/**
 * HTML renderer options (with Zod schema for validation)
 */
export const HTMLRenderOptionsSchema = z.object({
  /** Graph direction */
  direction: z.enum(["TB", "BT", "LR", "RL"]).optional(),
  /** Show field details in nodes */
  showFields: z.boolean().optional(),
  /** Show inherited fields (requires showFields) */
  showInheritedFields: z.boolean().optional(),
  /** Allow collapsing fields per node */
  collapsibleFields: z.boolean().optional(),
  /** Color theme */
  theme: z.enum(["light", "dark"]).optional(),
});

export type HTMLRenderOptions = z.infer<typeof HTMLRenderOptionsSchema>;
