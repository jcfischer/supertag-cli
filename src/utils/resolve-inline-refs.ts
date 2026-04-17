/**
 * Resolve Tana inline-reference spans to display text.
 *
 * Tana stores references and dates inside field values as self-closing or
 * empty spans:
 *
 *   <span data-inlineref-node="NODE_ID"></span>
 *   <span data-inlineref-date="{&quot;dateTimeString&quot;:&quot;2026-01-26&quot;,...}"></span>
 *
 * When naively stripped of HTML, these collapse to empty strings — which is
 * what caused v2.5.5's reference-field bug ("Context" → "").
 *
 * This module resolves those spans to their display text:
 *   - inlineref-node → target node's `name` from the nodes table
 *   - inlineref-date → the `dateTimeString` value
 *
 * Any HTML that remains after substitution is stripped (existing behavior for
 * option fields with color spans).
 */

import { Database } from "bun:sqlite";
import { stripHtml } from "./html";

const INLINEREF_NODE_RE = /<span[^>]*data-inlineref-node="([^"]+)"[^>]*><\/span>/g;
const INLINEREF_DATE_RE = /<span[^>]*data-inlineref-date="([^"]+)"[^>]*><\/span>/g;

/**
 * Resolve all inline-reference spans in a batch of strings. Uses a single
 * SQL query per unique referenced-node set to avoid N+1 lookups.
 */
export function resolveInlineRefsBatch(values: string[], db: Database): string[] {
  const nodeIds = new Set<string>();
  for (const v of values) {
    INLINEREF_NODE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINEREF_NODE_RE.exec(v)) !== null) {
      nodeIds.add(decodeHtmlEntities(m[1]));
    }
  }

  const nameMap = nodeIds.size > 0 ? lookupNodeNames([...nodeIds], db) : new Map<string, string>();

  return values.map((v) => resolveOne(v, nameMap));
}

/**
 * Resolve a single string's inline-reference spans. Prefer the batch variant
 * for bulk work — this is for one-off calls.
 */
export function resolveInlineRefs(value: string, db: Database): string {
  return resolveInlineRefsBatch([value], db)[0];
}

function resolveOne(value: string, nameMap: Map<string, string>): string {
  let out = value;

  out = out.replace(INLINEREF_NODE_RE, (_full, rawId) => {
    const id = decodeHtmlEntities(rawId);
    return nameMap.get(id) ?? "";
  });

  out = out.replace(INLINEREF_DATE_RE, (_full, rawJson) => {
    const json = decodeHtmlEntities(rawJson);
    try {
      const parsed = JSON.parse(json) as { dateTimeString?: string };
      return parsed.dateTimeString ?? "";
    } catch {
      return "";
    }
  });

  return stripHtml(out).trim();
}

function lookupNodeNames(ids: string[], db: Database): Map<string, string> {
  const result = new Map<string, string>();
  // SQLite defaults cap to ~999 params; batch conservatively at 500.
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db
      .query(`SELECT id, name FROM nodes WHERE id IN (${placeholders})`)
      .all(...batch) as Array<{ id: string; name: string | null }>;
    for (const r of rows) {
      if (r.name) result.set(r.id, r.name);
    }
  }
  return result;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
