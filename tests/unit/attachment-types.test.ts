/**
 * Attachment Types Tests
 * TDD tests for attachment type definitions and Zod validation
 */

import { describe, test, expect } from "bun:test";
import {
  AttachmentSchema,
  DownloadResultSchema,
  AttachmentOptionsSchema,
  ExtractionSummarySchema,
  type Attachment,
  type DownloadResult,
  type AttachmentOptions,
  type ExtractionSummary,
} from "../../src/types/attachment";

describe("Attachment Types", () => {
  describe("AttachmentSchema", () => {
    test("validates a complete attachment", () => {
      const attachment: Attachment = {
        nodeId: "abc123",
        url: "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2F2025-01-01T12%3A00%3A00.000Z-image.png?alt=media&token=xyz",
        filename: "image.png",
        extension: "png",
        mimeType: "image/png",
        parentId: "parent123",
        parentName: "Parent Node",
        tags: ["#photo", "#attachment"],
        created: 1704067200000,
      };

      const result = AttachmentSchema.safeParse(attachment);
      expect(result.success).toBe(true);
    });

    test("validates attachment with minimal fields", () => {
      const attachment = {
        nodeId: "abc123",
        url: "https://firebasestorage.googleapis.com/...",
        filename: "file.pdf",
        extension: "pdf",
      };

      const result = AttachmentSchema.safeParse(attachment);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toEqual([]);
        expect(result.data.mimeType).toBeUndefined();
      }
    });

    test("rejects attachment without nodeId", () => {
      const attachment = {
        url: "https://...",
        filename: "file.pdf",
        extension: "pdf",
      };

      const result = AttachmentSchema.safeParse(attachment);
      expect(result.success).toBe(false);
    });

    test("rejects attachment without url", () => {
      const attachment = {
        nodeId: "abc123",
        filename: "file.pdf",
        extension: "pdf",
      };

      const result = AttachmentSchema.safeParse(attachment);
      expect(result.success).toBe(false);
    });
  });

  describe("DownloadResultSchema", () => {
    test("validates successful download result", () => {
      const result: DownloadResult = {
        attachment: {
          nodeId: "abc123",
          url: "https://...",
          filename: "image.png",
          extension: "png",
        },
        success: true,
        localPath: "/downloads/image.png",
        bytesDownloaded: 1024000,
        durationMs: 1500,
      };

      const parsed = DownloadResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    test("validates failed download result", () => {
      const result: DownloadResult = {
        attachment: {
          nodeId: "abc123",
          url: "https://...",
          filename: "image.png",
          extension: "png",
        },
        success: false,
        error: "Network error: connection timeout",
        retries: 3,
      };

      const parsed = DownloadResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    test("validates result with skip reason", () => {
      const result: DownloadResult = {
        attachment: {
          nodeId: "abc123",
          url: "https://...",
          filename: "image.png",
          extension: "png",
        },
        success: true,
        skipped: true,
        skipReason: "File already exists",
      };

      const parsed = DownloadResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe("AttachmentOptionsSchema", () => {
    test("validates complete options", () => {
      const options: AttachmentOptions = {
        outputDir: "/downloads/attachments",
        organizeBy: "date",
        concurrency: 5,
        skipExisting: true,
        tags: ["#photo", "#document"],
        extensions: ["png", "pdf"],
        maxRetries: 3,
        retryDelayMs: 1000,
        verbose: true,
      };

      const result = AttachmentOptionsSchema.safeParse(options);
      expect(result.success).toBe(true);
    });

    test("applies default values", () => {
      const options = {};

      const result = AttachmentOptionsSchema.safeParse(options);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.organizeBy).toBe("flat");
        expect(result.data.concurrency).toBe(3);
        expect(result.data.skipExisting).toBe(false);
        expect(result.data.maxRetries).toBe(3);
        expect(result.data.retryDelayMs).toBe(1000);
      }
    });

    test("validates organizeBy enum values", () => {
      const validValues = ["flat", "date", "tag", "node"];
      for (const value of validValues) {
        const result = AttachmentOptionsSchema.safeParse({ organizeBy: value });
        expect(result.success).toBe(true);
      }

      const result = AttachmentOptionsSchema.safeParse({ organizeBy: "invalid" });
      expect(result.success).toBe(false);
    });

    test("validates concurrency range", () => {
      // Valid: 1-10
      expect(AttachmentOptionsSchema.safeParse({ concurrency: 1 }).success).toBe(true);
      expect(AttachmentOptionsSchema.safeParse({ concurrency: 10 }).success).toBe(true);

      // Invalid: 0 or >10
      expect(AttachmentOptionsSchema.safeParse({ concurrency: 0 }).success).toBe(false);
      expect(AttachmentOptionsSchema.safeParse({ concurrency: 11 }).success).toBe(false);
    });
  });

  describe("ExtractionSummarySchema", () => {
    test("validates complete extraction summary", () => {
      const summary: ExtractionSummary = {
        totalFound: 100,
        downloaded: 95,
        skipped: 3,
        failed: 2,
        totalBytes: 50000000,
        durationMs: 120000,
        outputDir: "/downloads/attachments",
        results: [
          {
            attachment: {
              nodeId: "abc123",
              url: "https://...",
              filename: "image.png",
              extension: "png",
            },
            success: true,
            localPath: "/downloads/image.png",
            bytesDownloaded: 1024,
          },
        ],
      };

      const result = ExtractionSummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });

    test("validates summary with errors", () => {
      const summary: ExtractionSummary = {
        totalFound: 10,
        downloaded: 0,
        skipped: 0,
        failed: 10,
        totalBytes: 0,
        durationMs: 5000,
        outputDir: "/downloads",
        results: [],
        errors: [
          { nodeId: "abc", error: "Auth expired" },
          { nodeId: "def", error: "File not found" },
        ],
      };

      const result = ExtractionSummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });
  });
});
