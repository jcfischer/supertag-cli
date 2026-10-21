/**
 * Tag ID Resolver
 *
 * Tag mutations take tag IDs, but users pass names (Issue #111). Resolve each
 * value through the workspace index: a known tag ID stays as is, a known tag
 * name becomes its ID, anything else passes through for the API to judge.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { resolveWorkspaceContext } from "../config/workspace-resolver";
import { UnifiedSchemaService } from "./unified-schema-service";

/**
 * Path of the default workspace database, or undefined when none is usable.
 */
export function defaultWorkspaceDbPath(): string | undefined {
  try {
    return resolveWorkspaceContext({ requireDatabase: false }).dbPath;
  } catch {
    return undefined;
  }
}

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
