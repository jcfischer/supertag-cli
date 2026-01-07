/**
 * tana_supertag_info MCP Tool
 *
 * Query supertag inheritance and fields via MCP.
 * Supports three modes: fields, inheritance, full.
 */

import { resolveWorkspaceContext } from "../../config/workspace-resolver.js";
import { SupertagMetadataService } from "../../services/supertag-metadata-service.js";
import { withDatabase } from "../../db/with-database.js";
import type { SupertagInfoInput } from "../schemas.js";

export interface FieldInfo {
  name: string;
  origin?: string; // For inherited fields, shows the origin tag name
  inferredDataType?: string; // Inferred data type (text, date, email, etc.) - T-5.4
  system?: boolean; // True if this is a system field (SYS_A*) - Spec 074
}

export interface AncestorInfo {
  name: string;
  depth: number;
}

export interface SupertagInfoResult {
  tagname: string;
  tagId?: string;
  fields?: FieldInfo[];
  parents?: string[];
  ancestors?: AncestorInfo[];
}

export async function supertagInfo(
  input: SupertagInfoInput
): Promise<SupertagInfoResult> {
  // Allow direct dbPath for testing, otherwise use workspace resolution
  let dbPath: string;
  if (input._dbPath) {
    dbPath = input._dbPath;
  } else {
    const workspace = resolveWorkspaceContext({ workspace: input.workspace });
    dbPath = workspace.dbPath;
  }

  return withDatabase({ dbPath, readonly: true }, (ctx) => {
    const service = new SupertagMetadataService(ctx.db);

    const tagId = service.findTagIdByName(input.tagname);
    const result: SupertagInfoResult = {
      tagname: input.tagname,
      tagId: tagId ?? undefined,
    };

    const mode = input.mode || "fields";

    if (mode === "fields" || mode === "full") {
      if (input.includeInherited) {
        // Get all fields including inherited (and system fields - Spec 074)
        const allFields = tagId ? service.getAllFields(tagId) : [];
        result.fields = allFields.map((f) => ({
          name: f.fieldName,
          origin: f.depth > 0 ? f.originTagName : undefined,
          inferredDataType: f.inferredDataType,
          system: f.system || undefined, // Only include if true
        }));
      } else {
        // Get only own fields
        const ownFields = service.getFieldsByName(input.tagname);
        result.fields = ownFields.map((f) => ({
          name: f.fieldName,
          inferredDataType: f.inferredDataType,
        }));
      }
    }

    if (mode === "inheritance" || mode === "full") {
      if (tagId) {
        // Get direct parents
        const parentIds = service.getDirectParents(tagId);
        result.parents = parentIds.map((parentId) => {
          // Try to get parent name from fields table
          const parentFields = service.getFields(parentId);
          return parentFields.length > 0 ? parentFields[0].tagName : parentId;
        });

        if (input.includeAncestors || mode === "full") {
          // Get full ancestor chain
          const ancestors = service.getAncestors(tagId);
          result.ancestors = ancestors.map((a) => {
            const ancestorFields = service.getFields(a.tagId);
            return {
              name:
                ancestorFields.length > 0
                  ? ancestorFields[0].tagName
                  : a.tagId,
              depth: a.depth,
            };
          });
        }
      } else {
        result.parents = [];
        if (input.includeAncestors || mode === "full") {
          result.ancestors = [];
        }
      }
    }

    return result;
  });
}
