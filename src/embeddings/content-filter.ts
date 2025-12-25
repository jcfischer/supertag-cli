/**
 * Content Filter for Embeddings
 *
 * Filters nodes to select only meaningful content for embedding.
 * Excludes system/structural nodes, very short noise, and timestamp artifacts.
 *
 * Research findings (573K node database):
 * - Baseline: 573,617 named nodes
 * - With recommended filters: ~325,500 nodes (43% reduction)
 *
 * Key exclusions:
 * - tuple (394K): Field:value pairs, all named "typeChoice", "tuple", "Values"
 * - metanode (117K): System metadata with no semantic value
 * - Very short names (<3 chars): "*", "..", single characters
 * - Timestamps: "1970-01-01..." artifacts from imports
 *
 * Note on short text embeddings:
 * Testing with mxbai-embed-large shows short texts ARE semantically meaningful:
 * - Animal-Mammal: 88.2% similarity (related)
 * - John-Animal: 57.1% similarity (unrelated)
 * The model correctly distinguishes related vs unrelated short terms.
 * Minimum length lowered from 15 to 3 chars to include names and concepts.
 *
 * Entity filtering (based on Tana developer insights):
 * - Entities are "interesting" nodes: tagged items, library items, "Create new" items
 * - Detection: props._entityOverride (user signal) OR props.flags % 2 === 1 (auto)
 * - Embedding only entities dramatically reduces noise and improves search quality
 */

import type { Database } from "bun:sqlite";
import { withDbRetrySync } from "../db/retry";
import { ENTITY_FILTER_SQL, getEntityStats } from "../db/entity";

/**
 * System docTypes that should be excluded from embeddings.
 * These are structural/metadata nodes with no semantic search value.
 *
 * Note: transcript and transcriptLine are excluded by default because:
 * - 90K+ transcript lines (6.7% of all nodes) create significant noise
 * - Spoken language contains filler words, fragments, "um", "äh"
 * - Use --include-transcripts flag to include them when needed
 */
export const SYSTEM_DOC_TYPES = [
  "tuple", // Field:value pairs - all named generically
  "metanode", // System metadata
  "viewDef", // View definitions
  "search", // Saved searches
  "command", // Command nodes
  "hotkey", // Hotkey definitions
  "tagDef", // Supertag definitions
  "attrDef", // Attribute definitions
  "associatedData", // Associated data structures
  "visual", // Visual elements
  "journalPart", // Journal structure
  "group", // Group nodes
  "chatbot", // Chatbot definitions
  "workspace", // Workspace metadata
  "transcript", // Transcript containers - excluded by default (use --include-transcripts)
  "transcriptLine", // Individual transcript lines - excluded by default (90K+ noisy nodes)
] as const;

/**
 * Content docTypes that SHOULD be included in embeddings.
 * These contain meaningful searchable content.
 *
 * Note: transcript and transcriptLine moved to SYSTEM_DOC_TYPES (excluded by default).
 * Use includeTranscripts option to include them in search/embeddings.
 */
export const CONTENT_DOC_TYPES = [
  "chat", // Chat messages
  "url", // URLs with titles
  "codeblock", // Code snippets
] as const;

/**
 * Options for filtering content nodes
 */
export interface ContentFilterOptions {
  /** Minimum name length (default: 3 - filters single chars but allows short names/concepts) */
  minLength?: number;

  /** Exclude timestamp-like names starting with 1970-01-01 */
  excludeTimestamps?: boolean;

  /** Exclude system docTypes (tuple, metanode, etc.) */
  excludeSystemTypes?: boolean;

  /** Exclude names that look like reference syntax [[...]] (default: true) */
  excludeReferenceSyntax?: boolean;

  /** Filter by specific supertag */
  tag?: string;

  /** Limit number of results */
  limit?: number;

  /** Include all nodes (bypass content filters) */
  includeAll?: boolean;

  /**
   * Only include entity nodes (tagged items, library items, "Create new" items).
   * Based on Tana's entity detection: props._entityOverride OR props.flags % 2 === 1
   * Dramatically reduces noise by focusing on meaningful user-created content.
   */
  entitiesOnly?: boolean;

  /**
   * Include transcript content (transcript, transcriptLine nodes).
   * By default, transcripts are excluded from search/embeddings because:
   * - 90K+ transcript lines create significant noise (6.7% of all nodes)
   * - Spoken language contains filler words, fragments, "um", "äh"
   * Set to true to include transcripts in search results or embeddings.
   */
  includeTranscripts?: boolean;
}

/**
 * Default filter options for optimal embedding quality
 */
export const DEFAULT_FILTER_OPTIONS: ContentFilterOptions = {
  minLength: 3,
  excludeTimestamps: true,
  excludeSystemTypes: true,
  excludeReferenceSyntax: true,
};

/**
 * Build SQL query with content filters applied
 *
 * @param options - Filter options
 * @returns Query string and parameters
 */
