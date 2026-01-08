/**
 * Attachment Type Definitions
 *
 * Types for discovering, downloading, and organizing attachments from Tana exports.
 * Attachments are files stored in Firebase Storage, referenced by URLs in node names.
 */

import { z } from "zod";

/**
 * An attachment discovered in the Tana export
 * Represents a file stored in Firebase Storage
 */
export interface Attachment {
  /** Node ID containing the attachment URL */
  nodeId: string;
  /** Full Firebase Storage URL */
  url: string;
  /** Extracted filename (decoded from URL) */
  filename: string;
  /** File extension (lowercase, e.g., "png", "pdf") */
  extension: string;
  /** MIME type if detectable */
  mimeType?: string;
  /** Parent node ID (for organization) */
  parentId?: string;
  /** Parent node name */
  parentName?: string;
  /** Tags applied to parent or self node */
  tags: string[];
  /** Created timestamp (from node) */
  created?: number;
}

/**
 * Zod schema for Attachment validation
 */
export const AttachmentSchema = z.object({
  nodeId: z.string().min(1),
  url: z.string().min(1),
  filename: z.string().min(1),
  extension: z.string().min(1),
  mimeType: z.string().optional(),
  parentId: z.string().optional(),
  parentName: z.string().optional(),
  tags: z.array(z.string()).default([]),
  created: z.number().optional(),
});

/**
 * Result of downloading a single attachment
 */
export interface DownloadResult {
  /** The attachment that was downloaded */
  attachment: Attachment;
  /** Whether download succeeded */
  success: boolean;
  /** Local file path (if success=true) */
  localPath?: string;
  /** Bytes downloaded (if success=true) */
  bytesDownloaded?: number;
  /** Download duration in milliseconds */
  durationMs?: number;
  /** Error message (if success=false) */
  error?: string;
  /** Number of retry attempts */
  retries?: number;
  /** Whether file was skipped */
  skipped?: boolean;
  /** Reason for skipping */
  skipReason?: string;
}

/**
 * Zod schema for DownloadResult validation
 */
export const DownloadResultSchema = z.object({
  attachment: AttachmentSchema,
  success: z.boolean(),
  localPath: z.string().optional(),
  bytesDownloaded: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  retries: z.number().optional(),
  skipped: z.boolean().optional(),
  skipReason: z.string().optional(),
});

/**
 * Organization strategies for downloaded files
 */
export type OrganizeBy = "flat" | "date" | "tag" | "node";

/**
 * Options for attachment extraction
 */
export interface AttachmentOptions {
  /** Output directory for downloads */
  outputDir?: string;
  /** How to organize files in subdirectories */
  organizeBy?: OrganizeBy;
  /** Number of concurrent downloads (1-10) */
  concurrency?: number;
  /** Skip files that already exist locally */
  skipExisting?: boolean;
  /** Filter by tags (include only attachments with these tags) */
  tags?: string[];
  /** Filter by file extensions */
  extensions?: string[];
  /** Maximum retry attempts per file */
  maxRetries?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Zod schema for AttachmentOptions validation
 */
export const AttachmentOptionsSchema = z.object({
  outputDir: z.string().optional(),
  organizeBy: z.enum(["flat", "date", "tag", "node"]).default("flat"),
  concurrency: z.number().min(1).max(10).default(3),
  skipExisting: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  extensions: z.array(z.string()).optional(),
  maxRetries: z.number().min(0).max(10).default(3),
  retryDelayMs: z.number().min(100).max(60000).default(1000),
  verbose: z.boolean().optional(),
});

/**
 * Summary of an extraction operation
 */
export interface ExtractionSummary {
  /** Total attachments found */
  totalFound: number;
  /** Successfully downloaded count */
  downloaded: number;
  /** Skipped count (already existed) */
  skipped: number;
  /** Failed count */
  failed: number;
  /** Total bytes downloaded */
  totalBytes: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Output directory used */
  outputDir: string;
  /** Individual results */
  results: DownloadResult[];
  /** Errors encountered */
  errors?: Array<{ nodeId: string; error: string }>;
}

/**
 * Zod schema for ExtractionSummary validation
 */
export const ExtractionSummarySchema = z.object({
  totalFound: z.number(),
  downloaded: z.number(),
  skipped: z.number(),
  failed: z.number(),
  totalBytes: z.number(),
  durationMs: z.number(),
  outputDir: z.string(),
  results: z.array(DownloadResultSchema),
  errors: z.array(z.object({
    nodeId: z.string(),
    error: z.string(),
  })).optional(),
});

/**
 * Common MIME types for attachments
 */
export const MIME_TYPES: Record<string, string> = {
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  // Audio
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  webm: "audio/webm",
  wav: "audio/wav",
  // Video
  mp4: "video/mp4",
  mov: "video/quicktime",
  // Documents
  pdf: "application/pdf",
};

/**
 * Get MIME type from extension
 */
export function getMimeType(extension: string): string | undefined {
  return MIME_TYPES[extension.toLowerCase()];
}
