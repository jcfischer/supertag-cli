/**
 * Field Values Type Definitions
 *
 * Types for indexing, storing, and querying field values from Tana tuple structures.
 * Field values are text-based data stored in tuple children, linked via _sourceId
 * to their field definitions.
 */

import { z } from "zod";

/**
 * Stored field value in the database
 * Represents a single field value after extraction and storage
 */
export interface StoredFieldValue {
  /** Auto-increment primary key */
  id: number;
  /** The tuple node containing this field application */
  tupleId: string;
  /** The parent node (entity) the field belongs to (e.g., day node) */
  parentId: string;
  /** Field definition ID (_sourceId from tuple) */
  fieldDefId: string;
  /** Human-readable field name */
  fieldName: string;
  /** Node ID containing the value text */
  valueNodeId: string;
  /** Actual text content of the field value */
  valueText: string;
  /** Order for multi-value fields (0, 1, 2...) */
  valueOrder: number;
  /** Timestamp from parent node (null if unavailable) */
  created: number | null;
}

/**
 * Zod schema for StoredFieldValue validation
 */
export const StoredFieldValueSchema = z.object({
  id: z.number(),
  tupleId: z.string(),
  parentId: z.string(),
  fieldDefId: z.string(),
  fieldName: z.string(),
  valueNodeId: z.string(),
  valueText: z.string(),
  valueOrder: z.number().default(0),
  created: z.number().nullable(),
});

/**
 * Query result including parent context
 * Returned when querying field values with enrichment
 */
export interface FieldValueResult {
  /** Parent node ID */
  parentId: string;
  /** Parent node name */
  parentName: string;
  /** Supertags applied to parent node */
  parentTags: string[];
  /** Field name */
  fieldName: string;
  /** Value text */
  valueText: string;
  /** Order for multi-value fields */
  valueOrder: number;
  /** Created timestamp */
  created: number | null;
}

/**
 * Compound query condition
 * Used for filtering nodes by field values
 */
export interface FieldCondition {
  /** Field name to filter by */
  field: string;
  /** Comparison operator */
  op: "eq" | "contains" | "lt" | "gt";
  /** Value to compare against */
  value: string;
}

/**
 * Zod schema for FieldCondition validation
 */
export const FieldConditionSchema = z.object({
  field: z.string(),
  op: z.enum(["eq", "contains", "lt", "gt"]),
  value: z.string(),
});

/**
 * Field value extracted during parsing (before database storage)
 * Does not include auto-increment id
 */
export interface ExtractedFieldValue {
  /** The tuple node containing this field application */
  tupleId: string;
  /** The parent node (entity) the field belongs to */
  parentId: string;
  /** Field definition ID (_sourceId from tuple) */
  fieldDefId: string;
  /** Human-readable field name (resolved from definition) */
  fieldName: string;
  /** Node ID containing the value text */
  valueNodeId: string;
  /** Actual text content of the field value */
  valueText: string;
  /** Order for multi-value fields (0, 1, 2...) */
  valueOrder: number;
}

/**
 * Options for querying field values
 */
export interface FieldQueryOptions {
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by creation date (YYYY-MM-DD) */
  createdAfter?: string;
  /** Filter by creation date (YYYY-MM-DD) */
  createdBefore?: string;
  /** Filter by parent node's supertag */
  parentTag?: string;
  /** Sort field */
  orderBy?: "created" | "fieldName" | "parentName";
  /** Sort direction */
  orderDir?: "asc" | "desc";
}

/**
 * Zod schema for FieldQueryOptions validation
 */
export const FieldQueryOptionsSchema = z.object({
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
  parentTag: z.string().optional(),
  orderBy: z.enum(["created", "fieldName", "parentName"]).optional(),
  orderDir: z.enum(["asc", "desc"]).optional(),
});

/**
 * Options for compound queries (tag + field conditions)
 */
export interface CompoundQueryOptions {
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Include all field values in response */
  includeFields?: boolean;
  /** Sort field */
  orderBy?: "created" | "name";
  /** Sort direction */
  orderDir?: "asc" | "desc";
}

/**
 * Zod schema for CompoundQueryOptions validation
 */
export const CompoundQueryOptionsSchema = z.object({
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional(),
  includeFields: z.boolean().optional(),
  orderBy: z.enum(["created", "name"]).optional(),
  orderDir: z.enum(["asc", "desc"]).optional(),
});

/**
 * Result from compound query
 */
export interface CompoundQueryResult {
  /** Node ID */
  id: string;
  /** Node name */
  name: string;
  /** Supertags on this node */
  tags: string[];
  /** Created timestamp */
  created: number | null;
  /** Field values (if includeFields=true) */
  fields?: Array<{
    fieldName: string;
    valueText: string;
    valueOrder: number;
  }>;
}

/**
 * Field definition info from field_names table
 */
export interface FieldDefinition {
  /** Field definition ID */
  fieldId: string;
  /** Human-readable field name */
  fieldName: string;
  /** Supertags that use this field */
  supertags?: string[];
}

/**
 * Field exclusion record
 * Used to skip indexing certain system fields
 */
export interface FieldExclusion {
  /** Field name to exclude */
  fieldName: string;
  /** Reason for exclusion */
  reason?: string;
}
