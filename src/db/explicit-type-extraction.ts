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
