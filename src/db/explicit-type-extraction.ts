import type { DataType } from "../utils/infer-data-type";
import { Database } from "bun:sqlite";

/**
 * Maps Tana's SYS_D* codes to our DataType enum.
 *
 * Discovered via analysis of Tana export structure:
 * - typeChoice tuples have children like ["SYS_T06", "SYS_D03"]
 * - SYS_T06 appears to be a common type marker
 * - SYS_D* codes indicate the actual field type
 */
const SYS_D_CODE_MAP: Record<string, DataType> = {
  SYS_D01: "checkbox", // Boolean/checkbox field
  SYS_D03: "date", // Date field
  SYS_D05: "reference", // Options from Supertag (reference to tagged items)
  SYS_D06: "text", // Plain text field
  SYS_D08: "number", // Number field
  SYS_D10: "url", // URL field
  SYS_D11: "email", // Email field
  SYS_D12: "options", // Options (inline options)
  SYS_D13: "reference", // Tana User (team member assignment)
};

/**
 * Maps a Tana SYS_D* code to our DataType.
 * Returns null if the code is not recognized.
 */
export function mapSysDCodeToDataType(code: string): DataType | null {
  return SYS_D_CODE_MAP[code] ?? null;
}

/**
 * Extracts the DataType from a typeChoice's children array.
 *
 * @param children - Array of child IDs from the typeChoice tuple
 * @returns The DataType or null if not found
 */
export function extractTypeFromTypeChoiceChildren(
  children: string[] | undefined | null
): DataType | null {
  if (!children || !Array.isArray(children)) {
    return null;
  }

  // Find the SYS_D* code in the children
  const sysDCode = children.find((c) => c.startsWith("SYS_D"));
  if (!sysDCode) {
    return null;
  }

  return mapSysDCodeToDataType(sysDCode);
}

/**
 * Extracts field types from Tana export docs array.
 *
 * Looks for attrDef nodes with typeChoice children and extracts
 * their type from the SYS_D* code.
 *
 * @param docs - Array of Tana document nodes
 * @returns Map of field definition ID to DataType
 */
export function extractFieldTypesFromDocs(
  docs: Array<{
    id: string;
    props?: { _docType?: string; _sourceId?: string; name?: string };
    children?: string[];
  }>
): Map<string, DataType> {
  const fieldTypes = new Map<string, DataType>();

  // Build lookup for quick access: which parent contains each node
  const parentById = new Map<string, string>();
  for (const doc of docs) {
    if (doc.children) {
      for (const childId of doc.children) {
        parentById.set(childId, doc.id);
      }
    }
  }

  // Find all typeChoice tuples and extract types
  // This is more robust than filtering by _docType since some attrDef nodes
  // don't have _docType set explicitly
  const typeChoices = docs.filter(
    (d) =>
      d.props?._sourceId === "SYS_A02" && d.props?.name === "typeChoice"
  );

  for (const typeChoice of typeChoices) {
    const dataType = extractTypeFromTypeChoiceChildren(typeChoice.children);
    if (!dataType) continue;

    // Get the parent (field definition) ID
    const parentId = parentById.get(typeChoice.id);
    if (parentId) {
      fieldTypes.set(parentId, dataType);
    }
  }

  return fieldTypes;
}

/**
 * Target supertag information for reference fields
 */
export interface TargetSupertag {
  tagDefId: string;
  tagName: string;
}

/**
 * Extracts target supertag from field definition for "Options from Supertag" fields.
 *
 * In Tana's export, reference fields (SYS_D05) have a "Selected source supertag" tuple
 * that points to the tagDef of the target supertag.
 *
 * Structure:
 * - Field label node has children including a tuple with description "Selected source supertag"
 * - This tuple has children: ["SYS_A05", <tagDefId>]
 * - The tagDefId points to a tagDef node with the target supertag name
 *
 * @param docs - Array of Tana document nodes
 * @param fieldLabelId - ID of the field label node
 * @returns Target supertag info or null if not found
 */
