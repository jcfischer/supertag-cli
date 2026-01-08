/**
 * Attachment Downloader Service
 *
 * Downloads attachments from Firebase Storage with:
 * - Progress tracking
 * - Retry with exponential backoff
 * - Skip existing files
 * - Validation
 */

import { existsSync, mkdirSync, statSync } from "fs";
import { dirname, join, parse as parsePath } from "path";
import type { Attachment, DownloadResult, OrganizeBy } from "../types/attachment";

/**
 * Options for download operations
 */
export interface DownloadOptions {
  /** Output directory */
  outputDir: string;
  /** How to organize downloaded files */
  organizeBy?: OrganizeBy;
  /** Skip files that already exist */
  skipExisting?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Base delay between retries in ms */
  retryDelayMs?: number;
  /** Progress callback */
  onProgress?: (downloaded: number, total: number, filename: string) => void;
}

/**
 * Downloader configuration
 */
export interface DownloaderConfig {
  /** Firebase auth token (may be required for some files) */
  authToken?: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

/**
 * Attachment Downloader
 *
 * Handles downloading files from Firebase Storage URLs
 */
export class AttachmentDownloader {
  private authToken?: string;
  private timeoutMs: number;

  constructor(config: DownloaderConfig = {}) {
    this.authToken = config.authToken;
    this.timeoutMs = config.timeoutMs || 30000;
  }

  /**
   * Generate local file path for an attachment
   */
  generateLocalPath(
    attachment: Attachment,
    options: Pick<DownloadOptions, "outputDir" | "organizeBy">,
    checkConflicts = false
  ): string {
    const { outputDir, organizeBy = "flat" } = options;
    let subdir = "";

    switch (organizeBy) {
      case "date":
        if (attachment.created) {
          const date = new Date(attachment.created);
          const year = date.getFullYear().toString();
          const month = (date.getMonth() + 1).toString().padStart(2, "0");
          subdir = join(year, month);
        } else {
          subdir = "unknown-date";
        }
        break;

      case "tag":
        if (attachment.tags.length > 0) {
          // Use first tag, remove # prefix
          subdir = attachment.tags[0].replace(/^#/, "");
        } else {
          subdir = "uncategorized";
        }
        break;

      case "node":
        subdir = attachment.nodeId;
        break;

      case "flat":
      default:
        // No subdirectory
        break;
    }

    let basePath = subdir ? join(outputDir, subdir) : outputDir;
    let filename = attachment.filename;

    if (checkConflicts) {
      filename = this.resolveConflict(basePath, attachment.filename);
    }

    return join(basePath, filename);
  }

  /**
   * Resolve filename conflicts by appending counter
   */
  private resolveConflict(dir: string, filename: string): string {
    const fullPath = join(dir, filename);
    if (!existsSync(fullPath)) {
      return filename;
    }

    const { name, ext } = parsePath(filename);
    let counter = 1;
    let newFilename = `${name}_${counter}${ext}`;

    while (existsSync(join(dir, newFilename))) {
      counter++;
      newFilename = `${name}_${counter}${ext}`;
    }

    return newFilename;
  }

  /**
   * Check if a file should be skipped
   */
  shouldSkip(localPath: string, options: Pick<DownloadOptions, "skipExisting">): boolean {
    if (!options.skipExisting) {
      return false;
    }
    return existsSync(localPath);
  }

  /**
   * Validate a downloaded file
   */
  validateDownload(localPath: string, expectedSize: number): boolean {
    if (!existsSync(localPath)) {
      return false;
    }

    // If no expected size, just check file exists
    if (!expectedSize) {
      return true;
    }

    const stats = statSync(localPath);
    return stats.size === expectedSize;
  }

  /**
   * Download a single attachment
   */
  async downloadFile(
    attachment: Attachment,
    options: DownloadOptions
  ): Promise<DownloadResult> {
    const startTime = Date.now();

    // Generate local path
    const localPath = this.generateLocalPath(attachment, options, true);

    // Check if should skip
    if (this.shouldSkip(localPath, options)) {
      return {
        attachment,
        success: true,
        localPath,
        skipped: true,
        skipReason: "File already exists",
        durationMs: Date.now() - startTime,
      };
    }

    // Ensure directory exists
    const dir = dirname(localPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      // Build headers
      const headers: Record<string, string> = {};
      if (this.authToken) {
        headers["Authorization"] = `Bearer ${this.authToken}`;
      }

      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(attachment.url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          attachment,
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Get content for progress tracking
      const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Report progress
      if (options.onProgress) {
        options.onProgress(buffer.length, contentLength, attachment.filename);
      }

      // Write to file
      await Bun.write(localPath, buffer);

      // Validate
      if (contentLength > 0 && !this.validateDownload(localPath, contentLength)) {
        return {
          attachment,
          success: false,
          error: "Download validation failed: size mismatch",
          durationMs: Date.now() - startTime,
        };
      }

      return {
        attachment,
        success: true,
        localPath,
        bytesDownloaded: buffer.length,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        attachment,
        success: false,
        error: message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Download with retry and exponential backoff
   */
  async downloadWithRetry(
    attachment: Attachment,
    options: DownloadOptions
  ): Promise<DownloadResult> {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelay = options.retryDelayMs ?? 1000;

    let lastResult: DownloadResult | null = null;
    let retries = 0;

    while (retries <= maxRetries) {
      lastResult = await this.downloadFile(attachment, options);

      // Success or skip - return immediately
      if (lastResult.success) {
        return { ...lastResult, retries };
      }

      // Check if error is retryable
      if (!this.isRetryableError(lastResult.error || "")) {
        return { ...lastResult, retries };
      }

      retries++;

      // If we have retries left, wait with exponential backoff
      if (retries <= maxRetries) {
        const delay = baseDelay * Math.pow(2, retries - 1);
        await this.sleep(delay);
      }
    }

    return { ...lastResult!, retries };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: string): boolean {
    const retryablePatterns = [
      /429/, // Too many requests
      /5\d{2}/, // 5xx errors
      /timeout/i,
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /network/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(error));
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
