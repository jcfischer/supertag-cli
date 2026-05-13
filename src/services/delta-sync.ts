/**
 * Delta-Sync Service (F-095)
 *
 * Provides incremental synchronization via tana-local API.
 * Fetches nodes changed since the last watermark, merges them into
 * the local SQLite database, and optionally generates embeddings.
 *
 * Tasks: T-2.1 (merge logic), T-2.2 (pagination + embeddings), T-2.3 (locking + status)
 */

import { Database } from "bun:sqlite";
import { walCheckpoint } from "../db/retry";
import { ensureDeltaSyncSchema } from "../db/delta-sync-schema";
import type {
  DeltaSyncOptions,
  DeltaSyncResult,
  DeltaSyncStatus,
  SearchResultNode,
} from "../types/local-api";

/** Page size for API pagination */
const PAGE_SIZE = 100;

/**
 * Fraction of `sync_metadata.total_nodes` that a single delta is allowed to
 * exceed before we abort. The failure mode we guard against (Local API
 * ignoring `edited.since`) returns ~100% of the workspace, so any threshold
 * below 100% catches it — and the lower the threshold, the less work wasted
 * before the abort fires. 25% is well below any plausible real delta yet
 * still allows for months of accumulated edits; a real delta exceeding this
 * is better served by a full re-sync anyway.
 */
const MAX_PAGES_RATIO = 0.25;

/**
 * Fallback cap if `total_nodes` is unavailable (e.g. malformed metadata).
 * Conservative — equivalent to a ~400K-node workspace under the ratio.
 */
const FALLBACK_MAX_PAGES = 1000;

/**
 * Log a progress line on page 1 and every Nth page thereafter. Avoids
 * one-info-line-per-page noise on normal deltas while still proving liveness
 * on long runs.
 */
const PROGRESS_INTERVAL_PAGES = 10;

/**
 * DeltaSyncService handles incremental sync of Tana nodes
 * from the local API into the SQLite database.
 */
export class DeltaSyncService {
  private db: Database;
  private dbPath: string;
  private localApiClient: DeltaSyncOptions["localApiClient"];
  private embeddingConfig?: DeltaSyncOptions["embeddingConfig"];
  private logger: NonNullable<DeltaSyncOptions["logger"]>;
  /** Explicit override from constructor options; if undefined, auto-scaled per sync from `sync_metadata.total_nodes`. */
  private maxPagesOverride: number | undefined;
  private syncing = false;

  constructor(options: DeltaSyncOptions) {
    this.dbPath = options.dbPath;
    this.db = new Database(options.dbPath);
    this.db.run("PRAGMA busy_timeout = 5000");
    this.localApiClient = options.localApiClient;
    this.embeddingConfig = options.embeddingConfig;
    this.logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.maxPagesOverride = options.maxPages;
  }

  /**
   * Compute the per-sync abort cap.
   * - If the constructor was given an explicit `maxPages`, that wins.
   * - Otherwise scale against `sync_metadata.total_nodes`: cap at
   *   `MAX_PAGES_RATIO` of the graph.
   * - If `total_nodes` is missing or zero, fall back to `FALLBACK_MAX_PAGES`.
   *
   * Note: for very small workspaces the scaled cap may round down to 1 page;
   * that's inherent to page-quantized pagination, not a bug — the broken-API
   * signature still trips at page 2.
   */
  private resolveMaxPages(): number {
    if (this.maxPagesOverride !== undefined) return this.maxPagesOverride;
    const row = this.db
      .query("SELECT total_nodes FROM sync_metadata WHERE id = 1")
      .get() as { total_nodes: number } | undefined;
    const totalNodes = row?.total_nodes ?? 0;
    if (totalNodes <= 0) return FALLBACK_MAX_PAGES;
    return Math.ceil((totalNodes * MAX_PAGES_RATIO) / PAGE_SIZE);
  }

  /**
   * Check if the database connection is healthy.
   * If stale (e.g., "disk full" error from WAL corruption), reconnect.
   */
  ensureHealthyConnection(): void {
    try {
      this.db.run("SELECT 1");
    } catch (error) {
      this.logger.warn("Database connection unhealthy, reconnecting", {
        error: String(error),
      });
      try {
        this.db.close();
      } catch (closeError) {
        this.logger.warn("Failed to close stale connection (expected)", {
          error: String(closeError),
        });
      }
      this.db = new Database(this.dbPath);
      this.db.run("PRAGMA busy_timeout = 5000");
      this.logger.info("Database connection re-established");
    }
  }

