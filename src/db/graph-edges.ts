/**
 * Graph edges for CONNECTED TO traversal (issues #99, #100)
 *
 * The indexer only writes inline_ref rows to the references table, so child,
 * parent and reference-field edges are derived here from what the index does
 * hold:
 *
 * - child / parent: nodes.parent_id
 * - field: field_values (parent_id → value_node_id), labelled with field_name
 * - reference: inline refs made anywhere in a node's content. A node's content
 *   is the node plus its untagged descendants up to CONTENT_DEPTH levels. Tagged
 *   descendants are entities of their own (often reference children whose
 *   parent_id points here), so their content is not attributed to this node.
 *
 * All queries are set-based over batches of node IDs, with no LIMIT, so a
 * caller filtering by target tag never loses matches to truncation.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { RelationshipType } from "../types/graph";

/** How deep under a node inline refs still count as that node's own */
export const CONTENT_DEPTH = 3;

const BATCH_SIZE = 500;

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  type: RelationshipType;
  /** Field name for field edges */
  field?: string;
}

export interface NeighborOptions {
  /** Only follow reference-field edges for this field (case-insensitive) */
  viaField?: string;
}

function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    out.push(items.slice(i, i + BATCH_SIZE));
  }
  return out;
}

function placeholders(n: number): string {
  return new Array(n).fill("?").join(",");
}

const IS_TAGGED = (col: string) =>
  `EXISTS (SELECT 1 FROM tag_applications ta WHERE ta.data_node_id = ${col})`;

/**
 * Find every node directly connected to any of `ids`, in both directions.
 */
export function findNeighborEdges(
  db: Database,
  ids: string[],
  options: NeighborOptions = {}
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const batch of batches([...new Set(ids)])) {
    const ph = placeholders(batch.length);

    // Reference-field values, both directions
    const viaSql = options.viaField ? " AND LOWER(field_name) = LOWER(?)" : "";
    const viaParams: SQLQueryBindings[] = options.viaField ? [options.viaField] : [];
    const fieldOut = db
      .query(
        `SELECT DISTINCT parent_id AS s, value_node_id AS t, field_name AS f
         FROM field_values WHERE parent_id IN (${ph})${viaSql}`
      )
      .all(...batch, ...viaParams) as Array<{ s: string; t: string; f: string }>;
    const fieldIn = db
      .query(
        `SELECT DISTINCT value_node_id AS s, parent_id AS t, field_name AS f
         FROM field_values WHERE value_node_id IN (${ph})${viaSql}`
      )
      .all(...batch, ...viaParams) as Array<{ s: string; t: string; f: string }>;
    for (const r of [...fieldOut, ...fieldIn]) {
      edges.push({ sourceId: r.s, targetId: r.t, type: "field", field: r.f });
    }

    if (options.viaField) continue;

    // Tree edges
    const children = db
      .query(`SELECT parent_id AS s, id AS t FROM nodes WHERE parent_id IN (${ph})`)
      .all(...batch) as Array<{ s: string; t: string }>;
    for (const r of children) edges.push({ sourceId: r.s, targetId: r.t, type: "child" });

    const parents = db
      .query(`SELECT id AS s, parent_id AS t FROM nodes WHERE id IN (${ph}) AND parent_id IS NOT NULL`)
      .all(...batch) as Array<{ s: string; t: string }>;
    for (const r of parents) edges.push({ sourceId: r.s, targetId: r.t, type: "parent" });

    // Inline refs made from a source's content
    const refsOut = db
      .query(
        `WITH RECURSIVE content(src, id, depth) AS (
           SELECT id, id, 0 FROM nodes WHERE id IN (${ph})
           UNION
           SELECT c.src, n.id, c.depth + 1
           FROM content c JOIN nodes n ON n.parent_id = c.id
           WHERE c.depth < ? AND NOT ${IS_TAGGED("n.id")}
         )
         SELECT DISTINCT c.src AS s, r.to_node AS t
         FROM content c JOIN "references" r ON r.from_node = c.id
         WHERE r.reference_type = 'inline_ref'`
      )
      .all(...batch, CONTENT_DEPTH) as Array<{ s: string; t: string }>;
    for (const r of refsOut) edges.push({ sourceId: r.s, targetId: r.t, type: "reference" });

    // Inline refs pointing at a source, attributed to the referring node and
    // its untagged ancestors up to the first tagged one (the content owner)
    const refsIn = db
      .query(
        `WITH RECURSIVE owner(src, id, depth) AS (
           SELECT r.to_node, r.from_node, 0
           FROM "references" r
           WHERE r.to_node IN (${ph}) AND r.reference_type = 'inline_ref'
           UNION
           SELECT o.src, n.parent_id, o.depth + 1
           FROM owner o JOIN nodes n ON n.id = o.id
           WHERE o.depth < ? AND n.parent_id IS NOT NULL AND NOT ${IS_TAGGED("o.id")}
         )
         SELECT DISTINCT src AS s, id AS t FROM owner`
      )
      .all(...batch, CONTENT_DEPTH) as Array<{ s: string; t: string }>;
    for (const r of refsIn) edges.push({ sourceId: r.s, targetId: r.t, type: "reference" });
  }

  return edges.filter((e) => e.sourceId !== e.targetId);
}

/**
 * Return the subset of `ids` that carry `tag` (case-insensitive).
 */
export function filterNodesByTag(db: Database, ids: string[], tag: string): Set<string> {
  const matched = new Set<string>();
  for (const batch of batches([...new Set(ids)])) {
    const rows = db
      .query(
        `SELECT DISTINCT data_node_id AS id FROM tag_applications
         WHERE data_node_id IN (${placeholders(batch.length)}) AND LOWER(tag_name) = LOWER(?)`
      )
      .all(...batch, tag) as Array<{ id: string }>;
    for (const r of rows) matched.add(r.id);
  }
  return matched;
}

/**
 * Load name and tags for nodes, keyed by ID. Missing nodes are omitted.
 */
export function loadNodeSummaries(
  db: Database,
  ids: string[]
): Map<string, { name: string; tags: string[] }> {
  const out = new Map<string, { name: string; tags: string[] }>();
  for (const batch of batches([...new Set(ids)])) {
    const ph = placeholders(batch.length);
    const nodes = db
      .query(`SELECT id, name FROM nodes WHERE id IN (${ph})`)
      .all(...batch) as Array<{ id: string; name: string | null }>;
    for (const n of nodes) out.set(n.id, { name: n.name ?? "", tags: [] });

    const tags = db
      .query(`SELECT data_node_id AS id, tag_name AS tag FROM tag_applications WHERE data_node_id IN (${ph})`)
      .all(...batch) as Array<{ id: string; tag: string }>;
    for (const t of tags) out.get(t.id)?.tags.push(t.tag);
  }
  return out;
}
