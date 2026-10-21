import type { Database } from "bun:sqlite";

/**
 * Register every tag in a hand-rolled supertag_fields fixture in
 * supertag_metadata, as the indexer does for every tagDef.
 */
export function registerTagsFromFields(db: Database): void {
  db.run(
    "INSERT OR IGNORE INTO supertag_metadata (tag_id, tag_name, normalized_name) SELECT DISTINCT tag_id, tag_name, LOWER(tag_name) FROM supertag_fields"
  );
}
