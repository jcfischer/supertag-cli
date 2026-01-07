/**
 * Tana Query Engine
 *
 * Provides high-level query interface for indexed Tana data
 * Supports: node queries, supertag filtering, references, FTS5 search
 */

import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq, like, sql, inArray, gt, lt, and, desc, or } from "drizzle-orm";
import { nodes, supertags, fields, references } from "../db/schema";
import type { Node, Supertag, Reference } from "../db/schema";
import { withDbRetrySync } from "../db/retry";
import { buildPagination, buildOrderBy } from "../db/query-builder";
import type { RelationshipType, Direction } from "../types/graph";
import { mapDbType } from "../types/graph";

export interface NodeQuery {
  name?: string;
  namePattern?: string; // SQL LIKE pattern
  supertag?: string;
  createdAfter?: number;  // UNIX timestamp (ms)
  createdBefore?: number; // UNIX timestamp (ms)
  updatedAfter?: number;  // UNIX timestamp (ms)
  updatedBefore?: number; // UNIX timestamp (ms)
  limit?: number;
}

export interface SearchResult extends Node {
  rank: number; // FTS5 relevance rank
}

export interface ReferenceGraph {
  node: Node;
  outbound: Array<{ reference: Reference; node: Node | null }>;
  inbound: Array<{ reference: Reference; node: Node | null }>;
}

export interface SupertagCount {
  tagName: string;
  tagId: string;
  count: number;
}

export interface DatabaseStatistics {
  totalNodes: number;
  totalSupertags: number;
  totalFields: number;
  totalReferences: number;
}

/**
 * Result from getRelatedNodes query
 */
export interface RelatedNodeResult {
  /** Target node ID */
  nodeId: string;
  /** Relationship type (mapped from DB type) */
  type: RelationshipType;
}

/**
 * Escape a search query for FTS5 MATCH syntax.
 * FTS5 has special syntax where bare words can be interpreted as column names
 * or operators (AND, OR, NOT, NEAR). We quote each term to treat them as literals.
 *
 * Examples:
 *   "semantic" -> "semantic" (quoted to prevent column name interpretation)
 *   "hello world" -> "hello" "world" (each word quoted)
 *   "c++" -> "c++" (special chars preserved inside quotes)
 */
