/**
 * Timeline Query Engine
 * Spec: 066-timeline-queries
 *
 * Time-bucketed queries for nodes with granularity options:
 * hour, day, week, month, quarter, year
 */

import { parseDateValue, isRelativeDateValue } from "./date-resolver";

/**
 * Granularity levels for timeline bucketing
 */
export type TimeGranularity = "hour" | "day" | "week" | "month" | "quarter" | "year";

/**
 * Timeline query parameters
 */
export interface TimelineQuery {
  /** Filter by supertag (optional) */
  tag?: string;
  /** Start date (ISO or relative like "30d", "1m") */
  from?: string | number;
  /** End date (ISO or relative like "today") */
  to?: string | number;
  /** Time bucket granularity */
  granularity?: TimeGranularity;
  /** Max items per bucket */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * A single time bucket in timeline results
 */
export interface TimeBucket {
  /** Bucket identifier (format depends on granularity) */
  key: string;
  /** Start of period (ISO date) */
  start: string;
  /** End of period (ISO date) */
  end: string;
  /** Count of items in bucket */
  count: number;
  /** Items in this bucket (may be truncated) */
  items: TimelineItem[];
  /** True if items were truncated due to limit */
  truncated?: boolean;
}

/**
 * A node item in timeline results
 */
export interface TimelineItem {
  /** Node ID */
  id: string;
  /** Node name */
  name: string;
  /** Creation timestamp (ISO) */
  created?: string;
  /** Last update timestamp (ISO) */
  updated?: string;
  /** Supertag name if applicable */
  tag?: string;
}

/**
 * Timeline query response
 */
export interface TimelineResponse {
  /** Start of queried range (ISO date) */
  from: string;
  /** End of queried range (ISO date) */
  to: string;
  /** Granularity used */
  granularity: TimeGranularity;
  /** Time buckets with items */
  buckets: TimeBucket[];
  /** Total items across all buckets */
  totalCount: number;
  /** Any warnings encountered */
  warnings?: string[];
}

/**
 * Recent items query parameters
 */
export interface RecentQuery {
  /** Time period (e.g., "24h", "7d", "1w") */
  period?: string;
  /** Filter by supertag names */
  types?: string[];
  /** Include only created items (not updated) */
  createdOnly?: boolean;
  /** Include only updated items (not created) */
  updatedOnly?: boolean;
  /** Max items to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Recent items response
 */
export interface RecentResponse {
  /** Period queried */
  period: string;
  /** Items ordered by most recent activity */
  items: TimelineItem[];
  /** Total count of items */
  count: number;
  /** Count of items excluded due to missing timestamps */
  excludedCount?: number;
}

// Valid granularity values for validation
export const VALID_GRANULARITIES: TimeGranularity[] = [
  "hour", "day", "week", "month", "quarter", "year"
];

/**
 * Parse a period string like "24h", "7d", "1w" to milliseconds
 * Different from date-resolver which returns absolute timestamps
 */
export function parsePeriodToMs(period: string): number {
  // Match format: Nh, Nd, Nw, Nm, Ny
  const match = period.match(/^(\d+)([hdwmy])$/);
  if (!match) {
    throw new Error(
      `Invalid period format: "${period}". Expected: Nh (hours), Nd (days), Nw (weeks), Nm (months), Ny (years)`
    );
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  const MS_HOUR = 60 * 60 * 1000;
  const MS_DAY = 24 * MS_HOUR;
  const MS_WEEK = 7 * MS_DAY;
  const MS_MONTH = 30 * MS_DAY; // Approximate
  const MS_YEAR = 365 * MS_DAY; // Approximate

  switch (unit) {
    case "h":
      return amount * MS_HOUR;
    case "d":
      return amount * MS_DAY;
    case "w":
      return amount * MS_WEEK;
    case "m":
      return amount * MS_MONTH;
    case "y":
      return amount * MS_YEAR;
    default:
      throw new Error(`Unknown period unit: ${unit}`);
  }
}

/**
 * Get start of day (midnight UTC) for a date
 */
function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Get start of hour for a date
 */
function startOfHour(date: Date): Date {
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);
  return result;
}

/**
 * Get ISO week number and year for a date
 * Returns { year, week } following ISO 8601
 */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday (ISO week starts Monday)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

/**
 * Get quarter number (1-4) for a date
 */
function getQuarter(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

/**
 * Generate bucket key based on granularity
 */
export function getBucketKey(timestamp: number, granularity: TimeGranularity): string {
  const date = new Date(timestamp);

  switch (granularity) {
    case "hour": {
      // Format: 2025-12-31T14:00:00
      const d = startOfHour(date);
      return d.toISOString().slice(0, 19);
    }
    case "day": {
      // Format: 2025-12-31
      return date.toISOString().slice(0, 10);
    }
    case "week": {
      // Format: 2025-W52
      const { year, week } = getISOWeek(date);
      return `${year}-W${week.toString().padStart(2, "0")}`;
    }
    case "month": {
      // Format: 2025-12
      return date.toISOString().slice(0, 7);
    }
    case "quarter": {
      // Format: 2025-Q4
      const q = getQuarter(date);
      return `${date.getUTCFullYear()}-Q${q}`;
    }
    case "year": {
      // Format: 2025
      return String(date.getUTCFullYear());
    }
    default:
      throw new Error(`Unknown granularity: ${granularity}`);
  }
}

/**
 * Get bucket start and end dates for a bucket key
 */
export function getBucketRange(key: string, granularity: TimeGranularity): { start: string; end: string } {
  switch (granularity) {
    case "hour": {
      // Key: 2025-12-31T14:00:00
      const start = new Date(key + "Z");
      const end = new Date(start.getTime() + 60 * 60 * 1000 - 1);
      return {
        start: start.toISOString().slice(0, 19),
        end: end.toISOString().slice(0, 19),
      };
    }
    case "day": {
      // Key: 2025-12-31
      const start = new Date(key + "T00:00:00Z");
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
      return {
        start: key,
        end: key,
      };
    }
    case "week": {
      // Key: 2025-W52
      const match = key.match(/^(\d+)-W(\d+)$/);
      if (!match) throw new Error(`Invalid week key: ${key}`);
      const year = parseInt(match[1], 10);
      const week = parseInt(match[2], 10);
      // Calculate Monday of the given week
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const dayOfWeek = jan4.getUTCDay() || 7;
      const mondayWeek1 = new Date(jan4.getTime() - (dayOfWeek - 1) * 86400000);
      const start = new Date(mondayWeek1.getTime() + (week - 1) * 7 * 86400000);
      const end = new Date(start.getTime() + 6 * 86400000);
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    }
    case "month": {
      // Key: 2025-12
      const [year, month] = key.split("-").map(Number);
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 0)); // Last day of month
      return {
        start: key + "-01",
        end: end.toISOString().slice(0, 10),
      };
    }
    case "quarter": {
      // Key: 2025-Q4
      const match = key.match(/^(\d+)-Q([1-4])$/);
      if (!match) throw new Error(`Invalid quarter key: ${key}`);
      const year = parseInt(match[1], 10);
      const quarter = parseInt(match[2], 10);
      const startMonth = (quarter - 1) * 3;
      const endMonth = startMonth + 2;
      const start = new Date(Date.UTC(year, startMonth, 1));
      const end = new Date(Date.UTC(year, endMonth + 1, 0)); // Last day of quarter
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    }
    case "year": {
      // Key: 2025
      return {
        start: `${key}-01-01`,
        end: `${key}-12-31`,
      };
    }
    default:
      throw new Error(`Unknown granularity: ${granularity}`);
  }
}

/**
 * Generate all bucket keys between two timestamps for a given granularity
 * Includes empty buckets for visualization
 */
export function generateBucketKeys(
  fromTs: number,
  toTs: number,
  granularity: TimeGranularity
): string[] {
  const keys: string[] = [];
  let current = fromTs;

  // Clamp to start of period
  switch (granularity) {
    case "hour":
      current = startOfHour(new Date(current)).getTime();
      break;
    case "day":
    case "week":
    case "month":
    case "quarter":
    case "year":
      current = startOfDay(new Date(current)).getTime();
      break;
  }

  while (current <= toTs) {
    const key = getBucketKey(current, granularity);
    if (!keys.includes(key)) {
      keys.push(key);
    }

    // Advance to next period
    const date = new Date(current);
    switch (granularity) {
      case "hour":
        current += 60 * 60 * 1000;
        break;
      case "day":
        current += 24 * 60 * 60 * 1000;
        break;
      case "week":
        current += 7 * 24 * 60 * 60 * 1000;
        break;
      case "month":
        date.setUTCMonth(date.getUTCMonth() + 1);
        current = date.getTime();
        break;
      case "quarter":
        date.setUTCMonth(date.getUTCMonth() + 3);
        current = date.getTime();
        break;
      case "year":
        date.setUTCFullYear(date.getUTCFullYear() + 1);
        current = date.getTime();
        break;
    }
  }

  return keys;
}

/**
 * Resolve timeline query dates
 * Handles relative dates, defaults, and validation
 */
export function resolveTimelineRange(query: TimelineQuery): {
  fromTs: number;
  toTs: number;
  warnings: string[];
} {
  const warnings: string[] = [];
  const now = Date.now();

  // Default: last 30 days
  let fromTs = query.from !== undefined ? parseDateValue(query.from) : now - 30 * 24 * 60 * 60 * 1000;
  let toTs = query.to !== undefined ? parseDateValue(query.to) : now;

  // Swap if from > to
  if (fromTs > toTs) {
    warnings.push(`from (${new Date(fromTs).toISOString()}) is after to (${new Date(toTs).toISOString()}), swapped`);
    [fromTs, toTs] = [toTs, fromTs];
  }

  // Clamp future dates to now
  if (toTs > now) {
    warnings.push(`to date in future, clamped to today`);
    toTs = now;
  }

  return { fromTs, toTs, warnings };
}

/**
 * Format timestamp as ISO date string
 */
export function formatTimestamp(ts: number | null | undefined): string | undefined {
  if (ts === null || ts === undefined) return undefined;
  return new Date(ts).toISOString();
}
