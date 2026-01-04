/**
 * Supertag Metadata Types
 *
 * TypeScript interfaces for supertag field definitions and inheritance relationships.
 * Used for storing direct relationships and computing transitive inheritance.
 */

/**
 * Supertag field definition stored in database.
 * Extracted from tagDef tuple children during indexing.
 */
export interface SupertagField {
  id: number;
  tagId: string; // tagDef node ID
  tagName: string; // Human-readable tag name
  fieldName: string; // Field label (from tuple's first child)
  fieldLabelId: string; // Node ID of the field label
  fieldOrder: number; // Position in tagDef children
  inferredDataType?: string; // Inferred data type (text, date, email, etc.) - Spec 020
  targetSupertagId?: string; // Target supertag ID for reference fields (Options from Supertag)
  targetSupertagName?: string; // Target supertag name for reference fields
}

/**
 * Direct inheritance relationship stored in database.
 * Extracted from metaNode SYS_A13 tuples during indexing.
 */
export interface SupertagParent {
  id: number;
  childTagId: string; // Child tagDef node ID
  parentTagId: string; // Parent tagDef node ID
}

/**
 * Resolved field with origin information.
 * Computed on demand from SupertagField + inheritance.
 */
export interface InheritedField {
  fieldName: string;
  fieldLabelId: string;
  originTagId: string; // Tag that defines this field
  originTagName: string; // Human-readable origin tag name
  depth: number; // 0 = own field, 1+ = inherited depth
  inferredDataType?: string; // Inferred data type (text, date, email, etc.) - Spec 020
  targetSupertagId?: string; // Target supertag ID for reference fields (Options from Supertag)
  targetSupertagName?: string; // Target supertag name for reference fields
}

/**
 * Node in inheritance tree structure.
 * Used for tree visualization of supertag hierarchy.
 */
export interface InheritanceNode {
  tagId: string;
  tagName: string;
  depth?: number;
  parents: InheritanceNode[]; // Recursive tree structure
}

/**
 * Ancestor entry from recursive CTE.
 * Simple structure with just tag ID and depth.
 */
export interface Ancestor {
  tagId: string;
  depth: number;
}

/**
 * Flat ancestor entry from recursive CTE.
 * Used for computing transitive inheritance.
 */
export interface AncestorEntry {
  tagId: string;
  tagName: string;
  depth: number;
}

/**
 * Complete metadata result for a supertag.
 * Aggregates field and inheritance information for API responses.
 */
export interface SupertagMetadataResult {
  tag: {
    id: string;
    name: string;
  };
  fields: {
    own: Array<{ name: string; labelId: string }>;
    inherited: Array<{ name: string; origin: string; depth: number }>;
  };
  inheritance: {
    directParents: Array<{ id: string; name: string }>;
    allAncestors: Array<{ id: string; name: string; depth: number }>;
  };
}

/**
 * Extraction result from indexing.
 * Reports counts for logging and verification.
 */
export interface SupertagMetadataExtractionResult {
  fieldsExtracted: number;
  parentsExtracted: number;
  tagDefsProcessed: number;
}

/**
 * Raw field extraction from tagDef.
 * Intermediate structure before database insertion.
 */
export interface ExtractedField {
  fieldName: string;
  fieldLabelId: string;
  fieldOrder: number;
}

/**
 * Enhanced field extraction with additional metadata (Spec 020).
 * Includes normalized name and inferred data type for unified schema.
 */
export interface EnhancedExtractedField extends ExtractedField {
  normalizedName: string; // Lowercase, no special chars
  inferredDataType: string; // 'text' | 'date' | 'reference' | 'url' | 'number' | 'checkbox'
  description?: string | null; // Field description if available
}

/**
 * Supertag-level metadata entry (Spec 020).
 * Extracted from tagDef node for supertag_metadata table.
 */
export interface SupertagMetadataEntry {
  tagId: string;
  tagName: string;
  normalizedName: string;
  description: string | null;
  color: string | null;
}

/**
 * Field validation result.
 * Used when creating nodes to warn about invalid field names.
 */
export interface FieldValidationResult {
  valid: boolean;
  fieldLabelId?: string;
  originTagId?: string;
  originTagName?: string;
  inherited?: boolean;
  suggestion?: string; // Closest match if invalid
}
