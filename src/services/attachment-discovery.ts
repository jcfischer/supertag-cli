/**
 * Attachment Discovery Service
 *
 * Discovers and extracts attachment information from Tana exports.
 * Handles Firebase Storage URLs in various formats found in node names.
 */

import type { Database } from "bun:sqlite";
import type { Attachment } from "../types/attachment";
import { getMimeType } from "../types/attachment";

/**
 * Firebase Storage URL pattern
 * Matches: firebasestorage.googleapis.com[:443]/v0/b/<bucket>/o/<path>
 */
const FIREBASE_URL_PATTERN = /https:\/\/firebasestorage\.googleapis\.com(?::443)?\/v0\/b\/[^/]+\/o\/[^?\s]+\?[^"\s)]+/gi;

/**
 * Check if a string is a Firebase Storage URL
 */
export function isFirebaseStorageUrl(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") {
    return false;
  }
  return text.includes("firebasestorage.googleapis.com");
}

/**
 * Parse a node name/content to extract Firebase Storage URL
 * Handles various formats:
 * - Plain URL as node name
 * - Markdown image syntax: ![](url)
 * - HTML entity encoded ampersands: &amp;
 *
 * @param nodeName - The node name or content to parse
 * @returns The cleaned URL or null if not found
 */
export function parseNodeForUrl(nodeName: string | null | undefined): string | null {
  if (!nodeName || typeof nodeName !== "string") {
    return null;
  }

  if (!isFirebaseStorageUrl(nodeName)) {
    return null;
  }

  // Find Firebase Storage URL in the text
  const matches = nodeName.match(FIREBASE_URL_PATTERN);
  if (!matches || matches.length === 0) {
    return null;
  }

  let url = matches[0];

  // Decode HTML entities (&amp; -> &)
  url = url.replace(/&amp;/g, "&");

  return url;
}

/**
 * Extract filename and extension from Firebase Storage URL
 *
 * @param url - Firebase Storage URL
 * @returns Object with filename and extension (lowercase)
 */
export function extractFilename(url: string): { filename: string; extension: string } {
  try {
    // Extract the path part before query params
    const match = url.match(/\/o\/([^?]+)/);
    if (!match) {
      return { filename: "unknown", extension: "bin" };
    }

    // Decode URL-encoded path
    const fullPath = decodeURIComponent(match[1]);

    // Get just the filename (last part of path)
    const parts = fullPath.split("/");
    const filename = parts[parts.length - 1] || "unknown";

    // Extract extension (handle double extensions like .audio.webm)
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extMatch ? extMatch[1].toLowerCase() : "bin";

    return { filename, extension };
  } catch {
    return { filename: "unknown", extension: "bin" };
  }
}

/**
 * Options for scanning attachments
 */
export interface ScanOptions {
  /** Filter by tags (include only attachments with these tags on parent/self) */
  tags?: string[];
  /** Filter by extensions */
  extensions?: string[];
  /** Maximum results to return */
  limit?: number;
}

/**
 * Scan database for attachment nodes
 *
 * @param db - SQLite database connection
 * @param options - Scan options
 * @returns Array of discovered attachments
 */
export function scanDatabase(db: Database, options: ScanOptions = {}): Attachment[] {
  const attachments: Attachment[] = [];

  // Base query: find nodes with Firebase Storage URLs in name
  let sql = `
    SELECT
      n.id as nodeId,
      n.name as url,
      n.parent_id as parentId,
      p.name as parentName,
      n.created
    FROM nodes n
    LEFT JOIN nodes p ON n.parent_id = p.id
    WHERE n.name LIKE '%firebasestorage.googleapis.com%'
  `;

  const params: (string | number)[] = [];

  // Note: Extension filter is applied after parsing, not in SQL
  // because URLs have query params after the extension

  const rows = db.query(sql).all(...params) as Array<{
    nodeId: string;
    url: string;
    parentId: string | null;
    parentName: string | null;
    created: number | null;
  }>;

  for (const row of rows) {
    const parsedUrl = parseNodeForUrl(row.url);
    if (!parsedUrl) continue;

    const { filename, extension } = extractFilename(parsedUrl);

    // Apply extension filter if specified
    if (options.extensions && options.extensions.length > 0) {
      const matchesExtension = options.extensions.some(
        (ext) => ext.toLowerCase() === extension.toLowerCase()
      );
      if (!matchesExtension) continue;
    }

    // Get tags for this node or its parent
    const tags = getNodeTags(db, row.nodeId, row.parentId);

    // Apply tag filter if specified
    if (options.tags && options.tags.length > 0) {
      const hasMatchingTag = options.tags.some((filterTag) =>
        tags.some((nodeTag) =>
          nodeTag.toLowerCase() === filterTag.toLowerCase() ||
          nodeTag.toLowerCase() === `#${filterTag.toLowerCase()}`
        )
      );
      if (!hasMatchingTag) continue;
    }

    attachments.push({
      nodeId: row.nodeId,
      url: parsedUrl,
      filename,
      extension,
      mimeType: getMimeType(extension),
      parentId: row.parentId || undefined,
      parentName: row.parentName || undefined,
      tags,
      created: row.created || undefined,
    });

    // Apply limit after adding (so we can still filter)
    if (options.limit && attachments.length >= options.limit) {
      break;
    }
  }

  return attachments;
}

/**
 * Get tags for a node or its parent
 */
function getNodeTags(db: Database, nodeId: string, parentId: string | null): string[] {
  const tags: string[] = [];

  // Check tags on the node itself
  const nodeTags = db.query(`
    SELECT tag_name FROM tag_applications WHERE data_node_id = ?
  `).all(nodeId) as Array<{ tag_name: string }>;
  tags.push(...nodeTags.map((t) => t.tag_name));

  // Also check parent node tags
  if (parentId) {
    const parentTags = db.query(`
      SELECT tag_name FROM tag_applications WHERE data_node_id = ?
    `).all(parentId) as Array<{ tag_name: string }>;
    tags.push(...parentTags.map((t) => t.tag_name));
  }

  return [...new Set(tags)]; // Dedupe
}

/**
 * Scan a Tana export JSON file for attachments
 * Alternative to database scanning for direct export file processing
 *
 * @param exportPath - Path to Tana export JSON file
 * @param options - Scan options
 * @returns Array of discovered attachments
 */
export async function scanExport(
  exportPath: string,
  options: ScanOptions = {}
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];

  const file = Bun.file(exportPath);
  const content = await file.text();
  const data = JSON.parse(content);

  // Handle both old format and new storeData wrapper
  const docs = data.storeData?.docs || data.docs || [];

  for (const doc of docs) {
    const name = doc.props?.name;
    if (!name) continue;

    const parsedUrl = parseNodeForUrl(name);
    if (!parsedUrl) continue;

    const { filename, extension } = extractFilename(parsedUrl);

    // Apply extension filter
    if (options.extensions && options.extensions.length > 0) {
      if (!options.extensions.includes(extension)) continue;
    }

    attachments.push({
      nodeId: doc.id,
      url: parsedUrl,
      filename,
      extension,
      mimeType: getMimeType(extension),
      parentId: doc.props?._ownerId,
      tags: [], // Would need to resolve tags from export
      created: doc.props?.created,
    });

    // Apply limit
    if (options.limit && attachments.length >= options.limit) {
      break;
    }
  }

  return attachments;
}
