/**
 * Attachment Service
 *
 * Unified service for attachment discovery, listing, and extraction.
 * Combines discovery and downloader components.
 */

import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type {
  Attachment,
  AttachmentOptions,
  DownloadResult,
  ExtractionSummary,
} from "../types/attachment";
import { scanDatabase, type ScanOptions } from "./attachment-discovery";
import { AttachmentDownloader, type DownloadOptions } from "./attachment-downloader";

/**
 * Options for listing attachments
 */
export interface ListOptions extends ScanOptions {
  /** Maximum results */
  limit?: number;
}

/**
 * Statistics about attachments
 */
export interface AttachmentStats {
  /** Total number of attachments */
  total: number;
  /** Count by extension */
  byExtension: Record<string, number>;
  /** Count by tag */
  byTag: Record<string, number>;
}

/**
 * Attachment Service
 *
 * Main interface for working with Tana attachments
 */
export class AttachmentService {
  private db: Database;
  private downloader: AttachmentDownloader;

  constructor(db: Database, authToken?: string) {
    this.db = db;
    this.downloader = new AttachmentDownloader({ authToken });
  }

  /**
   * List attachments from database
   */
  list(options: ListOptions = {}): Attachment[] {
    return scanDatabase(this.db, options);
  }

  /**
   * Get a single attachment by node ID
   */
  get(nodeId: string): Attachment | null {
    const row = this.db.query(`
      SELECT
        n.id as nodeId,
        n.name as url,
        n.parent_id as parentId,
        p.name as parentName,
        n.created
      FROM nodes n
      LEFT JOIN nodes p ON n.parent_id = p.id
      WHERE n.id = ?
        AND n.name LIKE '%firebasestorage.googleapis.com%'
    `).get(nodeId) as {
      nodeId: string;
      url: string;
      parentId: string | null;
      parentName: string | null;
      created: number | null;
    } | null;

    if (!row) {
      return null;
    }

    // Parse and extract attachment info
    const { parseNodeForUrl, extractFilename } = require("./attachment-discovery");
    const { getMimeType } = require("../types/attachment");

    const parsedUrl = parseNodeForUrl(row.url);
    if (!parsedUrl) {
      return null;
    }

    const { filename, extension } = extractFilename(parsedUrl);

    // Get tags
    const tags = this.getNodeTags(nodeId, row.parentId);

    return {
      nodeId: row.nodeId,
      url: parsedUrl,
      filename,
      extension,
      mimeType: getMimeType(extension),
      parentId: row.parentId || undefined,
      parentName: row.parentName || undefined,
      tags,
      created: row.created || undefined,
    };
  }

  /**
   * Get tags for a node
   */
  private getNodeTags(nodeId: string, parentId: string | null): string[] {
    const tags: string[] = [];

    const nodeTags = this.db.query(`
      SELECT tag_name FROM tag_applications WHERE data_node_id = ?
    `).all(nodeId) as Array<{ tag_name: string }>;
    tags.push(...nodeTags.map((t) => t.tag_name));

    if (parentId) {
      const parentTags = this.db.query(`
        SELECT tag_name FROM tag_applications WHERE data_node_id = ?
      `).all(parentId) as Array<{ tag_name: string }>;
      tags.push(...parentTags.map((t) => t.tag_name));
    }

    return [...new Set(tags)];
  }

  /**
   * Get attachment statistics
   */
  stats(): AttachmentStats {
    const attachments = this.list();

    const byExtension: Record<string, number> = {};
    const byTag: Record<string, number> = {};

    for (const attachment of attachments) {
      // Count by extension
      byExtension[attachment.extension] = (byExtension[attachment.extension] || 0) + 1;

      // Count by tag
      for (const tag of attachment.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }

    return {
      total: attachments.length,
      byExtension,
      byTag,
    };
  }

  /**
   * Extract (download) attachments
   */
  async extract(options: AttachmentOptions): Promise<ExtractionSummary> {
    const startTime = Date.now();

    // Ensure output directory exists
    const outputDir = options.outputDir || "./attachments";
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Get attachments to download
    const attachments = this.list({
      tags: options.tags,
      extensions: options.extensions,
    });

    const results: DownloadResult[] = [];
    const errors: Array<{ nodeId: string; error: string }> = [];
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let totalBytes = 0;

    // Download with concurrency control
    const concurrency = options.concurrency || 3;
    const downloadOptions: DownloadOptions = {
      outputDir,
      organizeBy: options.organizeBy || "flat",
      skipExisting: options.skipExisting || false,
      maxRetries: options.maxRetries || 3,
      retryDelayMs: options.retryDelayMs || 1000,
      onProgress: options.verbose
        ? (bytes, total, filename) => {
            console.error(`Downloading: ${filename} (${bytes}/${total} bytes)`);
          }
        : undefined,
    };

    // Process in batches
    for (let i = 0; i < attachments.length; i += concurrency) {
      const batch = attachments.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((attachment) =>
          this.downloader.downloadWithRetry(attachment, downloadOptions)
        )
      );

      for (const result of batchResults) {
        results.push(result);

        if (result.success) {
          if (result.skipped) {
            skipped++;
          } else {
            downloaded++;
            totalBytes += result.bytesDownloaded || 0;
          }
        } else {
          failed++;
          errors.push({
            nodeId: result.attachment.nodeId,
            error: result.error || "Unknown error",
          });
        }
      }

      // Progress output
      if (options.verbose) {
        console.error(
          `Progress: ${i + batch.length}/${attachments.length} processed`
        );
      }
    }

    return {
      totalFound: attachments.length,
      downloaded,
      skipped,
      failed,
      totalBytes,
      durationMs: Date.now() - startTime,
      outputDir,
      results,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Download a single attachment by node ID
   */
  async downloadOne(
    nodeId: string,
    outputPath?: string
  ): Promise<DownloadResult> {
    const attachment = this.get(nodeId);
    if (!attachment) {
      return {
        attachment: {
          nodeId,
          url: "",
          filename: "unknown",
          extension: "bin",
          tags: [],
        },
        success: false,
        error: `Attachment not found: ${nodeId}`,
      };
    }

    const outputDir = outputPath ? require("path").dirname(outputPath) : ".";
    const downloadOptions: DownloadOptions = {
      outputDir,
      organizeBy: "flat",
      skipExisting: false,
    };

    return this.downloader.downloadWithRetry(attachment, downloadOptions);
  }
}
