/**
 * tana_timeline and tana_recent Tools
 * Spec 066: Timeline & Temporal Queries
 *
 * Time-based queries for viewing activity over time periods.
 */

import { Database } from "bun:sqlite";
import type { TimelineInput, RecentInput } from "../schemas";
import { TimelineService } from "../../services/timeline-service";
import type {
  TimelineResponse,
  RecentResponse,
} from "../../query/timeline";
import { resolveWorkspaceContext } from "../../config/workspace-resolver";

/**
 * Execute timeline query
 *
 * Returns time-bucketed activity for a date range.
 *
 * @example
 * // Last 30 days, daily buckets
 * tana_timeline({ granularity: "day" })
 *
 * @example
 * // Last week of meetings, weekly view
 * tana_timeline({ from: "7d", tag: "meeting", granularity: "week" })
 *
 * @example
 * // December 2025 activity, monthly
 * tana_timeline({ from: "2025-12-01", to: "2025-12-31", granularity: "month" })
 */
export async function timeline(input: TimelineInput): Promise<{
  workspace: string;
  timeline: TimelineResponse;
}> {
  // Resolve workspace
  const wsContext = resolveWorkspaceContext({ workspace: input.workspace });

  // Open database
  const db = new Database(wsContext.dbPath, { readonly: true });
  const service = new TimelineService(db);

  try {
    const result = await service.timeline({
      from: input.from,
      to: input.to,
      granularity: input.granularity,
      tag: input.tag,
      limit: input.limit,
    });

    return {
      workspace: wsContext.alias,
      timeline: result,
    };
  } finally {
    db.close();
  }
}

/**
 * Execute recent items query
 *
 * Returns items created or updated in a recent time period.
 *
 * @example
 * // Last 24 hours activity
 * tana_recent({})
 *
 * @example
 * // Last week's meetings and tasks
 * tana_recent({ period: "7d", types: ["meeting", "task"] })
 *
 * @example
 * // Items created (not just updated) in last 3 days
 * tana_recent({ period: "3d", createdOnly: true })
 */
export async function recent(input: RecentInput): Promise<{
  workspace: string;
  recent: RecentResponse;
}> {
  // Resolve workspace
  const wsContext = resolveWorkspaceContext({ workspace: input.workspace });

  // Open database
  const db = new Database(wsContext.dbPath, { readonly: true });
  const service = new TimelineService(db);

  try {
    const result = await service.recent({
      period: input.period,
      types: input.types,
      createdOnly: input.createdOnly,
      updatedOnly: input.updatedOnly,
      limit: input.limit,
    });

    return {
      workspace: wsContext.alias,
      recent: result,
    };
  } finally {
    db.close();
  }
}
