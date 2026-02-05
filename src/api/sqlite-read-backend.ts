/**
 * SQLite Read Backend Implementation
 * Spec: F-097 Live Read Backend
 * Task: T-2.2
 *
 * Implements TanaReadBackend using the local SQLite index database.
 * Wraps existing TanaQueryEngine for search and show.ts helpers for
 * node content formatting.
 *
 * This backend provides offline/indexed reads from Tana export data.
 * isLive() returns false since data may be stale (export-based).
 */

import { Database } from "bun:sqlite";
import { TanaQueryEngine } from "../query/tana-query-engine";
import {
  getNodeContents,
  getNodeContentsWithDepth,
  formatNodeOutput,
  formatNodeWithDepth,
} from "../commands/show";
import type { NodeContentsWithChildren } from "../commands/show";
import { withDbRetrySync } from "../db/retry";
import type {
  TanaReadBackend,
  ReadBackendType,
  ReadSearchResult,
  ReadNodeContent,
  ReadTagInfo,
  PaginatedResult,
  SearchOptions,
} from "./read-backend";

// =============================================================================
// SqliteReadBackend
// =============================================================================

export class SqliteReadBackend implements TanaReadBackend {
  readonly type: ReadBackendType = "sqlite";

  private engine: TanaQueryEngine;
  private db: Database;
  private ftsInitialized = false;

  constructor(dbPath: string) {
    this.engine = new TanaQueryEngine(dbPath);
    this.db = this.engine.rawDb;
  }

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------

  async search(query: string, options?: SearchOptions): Promise<ReadSearchResult[]> {
    // Auto-initialize FTS index if needed (transparent to caller)
    await this.ensureFTS();

    const results = await this.engine.searchNodes(query, {
      limit: options?.limit,
      createdAfter: options?.createdAfter,
      createdBefore: options?.createdBefore,
      updatedAfter: options?.updatedAfter,
      updatedBefore: options?.updatedBefore,
    });

    return results.map((result) => {
      const tags = this.engine.getNodeTags(result.id);

      const searchResult: ReadSearchResult = {
        id: result.id,
        name: result.name ?? "(unnamed)",
        tags,
        rank: result.rank,
      };

      // Include created as ISO string if available
      if (result.created) {
        searchResult.created = new Date(result.created).toISOString();
      }

      return searchResult;
    });
  }

  // ---------------------------------------------------------------------------
  // readNode
  // ---------------------------------------------------------------------------

  async readNode(nodeId: string, depth?: number): Promise<ReadNodeContent> {
    const effectiveDepth = depth ?? 0;

    if (effectiveDepth > 0) {
      return this.readNodeWithDepth(nodeId, effectiveDepth);
    }

    // Depth 0: single node without recursing into children
    const contents = getNodeContents(this.db, nodeId);
    if (!contents) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const markdown = formatNodeOutput(contents);

    const nodeContent: ReadNodeContent = {
      id: contents.id,
      name: contents.name,
      markdown,
      tags: contents.tags,
    };

    // Extract description from fields if present
    const descField = contents.fields.find(
      (f) => f.fieldName === "Description"
    );
    if (descField) {
      nodeContent.description = descField.value;
    }

    return nodeContent;
  }

  /**
   * Read node with recursive child traversal.
   */
  private readNodeWithDepth(nodeId: string, maxDepth: number): ReadNodeContent {
    const contentsWithChildren = getNodeContentsWithDepth(
      this.db,
      nodeId,
      0,
      maxDepth
    );
    if (!contentsWithChildren) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const markdown = formatNodeWithDepth(this.db, nodeId, 0, maxDepth);

    const nodeContent: ReadNodeContent = {
      id: contentsWithChildren.id,
      name: contentsWithChildren.name,
      markdown,
      tags: contentsWithChildren.tags,
    };

    // Extract description from fields if present
    const descField = contentsWithChildren.fields.find(
      (f) => f.fieldName === "Description"
    );
    if (descField) {
      nodeContent.description = descField.value;
    }

    // Build children array from recursive contents
    if (contentsWithChildren.children.length > 0) {
      nodeContent.children = contentsWithChildren.children.map((child) =>
        this.mapNodeContentsToReadContent(child)
      );
    }

    return nodeContent;
  }

