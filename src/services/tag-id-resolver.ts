/**
 * Tag ID Resolver
 *
 * Tag mutations take tag IDs, but users pass names (Issue #111). Resolve each
 * value through the workspace index: a known tag ID stays as is, a known tag
 * name becomes its ID, anything else passes through for the API to judge.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import type { TanaBackend } from "../api/backend";
import { defaultWorkspaceDbPath } from "../config/workspace-resolver";
import { UnifiedSchemaService } from "./unified-schema-service";

/** Injection points shared by the CLI and MCP tag mutations */
export interface TagMutationDeps {
  backend?: Pick<TanaBackend, "supportsMutations" | "addTags" | "removeTags">;
  /** Workspace database used for name resolution (default: default workspace) */
  dbPath?: string;
}

/** Output labels per tag action */
export const TAG_ACTION_LABELS = {
  add: { done: "Added", failed: "Failed to add", preposition: "to", mark: "+" },
  remove: { done: "Removed", failed: "Failed to remove", preposition: "from", mark: "-" },
} as const;

export function resolveTagIds(values: string[], dbPath: string | undefined = defaultWorkspaceDbPath()): string[] {
  if (!dbPath || !existsSync(dbPath)) {
    return values;
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const schema = new UnifiedSchemaService(db);
    return values.map((value) => {
      if (schema.getSupertagById(value)) return value;
      return schema.getSupertag(value)?.id ?? value;
    });
  } catch {
    // An index without the supertag tables cannot resolve names
    return values;
  } finally {
    db.close();
  }
}
