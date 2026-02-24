/**
 * Export Cleanup Module
 *
 * Manages cleanup of old Tana export JSON files with configurable retention.
 * Default keeps the 7 most recent exports.
 */

import { readdirSync, unlinkSync, statSync, existsSync } from "fs";
import { join, basename } from "path";

/**
 * Options for export cleanup
 */
export interface CleanupOptions {
  /** Number of export files to keep (default: 7) */
  keepCount?: number;
  /** Dry run mode - show what would be deleted without deleting (default: false) */
  dryRun?: boolean;
}

/**
 * Result of cleanup operation
 */
export interface CleanupResult {
  /** Files that were deleted (or would be deleted in dry-run) */
  deleted: string[];
  /** Files that were kept */
  kept: string[];
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Total bytes freed (or would be freed in dry-run) */
  bytesFreed: number;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Tana export filename pattern: {rootFileId}@{YYYY-MM-DD}.json
 */
const EXPORT_PATTERN = /@\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Get all Tana export files from a directory, sorted by date descending (newest first)
 *
 * @param exportDir - Directory containing export files
 * @returns Array of filenames matching Tana export pattern, sorted newest first
 */
export function getExportFiles(exportDir: string): string[] {
  if (!existsSync(exportDir)) {
    return [];
  }

  try {
    const files = readdirSync(exportDir);

    // Filter for Tana export files
    const exportFiles = files.filter((file) => EXPORT_PATTERN.test(file));

    // Sort by filename descending (date in filename makes lexicographic sort work)
    exportFiles.sort().reverse();

    return exportFiles;
  } catch {
    return [];
  }
}

/**
 * Clean up old export files, keeping only the most recent ones
 *
 * @param exportDir - Directory containing export files
 * @param options - Cleanup options
 * @returns Cleanup result with deleted and kept files
 */
export function cleanupExports(
  exportDir: string,
  options: CleanupOptions = {}
): CleanupResult {
  const keepCount = options.keepCount ?? 7;
  const dryRun = options.dryRun ?? false;

  // Validate keepCount
  if (keepCount < 1) {
    return {
      deleted: [],
      kept: [],
      dryRun,
      bytesFreed: 0,
      error: "keepCount must be at least 1",
    };
  }

  const exportFiles = getExportFiles(exportDir);

  // Nothing to clean up
  if (exportFiles.length <= keepCount) {
    return {
      deleted: [],
      kept: exportFiles,
      dryRun,
      bytesFreed: 0,
    };
  }

  // Split into keep and delete
  const filesToKeep = exportFiles.slice(0, keepCount);
  const filesToDelete = exportFiles.slice(keepCount);

  let bytesFreed = 0;

  // Delete old files (unless dry run)
  for (const file of filesToDelete) {
    const filePath = join(exportDir, file);
    try {
      const stats = statSync(filePath);
      bytesFreed += stats.size;

      if (!dryRun) {
        unlinkSync(filePath);
      }
    } catch {
      // File may have been deleted already, continue
    }
  }

  return {
    deleted: filesToDelete,
    kept: filesToKeep,
    dryRun,
    bytesFreed,
  };
}

