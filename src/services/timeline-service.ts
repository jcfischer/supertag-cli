/**
 * Timeline Service
 * Spec: 066-timeline-queries
 *
 * Database queries for timeline and recent items.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { buildPagination } from "../db/query-builder";
import {
  type TimelineQuery,
  type TimelineResponse,
  type TimeBucket,
  type TimelineItem,
  type RecentQuery,
  type RecentResponse,
  type TimeGranularity,
  getBucketKey,
  getBucketRange,
  generateBucketKeys,
  resolveTimelineRange,
  formatTimestamp,
  parsePeriodToMs,
  VALID_GRANULARITIES,
} from "../query/timeline";

/**
 * Raw node row from database
 */
interface NodeRow {
  id: string;
  name: string | null;
  created: number | null;
  updated: number | null;
  tag_name?: string | null;
}

/**
 * Internal item with raw timestamps for bucketing
 */
interface InternalItem {
  id: string;
  name: string;
  created: number | null;
  updated: number | null;
  tag?: string;
}

/**
 * Timeline Service
 *
 * Executes timeline and recent item queries against the database.
 */
export class TimelineService {
  constructor(private db: Database) {}

  /**
   * Execute a timeline query
   *
   * Returns time-bucketed results with items grouped by granularity.
   */
  async timeline(query: TimelineQuery): Promise<TimelineResponse> {
    const granularity = query.granularity ?? "day";
    const limitPerBucket = query.limit ?? 10;

    // Validate granularity
    if (!VALID_GRANULARITIES.includes(granularity)) {
      throw new Error(
        `Invalid granularity: "${granularity}". Allowed: ${VALID_GRANULARITIES.join(", ")}`
      );
    }

    // Resolve date range
    const { fromTs, toTs, warnings } = resolveTimelineRange(query);

    // Generate all bucket keys for the range (includes empty buckets)
    const allBucketKeys = generateBucketKeys(fromTs, toTs, granularity);

    // Query items in date range (raw timestamps)
    const rawItems = this.queryItemsInRangeRaw(fromTs, toTs, query.tag);

    // Group items by bucket (using raw timestamps)
    const bucketMap = new Map<string, InternalItem[]>();

    // Initialize all buckets (for empty bucket support)
    for (const key of allBucketKeys) {
      bucketMap.set(key, []);
    }

    // Assign items to buckets
    for (const item of rawItems) {
      if (!item.created) continue;

      const bucketKey = getBucketKey(item.created, granularity);
      const bucket = bucketMap.get(bucketKey);
      if (bucket) {
        bucket.push(item);
      }
    }

    // Build response buckets (convert to TimelineItem format)
    let totalCount = 0;
    const buckets: TimeBucket[] = [];

    for (const key of allBucketKeys) {
      const bucketItems = bucketMap.get(key) ?? [];
      const range = getBucketRange(key, granularity);

      const truncated = bucketItems.length > limitPerBucket;
      const displayItems = truncated ? bucketItems.slice(0, limitPerBucket) : bucketItems;

      totalCount += bucketItems.length;

      // Convert internal items to TimelineItem format
      const formattedItems: TimelineItem[] = displayItems.map((item) => ({
        id: item.id,
        name: item.name,
        created: formatTimestamp(item.created),
        updated: formatTimestamp(item.updated),
        ...(item.tag ? { tag: item.tag } : {}),
      }));

      buckets.push({
        key,
        start: range.start,
        end: range.end,
        count: bucketItems.length,
        items: formattedItems,
        ...(truncated ? { truncated: true } : {}),
      });
    }

    return {
      from: new Date(fromTs).toISOString().slice(0, 10),
      to: new Date(toTs).toISOString().slice(0, 10),
      granularity,
      buckets,
      totalCount,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * Execute a recent items query
   *
   * Returns items ordered by most recent activity.
   */
  async recent(query: RecentQuery): Promise<RecentResponse> {
    const period = query.period ?? "24h";
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    // Calculate time range
    let periodMs: number;
    try {
      periodMs = parsePeriodToMs(period);
    } catch {
      throw new Error(
        `Invalid period format: "${period}". Expected: Nh (hours), Nd (days), Nw (weeks), Nm (months), Ny (years)`
      );
    }

    const now = Date.now();
    const fromTs = now - periodMs;

    // Build query
    const params: SQLQueryBindings[] = [];
    const conditions: string[] = [];
    const joins: string[] = [];

    // Time conditions based on flags
    if (query.createdOnly) {
      conditions.push("n.created >= ?");
      params.push(fromTs);
    } else if (query.updatedOnly) {
      conditions.push("n.updated >= ?");
      params.push(fromTs);
    } else {
      // Either created or updated in period
      conditions.push("(n.created >= ? OR n.updated >= ?)");
      params.push(fromTs, fromTs);
    }

    // Filter by supertag types
    if (query.types && query.types.length > 0) {
      joins.push("INNER JOIN tag_applications ta ON ta.data_node_id = n.id");
      const placeholders = query.types.map(() => "?").join(", ");
      conditions.push(`ta.tag_name IN (${placeholders})`);
      params.push(...query.types);
    }

    // Build SQL
    const selectClause = `
      SELECT DISTINCT
        n.id,
        n.name,
        n.created,
        n.updated
        ${query.types ? ", ta.tag_name" : ""}
    `;

    const sql = `
      ${selectClause}
      FROM nodes n
      ${joins.join(" ")}
      WHERE ${conditions.join(" AND ")}
        AND n.node_type = 'node'
      ORDER BY COALESCE(n.updated, n.created) DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    // Execute query
    const rows = this.db.query(sql).all(...params) as NodeRow[];

    // Count total and excluded
    const countSql = `
      SELECT COUNT(DISTINCT n.id) as total
      FROM nodes n
      ${joins.join(" ")}
      WHERE ${conditions.join(" AND ")}
        AND n.node_type = 'node'
    `;
    const countParams = params.slice(0, -2); // Remove LIMIT/OFFSET
    const countResult = this.db.query(countSql).get(...countParams) as { total: number };

    // Count items with missing timestamps (for warning)
    const excludedSql = `
      SELECT COUNT(*) as excluded
      FROM nodes n
      WHERE n.node_type = 'node'
        AND n.created IS NULL
    `;
    const excludedResult = this.db.query(excludedSql).get() as { excluded: number };

    // Transform to response items
    const items: TimelineItem[] = rows.map((row) => ({
      id: row.id,
      name: row.name ?? "",
      created: formatTimestamp(row.created),
      updated: formatTimestamp(row.updated),
      ...(row.tag_name ? { tag: row.tag_name } : {}),
    }));

    return {
      period,
      items,
      count: countResult.total,
      ...(excludedResult.excluded > 0 ? { excludedCount: excludedResult.excluded } : {}),
    };
  }

  /**
   * Query items in a date range (returns raw timestamps)
   */
  private queryItemsInRangeRaw(
    fromTs: number,
    toTs: number,
    tag?: string
  ): InternalItem[] {
    const params: SQLQueryBindings[] = [fromTs, toTs];
    const joins: string[] = [];
    const conditions: string[] = ["n.created >= ?", "n.created <= ?"];

    if (tag) {
      joins.push("INNER JOIN tag_applications ta ON ta.data_node_id = n.id");
      conditions.push("ta.tag_name = ?");
      params.push(tag);
    }

    const sql = `
      SELECT DISTINCT
        n.id,
        n.name,
        n.created,
        n.updated
        ${tag ? ", ta.tag_name" : ""}
      FROM nodes n
      ${joins.join(" ")}
      WHERE ${conditions.join(" AND ")}
        AND n.node_type = 'node'
      ORDER BY n.created DESC
    `;

    const rows = this.db.query(sql).all(...params) as NodeRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name ?? "",
      created: row.created,
      updated: row.updated,
      ...(row.tag_name ? { tag: row.tag_name } : {}),
    }));
  }
}
