/**
 * Event Logger (F-103 T-2.1)
 *
 * Appends change events to a JSONL file (one JSON object per line).
 * Write-only, append-only — no rotation in V1.
 */

import { appendFileSync } from "fs";
import { join } from "path";
import { WORKSPACES_DIR } from "../config/paths";
import type { ChangeEvent } from "./types";

export class EventLogger {
  private readonly logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  /**
   * Append change events to the JSONL log file.
   * No-ops silently on empty array.
   */
  append(events: ChangeEvent[]): void {
    if (events.length === 0) return;

    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(this.logPath, lines, 'utf8');
  }

  /**
   * Resolve the default event log path for a workspace.
   */
  static defaultLogPath(workspaceAlias: string): string {
    return join(WORKSPACES_DIR, workspaceAlias, 'watch-events.jsonl');
  }
}
