/**
 * Snapshot Queries (F-103 T-1.2)
 *
 * Takes a point-in-time snapshot of nodes from SQLite for change detection.
 * Used in pre/post diffing around DeltaSyncService.sync() calls.
 */

import type { Database } from "bun:sqlite";
import type { NodeSnapshot } from "./types";

interface RawSnapshotRow {
  id: string;
  name: string;
  updated: number;
  tags: string | null;
}

/**
 * Take a snapshot of nodes from SQLite, optionally filtered by tag.
 *
 * @param db - SQLite database instance
 * @param filterTag - Optional supertag name to filter nodes
 * @returns Map from nodeId to NodeSnapshot
 */
export function takeSnapshot(db: Database, filterTag?: string): Map<string, NodeSnapshot> {
  const result = new Map<string, NodeSnapshot>();

  let rows: RawSnapshotRow[];

  if (filterTag) {
    // INNER JOIN to only get nodes with the specified tag
    rows = db.query<RawSnapshotRow, [string]>(`
      SELECT n.id, n.name, n.updated,
        GROUP_CONCAT(ta2.tag_name, ',') as tags
      FROM nodes n
      JOIN tag_applications ta ON n.id = ta.node_id AND ta.tag_name = ?
      LEFT JOIN tag_applications ta2 ON n.id = ta2.node_id
      GROUP BY n.id
    `).all(filterTag);
  } else {
    // All nodes, left join to get tags
    rows = db.query<RawSnapshotRow, []>(`
      SELECT n.id, n.name, n.updated,
        GROUP_CONCAT(ta.tag_name, ',') as tags
      FROM nodes n
      LEFT JOIN tag_applications ta ON n.id = ta.node_id
      GROUP BY n.id
    `).all();
  }

  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      name: row.name,
      tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
      updatedAt: row.updated ?? 0,
    });
  }

  return result;
}
