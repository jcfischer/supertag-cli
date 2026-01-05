/**
 * Supertag Metadata Extraction Module
 *
 * Extracts field definitions and inheritance relationships from tagDef nodes.
 *
 * Field discovery pattern:
 * - tagDef.children[] contains tuples
 * - Each tuple's children[0] = field label node with field name
 *
 * Inheritance discovery pattern:
 * - tagDef._metaNodeId points to metaNode
 * - metaNode contains tuple with SYS_A13 marker
 * - SYS_A13 tuple's remaining children are parent tagDef IDs
 */

import { Database } from "bun:sqlite";
import type { NodeDump } from "../types/tana-dump";
import type {
  ExtractedField,
  EnhancedExtractedField,
  SupertagMetadataEntry,
  SupertagMetadataExtractionResult,
} from "../types/supertag-metadata";
import { normalizeName } from "../utils/normalize-name";
import { inferDataType } from "../utils/infer-data-type";

/**
 * Mapping of known Tana system field markers to human-readable names.
 *
 * These are raw string identifiers used in tagDef tuple children to indicate
 * system-defined fields. They don't correspond to node IDs.
 *
 * Discovered markers:
 * - SYS_A90 (10 tagDefs, 3572 uses) - Date field (calendar events, meetings)
 * - SYS_A61 (17 tagDefs) - Due Date field (tasks, projects)
 * - Mp2A7_2PQw (1 tagDef, 1608 uses) - Attendees field (meetings)
 */
export const SYSTEM_FIELD_MARKERS: Record<string, string> = {
  SYS_A90: "Date",
  SYS_A61: "Due Date",
  Mp2A7_2PQw: "Attendees",
};

/**
 * Check if a node is in the trash by walking its ownership chain.
 *
 * Tana marks trash by having an _ownerId containing "TRASH" (e.g., "M9rkJkwuED_TRASH").
 * A node is considered trashed if any ancestor in its ownership chain is in trash.
 *
 * @param node - The node to check
 * @param nodes - Map of all nodes for ownership lookup
 * @param maxDepth - Maximum depth to traverse (prevents infinite loops)
 * @returns true if the node or any of its owners is in trash
 */
export function isNodeInTrash(
  node: NodeDump,
  nodes: Map<string, NodeDump>,
  maxDepth: number = 20
): boolean {
  let currentNode: NodeDump | undefined = node;
  let depth = 0;

  while (currentNode && depth < maxDepth) {
    const ownerId = currentNode.props._ownerId;

    // Check if owner ID contains TRASH
    if (ownerId && String(ownerId).includes("TRASH")) {
      return true;
    }

    // Move to parent node
    if (ownerId) {
      currentNode = nodes.get(String(ownerId));
    } else {
      break;
    }

    depth++;
  }

  return false;
}

/**
 * Extract field definitions from a tagDef node.
 *
 * Examines the tagDef's children looking for tuples where:
 * - children[0] has a name property (the field label)
 *
 * @param tagDef - The tagDef node to extract fields from
 * @param nodes - Map of all nodes for child lookup
 * @returns Array of extracted field definitions with order
 */
export function extractFieldsFromTagDef(
  tagDef: NodeDump,
  nodes: Map<string, NodeDump>
): ExtractedField[] {
  const fields: ExtractedField[] = [];

  // No children = no fields
  if (!tagDef.children || tagDef.children.length === 0) {
    return fields;
  }

  // Examine each child of the tagDef
  for (let i = 0; i < tagDef.children.length; i++) {
    const childId = tagDef.children[i];
    const child = nodes.get(childId);

    // Skip if child doesn't exist or isn't a tuple
    if (!child || child.props._docType !== "tuple") {
      continue;
    }

    // Skip tuples without children
    if (!child.children || child.children.length < 1) {
      continue;
    }

    // Get the first child of the tuple (field label or system marker)
    const labelId = child.children[0];
    const labelNode = nodes.get(labelId);

    // Check if this is a system field marker (raw string, not a node)
    if (!labelNode && labelId in SYSTEM_FIELD_MARKERS) {
      fields.push({
        fieldName: SYSTEM_FIELD_MARKERS[labelId],
        fieldLabelId: labelId, // Keep the marker as the label ID
        fieldOrder: fields.length,
      });
      continue;
    }

    // Skip if label doesn't have a name
    if (!labelNode?.props.name) {
      continue;
    }

    fields.push({
      fieldName: labelNode.props.name,
      fieldLabelId: labelId,
      fieldOrder: fields.length, // Order based on position in parent
    });
  }

  return fields;
}

