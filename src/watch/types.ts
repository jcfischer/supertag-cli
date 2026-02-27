/**
 * Watch Mode Types (F-103)
 *
 * Type definitions for the sync watch feature:
 * continuous polling for Tana changes with event hooks.
 */

// =============================================================================
// Core Event Types
// =============================================================================

export type ChangeType = 'create' | 'modify' | 'delete';

export interface ChangeEvent {
  type: ChangeType;
  timestamp: string;           // ISO 8601
  pollCycle: number;           // Monotonic cycle counter
  node: {
    id: string;
    name: string;
    tags: string[];            // Supertag names
  };
  changes?: {                  // Only for 'modify' type
    name?: { before: string; after: string };
    tags?: { added: string[]; removed: string[] };
  };
}

// =============================================================================
// Snapshot Types (for change detection)
// =============================================================================

export interface NodeSnapshot {
  id: string;
  name: string;
  tags: string[];              // From tag_applications table
  updatedAt: number;           // updated column (ms timestamp)
}

// =============================================================================
// Runtime State
// =============================================================================

export interface WatchState {
  pollCount: number;
  changesDetected: number;
  hooksExecuted: number;
  hooksFailed: number;
  startedAt: string;           // ISO 8601
  lastPollAt: string | null;
  consecutiveFailures: number;
}

// =============================================================================
// Configuration
// =============================================================================

export interface WatchOptions {
  workspace: string;
  interval: number;            // Seconds (default: 30, min: 5)
  filterTag?: string;          // Supertag name filter
  onChangeCmd?: string;        // Shell command for any change
  onCreateCmd?: string;        // Shell command for creates only
  onModifyCmd?: string;        // Shell command for modifies only
  onDeleteCmd?: string;        // Shell command for deletes only
  eventLogPath?: string;       // Custom JSONL path (default: auto)
  dryRun: boolean;             // Detect changes but don't execute hooks
  maxConsecutiveFailures: number; // Default: 10
}

// =============================================================================
// Hook Execution
// =============================================================================

export interface HookResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stderr?: string;
}
