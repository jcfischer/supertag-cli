/**
 * Delta-Sync Poller (F-095, T-4.1)
 *
 * Background polling wrapper around DeltaSyncService.
 * Runs periodic delta-sync cycles in the MCP server process.
 *
 * Features:
 * - Configurable interval (minutes)
 * - Health-aware pause/resume (pauses when Tana Desktop unreachable)
 * - Error resilience (never crashes, logs and continues)
 * - Manual trigger via triggerNow()
 * - Last result tracking for status queries
 */

import { DeltaSyncService } from "../services/delta-sync";
import type {
  DeltaSyncOptions,
  DeltaSyncResult,
  SearchResultNode,
} from "../types/local-api";

// =============================================================================
// Types
// =============================================================================

/** Logger interface compatible with the project's unified Logger */
interface PollerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface DeltaSyncPollerOptions {
  /** Interval between sync cycles in minutes */
  intervalMinutes: number;
  /** Path to SQLite database */
  dbPath: string;
  /** Local API client (structural typing for testability) */
  localApiClient: {
    searchNodes(
      query: Record<string, unknown>,
      options?: { limit?: number; offset?: number },
    ): Promise<SearchResultNode[]>;
    health(): Promise<boolean>;
  };
  /** Embedding config (optional) */
  embeddingConfig?: { model: string; endpoint?: string };
  /** Logger (writes to stderr in MCP context) */
  logger?: PollerLogger;
  /** Service factory, called once per sync cycle (injectable for testing) */
  createService?: (options: DeltaSyncOptions) => DeltaSyncService;
}

/** Options for the MCP server initialization helper */
export interface InitDeltaSyncPollerOptions {
  localApiConfig: {
    enabled: boolean;
    bearerToken?: string;
    endpoint: string;
  };
  syncInterval: number;
  dbPath: string;
  embeddingConfig?: { model: string; endpoint?: string };
  logger?: PollerLogger;
  /** Factory for creating the local API client (injectable for testing) */
  localApiClientFactory?: (config: { endpoint: string; bearerToken: string }) => {
    searchNodes(
      query: Record<string, unknown>,
      options?: { limit?: number; offset?: number },
    ): Promise<SearchResultNode[]>;
    health(): Promise<boolean>;
  };
}

// =============================================================================
// DeltaSyncPoller
// =============================================================================

