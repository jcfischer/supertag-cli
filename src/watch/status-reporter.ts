/**
 * Status Reporter (F-103 T-5.1)
 *
 * Periodic console status output for the watch loop.
 * Reports poll count, changes, hooks, and running time.
 */

import type { WatchState, WatchOptions } from "./types";

/** Format elapsed milliseconds as HH:MM:SS */
export function formatRunningTime(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return `${hh}:${mm}:${ss}`;
}

export class StatusReporter {
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReportChanges = 0;

  constructor(intervalMs = 300_000) { // Default: 5 minutes
    this.intervalMs = intervalMs;
  }

  /**
   * Print a status report line to stderr.
   */
  report(state: WatchState): void {
    const running = formatRunningTime(state.startedAt);
    const newChanges = state.changesDetected - this.lastReportChanges;

    process.stderr.write(
      `[supertag watch] Poll #${state.pollCount} | +${newChanges} changes | ${state.hooksExecuted} hooks run | ${state.hooksFailed} failed | running ${running}\n`
    );

    this.lastReportChanges = state.changesDetected;
  }

  /**
   * Print startup banner with watch configuration.
   */
  printBanner(options: WatchOptions): void {
    process.stderr.write(`[supertag watch] Starting watch mode\n`);
    process.stderr.write(`[supertag watch]   Workspace: ${options.workspace}\n`);
    process.stderr.write(`[supertag watch]   Interval: ${options.interval}s\n`);
    if (options.filterTag) {
      process.stderr.write(`[supertag watch]   Filter tag: ${options.filterTag}\n`);
    }
    if (options.onChangeCmd) {
      process.stderr.write(`[supertag watch]   On change: ${options.onChangeCmd}\n`);
    }
    if (options.onCreateCmd) {
      process.stderr.write(`[supertag watch]   On create: ${options.onCreateCmd}\n`);
    }
    if (options.onModifyCmd) {
      process.stderr.write(`[supertag watch]   On modify: ${options.onModifyCmd}\n`);
    }
    if (options.onDeleteCmd) {
      process.stderr.write(`[supertag watch]   On delete: ${options.onDeleteCmd}\n`);
    }
    if (options.dryRun) {
      process.stderr.write(`[supertag watch]   Mode: dry-run (hooks will not execute)\n`);
    }
    process.stderr.write(`[supertag watch] Press Ctrl+C to stop\n`);
  }

  /**
   * Start periodic status reporting.
   */
  start(getState: () => WatchState): void {
    this.timer = setInterval(() => {
      const state = getState();
      this.report(state);
    }, this.intervalMs);
  }

  /**
   * Stop periodic reporting.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