  /**
   * Close the database connection.
   * Call when the service is no longer needed.
   */
  close(): void {
    try {
      walCheckpoint(this.db);
      this.db.close();
    } catch {
      // Already closed or error - ignore
    }
  }

  // ===========================================================================
  // T-2.1: Core Merge Logic
  // ===========================================================================

  /**
   * Ensure delta-sync schema extensions are applied.
   * Safe to call multiple times (idempotent).
   */
  ensureSchema(): void {
    ensureDeltaSyncSchema(this.db);
  }

  /**
   * Get the current watermark timestamp for delta-sync.
   *
   * Priority:
   * 1. delta_sync_timestamp (if available and non-null)
   * 2. last_sync_timestamp (fallback to full sync timestamp)
   * 3. null (no sync has ever occurred)
   */
  getWatermark(): number | null {
    const row = this.db
      .query(
        "SELECT delta_sync_timestamp, last_sync_timestamp FROM sync_metadata WHERE id = 1"
      )
      .get() as { delta_sync_timestamp: number | null; last_sync_timestamp: number } | null;

    if (!row) return null;

    // Prefer delta_sync_timestamp if set
    if (row.delta_sync_timestamp !== null && row.delta_sync_timestamp !== undefined) {
      return row.delta_sync_timestamp;
    }

    // Fall back to full sync timestamp, but 0 means "never synced"
    if (row.last_sync_timestamp && row.last_sync_timestamp > 0) {
      return row.last_sync_timestamp;
    }

    return null;
  }

  /**
   * Check if a full sync has been performed.
   * Returns true if sync_metadata has a row with non-zero last_sync_timestamp.
   */
  hasFullSync(): boolean {
    const row = this.db
      .query("SELECT last_sync_timestamp FROM sync_metadata WHERE id = 1")
      .get() as { last_sync_timestamp: number } | null;

    return row !== null && row.last_sync_timestamp > 0;
  }

  /**
   * Merge a single node from the API into the local database.
   *
   * - New nodes: INSERT with id, name, node_type, created, updated
   * - Existing nodes: UPDATE name, node_type, updated + clear stale field_values
   * - PRESERVES: parent_id, done_at, raw_data (never overwritten by delta)
   */
  mergeNode(node: SearchResultNode): { inserted: boolean; updated: boolean; fieldValuesCleared: number } {
    const existing = this.db
      .query("SELECT id FROM nodes WHERE id = ?")
      .get(node.id) as { id: string } | null;

    const now = Date.now();

    if (existing) {
      // UPDATE: only name, node_type, updated
      this.db.run(
        "UPDATE nodes SET name = ?, node_type = ?, updated = ? WHERE id = ?",
        [node.name, node.docType, now, node.id]
      );

      // Clear stale field_values for this node — delta sync lacks the tuple
      // structure needed to re-extract field values, so clearing ensures
      // stale values (e.g., cleared option fields) don't persist.
      // A subsequent full sync will re-populate field values from the export.
      let cleared = 0;
      try {
        const row = this.db.query(
          "SELECT COUNT(*) as cnt FROM field_values WHERE parent_id = ?"
        ).get(node.id) as { cnt: number } | null;
        cleared = row?.cnt ?? 0;
        if (cleared > 0) {
          this.db.run("DELETE FROM field_values WHERE parent_id = ?", [node.id]);
        }
      } catch {
        // field_values table may not exist if full sync hasn't run yet
      }

      return { inserted: false, updated: true, fieldValuesCleared: cleared };
    }

    // INSERT: new node
    const created = Date.parse(node.created);
    this.db.run(
      "INSERT INTO nodes (id, name, node_type, created, updated) VALUES (?, ?, ?, ?, ?)",
      [node.id, node.name, node.docType, created, now]
    );
    return { inserted: true, updated: false, fieldValuesCleared: 0 };
  }

  /**
   * Reconcile tag applications for a node.
   *
   * Deletes all existing tag_applications for the node and inserts new ones.
   * Uses empty string '' for tuple_node_id since delta-sync has no tuple context.
   */
  reconcileTags(nodeId: string, tags: Array<{ id: string; name: string }>): void {
    // Delete existing tags for this node
    this.db.run(
      "DELETE FROM tag_applications WHERE data_node_id = ?",
      [nodeId]
    );

    // Insert new tags
    if (tags.length > 0) {
      const insertStmt = this.db.prepare(
        "INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES (?, ?, ?, ?)"
      );
      for (const tag of tags) {
        insertStmt.run("", nodeId, tag.id, tag.name);
      }
    }
  }

