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
  private service: DeltaSyncService;
  private paused = false;
  private wasHealthy = true;
  private lastResult: DeltaSyncResult | null = null;

  constructor(private options: DeltaSyncPollerOptions) {
    this.service = new DeltaSyncService({
      dbPath: options.dbPath,
      localApiClient: options.localApiClient,
      embeddingConfig: options.embeddingConfig,
      logger: options.logger,
    });
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
    this.service.close();
    this.options.logger?.info("Delta-sync poller stopped");
  }

  /**
   * Manually trigger an immediate sync cycle.
   * Does not require the poller to be started.
   */
  async triggerNow(): Promise<DeltaSyncResult> {
    const result = await this.service.sync();
    this.lastResult = result;
    return result;
  }

  /**
   * Check if a sync is currently in progress.
   */
  isSyncing(): boolean {
    return this.service.isSyncing();
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

      if (this.paused || this.service.isSyncing()) return;

      const result = await this.service.sync();
      this.lastResult = result;

      if (result.nodesFound > 0) {
        this.options.logger?.info("Delta-sync cycle complete", {
          nodesFound: result.nodesFound,
          inserted: result.nodesInserted,
          updated: result.nodesUpdated,
          durationMs: result.durationMs,
        });
      }
    } catch (error) {
      this.options.logger?.error("Delta-sync cycle failed", {
        error: String(error),
      });
      // Never crash - just log and continue polling
    }
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