/**
 * Extract parent tagDef IDs from a tagDef's metaNode.
 *
 * Inheritance is stored in the metaNode via a tuple structure:
 * - metaNode has tuple children
 * - Tuple with first child named "SYS_A13" contains inheritance info
 * - Remaining children of that tuple are parent tagDef IDs
 *
 * @param tagDef - The tagDef node to extract parents from
 * @param nodes - Map of all nodes for child lookup
 * @returns Array of parent tagDef node IDs
 */
export function extractParentsFromTagDef(
  tagDef: NodeDump,
  nodes: Map<string, NodeDump>
): string[] {
  const parents: string[] = [];

  // No _metaNodeId = no inheritance info
  const metaNodeId = tagDef.props._metaNodeId;
  if (!metaNodeId || typeof metaNodeId !== "string") {
    return parents;
  }

  const metaNode = nodes.get(metaNodeId);
  if (!metaNode?.children) {
    return parents;
  }

  // Look through metaNode's children for the SYS_A13 tuple
  for (const tupleId of metaNode.children) {
    const tuple = nodes.get(tupleId);

    // Skip non-tuples
    if (!tuple || tuple.props._docType !== "tuple") {
      continue;
    }

    // Must have children
    if (!tuple.children || tuple.children.length < 2) {
      continue;
    }

    // Check if first child is SYS_A13 marker
    // In real Tana exports, SYS_A13 is a raw string literal, NOT a node ID
    // The children array looks like: ["SYS_A13", "SYS_T01", "parent-tagdef-id"]
    const firstChildId = tuple.children[0];

    // Support both formats:
    // 1. Raw string "SYS_A13" (real Tana exports)
    // 2. Node ID pointing to a node named "SYS_A13" (legacy test data)
    const firstChildNode = nodes.get(firstChildId);
    const isSysA13Marker =
      firstChildId === "SYS_A13" || firstChildNode?.props.name === "SYS_A13";

    if (!isSysA13Marker) {
      continue;
    }

    // Found the inheritance tuple - remaining children are parent IDs
    // These may include:
    // - System references (SYS_T01, SYS_T98, etc.) that don't resolve to nodes
    // - Actual tagDef node IDs
    for (let i = 1; i < tuple.children.length; i++) {
      const potentialParentId = tuple.children[i];
      const potentialParent = nodes.get(potentialParentId);

      // Only include if it's actually a tagDef node
      if (potentialParent?.props._docType === "tagDef") {
        parents.push(potentialParentId);
      }
    }

    // Only one SYS_A13 tuple expected per metaNode
    break;
  }

  return parents;
}

/**
 * Extract supertag metadata from all nodes and store in database.
 *
 * Scans all nodes for tagDef entries, extracts their field definitions
 * and inheritance relationships, and stores them in the database tables.
 *
 * Updated for Spec 020 (Schema Consolidation):
 * - Also populates supertag_metadata table (T-2.4)
 * - Uses enhanced field extraction with normalized_name and inferred_data_type (T-2.3)
 *
 * @param nodes - Map of all nodes from Tana export
 * @param db - SQLite database connection
 * @returns Extraction statistics
 */
