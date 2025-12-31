/**
 * Batch Workspace Processor
 *
 * Utility for executing operations across multiple workspaces with consistent
 * error handling, progress reporting, and optional parallel execution.
 *
 * Spec: 056-batch-workspace-processor
 */

import {
  resolveWorkspaceContext,
  listAvailableWorkspaces,
  getDefaultWorkspace,
  type ResolvedWorkspace,
} from "./workspace-resolver";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for batch processing
 */
export interface BatchOptions {
  /** Process all configured workspaces */
  all?: boolean;

  /** Specific workspaces to process (alternative to --all) */
  workspaces?: string[];

  /** Single workspace (used when not batch mode) */
  workspace?: string;

  /** Continue processing remaining workspaces on error (default: false) */
  continueOnError?: boolean;

  /** Run operations in parallel (default: false for safety) */
  parallel?: boolean;

  /** Maximum parallel operations (default: 4) */
  concurrency?: number;

  /** Show progress for each workspace */
  showProgress?: boolean;
}

/**
 * Result of processing a single workspace
 */
export interface WorkspaceResult<T> {
  workspace: ResolvedWorkspace;
  success: boolean;
  result?: T;
  error?: Error;
  duration: number; // milliseconds
}

/**
 * Summary of batch operation
 */
export interface BatchResult<T> {
  results: WorkspaceResult<T>[];
  successful: number;
  failed: number;
  totalDuration: number;
}

/**
 * Progress callback for batch operations
 */
export type ProgressCallback = (
  workspace: string,
  index: number,
  total: number,
  status: "start" | "success" | "error"
) => void;

// =============================================================================
// Core Functions (stubs for T-1.1)
// =============================================================================

/**
 * Process operation across one or more workspaces
 *
 * @param options - Batch processing options
 * @param operation - Function to execute for each workspace
 * @param onProgress - Optional progress callback
 * @returns Batch result with all workspace results
 */
export async function processWorkspaces<T>(
  options: BatchOptions,
  operation: (workspace: ResolvedWorkspace) => Promise<T>,
  onProgress?: ProgressCallback
): Promise<BatchResult<T>> {
  const startTime = Date.now();
  const workspaceAliases = resolveWorkspaceList(options);
  const total = workspaceAliases.length;

  const results: WorkspaceResult<T>[] = [];

  // Parallel execution with concurrency limit
  if (options.parallel) {
    const concurrency = options.concurrency ?? 4;
    const chunks = chunkArray(workspaceAliases, concurrency);

    let globalIndex = 0;
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map((alias, localIdx) => {
          const idx = globalIndex + localIdx;
          return processOne(alias, operation, onProgress, idx, total);
        })
      );
      results.push(...chunkResults);
      globalIndex += chunk.length;
    }
  }
  // Sequential execution
  else {
    for (let i = 0; i < workspaceAliases.length; i++) {
      const alias = workspaceAliases[i];
      const result = await processOne(alias, operation, onProgress, i, total);
      results.push(result);

      // Stop on first error if not continuing
      if (!result.success && !options.continueOnError) {
        break;
      }
    }
  }

  return {
    results,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    totalDuration: Date.now() - startTime,
  };
}

/**
 * Split array into chunks of specified size
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process a single workspace
 */
async function processOne<T>(
  alias: string,
  operation: (workspace: ResolvedWorkspace) => Promise<T>,
  onProgress: ProgressCallback | undefined,
  index: number,
  total: number
): Promise<WorkspaceResult<T>> {
  const startTime = Date.now();

  onProgress?.(alias, index + 1, total, "start");

  try {
    const workspace = resolveWorkspaceContext({ workspace: alias });
    const result = await operation(workspace);

    onProgress?.(alias, index + 1, total, "success");

    return {
      workspace,
      success: true,
      result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    onProgress?.(alias, index + 1, total, "error");

    // Create a minimal workspace object for error cases
    const errorWorkspace = {
      alias,
      config: {} as ResolvedWorkspace["config"],
      dbPath: "",
      schemaPath: "",
      exportDir: "",
      isDefault: false,
      rootFileId: "",
    } as ResolvedWorkspace;

    return {
      workspace: errorWorkspace,
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Resolve batch options to list of workspace aliases
 */
export function resolveWorkspaceList(options: BatchOptions): string[] {
  // Explicit list of workspaces
  if (options.workspaces && options.workspaces.length > 0) {
    return options.workspaces;
  }

  // All workspaces
  if (options.all) {
    return listAvailableWorkspaces();
  }

  // Single workspace (default to configured default)
  const single = options.workspace ?? getDefaultWorkspace();
  return [single];
}

/**
 * Check if options indicate batch mode (multiple workspaces)
 */
export function isBatchMode(options: BatchOptions): boolean {
  return (
    options.all === true ||
    (options.workspaces !== undefined && options.workspaces.length > 1)
  );
}

/**
 * Create a default progress logger
 */
export function createProgressLogger(
  mode: "pretty" | "unix" = "pretty"
): ProgressCallback {
  return (alias, index, total, status) => {
    if (mode === "pretty") {
      const icon = {
        start: "\u22EF",
        success: "\u2713",
        error: "\u2717",
      }[status];
      console.log(`${icon} [${index}/${total}] ${alias}`);
    } else {
      // Unix mode: only output on completion
      if (status !== "start") {
        console.log(`${alias}\t${status}`);
      }
    }
  };
}
