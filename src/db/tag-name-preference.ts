/**
 * Tag Name Preference (#123)
 *
 * Several tagDefs can share a name. Every name resolver ranks the candidates
 * with the same rule so the CLI and MCP pick the same tag:
 * 1. most inheritance parents
 * 2. most own fields
 * 3. most applications
 * 4. lowest tag ID (stable tiebreak)
 *
 * Steps 1-2 match SchemaRegistry's shouldPreferSchema(); the registry has no
 * application counts, so it stops there.
 */

import type { Database } from "bun:sqlite";

function hasColumn(db: Database, table: string, column: string): boolean {
  return db.query("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get(table, column) !== null;
}

/**
 * SELECT columns parent_count, field_count, usage_count for a supertag row
 * whose tag ID is `${alias}.tag_id`. usage_count is 0 when the database has
 * no tag_applications.tag_id column (schema-only databases).
 */
export function tagPreferenceColumns(db: Database, alias: string): string {
  const usage = hasColumn(db, "tag_applications", "tag_id")
    ? `(SELECT COUNT(*) FROM tag_applications ta WHERE ta.tag_id = ${alias}.tag_id)`
    : "0";
  return `(SELECT COUNT(*) FROM supertag_parents sp WHERE sp.child_tag_id = ${alias}.tag_id) AS parent_count,
          (SELECT COUNT(*) FROM supertag_fields sf WHERE sf.tag_id = ${alias}.tag_id) AS field_count,
          ${usage} AS usage_count`;
}

/** ORDER BY terms for rows selected with tagPreferenceColumns() */
export function tagPreferenceOrder(alias: string): string {
  return `parent_count DESC, field_count DESC, usage_count DESC, ${alias}.tag_id ASC`;
}
