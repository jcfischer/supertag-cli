/**
 * WatchService (F-103 T-3.1)
 *
 * Main orchestrator for the sync watch mode.
 * Runs a poll loop: snapshot → sync → snapshot → diff → log → hooks.
 */

import type { Database } from "bun:sqlite";
import type { DeltaSyncService } from "../services/delta-sync";
import type { LocalApiClient } from "../api/local-api-client";
import { takeSnapshot } from "./snapshot";
import { diffSnapshots } from "./differ";
import { EventLogger } from "./event-log";
import { HookRunner } from "./hook-runner";
import { StatusReporter } from "./status-reporter";
import type {
  WatchOptions,
  WatchState,
  ChangeEvent,
} from "./types";

interface WatchServiceDeps {
  deltaSyncService: Pick<DeltaSyncService, 'sync' | 'close'>;
  db: Database;
  localApiClient?: Pick<LocalApiClient, 'health'>;
  eventLogger?: EventLogger;
  hookRunner?: HookRunner;
  statusReporter?: StatusReporter;
}

/**
 * Compute exponential backoff delay for consecutive failures.
 * Sequence: 5s, 10s, 20s, 40s, 60s (capped)
 */
export function getBackoffMs(consecutiveFailures: number): number {
  const base = 5_000;
  const max = 60_000;
  return Math.min(base * Math.pow(2, consecutiveFailures - 1), max);
}

export class WatchService {
  private options: WatchOptions;
  private deps: WatchServiceDeps;
  private state: WatchState;
  private running = false;
  private eventLogger: EventLogger;
  private hookRunner: HookRunner;
  private statusReporter: StatusReporter;

  constructor(options: WatchOptions, deps: WatchServiceDeps) {
    this.options = options;
    this.deps = deps;

    this.state = {
      pollCount: 0,
      changesDetected: 0,
      hooksExecuted: 0,
      hooksFailed: 0,
      startedAt: new Date().toISOString(),
      lastPollAt: null,
      consecutiveFailures: 0,
    };

    // Use injected deps or create defaults
    this.eventLogger = deps.eventLogger ?? new EventLogger(
      options.eventLogPath ?? EventLogger.defaultLogPath(options.workspace)
    );
    this.hookRunner = deps.hookRunner ?? new HookRunner();
    this.statusReporter = deps.statusReporter ?? new StatusReporter();
  }

  /**
   * Get current watch state snapshot.
   */
  getStatus(): WatchState {
    return { ...this.state };
  }

  /**
   * Start the watch loop. Runs until stop() is called or max failures exceeded.
   */
  async start(): Promise<void> {
    this.running = true;
    this.state.startedAt = new Date().toISOString();

    this.statusReporter.printBanner(this.options);
    this.statusReporter.start(() => this.getStatus());

    // Register signal handlers
    const shutdown = () => {
      process.stderr.write('\n[supertag watch] Received shutdown signal...\n');
      this.stop().catch(() => {});
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    while (this.running) {
      // Wait for the poll interval (or backoff on failure)
      const waitMs = this.state.consecutiveFailures > 0
        ? getBackoffMs(this.state.consecutiveFailures)
        : this.options.interval * 1000;

      await sleep(waitMs);

      if (!this.running) break;

      await this.runPollCycle();

      if (this.state.consecutiveFailures >= this.options.maxConsecutiveFailures) {
        process.stderr.write(
          `[supertag watch] ERROR: ${this.state.consecutiveFailures} consecutive failures. Exiting.\n`
        );
        process.stderr.write(
          `[supertag watch] Consider increasing --interval or checking Tana Desktop status.\n`
        );
        this.running = false;
        this.statusReporter.stop();
        process.exit(1);
      }
    }

    this.statusReporter.stop();
  }

  /**
   * Stop the watch loop gracefully.
   * Waits for any in-flight hooks, runs a final sync, logs final status.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.statusReporter.stop();

    // Run final status report
    this.statusReporter.report(this.state);

    process.stderr.write('[supertag watch] Running final delta-sync...\n');
    try {
      await Promise.race([
        this.deps.deltaSyncService.sync(),
        sleep(15_000),
      ]);
    } catch {
      // Best-effort final sync
    }

    process.stderr.write('[supertag watch] Stopped.\n');
  }

  /**
   * Run a single poll cycle.
   */
  private async runPollCycle(): Promise<void> {
    this.state.pollCount++;
    this.state.lastPollAt = new Date().toISOString();

    try {
      // 1. Pre-sync snapshot
      const before = takeSnapshot(this.deps.db, this.options.filterTag);

      // 2. Delta sync
      await this.deps.deltaSyncService.sync();

      // 3. Post-sync snapshot
      const after = takeSnapshot(this.deps.db, this.options.filterTag);

      // 4. Diff
      const events = diffSnapshots(before, after, this.state.pollCount);

      if (events.length > 0) {
        this.state.changesDetected += events.length;

        process.stderr.write(
          `[supertag watch] Poll #${this.state.pollCount}: ${events.length} change(s) detected\n`
        );
      }

      // 5. Log events and dispatch hooks (unless dry-run)
      if (!this.options.dryRun && events.length > 0) {
        this.eventLogger.append(events);
        await this.dispatchHooks(events);
      } else if (this.options.dryRun && events.length > 0) {
        process.stderr.write(`[supertag watch] (dry-run) Would dispatch ${events.length} event(s)\n`);
      }

      // Reset consecutive failures on success
      this.state.consecutiveFailures = 0;
    } catch (error) {
      this.state.consecutiveFailures++;
      const backoffMs = getBackoffMs(this.state.consecutiveFailures);
      process.stderr.write(
        `[supertag watch] Poll #${this.state.pollCount} failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.stderr.write(
        `[supertag watch] Backing off for ${backoffMs / 1000}s (failure ${this.state.consecutiveFailures}/${this.options.maxConsecutiveFailures})\n`
      );
    }
  }

  /**
   * Dispatch hooks for a batch of change events.
   */
  private async dispatchHooks(events: ChangeEvent[]): Promise<void> {
    const hooks: Array<{ cmd: string; filtered: ChangeEvent[] }> = [];

    if (this.options.onChangeCmd) {
      hooks.push({ cmd: this.options.onChangeCmd, filtered: events });
    }

    if (this.options.onCreateCmd) {
      const filtered = events.filter(e => e.type === 'create');
      if (filtered.length > 0) {
        hooks.push({ cmd: this.options.onCreateCmd, filtered });
      }
    }

    if (this.options.onModifyCmd) {
      const filtered = events.filter(e => e.type === 'modify');
      if (filtered.length > 0) {
        hooks.push({ cmd: this.options.onModifyCmd, filtered });
      }
    }

    if (this.options.onDeleteCmd) {
      const filtered = events.filter(e => e.type === 'delete');
      if (filtered.length > 0) {
        hooks.push({ cmd: this.options.onDeleteCmd, filtered });
      }
    }

    // Execute hooks sequentially
    for (const { cmd, filtered } of hooks) {
      this.state.hooksExecuted++;
      const result = await this.hookRunner.execute(cmd, filtered);

      if (result.exitCode !== 0 || result.timedOut) {
        this.state.hooksFailed++;
        if (result.timedOut) {
          process.stderr.write(
            `[supertag watch] Hook timed out: ${cmd}\n`
          );
        } else {
          process.stderr.write(
            `[supertag watch] Hook failed (exit ${result.exitCode}): ${cmd}\n`
          );
          if (result.stderr) {
            process.stderr.write(`[supertag watch]   stderr: ${result.stderr}\n`);
          }
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
