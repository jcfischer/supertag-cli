/**
 * Hook Runner (F-103 T-2.2)
 *
 * Executes shell commands with change events piped to stdin.
 * Never throws — all errors are captured in HookResult.
 */

import type { ChangeEvent, HookResult } from "./types";

interface HookRunnerOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SIGTERM_GRACE_MS = 5_000;

export class HookRunner {
  private readonly timeoutMs: number;

  constructor(options: HookRunnerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Execute a shell command with events piped to stdin.
   *
   * Sets environment variables:
   * - SUPERTAG_WATCH_EVENT_COUNT: number of events
   * - SUPERTAG_WATCH_EVENT_TYPE: event type (only for single-type filtered calls)
   *
   * @param command - Shell command to execute
   * @param events - Change events to pipe as JSON to stdin
   * @returns HookResult with execution details; never throws
   */
  async execute(command: string, events: ChangeEvent[]): Promise<HookResult> {
    const startMs = Date.now();

    // Determine event type env var (single type if all events are same type)
    const uniqueTypes = [...new Set(events.map(e => e.type))];
    const eventType = uniqueTypes.length === 1 ? uniqueTypes[0] : 'mixed';

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      SUPERTAG_WATCH_EVENT_COUNT: String(events.length),
      SUPERTAG_WATCH_EVENT_TYPE: eventType,
    };

    const stdinData = JSON.stringify(events);

    try {
      const proc = Bun.spawn(['sh', '-c', command], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });

      // Write events JSON to stdin and close
      proc.stdin.write(stdinData);
      proc.stdin.end();

      // Set up timeout
      let timedOut = false;
      const timeoutHandle = setTimeout(async () => {
        timedOut = true;
        try {
          proc.kill('SIGTERM');
          // Wait for SIGTERM grace period, then SIGKILL
          await new Promise(resolve => setTimeout(resolve, SIGTERM_GRACE_MS));
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process may already be dead
          }
        } catch {
          // Process may already be dead
        }
      }, this.timeoutMs);

      // Wait for process to complete
      let exitCode: number | null = null;
      let stderrText: string | undefined;

      try {
        const [code, stderrData] = await Promise.all([
          proc.exited,
          new Response(proc.stderr).text(),
        ]);
        exitCode = code;
        stderrText = stderrData || undefined;
      } catch {
        // Process killed or error
      } finally {
        clearTimeout(timeoutHandle);
      }

      return {
        command,
        exitCode: timedOut ? null : exitCode,
        timedOut,
        durationMs: Date.now() - startMs,
        stderr: stderrText,
      };
    } catch (error) {
      return {
        command,
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - startMs,
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