export function extractTargetSupertag(
  docs: Array<{
    id: string;
    props?: { _docType?: string; name?: string; description?: string };
    children?: string[];
  }>,
  fieldLabelId: string
): TargetSupertag | null {
  // Build lookup maps for quick access
  const docsById = new Map(docs.map((d) => [d.id, d]));

  // Find the field label node
  const fieldNode = docsById.get(fieldLabelId);
  if (!fieldNode?.children) {
    return null;
  }

  // Find the "Selected source supertag" tuple among the field's children
  const sourceTuple = fieldNode.children
    .map((childId) => docsById.get(childId))
    .find(
      (child) =>
        child?.props?._docType === "tuple" &&
        child?.props?.description === "Selected source supertag"
    );

  if (!sourceTuple?.children) {
    return null;
  }

  // Find the tagDef reference (the child that's not a SYS_* code)
  const tagDefId = sourceTuple.children.find((id) => !id.startsWith("SYS_"));
  if (!tagDefId) {
    return null;
  }

  // Look up the tagDef node to get the supertag name
  const tagDefNode = docsById.get(tagDefId);
  if (!tagDefNode?.props?.name) {
    return null;
  }

  return {
    tagDefId,
    tagName: tagDefNode.props.name,
  };
}

/**
 * Extract target supertags for all reference fields in the export.
 *
 * @param docs - Array of Tana document nodes
 * @returns Map of field label ID to target supertag info
 */
export function extractTargetSupertagsFromDocs(
  docs: Array<{
    id: string;
    props?: { _docType?: string; name?: string; description?: string };
    children?: string[];
  }>
): Map<string, TargetSupertag> {
  const targetSupertags = new Map<string, TargetSupertag>();

  // Build lookup for quick child node access
  const docsById = new Map(docs.map((d) => [d.id, d]));

  // Find all nodes that have a child with "Selected source supertag" description
  // These are field label nodes with target supertag information
  for (const doc of docs) {
    if (!doc.children || doc.children.length === 0) continue;

    // Check if any child is a "Selected source supertag" tuple
    const hasTargetSupertagChild = doc.children.some((childId) => {
      const child = docsById.get(childId);
      return (
        child?.props?._docType === "tuple" &&
        child?.props?.description === "Selected source supertag"
      );
    });

    if (hasTargetSupertagChild) {
      const target = extractTargetSupertag(docs, doc.id);
      if (target) {
        targetSupertags.set(doc.id, target);
      }
    }
  }

  return targetSupertags;
}

/**
 * Updates field types in the database using explicit types from the export.
 *
 * This should be called after indexing when we have access to the full docs array.
 * It updates the inferred_data_type column in supertag_fields.
 *
 * @param db - SQLite database instance
 * @param fieldTypes - Map of field definition ID to DataType
 * @returns Number of fields updated
 */
export function updateFieldTypesFromExport(
  db: Database,
  fieldTypes: Map<string, DataType>
): number {
  let updated = 0;

  // Update each field with an explicit type
  // Note: field_label_id in supertag_fields corresponds to the attrDef node ID
  const updateStmt = db.prepare(`
    UPDATE supertag_fields
    SET inferred_data_type = ?
    WHERE field_label_id = ? AND inferred_data_type != ?
  `);

  for (const [fieldDefId, dataType] of fieldTypes) {
    const changes = updateStmt.run(dataType, fieldDefId, dataType);
    if (changes.changes > 0) {
      updated += changes.changes;
    }
  }

  return updated;
}

/**
 * Updates target supertag info in the database for reference fields.
 *
 * This should be called after field type extraction when we have target supertag data.
 * It updates the target_supertag_id and target_supertag_name columns in supertag_fields.
 *
 * @param db - SQLite database instance
 * @param targetSupertags - Map of field definition ID to target supertag info
 * @returns Number of fields updated
 */
export function updateTargetSupertagsFromExport(
  db: Database,
  targetSupertags: Map<string, TargetSupertag>
): number {
  let updated = 0;

  // Update each field with target supertag info
  // Note: field_label_id in supertag_fields corresponds to the field label node ID
  const updateStmt = db.prepare(`
    UPDATE supertag_fields
    SET target_supertag_id = ?, target_supertag_name = ?
    WHERE field_label_id = ?
  `);

  for (const [fieldLabelId, targetSupertag] of targetSupertags) {
    const changes = updateStmt.run(
      targetSupertag.tagDefId,
      targetSupertag.tagName,
      fieldLabelId
    );
    if (changes.changes > 0) {
      updated += changes.changes;
    }
  }

  // Debug logging
  if (process.env.DEBUG) {
    const fs = require("fs");
    fs.appendFileSync(
      "/tmp/target-supertag-debug.log",
      `Updated ${updated} fields with target supertags from ${targetSupertags.size} extracted\n`
    );
  }

  return updated;
}
