/**
 * tana_stats Tool
 *
 * Get database statistics including total nodes, supertags, fields, and references,
 * plus sync freshness (when the index was last updated via full or delta sync).
 */

import { TanaQueryEngine } from '../../query/tana-query-engine.js';
import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import { getSyncStaleness } from '../../utils/sync-staleness.js';
import type { StatsInput } from '../schemas.js';

export interface StatsResult {
  workspace: string;
  totalNodes: number;
  totalSupertags: number;
  totalFields: number;
  totalReferences: number;
  /** ms epoch of last full export-based sync, or null if never run. */
  lastFullSync: number | null;
  /** ms epoch of last successful delta-sync via Local API, or null. */
  lastDeltaSync: number | null;
  /** Nodes touched by the most recent delta-sync (0 if none). */
  lastDeltaNodesCount: number;
  /** Seconds since the most recent sync of any kind (null = never synced). */
  secondsSinceLastSync: number | null;
  /** True if staleness exceeds the configured warning threshold. */
  isStale: boolean;
  /** Human-readable reason, present when isStale is true. */
  staleReason?: string;
}

export async function stats(input: StatsInput): Promise<StatsResult> {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });

  const engine = new TanaQueryEngine(workspace.dbPath);

  try {
    const statistics = await engine.getStatistics();
    const staleness = getSyncStaleness(workspace.dbPath);

    const result: StatsResult = {
      workspace: workspace.alias,
      ...statistics,
      lastFullSync: staleness.lastFullSync,
      lastDeltaSync: staleness.lastDeltaSync,
      lastDeltaNodesCount: staleness.lastDeltaNodesCount,
      secondsSinceLastSync: staleness.secondsSinceLastSync,
      isStale: staleness.isStale,
    };
    if (staleness.staleReason) {
      result.staleReason = staleness.staleReason;
    }
    return result;
  } finally {
    engine.close();
  }
}
