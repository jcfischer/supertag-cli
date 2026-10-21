/**
 * Field ID Resolver
 *
 * set-field writes go to /nodes/{id}/fields/{attributeId}; a field name in
 * that slot fails with a misleading NODE_NOT_FOUND (Issue #110). Resolve a
 * field name to its attribute ID through the workspace index: first among the
 * fields of the node's supertags (inherited included), then among all
 * supertags when the node is not indexed yet.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { normalizeName } from "../utils/normalize-name";
import { UnifiedSchemaService } from "./unified-schema-service";

export interface FieldCandidate {
  attributeId: string;
  tagName: string;
}

export type FieldIdResolution =
  | { kind: "resolved"; attributeId: string }
  | { kind: "ambiguous"; candidates: FieldCandidate[] }
  | { kind: "unknown" };

function fromCandidates(candidates: FieldCandidate[]): FieldIdResolution {
  const unique = [...new Map(candidates.map((c) => [c.attributeId, c])).values()];
  if (unique.length === 1) return { kind: "resolved", attributeId: unique[0].attributeId };
  if (unique.length > 1) return { kind: "ambiguous", candidates: unique };
  return { kind: "unknown" };
}

export function resolveFieldId(nodeId: string, fieldName: string, dbPath: string | undefined): FieldIdResolution {
  if (!dbPath || !existsSync(dbPath)) {
    return { kind: "unknown" };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const known = db
      .query("SELECT 1 FROM supertag_fields WHERE field_label_id = ? LIMIT 1")
      .get(fieldName);
    if (known) return { kind: "resolved", attributeId: fieldName };

    const wanted = normalizeName(fieldName);
    const schema = new UnifiedSchemaService(db);

    const nodeTags = db
      .query("SELECT DISTINCT tag_id, tag_name FROM tag_applications WHERE data_node_id = ?")
      .all(nodeId) as Array<{ tag_id: string; tag_name: string }>;
    const onNode = nodeTags.flatMap((tag) =>
      schema
        .getAllFields(tag.tag_id)
        .filter((field) => normalizeName(field.name) === wanted)
        .map((field) => ({ attributeId: field.attributeId, tagName: tag.tag_name }))
    );
    // An indexed node only takes fields of its own supertags
    if (nodeTags.length > 0) return fromCandidates(onNode);

    const everywhere = (db
      .query("SELECT field_name, field_label_id, tag_name FROM supertag_fields")
      .all() as Array<{ field_name: string; field_label_id: string; tag_name: string }>)
      .filter((row) => normalizeName(row.field_name) === wanted)
      .map((row) => ({ attributeId: row.field_label_id, tagName: row.tag_name }));
    return fromCandidates(everywhere);
  } catch {
    // An index without the supertag tables cannot resolve names
    return { kind: "unknown" };
  } finally {
    db.close();
  }
}
