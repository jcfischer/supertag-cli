/**
 * Graph-Aware Enrichment Types (F-104)
 *
 * Type definitions for the graph-aware embedding enrichment pipeline.
 * Enrichment prepends supertag type and field values to node text
 * before embedding, improving semantic search quality for typed queries.
 */

import type { ContextualizedNode } from "../embeddings/contextualize";

/** Field types that can be included in enrichment */
export type FieldType = "options" | "date" | "instance" | "text";

/**
 * Per-supertag enrichment configuration overrides
 */
export interface SupertagEnrichmentConfig {
  /** Specific field names to include (overrides defaults.includeFields) */
  includeFields?: string[];
  /** Maximum fields for this specific tag */
  maxFieldsPerTag?: number;
  /** Completely disable enrichment for this tag */
  disabled?: boolean;
}

/**
 * Graph-aware enrichment configuration
 * Stored at: ~/.config/supertag/embed-enrichment.json
 */
export interface GraphAwareEnrichmentConfig {
  /** Global defaults for all supertags */
  defaults: {
    /** Include supertag name in enrichment (default: true) */
    includeTagName: boolean;
    /** Field types to include: "options", "date", "instance", "text" */
    includeFields: FieldType[];
    /** Maximum fields per supertag (default: 5) */
    maxFieldsPerTag: number;
  };
  /** Per-supertag overrides (key is lowercase tag name) */
  overrides: Record<string, SupertagEnrichmentConfig>;
}

/**
 * Default configuration when no config file exists
 */
export const DEFAULT_ENRICHMENT_CONFIG: GraphAwareEnrichmentConfig = {
  defaults: {
    includeTagName: true,
    includeFields: ["options", "date", "instance"],
    maxFieldsPerTag: 5,
  },
  overrides: {},
};

/**
 * Extended ContextualizedNode with graph enrichment metadata
 */
export interface EnrichedContextualizedNode extends ContextualizedNode {
  /** Whether graph enrichment was applied */
  enriched: boolean;
  /** Enrichment format version (for re-generation tracking) */
  enrichmentVersion: number;
  /** The raw enriched text before any truncation (for debugging) */
  enrichedTextRaw: string;
  /** Supertag names used for enrichment */
  enrichmentTags: string[];
  /** Fields included in enrichment */
  enrichmentFields: Array<{ name: string; value: string }>;
}

/**
 * Current enrichment format version.
 * Bump when enrichment template changes to trigger re-generation.
 */
export const ENRICHMENT_VERSION = 1;

/**
 * Type guard for EnrichedContextualizedNode.
 * Use instead of `"enriched" in node` + `as` cast.
 */
export function isEnrichedNode(
  node: ContextualizedNode
): node is EnrichedContextualizedNode {
  return "enriched" in node && "enrichmentVersion" in node;
}