  /**
   * Update the delta-sync watermark in sync_metadata.
   * Uses UPSERT to handle both insert and update cases.
   */
  updateWatermark(timestamp: number, nodesCount: number): void {
    const existing = this.db
      .query("SELECT id FROM sync_metadata WHERE id = 1")
      .get();

    if (existing) {
      this.db.run(
        "UPDATE sync_metadata SET delta_sync_timestamp = ?, delta_nodes_synced = ? WHERE id = 1",
        [timestamp, nodesCount]
      );
    } else {
      this.db.run(
        "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes, delta_sync_timestamp, delta_nodes_synced) VALUES (1, '', 0, 0, ?, ?)",
        [timestamp, nodesCount]
      );
    }
  }

  // ===========================================================================
  // T-2.2: Pagination + Embedding Generation
  // ===========================================================================

  /**
   * Async generator that pages through changed nodes from the API.
   *
   * Calls localApiClient.searchNodes with edited.since filter,
   * yielding each page of results. Stops when an empty page or
   * a page smaller than PAGE_SIZE is returned.
   *
   * NOTE (v2.5.6 fix): Tana Local API interprets `edited.since` as
   * **seconds since epoch**, not milliseconds. Prior to this release we
   * passed the ms watermark directly, which the API resolved to a
   * far-future timestamp (~year 58,000) — making delta-sync silently a
   * no-op after its first run. We keep watermarks in ms internally (for
   * backward-compat with existing databases) and convert at this boundary.
   */
  async *fetchChangedNodes(sinceMs: number): AsyncGenerator<SearchResultNode[]> {
    // Convert ms → seconds. Floor so we don't skip edits that happened
    // within the sub-second of the previous watermark. Clamp to min 1
    // because the API rejects `since=0` with a validation error.
    const sinceSec = Math.max(1, Math.floor(sinceMs / 1000));

    let offset = 0;

    while (true) {
      const page = await this.localApiClient.searchNodes(
        { edited: { since: sinceSec } },
        { limit: PAGE_SIZE, offset }
      );

      if (page.length === 0) break;

      yield page;

      if (page.length < PAGE_SIZE) break;

      offset += PAGE_SIZE;
    }
  }

