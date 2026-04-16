/**
 * Sync Staleness Helper
 *
 * Reads last-sync timestamps from a workspace database and reports
 * whether the local index is stale relative to configurable thresholds.
 *
 * Used by `tana_stats` (surface timestamps) and `tana_query`
 * (emit staleness warnings on results).
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

export interface SyncStaleness {
  /** ms epoch of last full export-based sync (null = never). */
  lastFullSync: number | null;
  /** ms epoch of last successful delta-sync via Local API (null = never). */
  lastDeltaSync: number | null;
  /** Number of nodes touched by the most recent delta-sync. */
  lastDeltaNodesCount: number;
  /** Seconds since the most recent sync of any kind (null = never synced). */
  secondsSinceLastSync: number | null;
  /** True if staleness exceeds the configured warning threshold. */
  isStale: boolean;
  /** Human-readable reason when isStale is true. */
  staleReason: string | null;
}

/**
 * Env-configurable thresholds. Defaults chosen so silent staleness is surfaced
 * before it can cause real data decisions downstream, but not so tight that a
 * developer running one-off queries gets nagged constantly.
 *
 * - SUPERTAG_STALE_DELTA_MINUTES (default 60): warn if newest sync older than N min
 * - SUPERTAG_STALE_FULL_HOURS (default 168 = 7d): warn if full sync older than N h
 */
function parsePositiveFinite(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getThresholds(): { deltaMinutes: number; fullHours: number } {
  return {
    deltaMinutes: parsePositiveFinite(process.env.SUPERTAG_STALE_DELTA_MINUTES, 60),
    fullHours: parsePositiveFinite(process.env.SUPERTAG_STALE_FULL_HOURS, 168),
  };
}

/**
 * Read sync staleness from a workspace database.
 *
 * Never throws — if the database or sync_metadata table is missing,
 * returns an all-null result with isStale=true (unknown age is stale).
 */
export function getSyncStaleness(dbPath: string): SyncStaleness {
  const empty: SyncStaleness = {
    lastFullSync: null,
    lastDeltaSync: null,
    lastDeltaNodesCount: 0,
    secondsSinceLastSync: null,
    isStale: true,
    staleReason: "No sync has ever completed for this workspace",
  };

  if (!existsSync(dbPath)) {
    return empty;
  }

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });

    const tableRow = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_metadata'")
      .get() as { name: string } | null;
    if (!tableRow) return empty;

    const cols = db.query("PRAGMA table_info(sync_metadata)").all() as Array<{ name: string }>;
    const hasDelta = cols.some((c) => c.name === "delta_sync_timestamp");
    const hasDeltaCount = cols.some((c) => c.name === "delta_nodes_synced");

    const row = db
      .query(
        `SELECT last_sync_timestamp${hasDelta ? ", delta_sync_timestamp" : ""}${hasDeltaCount ? ", delta_nodes_synced" : ""} FROM sync_metadata WHERE id = 1`
      )
      .get() as {
      last_sync_timestamp: number;
      delta_sync_timestamp?: number | null;
      delta_nodes_synced?: number | null;
    } | null;

    if (!row) return empty;

    const lastFullSync = row.last_sync_timestamp > 0 ? row.last_sync_timestamp : null;
    const lastDeltaSync = row.delta_sync_timestamp ?? null;
    const lastDeltaNodesCount = row.delta_nodes_synced ?? 0;

    // Newest sync of any kind
    const newest = Math.max(lastFullSync ?? 0, lastDeltaSync ?? 0);
    const secondsSinceLastSync = newest > 0 ? Math.floor((Date.now() - newest) / 1000) : null;

    const { deltaMinutes, fullHours } = getThresholds();
    // Collect every applicable reason independently, then pick the most
    // severe. The full-sync-age check must NOT be gated behind the
    // delta-age check — they describe different failure modes:
    //   - delta-age stale: index is generally behind reality
    //   - full-sync-age stale: field_values are drifting (delta-sync can't
    //     repopulate them), so field-filtered queries are incorrect
    // A fresh delta-sync does not fix the second problem.
    const reasons: string[] = [];

    if (secondsSinceLastSync === null) {
      reasons.push("No sync has ever completed for this workspace");
    } else if (secondsSinceLastSync > deltaMinutes * 60) {
      const minutes = Math.floor(secondsSinceLastSync / 60);
      reasons.push(
        `Index last synced ${formatDuration(minutes)} ago (threshold: ${deltaMinutes}m). Run 'supertag sync index --delta' or 'supertag sync index' to refresh.`
      );
    }

    if (lastFullSync === null) {
      // Only emit the "never full-synced" warning when we have *some* sync
      // (a fresh delta without a full sync is its own correctness problem).
      // The all-null case is already covered by the reasons.push above.
      if (lastDeltaSync !== null) {
        reasons.push(
          "Full sync has never run for this workspace. Delta-sync cannot repopulate field values — field-filtered queries may be incorrect. Run 'supertag sync index' to fix."
        );
      }
    } else if (Date.now() - lastFullSync > fullHours * 3600 * 1000) {
      const hours = Math.floor((Date.now() - lastFullSync) / 3600000);
      reasons.push(
        `Last full sync was ${formatDuration(hours * 60)} ago (threshold: ${fullHours}h). Delta-sync cannot repopulate field values — field-filtered results may be stale. Run 'supertag sync index' to refresh.`
      );
    }

    const isStale = reasons.length > 0;
    const staleReason = isStale ? reasons.join(" ") : null;

    return {
      lastFullSync,
      lastDeltaSync,
      lastDeltaNodesCount,
      secondsSinceLastSync,
      isStale,
      staleReason,
    };
  } catch {
    return empty;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

/** Format a count of minutes into a short human-readable string. */
function formatDuration(minutes: number): string {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
