/**
 * Tana Export Filesystem Watcher
 *
 * Monitors export directory for new Tana export files and automatically
 * triggers reindexing when changes are detected.
 */

import { watch, type FSWatcher, existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { TanaIndexer, type IndexResult } from "../db/indexer";
import { EventEmitter } from "events";

export interface WatcherConfig {
  exportDir: string;
  dbPath: string;
  debounceMs?: number; // Debounce delay for file changes (default: 1000ms)
}

export interface WatcherStatus {
  watching: boolean;
  exportDir: string;
  dbPath: string;
  latestExport: string | null;
  lastIndexed: number | null; // Timestamp
}

export interface IndexEventResult extends IndexResult {
  success: boolean;
  exportFile: string;
  nodesAdded?: number;
  nodesDeleted?: number;
  nodesModified?: number;
}

/**
 * Event emitter interface for TanaExportWatcher
 */
export interface TanaExportWatcherEvents {
  indexed: (result: IndexEventResult) => void;
  error: (error: Error) => void;
}

/**
 * Filesystem watcher for Tana export directory
 *
 * Monitors for new .json files matching Tana export naming pattern
 * and automatically triggers indexing.
 */
export class TanaExportWatcher extends EventEmitter {
  private config: Required<WatcherConfig>;
  private indexer: TanaIndexer;
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastIndexedTimestamp: number | null = null;
  private latestExportFile: string | null = null;

  constructor(config: WatcherConfig) {
    super();

    // Validate export directory exists
    if (!existsSync(config.exportDir)) {
      throw new Error(`Export directory does not exist: ${config.exportDir}`);
    }

    // Set defaults
    this.config = {
      exportDir: config.exportDir,
      dbPath: config.dbPath,
      debounceMs: config.debounceMs ?? 1000,
    };

    // Initialize indexer
    this.indexer = new TanaIndexer(this.config.dbPath);
  }

  /**
   * Find the latest Tana export file in directory
   *
   * Looks for files matching pattern: *@YYYY-MM-DD.json
   * Returns the file with the most recent date in filename
   */
  findLatestExport(): string | null {
    try {
      const files = readdirSync(this.config.exportDir);

      // Filter for Tana export files (pattern: *@YYYY-MM-DD.json)
      const exportFiles = files.filter((file) => {
        return file.match(/@\d{4}-\d{2}-\d{2}\.json$/);
      });

      if (exportFiles.length === 0) {
        return null;
      }

      // Sort by filename (date is in filename, so lexicographic sort works)
      exportFiles.sort().reverse();

      const latestFile = join(this.config.exportDir, exportFiles[0]);
      this.latestExportFile = latestFile;
      return latestFile;
    } catch (error) {
      console.error("Error finding latest export:", error);
      return null;
    }
  }

  /**
   * Manually trigger indexing of latest export file
   */
  async indexLatest(): Promise<IndexEventResult> {
    const exportFile = this.findLatestExport();

    if (!exportFile) {
      throw new Error("No export files found in directory");
    }

    try {
      // Initialize schema if needed
      await this.indexer.initializeSchema();

      // Index the export
      const result = await this.indexer.indexExport(exportFile);

      this.lastIndexedTimestamp = Date.now();

      const successResult: IndexEventResult = {
        success: true,
        exportFile: basename(exportFile),
        ...result,
      };

      this.emit("indexed", successResult);

      return successResult;
    } catch (error) {
      const errorResult: IndexEventResult = {
        success: false,
        exportFile: basename(exportFile),
        nodesIndexed: 0,
        supertagsIndexed: 0,
        fieldsIndexed: 0,
        referencesIndexed: 0,
        tagApplicationsIndexed: 0,
        fieldNamesIndexed: 0,
        durationMs: 0,
      };

      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Start watching export directory for changes
   */
  start(): void {
    if (this.watcher) {
      console.warn("Watcher already started");
      return;
    }

    console.log(`Starting watcher on: ${this.config.exportDir}`);

    this.watcher = watch(
      this.config.exportDir,
      { recursive: false },
      (eventType, filename) => {
        if (!filename) return;

        // Only process .json files matching Tana export pattern
        if (!filename.match(/@\d{4}-\d{2}-\d{2}\.json$/)) {
          return;
        }

        console.log(`File change detected: ${filename} (${eventType})`);

        // Debounce: clear existing timer and set new one
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
          this.handleFileChange(filename);
        }, this.config.debounceMs);
      }
    );
  }

  /**
   * Handle file change event (after debounce)
   */
  private async handleFileChange(filename: string): Promise<void> {
    const filePath = join(this.config.exportDir, filename);

    // Verify file exists (might have been deleted)
    if (!existsSync(filePath)) {
      console.log(`File no longer exists: ${filename}`);
      return;
    }

    console.log(`Indexing new export: ${filename}`);

    try {
      await this.indexLatest();
    } catch (error) {
      console.error(`Error indexing ${filename}:`, error);
      this.emit("error", error as Error);
    }
  }

  /**
   * Stop watching directory
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    console.log("Watcher stopped");
  }

  /**
   * Check if watcher is currently active
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Get current watcher status
   */
  getStatus(): WatcherStatus {
    return {
      watching: this.isWatching(),
      exportDir: this.config.exportDir,
      dbPath: this.config.dbPath,
      latestExport: this.latestExportFile
        ? basename(this.latestExportFile)
        : null,
      lastIndexed: this.lastIndexedTimestamp,
    };
  }

  /**
   * Close indexer database connection
   */
  close(): void {
    this.stop();
    this.indexer.close();
  }
}
