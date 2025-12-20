/**
 * Tana SQLite Indexer
 *
 * Indexes parsed Tana data into SQLite database for fast querying
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

// CRITICAL: Configure custom SQLite BEFORE any Database is created
// This enables extension loading (sqlite-vec) for embedding cleanup during sync
if (process.platform === "darwin") {
  const sqlitePaths = [
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",  // ARM Mac
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib",     // Intel Mac
  ];
  for (const path of sqlitePaths) {
    if (existsSync(path)) {
      try {
        Database.setCustomSQLite(path);
        break;
      } catch {
        // Already set or error - continue
      }
    }
  }
}

import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq, like, sql } from "drizzle-orm";
import { TanaExportParser } from "../parsers/tana-export";
import { nodes, supertags, fields, references, fieldNames } from "./schema";
import type { Node, Supertag, Field, Reference, FieldName } from "./schema";
import { withDbRetrySync } from "./retry";

export interface IndexResult {
  nodesIndexed: number;
  supertagsIndexed: number;
  fieldsIndexed: number;
  referencesIndexed: number;
  tagApplicationsIndexed: number;
  fieldNamesIndexed: number;
  durationMs: number;
  nodesAdded?: number;
  nodesDeleted?: number;
  nodesModified?: number;
  embeddingsCleared?: number;
}

interface SyncMetadata {
  lastExportFile: string;
  lastSyncTimestamp: number;
  totalNodes: number;
}

export class TanaIndexer {
  private sqlite: Database;
  private db: BunSQLiteDatabase;
  private parser: TanaExportParser;

  constructor(private dbPath: string) {
    this.sqlite = new Database(dbPath);
    this.db = drizzle(this.sqlite);
    this.parser = new TanaExportParser();

    // Try to load sqlite-vec extension for embedding cleanup support
    try {
      const sqliteVec = require("sqlite-vec");
      sqliteVec.load(this.sqlite);
    } catch {
      // sqlite-vec not available - embedding cleanup will be skipped
    }
  }

  /**
   * Initialize database schema
   */
  async initializeSchema(): Promise<void> {
    // Create nodes table
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        parent_id TEXT,
        node_type TEXT,
        created INTEGER,
        updated INTEGER,
        done_at INTEGER,
        raw_data TEXT
      )
    `);

    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_nodes_done_at ON nodes(done_at)`);

    // Create supertags table
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS supertags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        color TEXT
      )
    `);

    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_supertags_node ON supertags(node_id)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_supertags_name ON supertags(tag_name)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_supertags_tagid ON supertags(tag_id)`);

    // Create fields table
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_id TEXT NOT NULL
      )
    `);

    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_fields_node ON fields(node_id)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_fields_name ON fields(field_name)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_fields_fieldid ON fields(field_id)`);

    // Create references table (quotes needed - "references" is SQLite keyword)
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS "references" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        reference_type TEXT NOT NULL
      )
    `);

    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_references_from ON "references"(from_node)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_references_to ON "references"(to_node)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_references_type ON "references"(reference_type)`);

    // Create tag_applications table (maps nodes to their applied supertags)
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS tag_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_node_id TEXT NOT NULL,
        data_node_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL
      )
    `);

    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tag_apps_data_node ON tag_applications(data_node_id)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tag_apps_tag_id ON tag_applications(tag_id)`);
    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tag_apps_tag_name ON tag_applications(tag_name)`);

    // Create field_names table (maps field IDs to human-readable names)
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS field_names (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_id TEXT NOT NULL UNIQUE,
        field_name TEXT NOT NULL,
        supertags TEXT
      )
    `);

    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_field_names_fieldid ON field_names(field_id)`);

    // Create sync_metadata table to track sync state
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_export_file TEXT NOT NULL,
        last_sync_timestamp INTEGER NOT NULL,
        total_nodes INTEGER NOT NULL
      )
    `);

    // Create node_checksums table for change detection
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS node_checksums (
        node_id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        last_seen INTEGER NOT NULL
      )
    `);

    this.sqlite.run(`CREATE INDEX IF NOT EXISTS idx_node_checksums_last_seen ON node_checksums(last_seen)`);
  }

  /**
   * Get list of tables in database
   */
  async getTables(): Promise<string[]> {
    const result = this.sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    return result.map((r) => r.name);
  }

  /**
   * Check if embeddings table exists (for cleanup during sync)
   */
  private hasEmbeddingsTable(): boolean {
    const result = this.sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings'")
      .get() as { name: string } | null;
    return result !== null;
  }

  /**
   * Check if vec_embeddings virtual table exists (requires sqlite-vec to be loaded)
   */
  private hasVecEmbeddingsTable(): boolean {
    try {
      const result = this.sqlite
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
        .get() as { name: string } | null;
      return result !== null;
    } catch {
      // If query fails, vec_embeddings doesn't exist or sqlite-vec not loaded
      return false;
    }
  }

  /**
   * Compute checksum for a node (for change detection)
   * Uses a simple hash of critical node properties
   */
  private computeNodeChecksum(node: any): string {
    // Hash critical properties that indicate a node has changed
    const criticalData = {
      name: node.props?.name || null,
      created: node.props?.created || null,
      modified: Array.isArray(node.modifiedTs) ? node.modifiedTs[0] : null,
      doneAt: node.props?._done || null, // Include completion timestamp
      children: node.children || [],
      supertags: node.refs?.filter((r: any) => r.type === 'instance' || r.type === 'supertag') || [],
    };

    // Simple JSON stringify as checksum (could use crypto.hash for better performance)
    return JSON.stringify(criticalData);
  }

  /**
   * Get existing node IDs and their checksums from database
   */
  private getExistingNodeData(): Map<string, string> {
    const results = this.sqlite
      .query("SELECT node_id, checksum FROM node_checksums")
      .all() as Array<{ node_id: string; checksum: string }>;

    return new Map(results.map(r => [r.node_id, r.checksum]));
  }

  /**
   * Detect changes between export and database
   * Returns: { added: Set<id>, deleted: Set<id>, modified: Set<id> }
   */
  private detectChanges(
    exportGraph: ReturnType<TanaExportParser["buildGraph"]>,
    existingData: Map<string, string>
  ): { added: Set<string>; deleted: Set<string>; modified: Set<string> } {
    const added = new Set<string>();
    const modified = new Set<string>();
    const seen = new Set<string>();

    // Check all nodes in export
    for (const [nodeId, node] of exportGraph.nodes) {
      seen.add(nodeId);
      const newChecksum = this.computeNodeChecksum(node);

      if (!existingData.has(nodeId)) {
        // New node
        added.add(nodeId);
      } else if (existingData.get(nodeId) !== newChecksum) {
        // Modified node
        modified.add(nodeId);
      }
      // else: unchanged node
    }

    // Find deleted nodes (in DB but not in export)
    const deleted = new Set<string>();
    for (const nodeId of existingData.keys()) {
      if (!seen.has(nodeId)) {
        deleted.add(nodeId);
      }
    }

    return { added, deleted, modified };
  }

  /**
   * Full reindex (used for migration or first-time sync)
   * Drops all data and rebuilds from scratch
   */
  private async fullReindex(
    exportPath: string,
    graph: ReturnType<TanaExportParser["buildGraph"]>
  ): Promise<IndexResult> {
    const startTime = Date.now();
    const exportFilename = require('path').basename(exportPath);

    // Clear all data - wrap transaction in retry for concurrent access
    withDbRetrySync(() => this.sqlite.run("BEGIN TRANSACTION"), "BEGIN fullReindex");

    try {
      this.sqlite.run("DELETE FROM nodes");
      this.sqlite.run("DELETE FROM supertags");
      this.sqlite.run("DELETE FROM fields");
      this.sqlite.run('DELETE FROM "references"');
      this.sqlite.run("DELETE FROM tag_applications");
      this.sqlite.run("DELETE FROM field_names");
      this.sqlite.run("DELETE FROM node_checksums");

      const now = Date.now();

      // Build parent map
      const parentMap = new Map<string, string>();
      for (const [id, node] of graph.nodes) {
        if (node.children) {
          for (const childId of node.children) {
            parentMap.set(childId, id);
          }
        }
      }

      // Insert all nodes
      const insertNode = this.sqlite.prepare(
        "INSERT INTO nodes (id, name, parent_id, node_type, created, updated, done_at, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const upsertNodeChecksum = this.sqlite.prepare(
        "INSERT INTO node_checksums (node_id, checksum, last_seen) VALUES (?, ?, ?)"
      );

      let nodesCount = 0;
      for (const [id, node] of graph.nodes) {
        const updated = Array.isArray(node.modifiedTs) ? node.modifiedTs[0] : null;
        // Only store numeric timestamps, ignore boolean _done values
        const doneAt = typeof node.props._done === 'number' ? node.props._done : null;
        const checksum = this.computeNodeChecksum(node);

        insertNode.run(
          id,
          node.props.name || null,
          parentMap.get(id) || null,
          "node",
          node.props.created,
          updated,
          doneAt,
          JSON.stringify(node)
        );
        upsertNodeChecksum.run(id, checksum, now);
        nodesCount++;
      }

      // Insert all supertags
      const insertSupertag = this.sqlite.prepare(
        "INSERT INTO supertags (node_id, tag_name, tag_id, color) VALUES (?, ?, ?, ?)"
      );
      for (const [tagName, tuple] of graph.supertags) {
        insertSupertag.run(tuple.nodeId, tagName, tuple.tagId, tuple.color || null);
      }

      // Insert all fields
      const insertField = this.sqlite.prepare(
        "INSERT INTO fields (node_id, field_name, field_id) VALUES (?, ?, ?)"
      );
      for (const [fieldName, tuple] of graph.fields) {
        insertField.run(tuple.nodeId, fieldName, tuple.fieldId);
      }

      // Insert all references
      const insertReference = this.sqlite.prepare(
        'INSERT INTO "references" (from_node, to_node, reference_type) VALUES (?, ?, ?)'
      );
      for (const ref of graph.inlineRefs) {
        for (const targetId of ref.targetNodeIds) {
          insertReference.run(ref.sourceNodeId, targetId, ref.type);
        }
      }

      // Insert all tag applications
      const insertTagApplication = this.sqlite.prepare(
        "INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES (?, ?, ?, ?)"
      );
      for (const app of graph.tagApplications) {
        insertTagApplication.run(app.tupleNodeId, app.dataNodeId, app.tagId, app.tagName);
      }

      // Insert field names
      const fieldNamesMap = this.extractFieldNames(graph);
      const insertFieldName = this.sqlite.prepare(
        "INSERT INTO field_names (field_id, field_name, supertags) VALUES (?, ?, ?)"
      );
      let fieldNamesCount = 0;
      for (const [fieldId, mapping] of fieldNamesMap) {
        insertFieldName.run(fieldId, mapping.fieldName, JSON.stringify(mapping.supertags));
        fieldNamesCount++;
      }

      // Update sync metadata
      this.sqlite.run(
        "INSERT OR REPLACE INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, ?, ?, ?)",
        [exportFilename, now, graph.nodes.size]
      );

      withDbRetrySync(() => this.sqlite.run("COMMIT"), "COMMIT fullReindex");

      const durationMs = Date.now() - startTime;

      return {
        nodesIndexed: nodesCount,
        nodesAdded: nodesCount,
        nodesModified: 0,
        nodesDeleted: 0,
        supertagsIndexed: graph.supertags.size,
        fieldsIndexed: graph.fields.size,
        referencesIndexed: graph.inlineRefs.length,
        tagApplicationsIndexed: graph.tagApplications.length,
        fieldNamesIndexed: fieldNamesCount,
        durationMs,
      };
    } catch (error) {
      withDbRetrySync(() => this.sqlite.run("ROLLBACK"), "ROLLBACK fullReindex");
      throw error;
    }
  }

  /**
   * Index Tana export file
   */
  async indexExport(exportPath: string): Promise<IndexResult> {
    const startTime = Date.now();
    const exportFilename = require('path').basename(exportPath);

    // Parse export
    const dump = await this.parser.parseFile(exportPath);
    const graph = this.parser.buildGraph(dump);

    // Get existing data and detect changes
    const existingData = this.getExistingNodeData();

    // Migration check: if database has nodes but no checksums, do full reindex
    const nodeCount = this.sqlite.query("SELECT COUNT(*) as count FROM nodes").get() as { count: number };
    const checksumCount = this.sqlite.query("SELECT COUNT(*) as count FROM node_checksums").get() as { count: number };

    const needsFullReindex = nodeCount.count > 0 && checksumCount.count === 0;

    if (needsFullReindex) {
      console.log(`🔄 First-time migration: performing full reindex of ${nodeCount.count.toLocaleString()} existing nodes`);
      return this.fullReindex(exportPath, graph);
    }

    const changes = this.detectChanges(graph, existingData);

    // Count embeddings that will be cleared (deleted + modified nodes)
    let embeddingsCleared = 0;
    if (this.hasEmbeddingsTable()) {
      const nodesToClear = [...changes.deleted, ...changes.modified];
      if (nodesToClear.length > 0) {
        const placeholders = nodesToClear.map(() => '?').join(',');
        const result = this.sqlite
          .query(`SELECT COUNT(*) as count FROM embeddings WHERE node_id IN (${placeholders})`)
          .get(...nodesToClear) as { count: number };
        embeddingsCleared = result?.count || 0;
      }
    }

    const embeddingInfo = embeddingsCleared > 0 ? ` 🔄${embeddingsCleared} embeddings` : '';
    console.log(`📊 Change detection: +${changes.added.size} ~${changes.modified.size} -${changes.deleted.size}${embeddingInfo}`);

    // Use transaction for all operations - wrap in retry for concurrent access
    withDbRetrySync(() => this.sqlite.run("BEGIN TRANSACTION"), "BEGIN indexExport");

    try {
      const now = Date.now();

      // Build parent map from children relationships (needed for all nodes)
      const parentMap = new Map<string, string>();
      for (const [id, node] of graph.nodes) {
        if (node.children) {
          for (const childId of node.children) {
            parentMap.set(childId, id);
          }
        }
      }

      // STEP 1: Delete removed nodes (cascade will handle related tables if foreign keys are set)
      if (changes.deleted.size > 0) {
        const deleteNode = this.sqlite.prepare("DELETE FROM nodes WHERE id = ?");
        const deleteNodeChecksum = this.sqlite.prepare("DELETE FROM node_checksums WHERE node_id = ?");
        const deleteSupertags = this.sqlite.prepare("DELETE FROM supertags WHERE node_id = ?");
        const deleteFields = this.sqlite.prepare("DELETE FROM fields WHERE node_id = ?");
        const deleteRefsFrom = this.sqlite.prepare('DELETE FROM "references" WHERE from_node = ?');
        const deleteRefsTo = this.sqlite.prepare('DELETE FROM "references" WHERE to_node = ?');
        const deleteTagApps = this.sqlite.prepare("DELETE FROM tag_applications WHERE data_node_id = ?");

        // Also delete embeddings if the tables exist
        const hasEmbeddings = this.hasEmbeddingsTable();
        const hasVecEmbeddings = this.hasVecEmbeddingsTable();
        const deleteEmbedding = hasEmbeddings
          ? this.sqlite.prepare("DELETE FROM embeddings WHERE node_id = ?")
          : null;
        const deleteVecEmbedding = hasVecEmbeddings
          ? this.sqlite.prepare("DELETE FROM vec_embeddings WHERE node_id = ?")
          : null;

        for (const nodeId of changes.deleted) {
          deleteNode.run(nodeId);
          deleteNodeChecksum.run(nodeId);
          deleteSupertags.run(nodeId);
          deleteFields.run(nodeId);
          deleteRefsFrom.run(nodeId);
          deleteRefsTo.run(nodeId);
          deleteTagApps.run(nodeId);
          // Delete embeddings for deleted nodes
          if (deleteEmbedding) deleteEmbedding.run(nodeId);
          if (deleteVecEmbedding) deleteVecEmbedding.run(nodeId);
        }
      }

      // STEP 2: Prepare statements for inserts and updates
      const insertNode = this.sqlite.prepare(
        "INSERT INTO nodes (id, name, parent_id, node_type, created, updated, done_at, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const updateNode = this.sqlite.prepare(
        "UPDATE nodes SET name = ?, parent_id = ?, updated = ?, done_at = ?, raw_data = ? WHERE id = ?"
      );
      const upsertNodeChecksum = this.sqlite.prepare(
        "INSERT OR REPLACE INTO node_checksums (node_id, checksum, last_seen) VALUES (?, ?, ?)"
      );

      // STEP 3: Insert new nodes and update modified nodes
      let nodesAdded = 0;
      let nodesModified = 0;

      for (const [id, node] of graph.nodes) {
        const updated = Array.isArray(node.modifiedTs) ? node.modifiedTs[0] : null;
        // Only store numeric timestamps, ignore boolean _done values
        const doneAt = typeof node.props._done === 'number' ? node.props._done : null;
        const checksum = this.computeNodeChecksum(node);

        if (changes.added.has(id)) {
          // Insert new node
          insertNode.run(
            id,
            node.props.name || null,
            parentMap.get(id) || null,
            "node",
            node.props.created,
            updated,
            doneAt,
            JSON.stringify(node)
          );
          nodesAdded++;
        } else if (changes.modified.has(id)) {
          // Update modified node
          updateNode.run(
            node.props.name || null,
            parentMap.get(id) || null,
            updated,
            doneAt,
            JSON.stringify(node),
            id
          );
          nodesModified++;
        }

        // Update checksum for all nodes (new, modified, and unchanged)
        upsertNodeChecksum.run(id, checksum, now);
      }

      // STEP 4: Rebuild related tables for changed nodes only
      // For simplicity and correctness, we delete and re-insert related data for added/modified nodes
      // This ensures referential integrity without complex diff logic for each table

      const changedNodes = new Set([...changes.added, ...changes.modified]);

      if (changedNodes.size > 0) {
        // Delete old related data for changed nodes
        const deleteSupertags = this.sqlite.prepare("DELETE FROM supertags WHERE node_id = ?");
        const deleteFields = this.sqlite.prepare("DELETE FROM fields WHERE node_id = ?");
        const deleteRefsFrom = this.sqlite.prepare('DELETE FROM "references" WHERE from_node = ?');
        const deleteTagApps = this.sqlite.prepare("DELETE FROM tag_applications WHERE data_node_id = ?");

        // Also clear embeddings for modified nodes (so they get re-embedded)
        const hasEmbeddings = this.hasEmbeddingsTable();
        const hasVecEmbeddings = this.hasVecEmbeddingsTable();
        const deleteEmbedding = hasEmbeddings
          ? this.sqlite.prepare("DELETE FROM embeddings WHERE node_id = ?")
          : null;
        const deleteVecEmbedding = hasVecEmbeddings
          ? this.sqlite.prepare("DELETE FROM vec_embeddings WHERE node_id = ?")
          : null;

        for (const nodeId of changedNodes) {
          deleteSupertags.run(nodeId);
          deleteFields.run(nodeId);
          deleteRefsFrom.run(nodeId);
          deleteTagApps.run(nodeId);
          // Clear embeddings for modified nodes (will be regenerated on next embed generate)
          if (deleteEmbedding) deleteEmbedding.run(nodeId);
          if (deleteVecEmbedding) deleteVecEmbedding.run(nodeId);
        }

        // Re-insert related data for changed nodes
        const insertSupertag = this.sqlite.prepare(
          "INSERT INTO supertags (node_id, tag_name, tag_id, color) VALUES (?, ?, ?, ?)"
        );
        const insertField = this.sqlite.prepare(
          "INSERT INTO fields (node_id, field_name, field_id) VALUES (?, ?, ?)"
        );
        const insertReference = this.sqlite.prepare(
          'INSERT INTO "references" (from_node, to_node, reference_type) VALUES (?, ?, ?)'
        );
        const insertTagApplication = this.sqlite.prepare(
          "INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES (?, ?, ?, ?)"
        );

        // Supertags
        let supertagsCount = 0;
        for (const [tagName, tuple] of graph.supertags) {
          if (changedNodes.has(tuple.nodeId)) {
            insertSupertag.run(tuple.nodeId, tagName, tuple.tagId, tuple.color || null);
            supertagsCount++;
          }
        }

        // Fields
        let fieldsCount = 0;
        for (const [fieldName, tuple] of graph.fields) {
          if (changedNodes.has(tuple.nodeId)) {
            insertField.run(tuple.nodeId, fieldName, tuple.fieldId);
            fieldsCount++;
          }
        }

        // References
        let referencesCount = 0;
        for (const ref of graph.inlineRefs) {
          if (changedNodes.has(ref.sourceNodeId)) {
            for (const targetId of ref.targetNodeIds) {
              insertReference.run(ref.sourceNodeId, targetId, ref.type);
              referencesCount++;
            }
          }
        }

        // Tag applications
        let tagApplicationsCount = 0;
        for (const app of graph.tagApplications) {
          if (changedNodes.has(app.dataNodeId)) {
            insertTagApplication.run(app.tupleNodeId, app.dataNodeId, app.tagId, app.tagName);
            tagApplicationsCount++;
          }
        }
      }

      // STEP 5: Always rebuild field_names (relatively small table)
      this.sqlite.run("DELETE FROM field_names");
      const fieldNamesMap = this.extractFieldNames(graph);
      const insertFieldName = this.sqlite.prepare(
        "INSERT INTO field_names (field_id, field_name, supertags) VALUES (?, ?, ?)"
      );

      let fieldNamesCount = 0;
      for (const [fieldId, mapping] of fieldNamesMap) {
        insertFieldName.run(fieldId, mapping.fieldName, JSON.stringify(mapping.supertags));
        fieldNamesCount++;
      }

      // STEP 6: Update sync metadata
      this.sqlite.run(
        "INSERT OR REPLACE INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, ?, ?, ?)",
        [exportFilename, now, graph.nodes.size]
      );

      withDbRetrySync(() => this.sqlite.run("COMMIT"), "COMMIT indexExport");

      const durationMs = Date.now() - startTime;

      return {
        nodesIndexed: graph.nodes.size,
        nodesAdded,
        nodesModified,
        nodesDeleted: changes.deleted.size,
        embeddingsCleared,
        supertagsIndexed: graph.supertags.size,
        fieldsIndexed: graph.fields.size,
        referencesIndexed: graph.inlineRefs.length,
        tagApplicationsIndexed: graph.tagApplications.length,
        fieldNamesIndexed: fieldNamesCount,
        durationMs,
      };
    } catch (error) {
      withDbRetrySync(() => this.sqlite.run("ROLLBACK"), "ROLLBACK indexExport");
      throw error;
    }
  }

  /**
   * Get node by ID
   */
  async getNodeById(nodeId: string): Promise<Node | null> {
    const result = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find nodes by name pattern (SQL LIKE)
   */
  async findNodesByName(pattern: string): Promise<Node[]> {
    return await this.db
      .select()
      .from(nodes)
      .where(like(nodes.name, pattern));
  }

  /**
   * Get all supertags
   */
  async getAllSupertags(): Promise<Supertag[]> {
    return await this.db.select().from(supertags);
  }

  /**
   * Find nodes by supertag name (DEPRECATED - use findNodesByTagApplication)
   * This method finds the tag definition nodes, not nodes with the tag applied
   */
  async findNodesBySupertag(tagName: string): Promise<Node[]> {
    // Join supertags with nodes
    const result = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        parentId: nodes.parentId,
        nodeType: nodes.nodeType,
        created: nodes.created,
        updated: nodes.updated,
        doneAt: nodes.doneAt,
        rawData: nodes.rawData,
      })
      .from(nodes)
      .innerJoin(supertags, eq(supertags.tagId, nodes.id))
      .where(eq(supertags.tagName, tagName));

    return result;
  }

  /**
   * Find nodes that have a specific supertag applied
   * This is the correct way to find "all nodes tagged with X"
   */
  async findNodesByTagApplication(
    tagName: string,
    options?: { limit?: number; orderBy?: "created" | "updated" }
  ): Promise<Node[]> {
    const limit = options?.limit || 100;
    const orderBy = options?.orderBy || "created";

    const result = this.sqlite
      .query(
        `
      SELECT
        n.id,
        n.name,
        n.parent_id as parentId,
        n.node_type as nodeType,
        n.created,
        n.updated,
        n.done_at as doneAt,
        n.raw_data as rawData
      FROM nodes n
      INNER JOIN tag_applications ta ON ta.data_node_id = n.id
      WHERE ta.tag_name = ?
      ORDER BY n.${orderBy} DESC
      LIMIT ?
    `
      )
      .all(tagName, limit) as Node[];

    return result;
  }

  /**
   * Get outbound references for a node
   */
  async getOutboundReferences(nodeId: string): Promise<Reference[]> {
    return await this.db
      .select()
      .from(references)
      .where(eq(references.fromNode, nodeId));
  }

  /**
   * Get inbound references for a node
   */
  async getInboundReferences(nodeId: string): Promise<Reference[]> {
    return await this.db
      .select()
      .from(references)
      .where(eq(references.toNode, nodeId));
  }

  /**
   * Extract field names from supertag definitions
   * Iterates through all supertag nodes and extracts field ID -> name mappings
   */
  private extractFieldNames(
    graph: ReturnType<TanaExportParser["buildGraph"]>
  ): Map<string, { fieldName: string; supertags: string[] }> {
    const fieldNamesMap = new Map<
      string,
      { fieldName: string; supertags: string[] }
    >();

    // Iterate through all supertags
    for (const [tagName, tagInfo] of graph.supertags) {
      const tagNode = graph.nodes.get(tagInfo.tagId);
      if (!tagNode || !tagNode.children) continue;

      // Each child of a supertag definition could be a field tuple
      for (const childId of tagNode.children) {
        const childNode = graph.nodes.get(childId);
        if (!childNode) continue;

        // Check if it's a tuple (field definition)
        if (childNode.props?._docType === "tuple" && childNode.children) {
          const fieldChildren = childNode.children;
          if (fieldChildren.length >= 1) {
            const fieldId = fieldChildren[0];

            // Try to get field name from node
            const fieldNode = graph.nodes.get(fieldId);
            let fieldName = fieldNode?.props?.name || null;

            // For system fields, the name is in the node
            if (fieldId.startsWith("SYS_") && fieldNode?.props?.name) {
              fieldName = fieldNode.props.name;
            }

            if (fieldName) {
              if (fieldNamesMap.has(fieldId)) {
                // Add supertag to existing mapping
                fieldNamesMap.get(fieldId)!.supertags.push(tagName);
              } else {
                fieldNamesMap.set(fieldId, {
                  fieldName,
                  supertags: [tagName],
                });
              }
            }
          }
        }
      }
    }

    // Also add hardcoded system field names for fields not in supertag definitions
    const systemFields: Record<string, string> = {
      SYS_A13: "Tag",
      SYS_A61: "Due date",
      SYS_A90: "Date",
      SYS_A142: "Attendees",
      SYS_T01: "Supertag",
      SYS_T02: "Field",
    };

    for (const [fieldId, fieldName] of Object.entries(systemFields)) {
      if (!fieldNamesMap.has(fieldId)) {
        fieldNamesMap.set(fieldId, { fieldName, supertags: ["system"] });
      }
    }

    return fieldNamesMap;
  }

  /**
   * Get field name by ID from database
   */
  async getFieldName(fieldId: string): Promise<string | null> {
    const result = this.sqlite
      .query("SELECT field_name FROM field_names WHERE field_id = ?")
      .get(fieldId) as { field_name: string } | null;
    return result?.field_name || null;
  }

  /**
   * Get all field name mappings
   */
  async getAllFieldNames(): Promise<
    Array<{ fieldId: string; fieldName: string; supertags: string[] }>
  > {
    const results = this.sqlite
      .query("SELECT field_id, field_name, supertags FROM field_names")
      .all() as Array<{
      field_id: string;
      field_name: string;
      supertags: string;
    }>;

    return results.map((r) => ({
      fieldId: r.field_id,
      fieldName: r.field_name,
      supertags: JSON.parse(r.supertags || "[]"),
    }));
  }

  /**
   * Find the nearest ancestor with a supertag applied
   * Traverses up the tree until finding a node with a tag in tag_applications
   */
  async findTaggedAncestor(
    nodeId: string,
    maxDepth: number = 20
  ): Promise<Node | null> {
    let currentId: string | null = nodeId;
    let depth = 0;

    while (currentId && depth < maxDepth) {
      // Check if current node has a tag applied
      const hasTag = this.sqlite
        .query(
          "SELECT 1 FROM tag_applications WHERE data_node_id = ? LIMIT 1"
        )
        .get(currentId);

      if (hasTag) {
        // Return this node
        const node = this.sqlite
          .query(
            "SELECT id, name, parent_id as parentId, node_type as nodeType, created, updated, raw_data as rawData FROM nodes WHERE id = ?"
          )
          .get(currentId) as Node | null;
        return node;
      }

      // Get parent
      const parent = this.sqlite
        .query("SELECT parent_id FROM nodes WHERE id = ?")
        .get(currentId) as { parent_id: string | null } | null;

      currentId = parent?.parent_id || null;
      depth++;
    }

    return null;
  }

  /**
   * Find the nearest ancestor with a name (even if not tagged)
   * Traverses up the tree until finding a node with a non-null name
   */
  async findNamedAncestor(
    nodeId: string,
    maxDepth: number = 20
  ): Promise<Node | null> {
    let currentId: string | null = nodeId;
    let depth = 0;

    while (currentId && depth < maxDepth) {
      // Check if current node has a name
      const node = this.sqlite
        .query(
          "SELECT id, name, parent_id as parentId, node_type as nodeType, created, updated, raw_data as rawData FROM nodes WHERE id = ?"
        )
        .get(currentId) as Node | null;

      if (node?.name) {
        return node;
      }

      // Get parent
      currentId = node?.parentId || null;
      depth++;
    }

    return null;
  }

  /**
   * Find tagged ancestors for multiple nodes (batch operation)
   * Returns a map of original nodeId -> tagged ancestor node
   */
  async findTaggedAncestors(
    nodeIds: string[]
  ): Promise<Map<string, Node>> {
    const results = new Map<string, Node>();
    const seen = new Map<string, Node | null>(); // Cache for ancestor lookups

    for (const nodeId of nodeIds) {
      // Check cache first
      if (seen.has(nodeId)) {
        const cached = seen.get(nodeId);
        if (cached) results.set(nodeId, cached);
        continue;
      }

      const ancestor = await this.findTaggedAncestor(nodeId);
      seen.set(nodeId, ancestor);
      if (ancestor) {
        results.set(nodeId, ancestor);
      }
    }

    return results;
  }

  /**
   * Find named ancestors for multiple nodes (batch operation)
   * Returns a map of original nodeId -> named ancestor node
   */
  async findNamedAncestors(
    nodeIds: string[]
  ): Promise<Map<string, Node>> {
    const results = new Map<string, Node>();
    const seen = new Map<string, Node | null>(); // Cache for ancestor lookups

    for (const nodeId of nodeIds) {
      // Check cache first
      if (seen.has(nodeId)) {
        const cached = seen.get(nodeId);
        if (cached) results.set(nodeId, cached);
        continue;
      }

      const ancestor = await this.findNamedAncestor(nodeId);
      seen.set(nodeId, ancestor);
      if (ancestor) {
        results.set(nodeId, ancestor);
      }
    }

    return results;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.sqlite.close();
  }
}