export function buildContentFilterQuery(options: ContentFilterOptions): {
  query: string;
  params: (string | number)[];
} {
  const params: (string | number)[] = [];
  const conditions: string[] = ["n.name IS NOT NULL"];

  // If includeAll is set, skip content filters
  if (!options.includeAll) {
    // Minimum length filter - but entities always pass (they're "interesting" by definition)
    // This ensures short-named entities like "Animal #topic" get embedded
    if (options.minLength && options.minLength > 0) {
      conditions.push(`(
        LENGTH(n.name) >= ${options.minLength}
        OR ${ENTITY_FILTER_SQL}
      )`);
    }

    // Exclude timestamp artifacts
    if (options.excludeTimestamps) {
      conditions.push("n.name NOT LIKE '1970-01-01%'");
    }

    // Exclude reference-syntax text nodes (names like "[[Something]]" or "- [[Something]]")
    // These are text artifacts, not actual references - the real nodes have plain names
    if (options.excludeReferenceSyntax) {
      conditions.push("n.name NOT LIKE '%[[%]]%'");
    }

    // Exclude system docTypes
    if (options.excludeSystemTypes) {
      // When includeTranscripts is true, exclude transcript types from the exclusion list
      const transcriptTypes = ["transcript", "transcriptLine"];
      const typesToExclude = options.includeTranscripts
        ? SYSTEM_DOC_TYPES.filter((t) => !transcriptTypes.includes(t))
        : SYSTEM_DOC_TYPES;

      const docTypeList = typesToExclude.map((t) => `'${t}'`).join(", ");
      conditions.push(`(
        json_extract(n.raw_data, '$.props._docType') IS NULL
        OR json_extract(n.raw_data, '$.props._docType') NOT IN (${docTypeList})
      )`);
    }

    // Entity filter - only include "interesting" nodes
    if (options.entitiesOnly) {
      conditions.push(ENTITY_FILTER_SQL);
    }
  }

  let query: string;

  // Tag filter requires join with tag_applications
  if (options.tag) {
    query = `
      SELECT DISTINCT n.id, n.name
      FROM nodes n
      JOIN tag_applications ta ON ta.data_node_id = n.id
      WHERE ${conditions.join(" AND ")}
        AND ta.tag_name = ?
    `;
    params.push(options.tag);
  } else {
    query = `
      SELECT n.id, n.name
      FROM nodes n
      WHERE ${conditions.join(" AND ")}
    `;
  }

  // Apply limit
  if (options.limit && options.limit > 0) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  return { query, params };
}

/**
 * Get count of nodes that would be selected with given filters
 *
 * @param db - Database connection
 * @param options - Filter options
 * @returns Number of matching nodes
 */
export function getFilterableNodeCount(
  db: Database,
  options: ContentFilterOptions
): number {
  const { query, params } = buildContentFilterQuery(options);

  // Convert SELECT to COUNT
  const countQuery = query.replace(
    /SELECT\s+(DISTINCT\s+)?n\.id,\s*n\.name/i,
    "SELECT COUNT($1n.id)"
  );

  // Remove LIMIT for count query
  const countQueryNoLimit = countQuery.replace(/\s+LIMIT\s+\?/, "");
  const countParams = params.filter((p) => p !== options.limit);

  const result = withDbRetrySync(
    () => db.query(countQueryNoLimit).get(...countParams) as Record<string, number>,
    "getFilterableNodeCount"
  );

  // Handle both regular and DISTINCT count results
  return result["COUNT(n.id)"] ?? result["COUNT(DISTINCT n.id)"] ?? 0;
}

/**
 * Get nodes to embed with content filtering applied
 *
 * @param db - Database connection
 * @param options - Filter options
 * @returns Array of nodes with id and name
 */
export function getFilteredNodes(
  db: Database,
  options: ContentFilterOptions = DEFAULT_FILTER_OPTIONS
): Array<{ id: string; name: string }> {
  const { query, params } = buildContentFilterQuery(options);
  return withDbRetrySync(
    () => db.query(query).all(...params) as Array<{ id: string; name: string }>,
    "getFilteredNodes"
  );
}

/**
 * Get statistics about filtering effectiveness
 *
 * @param db - Database connection
 * @returns Statistics object
 */
export function getFilterStats(db: Database): {
  totalNamed: number;
  withDefaultFilters: number;
  reduction: string;
  byDocType: Array<{ docType: string | null; count: number }>;
  entityStats: {
    totalEntities: number;
    entitiesTagged: number;
    entitiesLibrary: number;
    entitiesWithOverride: number;
    entitiesAutomatic: number;
    entityPercentage: string;
  };
  entitiesWithFilters: number;
} {
  // Total named nodes
  const totalNamed = withDbRetrySync(
    () => db
      .query("SELECT COUNT(*) as count FROM nodes WHERE name IS NOT NULL")
      .get() as { count: number },
    "getFilterStats totalNamed"
  );

  // With default filters
  const withDefaultFilters = getFilterableNodeCount(db, DEFAULT_FILTER_OPTIONS);

  // With default filters + entities only
  const entitiesWithFilters = getFilterableNodeCount(db, {
    ...DEFAULT_FILTER_OPTIONS,
    entitiesOnly: true,
  });

  // By docType
  const byDocType = withDbRetrySync(
    () => db
      .query(`
        SELECT
          json_extract(raw_data, '$.props._docType') as docType,
          COUNT(*) as count
        FROM nodes
        WHERE name IS NOT NULL
        GROUP BY docType
        ORDER BY count DESC
        LIMIT 20
      `)
      .all() as Array<{ docType: string | null; count: number }>,
    "getFilterStats byDocType"
  );

  const reduction = (
    ((totalNamed.count - withDefaultFilters) / totalNamed.count) *
    100
  ).toFixed(1);

  // Get entity-specific stats
  const entityStats = getEntityStats(db);

  return {
    totalNamed: totalNamed.count,
    withDefaultFilters,
    reduction: `${reduction}%`,
    byDocType,
    entityStats: {
      totalEntities: entityStats.totalEntities,
      entitiesTagged: entityStats.entitiesTagged,
      entitiesLibrary: entityStats.entitiesLibrary,
      entitiesWithOverride: entityStats.entitiesWithOverride,
      entitiesAutomatic: entityStats.entitiesAutomatic,
      entityPercentage: entityStats.entityPercentage,
    },
    entitiesWithFilters,
  };
}