export class DeltaSyncPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  /** Service for the cycle in progress; null while idle, so no connection stays open between cycles (#107) */
  private active: DeltaSyncService | null = null;
  private paused = false;
  private wasHealthy = true;
  private lastResult: DeltaSyncResult | null = null;
  private tickCount = 0;
  private consecutiveFailures = 0;
  private lastErrorMessage: string | null = null;

  /**
   * After this many consecutive failures, escalate from a per-cycle error log
   * to a loud, actionable warning. Catches the "silently wedged for days"
   * failure mode (e.g. Tana Local API 500 on every cycle).
   */
  private static readonly FAILURE_ALERT_THRESHOLD = 3;

  /**
   * More poison nodes than this in one cycle is a cluster, not a stray bad
   * node: each costs its own bisection, and a cluster points at Tana Local API
   * degradation rather than one corrupt node.
   */
  private static readonly POISON_CLUSTER_THRESHOLD = 3;

  constructor(private options: DeltaSyncPollerOptions) {}

  /**
   * Run one sync cycle on a connection opened for this cycle only.
   *
   * The connection used to live as long as the MCP process. An idle
   * connection does not block a checkpoint, but one left inside a read
   * transaction would, for the whole session (#107). Closing it before the
   * poller goes idle rules that out. A cycle started
   * while another is running gets the in-progress service's skip result.
   */
  private async runCycle(): Promise<DeltaSyncResult> {
    if (this.active) return this.active.sync();

    const serviceOptions: DeltaSyncOptions = {
      dbPath: this.options.dbPath,
      localApiClient: this.options.localApiClient,
      embeddingConfig: this.options.embeddingConfig,
      logger: this.options.logger,
    };
    const service = this.options.createService
      ? this.options.createService(serviceOptions)
      : new DeltaSyncService(serviceOptions);
    this.active = service;
    try {
      return await service.sync();
    } finally {
      this.active = null;
      service.close();
    }
  }

  /**
   * Start the background polling interval.
   * Idempotent: calling start() when already running is a no-op.
   */
  start(): void {
    if (this.interval) return; // Already started

    const ms = this.options.intervalMinutes * 60 * 1000;
    this.interval = setInterval(() => this.tick(), ms);

    this.options.logger?.info("Delta-sync poller started", {
      intervalMinutes: this.options.intervalMinutes,
    });
  }

  /**
   * Stop the background polling interval and clean up resources.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.tickCount = 0;
    this.options.logger?.info("Delta-sync poller stopped");
  }

  /**
   * Manually trigger an immediate sync cycle.
   * Does not require the poller to be started.
   */
  async triggerNow(): Promise<DeltaSyncResult> {
    const result = await this.runCycle();
    this.lastResult = result;
    this.consecutiveFailures = 0;
    this.lastErrorMessage = null;
    return result;
  }

  /**
   * Check if a sync is currently in progress.
   */
  isSyncing(): boolean {
    return this.active?.isSyncing() ?? false;
  }

  /**
   * Check if the polling interval is active.
   */
  isRunning(): boolean {
    return this.interval !== null;
  }

  /**
   * Get the result of the last completed sync cycle.
   * Returns null if no sync has completed yet.
   */
  getLastResult(): DeltaSyncResult | null {
    return this.lastResult;
  }

  /**
   * Execute a single tick of the polling cycle.
   *
   * 1. Health check: pause if Tana Desktop unreachable, resume when back
   * 2. Skip if paused or already syncing
   * 3. Run sync and log results
   *
   * NEVER throws -- all errors are caught and logged.
   */
  async tick(): Promise<void> {
    try {
      // Health check
      const healthy = await this.options.localApiClient.health();

      if (!healthy && this.wasHealthy) {
        this.options.logger?.warn(
          "Tana Desktop unreachable - pausing delta-sync"
        );
        this.paused = true;
        this.wasHealthy = false;
        return;
      }

      if (healthy && !this.wasHealthy) {
        this.options.logger?.info(
          "Tana Desktop reconnected - resuming delta-sync"
        );
        this.paused = false;
        this.wasHealthy = true;
      }

      if (this.paused || this.isSyncing()) return;

      this.tickCount++;

      const result = await this.runCycle();
      this.lastResult = result;

      // A completed cycle (even one that only skipped poison nodes) clears the
      // failure streak — sync is unwedged and making progress again.
      this.consecutiveFailures = 0;
      this.lastErrorMessage = null;

      if (result.poisonNodesSkipped > DeltaSyncPoller.POISON_CLUSTER_THRESHOLD) {
        this.options.logger?.warn(
          `Delta-sync skipped a cluster of ${result.poisonNodesSkipped} nodes that crash ` +
            "Tana Local API search (HTTP 500) in one cycle. Tana's Local API may be degraded. " +
            "Run 'supertag sync index' for a full re-sync to capture them.",
          { poisonNodesSkipped: result.poisonNodesSkipped }
        );
      } else if (result.poisonNodesSkipped > 0) {
        this.options.logger?.warn(
          "Delta-sync skipped node(s) that crash Tana Local API search (HTTP 500). " +
            "Run 'supertag sync index' for a full re-sync to capture them.",
          { poisonNodesSkipped: result.poisonNodesSkipped }
        );
      }

      if (result.nodesFound > 0) {
        this.options.logger?.info("Delta-sync cycle complete", {
          nodesFound: result.nodesFound,
          inserted: result.nodesInserted,
          updated: result.nodesUpdated,
          durationMs: result.durationMs,
        });
      }
    } catch (error) {
      this.consecutiveFailures++;
      this.lastErrorMessage = String(error);
      this.options.logger?.error("Delta-sync cycle failed", {
        error: String(error),
        consecutiveFailures: this.consecutiveFailures,
      });

      // Escalate once the streak crosses the threshold so a persistent wedge
      // (e.g. Tana 500 on every cycle) can't run unnoticed for days.
      if (this.consecutiveFailures >= DeltaSyncPoller.FAILURE_ALERT_THRESHOLD) {
        this.options.logger?.error(
          `Delta-sync has failed ${this.consecutiveFailures} cycles in a row. ` +
            "Tana's Local API may be rejecting the request (e.g. HTTP 500). " +
            "Run 'supertag sync index' for a full re-sync to recover.",
          { consecutiveFailures: this.consecutiveFailures }
        );
      }
      // Never crash - just log and continue polling
    }
  }

  /**
   * Failure-streak state for status reporting. `consecutiveFailures` resets to
   * 0 on any completed cycle; a non-zero value means delta-sync is currently
   * wedged and `lastErrorMessage` holds the most recent failure.
   */
  getFailureState(): { consecutiveFailures: number; lastErrorMessage: string | null } {
    return {
      consecutiveFailures: this.consecutiveFailures,
      lastErrorMessage: this.lastErrorMessage,
    };
  }
}

// =============================================================================
// MCP Server Initialization Helper (T-4.2)
// =============================================================================

/**
 * Initialize the delta-sync poller for the MCP server.
 *
 * Returns null if:
 * - Local API is not enabled
 * - Bearer token is missing or empty
 * - Sync interval is 0 (disabled)
 *
 * Otherwise creates, starts, and returns the poller.
 */
export function initDeltaSyncPoller(
  options: InitDeltaSyncPollerOptions
): DeltaSyncPoller | null {
  const { localApiConfig, syncInterval, dbPath, embeddingConfig, logger } =
    options;

  // Guard: local API must be enabled
  if (!localApiConfig.enabled) {
    return null;
  }

  // Guard: bearer token must be present and non-empty
  if (!localApiConfig.bearerToken) {
    return null;
  }

  // Guard: interval must be > 0
  if (syncInterval <= 0) {
    return null;
  }

  // Create the local API client
  const clientFactory =
    options.localApiClientFactory ??
    ((_config: { endpoint: string; bearerToken: string }) => {
      // Dynamic import would be used in production but for tests we use the factory
      throw new Error(
        "No localApiClientFactory provided and dynamic import not available in this context"
      );
    });

  const localApiClient = clientFactory({
    endpoint: localApiConfig.endpoint,
    bearerToken: localApiConfig.bearerToken,
  });

  // Create and start poller
  const poller = new DeltaSyncPoller({
    intervalMinutes: syncInterval,
    dbPath,
    localApiClient,
    embeddingConfig,
    logger,
  });

  poller.start();

  logger?.info("Delta-sync poller initialized", {
    intervalMinutes: syncInterval,
  });

  return poller;
}