  /**
   * Orchestrate a full delta-sync cycle:
   *
   * 1. Ensure schema
   * 2. Get watermark (throw if no full sync exists)
   * 3. Page through changed nodes, merge + reconcile tags
   * 4. Generate embeddings if configured
   * 5. Update watermark
   * 6. Return result
   */
  async sync(): Promise<DeltaSyncResult> {
    // Verify connection health before syncing (mitigates stale connection from process accumulation)
    this.ensureHealthyConnection();

    // T-2.3: In-memory lock check
    if (this.syncing) {
      this.logger.warn("Delta-sync already in progress, skipping");
      return {
        nodesFound: 0,
        nodesInserted: 0,
        nodesUpdated: 0,
        nodesSkipped: 0,
        fieldValuesCleared: 0,
        embeddingsGenerated: 0,
        embeddingsSkipped: true,
        watermarkBefore: 0,
        watermarkAfter: 0,
        durationMs: 0,
        pages: 0,
      };
    }

    this.syncing = true;
    const startTime = performance.now();

    try {
      // Step 1: Ensure schema
      this.ensureSchema();

      // Step 2: Get watermark
      const watermarkBefore = this.getWatermark();
      if (watermarkBefore === null && !this.hasFullSync()) {
        throw new Error(
          "No full sync found. Run 'supertag sync index' first."
        );
      }

      // Use 0 as fallback watermark if null (first delta after full sync with no delta timestamp)
      const sinceMs = watermarkBefore ?? 0;

      // Resolve the per-sync abort cap from current workspace size.
      const maxPages = this.resolveMaxPages();

      // Step 3: Page through changed nodes
      let nodesFound = 0;
      let nodesInserted = 0;
      let nodesUpdated = 0;
      let nodesSkipped = 0;
      let fieldValuesCleared = 0;
      let pages = 0;
      const changedNodeIds: string[] = [];

      for await (const page of this.fetchChangedNodes(sinceMs)) {
        pages++;

        if (pages > maxPages) {
          // Rows merged on pages 1..maxPages are already committed to SQLite;
          // the watermark is NOT advanced because we throw before Step 5.
          // The next delta-sync will replay from the same `sinceMs` and
          // re-merge those rows idempotently. Recovery is `supertag sync index`.
          // Check fires BEFORE merging this page, so we don't do work we're
          // about to throw away.
          throw new Error(
            `Delta-sync aborted after ${maxPages} pages (${nodesFound} nodes merged so far; watermark NOT advanced). ` +
              `This usually means the Local API is not honoring 'edited.since' ` +
              `and is returning the entire workspace. Run 'supertag sync index' ` +
              `for a full sync instead, or raise maxPages if this is a legitimately large delta.`,
          );
        }

        nodesFound += page.length;

        if (pages === 1 || pages % PROGRESS_INTERVAL_PAGES === 0) {
          this.logger.info(
            `delta-sync progress: ${pages} page(s), ${nodesFound} nodes (latest page: ${page.length})`,
          );
        }

        for (const node of page) {
          const result = this.mergeNode(node);
          if (result.inserted) nodesInserted++;
          if (result.updated) nodesUpdated++;
          if (result.fieldValuesCleared) fieldValuesCleared += result.fieldValuesCleared;

          this.reconcileTags(node.id, node.tags);
          changedNodeIds.push(node.id);
        }
      }

      // Step 4: Embedding generation
      let embeddingsGenerated = 0;
      let embeddingsSkipped = true;

      if (this.embeddingConfig && changedNodeIds.length > 0) {
        embeddingsSkipped = false;
        this.logger.info(
          `Embedding generation requested for ${changedNodeIds.length} nodes`
        );
        // Embedding integration is deferred - track IDs for now
        // Actual embedding calls will be implemented in a later phase
        embeddingsGenerated = 0;
      }

      // Step 5: Update watermark
      const watermarkAfter = Date.now();
      if (nodesFound > 0) {
        this.updateWatermark(watermarkAfter, nodesFound);
      }

      // Step 6: Return result
      const durationMs = Math.round(performance.now() - startTime);

      return {
        nodesFound,
        nodesInserted,
        nodesUpdated,
        nodesSkipped,
        fieldValuesCleared,
        embeddingsGenerated,
        embeddingsSkipped,
        watermarkBefore: sinceMs,
        watermarkAfter: nodesFound > 0 ? watermarkAfter : sinceMs,
        durationMs,
        pages,
      };
    } finally {
      // T-2.3: Always release lock
      this.syncing = false;
    }
  }

  // ===========================================================================
  // T-2.3: Locking + Status Reporting
  // ===========================================================================

  /**
   * Check if a sync is currently in progress.
   */
  isSyncing(): boolean {
    return this.syncing;
  }

  /**
   * Get delta-sync status for reporting.
   *
   * Queries sync_metadata for all stats:
   * - lastFullSync: last_sync_timestamp or null
   * - lastDeltaSync: delta_sync_timestamp or null
   * - lastDeltaNodesCount: delta_nodes_synced or 0
   * - totalNodes: COUNT(*) from nodes
   * - embeddingCoverage: 0 (placeholder)
   */
  getStatus(): DeltaSyncStatus {
    this.ensureSchema();

    const metaRow = this.db
      .query(
        "SELECT last_sync_timestamp, delta_sync_timestamp, delta_nodes_synced FROM sync_metadata WHERE id = 1"
      )
      .get() as {
        last_sync_timestamp: number;
        delta_sync_timestamp: number | null;
        delta_nodes_synced: number | null;
      } | null;

    const nodeCountRow = this.db
      .query("SELECT COUNT(*) as cnt FROM nodes")
      .get() as { cnt: number };

    const lastFullSync =
      metaRow && metaRow.last_sync_timestamp > 0
        ? metaRow.last_sync_timestamp
        : null;

    const lastDeltaSync = metaRow?.delta_sync_timestamp ?? null;
    const lastDeltaNodesCount = metaRow?.delta_nodes_synced ?? 0;

    return {
      lastFullSync,
      lastDeltaSync,
      lastDeltaNodesCount,
      totalNodes: nodeCountRow.cnt,
      embeddingCoverage: 0, // placeholder - will be enhanced later
    };
  }
}