export function extractSupertagMetadata(
  nodes: Map<string, NodeDump>,
  db: Database
): SupertagMetadataExtractionResult {
  let tagDefsProcessed = 0;
  let fieldsExtracted = 0;
  let parentsExtracted = 0;

  // Prepare statements for batch insertion with upsert
  // Enhanced field insert includes normalized_name and inferred_data_type (T-2.3)
  const insertField = db.prepare(`
    INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tag_id, field_name) DO UPDATE SET
      tag_name = excluded.tag_name,
      field_label_id = excluded.field_label_id,
      field_order = excluded.field_order,
      normalized_name = excluded.normalized_name,
      inferred_data_type = excluded.inferred_data_type
  `);

  const insertParent = db.prepare(`
    INSERT INTO supertag_parents (child_tag_id, parent_tag_id)
    VALUES (?, ?)
    ON CONFLICT(child_tag_id, parent_tag_id) DO NOTHING
  `);

  // Supertag metadata insert (T-2.4)
  const insertMetadata = db.prepare(`
    INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description, color)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tag_id) DO UPDATE SET
      tag_name = excluded.tag_name,
      normalized_name = excluded.normalized_name,
      description = excluded.description,
      color = excluded.color
  `);

  // Iterate through all nodes looking for tagDefs
  for (const [nodeId, node] of nodes) {
    if (node.props._docType !== "tagDef") {
      continue;
    }

    // Skip trashed tagDefs - walk the ownership chain to detect trash
    // A node is trashed if any ancestor in its ownership chain has "TRASH" in its ID
    if (isNodeInTrash(node, nodes)) {
      continue;
    }

    tagDefsProcessed++;

    // Extract and store supertag-level metadata (T-2.4)
    const metadata = extractSupertagMetadataEntry(node);
    insertMetadata.run(
      metadata.tagId,
      metadata.tagName,
      metadata.normalizedName,
      metadata.description,
      metadata.color
    );

    // Extract and store enhanced fields with normalized_name and inferred_data_type (T-2.3)
    const fields = extractEnhancedFieldsFromTagDef(node, nodes);
    for (const field of fields) {
      insertField.run(
        nodeId,
        metadata.tagName,
        field.fieldName,
        field.fieldLabelId,
        field.fieldOrder,
        field.normalizedName,
        field.inferredDataType
      );
      fieldsExtracted++;
    }

    // Extract and store parent relationships
    const parentIds = extractParentsFromTagDef(node, nodes);
    for (const parentId of parentIds) {
      insertParent.run(nodeId, parentId);
      parentsExtracted++;
    }
  }

  return {
    tagDefsProcessed,
    fieldsExtracted,
    parentsExtracted,
  };
}

/**
 * Extract enhanced field definitions from a tagDef node (Spec 020 T-2.3).
 *
 * Extends extractFieldsFromTagDef with:
 * - normalizedName: Lowercase, special chars removed
 * - inferredDataType: Heuristic data type from field name
 *
 * @param tagDef - The tagDef node to extract fields from
 * @param nodes - Map of all nodes for child lookup
 * @returns Array of enhanced extracted field definitions
 */
export function extractEnhancedFieldsFromTagDef(
  tagDef: NodeDump,
  nodes: Map<string, NodeDump>
): EnhancedExtractedField[] {
  // Get base fields using existing function
  const baseFields = extractFieldsFromTagDef(tagDef, nodes);

  // Enhance each field with normalized name and inferred data type
  return baseFields.map((field) => ({
    ...field,
    normalizedName: normalizeName(field.fieldName),
    inferredDataType: inferDataType(field.fieldName),
  }));
}

/**
 * Extract supertag-level metadata from a tagDef node (Spec 020 T-2.4).
 *
 * Extracts:
 * - tagId: The node ID
 * - tagName: Original tag name
 * - normalizedName: Lowercase, special chars removed
 * - description: From _description prop if present
 * - color: From _color prop if present
 *
 * @param tagDef - The tagDef node to extract metadata from
 * @returns Supertag metadata entry
 */
export function extractSupertagMetadataEntry(
  tagDef: NodeDump
): SupertagMetadataEntry {
  const tagName = tagDef.props.name || "";

  return {
    tagId: tagDef.id,
    tagName,
    normalizedName: normalizeName(tagName),
    description: (tagDef.props._description as string) || null,
    color: (tagDef.props._color as string) || null,
  };
}
