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
 * DeltaSyncService handles incremental sync of Tana nodes
 * from the local API into the SQLite database.
 */
export class DeltaSyncService {
  private db: Database;
  private localApiClient: DeltaSyncOptions["localApiClient"];
  private embeddingConfig?: DeltaSyncOptions["embeddingConfig"];
  private logger: NonNullable<DeltaSyncOptions["logger"]>;
  private syncing = false;

  constructor(options: DeltaSyncOptions) {
    this.db = new Database(options.dbPath);
    this.localApiClient = options.localApiClient;
    this.embeddingConfig = options.embeddingConfig;
    this.logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  /**
   * Close the database connection.
   * Call when the service is no longer needed.
   */
  close(): void {
    try {
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
   * - Existing nodes: UPDATE name, node_type, updated
   * - PRESERVES: parent_id, done_at, raw_data (never overwritten by delta)
   */
  mergeNode(node: SearchResultNode): { inserted: boolean; updated: boolean } {
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
      return { inserted: false, updated: true };
    }

    // INSERT: new node
    const created = Date.parse(node.created);
    this.db.run(
      "INSERT INTO nodes (id, name, node_type, created, updated) VALUES (?, ?, ?, ?, ?)",
      [node.id, node.name, node.docType, created, now]
    );
    return { inserted: true, updated: false };
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
   */
  async *fetchChangedNodes(sinceMs: number): AsyncGenerator<SearchResultNode[]> {
    let offset = 0;

    while (true) {
      const page = await this.localApiClient.searchNodes(
        { edited: { since: sinceMs } },
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
    // T-2.3: In-memory lock check
    if (this.syncing) {
      this.logger.warn("Delta-sync already in progress, skipping");
      return {
        nodesFound: 0,
        nodesInserted: 0,
        nodesUpdated: 0,
        nodesSkipped: 0,
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

      // Step 3: Page through changed nodes
      let nodesFound = 0;
      let nodesInserted = 0;
      let nodesUpdated = 0;
      let nodesSkipped = 0;
      let pages = 0;
      const changedNodeIds: string[] = [];

      for await (const page of this.fetchChangedNodes(sinceMs)) {
        pages++;
        nodesFound += page.length;

        for (const node of page) {
          const result = this.mergeNode(node);
          if (result.inserted) nodesInserted++;
          if (result.updated) nodesUpdated++;

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