  /**
   * Map NodeContentsWithChildren to ReadNodeContent recursively.
   */
  private mapNodeContentsToReadContent(
    contents: NodeContentsWithChildren
  ): ReadNodeContent {
    // Build markdown from the NodeContentsWithChildren fields manually
    // (formatNodeOutput expects NodeContents which has a different children type)
    const lines: string[] = [];
    const tagStr =
      contents.tags.length > 0 ? ` #${contents.tags.join(" #")}` : "";
    lines.push(`${contents.name}${tagStr}`);

    if (contents.fields.length > 0) {
      for (const field of contents.fields) {
        lines.push(`  ${field.fieldName}:: ${field.value}`);
      }
    }

    if (contents.children.length > 0) {
      for (const child of contents.children) {
        lines.push(`  - ${child.name}`);
      }
    }

    const markdown = lines.join("\n");

    const nodeContent: ReadNodeContent = {
      id: contents.id,
      name: contents.name,
      markdown,
      tags: contents.tags,
    };

    const descField = contents.fields.find(
      (f) => f.fieldName === "Description"
    );
    if (descField) {
      nodeContent.description = descField.value;
    }

    if (contents.children.length > 0) {
      nodeContent.children = contents.children.map((child) =>
        this.mapNodeContentsToReadContent(child)
      );
    }

    return nodeContent;
  }

  // ---------------------------------------------------------------------------
  // getChildren
  // ---------------------------------------------------------------------------

  async getChildren(
    nodeId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<PaginatedResult<ReadNodeContent>> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    // Get total count (excluding trashed nodes)
    const totalResult = withDbRetrySync(
      () =>
        this.db
          .query(
            "SELECT count(*) as count FROM nodes WHERE parent_id = ? AND (node_type IS NULL OR node_type != 'trash')"
          )
          .get(nodeId) as { count: number },
      "getChildren total"
    );
    const total = totalResult?.count ?? 0;

    // Get paginated children
    const children = withDbRetrySync(
      () =>
        this.db
          .query(
            "SELECT id, name FROM nodes WHERE parent_id = ? AND (node_type IS NULL OR node_type != 'trash') LIMIT ? OFFSET ?"
          )
          .all(nodeId, limit, offset) as Array<{ id: string; name: string | null }>,
      "getChildren query"
    );

    const items: ReadNodeContent[] = children.map((child) => ({
      id: child.id,
      name: child.name ?? "(unnamed)",
      markdown: child.name ?? "(unnamed)",
    }));

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  // ---------------------------------------------------------------------------
  // listTags
  // ---------------------------------------------------------------------------

  async listTags(options?: { limit?: number }): Promise<ReadTagInfo[]> {
    const limit = options?.limit ?? 200;

    // Join supertag_metadata with tag_applications to get instance counts
    const tags = withDbRetrySync(
      () =>
        this.db
          .query(
            `SELECT
              sm.tag_id,
              sm.tag_name,
              sm.color,
              COUNT(ta.data_node_id) as instance_count
            FROM supertag_metadata sm
            LEFT JOIN tag_applications ta ON ta.tag_id = sm.tag_id
            GROUP BY sm.tag_id, sm.tag_name, sm.color
            ORDER BY instance_count DESC
            LIMIT ?`
          )
          .all(limit) as Array<{
          tag_id: string;
          tag_name: string;
          color: string | null;
          instance_count: number;
        }>,
      "listTags"
    );

    return tags.map((tag) => {
      const info: ReadTagInfo = {
        id: tag.tag_id,
        name: tag.tag_name,
        instanceCount: tag.instance_count,
      };
      if (tag.color) {
        info.color = tag.color;
      }
      return info;
    });
  }

  // ---------------------------------------------------------------------------
  // FTS auto-initialization
  // ---------------------------------------------------------------------------

  /**
   * Ensure FTS5 index exists, creating it if needed.
   * Called automatically before search — transparent to callers.
   */
  private async ensureFTS(): Promise<void> {
    if (this.ftsInitialized) return;

    const hasFTS = await this.engine.hasFTSIndex();
    if (!hasFTS) {
      await this.engine.initializeFTS();
    }
    this.ftsInitialized = true;
  }

  // ---------------------------------------------------------------------------
  // isLive / close
  // ---------------------------------------------------------------------------

  isLive(): boolean {
    return false;
  }

  close(): void {
    this.engine.close();
  }
}