function escapeFTS5Query(query: string): string {
  // Split on whitespace and quote each term
  // FTS5 double-quoted strings are phrase searches, treating content literally
  const terms = query.trim().split(/\s+/).filter(t => t.length > 0);

  if (terms.length === 0) {
    return '""'; // Empty query
  }

  // Quote each term - escape any internal double quotes by doubling them
  return terms.map(term => {
    const escaped = term.replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(' ');
}

/**
 * High-level query engine for Tana indexed data
 */
export class TanaQueryEngine {
  private sqlite: Database;
  private db: BunSQLiteDatabase;

  constructor(private dbPath: string) {
    this.sqlite = new Database(dbPath);
    this.db = drizzle(this.sqlite);
  }

  /**
   * Get the raw SQLite database for direct queries
   */
  get rawDb(): Database {
    return this.sqlite;
  }

  /**
   * Check if database connection is active
   */
  isConnected(): boolean {
    try {
      this.sqlite.query("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find nodes matching query criteria
   */
  async findNodes(query: NodeQuery): Promise<Node[]> {
    // Build conditions for WHERE clause
    const conditions = [];

    if (query.name) {
      conditions.push(eq(nodes.name, query.name));
    }

    if (query.namePattern) {
      conditions.push(sql`${nodes.name} IS NOT NULL`);
      conditions.push(like(nodes.name, query.namePattern));
    }

    if (query.createdAfter) {
      conditions.push(gt(nodes.created, query.createdAfter));
    }

    if (query.createdBefore) {
      conditions.push(lt(nodes.created, query.createdBefore));
    }

    if (query.updatedAfter) {
      conditions.push(sql`${nodes.updated} IS NOT NULL`);
      conditions.push(gt(nodes.updated, query.updatedAfter));
    }

    if (query.updatedBefore) {
      conditions.push(sql`${nodes.updated} IS NOT NULL`);
      conditions.push(lt(nodes.updated, query.updatedBefore));
    }

    // Special case: supertag filter requires join
    if (query.supertag) {
      let joinQuery = this.db
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
        .innerJoin(supertags, eq(supertags.nodeId, nodes.id))
        .where(eq(supertags.tagName, query.supertag));

      // Add other conditions to join query
      if (conditions.length > 0) {
        joinQuery = (joinQuery as any).where(sql.join(conditions, sql` AND `));
      }

      return await joinQuery.limit(query.limit || 100);
    }

    // Regular query without join
    let queryBuilder = this.db.select().from(nodes);

    if (conditions.length > 0) {
      queryBuilder = queryBuilder.where(sql.join(conditions, sql` AND `)) as any;
    }

    return await queryBuilder.limit(query.limit || 100);
  }

  /**
   * Find nodes by list of IDs
   */
  async findNodesByIds(ids: string[]): Promise<Node[]> {
    return await this.db
      .select()
      .from(nodes)
      .where(inArray(nodes.id, ids));
  }

  /**
   * Get all supertags
   */
  async getAllSupertags(): Promise<Supertag[]> {
    return await this.db.select().from(supertags);
  }

  /**
   * Get node counts per supertag
   */
  async getNodeCountsBySupertag(): Promise<SupertagCount[]> {
    const result = withDbRetrySync(
      () => this.sqlite
        .query(
          `
        SELECT
          tag_name as tagName,
          tag_id as tagId,
          COUNT(DISTINCT node_id) as count
        FROM supertags
        GROUP BY tag_name, tag_id
        ORDER BY count DESC
      `
        )
        .all() as SupertagCount[],
      "getNodeCountsBySupertag"
    );

    return result;
  }

  /**
   * Get top N most used supertags
   */
  async getTopSupertags(limit: number): Promise<SupertagCount[]> {
    const counts = await this.getNodeCountsBySupertag();
    return counts.slice(0, limit);
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
   * Get reference graph for a node (with depth)
   */
  async getReferenceGraph(
    nodeId: string,
    depth: number = 1
  ): Promise<ReferenceGraph> {
    // Get the node itself
    const nodeResult = await this.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);

    if (nodeResult.length === 0) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const node = nodeResult[0];

    // Get outbound references
    const outboundRefs = await this.getOutboundReferences(nodeId);
    const outbound = await Promise.all(
      outboundRefs.map(async (ref) => {
        const targetNode = await this.db
          .select()
          .from(nodes)
          .where(eq(nodes.id, ref.toNode))
          .limit(1);

        return {
          reference: ref,
          node: targetNode[0] || null,
        };
      })
    );

    // Get inbound references
    const inboundRefs = await this.getInboundReferences(nodeId);
    const inbound = await Promise.all(
      inboundRefs.map(async (ref) => {
        const sourceNode = await this.db
          .select()
          .from(nodes)
          .where(eq(nodes.id, ref.fromNode))
          .limit(1);

        return {
          reference: ref,
          node: sourceNode[0] || null,
        };
      })
    );

    return {
      node,
      outbound,
      inbound,
    };
  }

  /**
   * Find all nodes that reference a given node
   */
  async findNodesReferencingNode(nodeId: string): Promise<Node[]> {
    const refs = await this.getInboundReferences(nodeId);
    const sourceIds = refs.map((r) => r.fromNode);

    if (sourceIds.length === 0) {
      return [];
    }

    return await this.findNodesByIds(sourceIds);
  }

  /**
   * Initialize FTS5 full-text search index
   */
  async initializeFTS(): Promise<void> {
    // Create FTS5 virtual table
    withDbRetrySync(
      () => this.sqlite.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          id UNINDEXED,
          name,
          content='nodes',
          content_rowid='rowid'
        )
      `),
      "initializeFTS create"
    );

    // Populate FTS index from nodes table
    withDbRetrySync(
      () => this.sqlite.run(`
        INSERT OR REPLACE INTO nodes_fts(rowid, id, name)
        SELECT rowid, id, name FROM nodes WHERE name IS NOT NULL
      `),
      "initializeFTS populate"
    );
  }

  /**
   * Check if FTS5 index exists
   */
  async hasFTSIndex(): Promise<boolean> {
    try {
      const result = withDbRetrySync(
        () => this.sqlite
          .query("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'")
          .get(),
        "hasFTSIndex"
      );
      return result !== null;
    } catch {
      return false;
    }
  }

  /**
   * Full-text search on node names
   */
  async searchNodes(
    query: string,
    options?: {
      limit?: number;
      createdAfter?: number;
      createdBefore?: number;
      updatedAfter?: number;
      updatedBefore?: number;
    }
  ): Promise<SearchResult[]> {
    const limit = options?.limit || 50;

    // Escape query for FTS5 syntax - prevents words like "semantic" being
    // interpreted as column names or operators (AND, OR, NOT, NEAR)
    const escapedQuery = escapeFTS5Query(query);

    // Build WHERE conditions (FTS MATCH is special, handle separately)
    const conditions = ["nodes_fts MATCH ?"];
    const params: (string | number)[] = [escapedQuery];

    if (options?.createdAfter) {
      conditions.push("nodes.created > ?");
      params.push(options.createdAfter);
    }
    if (options?.createdBefore) {
      conditions.push("nodes.created < ?");
      params.push(options.createdBefore);
    }
    if (options?.updatedAfter) {
      conditions.push("nodes.updated IS NOT NULL AND nodes.updated > ?");
      params.push(options.updatedAfter);
    }
    if (options?.updatedBefore) {
      conditions.push("nodes.updated IS NOT NULL AND nodes.updated < ?");
      params.push(options.updatedBefore);
    }

    // Build query with pagination
    const pagination = buildPagination({ limit });
    const sqlParts = [
      `SELECT
          nodes.id,
          nodes.name,
          nodes.parent_id as parentId,
          nodes.node_type as nodeType,
          nodes.created,
          nodes.updated,
          nodes.raw_data as rawData,
          rank
        FROM nodes_fts
        JOIN nodes ON nodes.id = nodes_fts.id
        WHERE ${conditions.join(" AND ")}
        ORDER BY rank`,
    ];

    if (pagination.sql) {
      sqlParts.push(pagination.sql);
      params.push(...(pagination.params as (string | number)[]));
    }

    const result = withDbRetrySync(
      () => this.sqlite.query(sqlParts.join(" ")).all(...params) as SearchResult[],
      "searchNodes"
    );

    return result;
  }

  /**
   * Find recently updated nodes
   */
  async findRecentlyUpdated(
    limit: number,
    options?: {
      createdAfter?: number;
      createdBefore?: number;
      updatedAfter?: number;
      updatedBefore?: number;
    }
  ): Promise<Node[]> {
    // Build WHERE conditions
    const conditions = ["updated IS NOT NULL"];
    const params: number[] = [];

    if (options?.createdAfter) {
      conditions.push("created > ?");
      params.push(options.createdAfter);
    }
    if (options?.createdBefore) {
      conditions.push("created < ?");
      params.push(options.createdBefore);
    }
    if (options?.updatedAfter) {
      conditions.push("updated > ?");
      params.push(options.updatedAfter);
    }
    if (options?.updatedBefore) {
      conditions.push("updated < ?");
      params.push(options.updatedBefore);
    }

    // Build query with ORDER BY and pagination
    const orderBy = buildOrderBy({ sort: "updated", direction: "DESC" }, []);
    const pagination = buildPagination({ limit });

    const sqlParts = [
      `SELECT
          id,
          name,
          parent_id as parentId,
          node_type as nodeType,
          created,
          updated,
          raw_data as rawData
        FROM nodes
        WHERE ${conditions.join(" AND ")}`,
      orderBy.sql,
    ];

    if (pagination.sql) {
      sqlParts.push(pagination.sql);
      params.push(...(pagination.params as number[]));
    }

    const result = withDbRetrySync(
      () => this.sqlite.query(sqlParts.join(" ")).all(...params) as Node[],
      "findRecentlyUpdated"
    );

    return result;
  }

  /**
   * Get database statistics
   */
  async getStatistics(): Promise<DatabaseStatistics> {
    const nodeCount = withDbRetrySync(
      () => this.sqlite
        .query("SELECT COUNT(*) as count FROM nodes")
        .get() as { count: number },
      "getStatistics nodeCount"
    );

    const supertagCount = withDbRetrySync(
      () => this.sqlite
        .query("SELECT COUNT(DISTINCT tag_name) as count FROM supertags")
        .get() as { count: number },
      "getStatistics supertagCount"
    );

    const fieldCount = withDbRetrySync(
      () => this.sqlite
        .query("SELECT COUNT(DISTINCT field_name) as count FROM fields")
        .get() as { count: number },
      "getStatistics fieldCount"
    );

    const refCount = withDbRetrySync(
      () => this.sqlite
        .query('SELECT COUNT(*) as count FROM "references"')
        .get() as { count: number },
      "getStatistics refCount"
    );

    return {
      totalNodes: nodeCount.count,
      totalSupertags: supertagCount.count,
      totalFields: fieldCount.count,
      totalReferences: refCount.count,
    };
  }

  /**
   * Find nodes that have a specific supertag applied
   * This queries the tag_applications table which maps nodes to their tags
   */
  async findNodesByTag(
    tagName: string,
    options?: {
      limit?: number;
      orderBy?: "created" | "updated";
      createdAfter?: number;
      createdBefore?: number;
      updatedAfter?: number;
      updatedBefore?: number;
    }
  ): Promise<Node[]> {
    const limit = options?.limit || 100;
    const orderByCol = options?.orderBy || "created";

    // Build WHERE conditions
    const conditions = ["ta.tag_name = ?"];
    const params: (string | number)[] = [tagName];

    if (options?.createdAfter) {
      conditions.push("n.created > ?");
      params.push(options.createdAfter);
    }
    if (options?.createdBefore) {
      conditions.push("n.created < ?");
      params.push(options.createdBefore);
    }
    if (options?.updatedAfter) {
      conditions.push("n.updated IS NOT NULL AND n.updated > ?");
      params.push(options.updatedAfter);
    }
    if (options?.updatedBefore) {
      conditions.push("n.updated IS NOT NULL AND n.updated < ?");
      params.push(options.updatedBefore);
    }

    // Build query with ORDER BY and pagination
    const orderBy = buildOrderBy({ sort: `n.${orderByCol}`, direction: "DESC" }, []);
    const pagination = buildPagination({ limit });

    const sqlParts = [
      `SELECT
          n.id,
          n.name,
          n.parent_id as parentId,
          n.node_type as nodeType,
          n.created,
          n.updated,
          n.raw_data as rawData
        FROM nodes n
        INNER JOIN tag_applications ta ON ta.data_node_id = n.id
        WHERE ${conditions.join(" AND ")}`,
      orderBy.sql,
    ];

    if (pagination.sql) {
      sqlParts.push(pagination.sql);
      params.push(...(pagination.params as (string | number)[]));
    }

    const result = withDbRetrySync(
      () => this.sqlite.query(sqlParts.join(" ")).all(...params) as Node[],
      "findNodesByTag"
    );

    return result;
  }

  /**
   * Get tag application counts (how many nodes have each tag)
   */
  async getTagApplicationCounts(): Promise<SupertagCount[]> {
    const result = withDbRetrySync(
      () => this.sqlite
        .query(
          `
        SELECT
          tag_name as tagName,
          tag_id as tagId,
          COUNT(DISTINCT data_node_id) as count
        FROM tag_applications
        GROUP BY tag_name, tag_id
        ORDER BY count DESC
      `
        )
        .all() as SupertagCount[],
      "getTagApplicationCounts"
    );

    return result;
  }

  /**
   * Get top N tags by application count
   */
  async getTopTagsByUsage(limit: number): Promise<SupertagCount[]> {
    const counts = await this.getTagApplicationCounts();
    return counts.slice(0, limit);
  }

  /**
   * Get tags applied to a specific node
   */
  getNodeTags(nodeId: string): string[] {
    const result = withDbRetrySync(
      () => this.sqlite
        .query("SELECT tag_name FROM tag_applications WHERE data_node_id = ?")
        .all(nodeId) as Array<{ tag_name: string }>,
      "getNodeTags"
    );

    return result.map((r) => r.tag_name);
  }

  /**
   * Get related nodes in a single direction with type filtering.
   * Used for graph traversal (Spec 065).
   *
   * @param nodeId - Source node ID
   * @param direction - 'in' (nodes pointing to this), 'out' (this points to)
   * @param types - Relationship types to include
   * @param limit - Maximum results
   * @returns Array of related node IDs with relationship type
   */
  async getRelatedNodes(
    nodeId: string,
    direction: 'in' | 'out',
    types: RelationshipType[],
    limit: number
  ): Promise<RelatedNodeResult[]> {
    const results: RelatedNodeResult[] = [];
    const includeField = types.includes('field');

    // Map RelationshipType to database reference_type values for references table
    const dbTypes: string[] = [];
    for (const t of types) {
      if (t === 'reference') {
        dbTypes.push('inline_ref');
      } else if (t === 'child' || t === 'parent') {
        dbTypes.push(t);
      }
      // 'field' type is handled separately via field_values table
    }

    // Query references table for inline_ref, child, parent types
    if (dbTypes.length > 0) {
      const query = direction === 'out'
        ? this.sqlite.prepare(`
            SELECT to_node as nodeId, reference_type as refType
            FROM "references"
            WHERE from_node = ? AND reference_type IN (${dbTypes.map(() => '?').join(',')})
            LIMIT ?
          `)
        : this.sqlite.prepare(`
            SELECT from_node as nodeId, reference_type as refType
            FROM "references"
            WHERE to_node = ? AND reference_type IN (${dbTypes.map(() => '?').join(',')})
            LIMIT ?
          `);

      const params = [nodeId, ...dbTypes, limit];
      const rows = query.all(...params) as Array<{ nodeId: string; refType: string }>;

      // Map database types back to RelationshipType
      for (const row of rows) {
        results.push({
          nodeId: row.nodeId,
          type: mapDbType(row.refType),
        });
      }
    }

    // Query field_values table for field references
    if (includeField) {
      const remainingLimit = limit - results.length;
      if (remainingLimit > 0) {
        // direction='out': Find nodes this node references via field values
        //   A uses F as "Topic" means A has outbound field reference to F
        //   Query: parent_id = nodeId → value_node_id
        // direction='in': Find nodes that reference this node via field values
        //   F is used by A means F has inbound field reference from A
        //   Query: value_node_id = nodeId → parent_id
        const fieldQuery = direction === 'out'
          ? this.sqlite.prepare(`
              SELECT DISTINCT value_node_id as nodeId
              FROM field_values
              WHERE parent_id = ?
              LIMIT ?
            `)
          : this.sqlite.prepare(`
              SELECT DISTINCT parent_id as nodeId
              FROM field_values
              WHERE value_node_id = ?
              LIMIT ?
            `);

        const fieldRows = fieldQuery.all(nodeId, remainingLimit) as Array<{ nodeId: string }>;

        for (const row of fieldRows) {
          results.push({
            nodeId: row.nodeId,
            type: 'field',
          });
        }
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
