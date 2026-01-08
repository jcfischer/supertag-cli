/**
 * Attachment Downloader Tests
 * TDD tests for download functionality
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  AttachmentDownloader,
  type DownloadOptions,
} from "../../src/services/attachment-downloader";
import type { Attachment } from "../../src/types/attachment";

const TEST_DIR = "/tmp/supertag-downloader-test";

describe("AttachmentDownloader", () => {
  beforeAll(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("constructor", () => {
    test("creates instance with auth token", () => {
      const downloader = new AttachmentDownloader({ authToken: "test-token" });
      expect(downloader).toBeInstanceOf(AttachmentDownloader);
    });

    test("creates instance without auth token", () => {
      const downloader = new AttachmentDownloader();
      expect(downloader).toBeInstanceOf(AttachmentDownloader);
    });
  });

  describe("generateLocalPath", () => {
    test("generates flat path by default", () => {
      const downloader = new AttachmentDownloader();
      const attachment: Attachment = {
        nodeId: "abc123",
        url: "https://...",
        filename: "image.png",
        extension: "png",
        tags: [],
      };

      const path = downloader.generateLocalPath(attachment, {
        outputDir: TEST_DIR,
        organizeBy: "flat",
      });

      expect(path).toBe(join(TEST_DIR, "image.png"));
    });

    test("generates date-based path", () => {
      const downloader = new AttachmentDownloader();
      const attachment: Attachment = {
        nodeId: "abc123",
        url: "https://...",
        filename: "image.png",
        extension: "png",
        tags: [],
        created: new Date("2025-06-15").getTime(),
      };

      const path = downloader.generateLocalPath(attachment, {
        outputDir: TEST_DIR,
        organizeBy: "date",
      });

      expect(path).toBe(join(TEST_DIR, "2025", "06", "image.png"));
    });

    test("generates tag-based path", () => {
      const downloader = new AttachmentDownloader();
      const attachment: Attachment = {
        nodeId: "abc123",
        url: "https://...",
        filename: "image.png",
        extension: "png",
        tags: ["#photo", "#vacation"],
      };

      const path = downloader.generateLocalPath(attachment, {
        outputDir: TEST_DIR,
        organizeBy: "tag",
      });

      // Should use first tag (cleaned)
      expect(path).toBe(join(TEST_DIR, "photo", "image.png"));
    });

    test("generates node-based path", () => {
      const downloader = new AttachmentDownloader();
      const attachment: Attachment = {
        nodeId: "abc123",
        url: "https://...",
        filename: "image.png",
        extension: "png",
        tags: [],
      };

      const path = downloader.generateLocalPath(attachment, {
        outputDir: TEST_DIR,
        organizeBy: "node",
      });

      expect(path).toBe(join(TEST_DIR, "abc123", "image.png"));
    });

    test("handles filename conflicts by appending counter", () => {
      const downloader = new AttachmentDownloader();
      const attachment: Attachment = {
        nodeId: "abc123",
        url: "https://...",
        filename: "image.png",
        extension: "png",
        tags: [],
      };

      // Create a conflicting file
      const existingPath = join(TEST_DIR, "conflict-test.png");
      Bun.write(existingPath, "existing content");

      const path = downloader.generateLocalPath(
        { ...attachment, filename: "conflict-test.png" },
        { outputDir: TEST_DIR, organizeBy: "flat" },
        true // Check for conflicts
      );

      expect(path).toBe(join(TEST_DIR, "conflict-test_1.png"));

      // Cleanup
      rmSync(existingPath);
    });

    test("falls back to uncategorized for tag organization without tags", () => {
      const downloader = new AttachmentDownloader();
      const attachment: Attachment = {
        nodeId: "abc123",
        url: "https://...",
        filename: "image.png",
        extension: "png",
        tags: [],
      };

      const path = downloader.generateLocalPath(attachment, {
        outputDir: TEST_DIR,
        organizeBy: "tag",
      });

      expect(path).toBe(join(TEST_DIR, "uncategorized", "image.png"));
    });

    test("falls back to flat for date organization without created timestamp", () => {
      const downloader = new AttachmentDownloader();
      const attachment: Attachment = {
        nodeId: "abc123",
        url: "https://...",
        filename: "image.png",
        extension: "png",
        tags: [],
        // No created timestamp
      };

      const path = downloader.generateLocalPath(attachment, {
        outputDir: TEST_DIR,
        organizeBy: "date",
      });

      // Should fall back to 'unknown-date' directory
      expect(path).toBe(join(TEST_DIR, "unknown-date", "image.png"));
    });
  });

  describe("shouldSkip", () => {
    test("returns false when skipExisting is false", () => {
      const downloader = new AttachmentDownloader();

      // Create a file
      const filePath = join(TEST_DIR, "existing.png");
      Bun.write(filePath, "content");

      const result = downloader.shouldSkip(filePath, { skipExisting: false });
      expect(result).toBe(false);

      // Cleanup
      rmSync(filePath);
    });

    test("returns true when file exists and skipExisting is true", () => {
      const downloader = new AttachmentDownloader();

      // Create a file
      const filePath = join(TEST_DIR, "skip-test.png");
      Bun.write(filePath, "content");

      const result = downloader.shouldSkip(filePath, { skipExisting: true });
      expect(result).toBe(true);

      // Cleanup
      rmSync(filePath);
    });

    test("returns false when file does not exist and skipExisting is true", () => {
      const downloader = new AttachmentDownloader();
      const filePath = join(TEST_DIR, "nonexistent.png");

      const result = downloader.shouldSkip(filePath, { skipExisting: true });
      expect(result).toBe(false);
    });
  });

  describe("validateDownload", () => {
    test("returns true when file exists and size matches", () => {
      const downloader = new AttachmentDownloader();

      const filePath = join(TEST_DIR, "valid.png");
      const content = "test content here";
      Bun.write(filePath, content);

      const result = downloader.validateDownload(filePath, content.length);
      expect(result).toBe(true);

      // Cleanup
      rmSync(filePath);
    });

    test("returns false when file does not exist", () => {
      const downloader = new AttachmentDownloader();
      const result = downloader.validateDownload(join(TEST_DIR, "missing.png"), 100);
      expect(result).toBe(false);
    });

    test("returns false when size does not match", () => {
      const downloader = new AttachmentDownloader();

      const filePath = join(TEST_DIR, "size-mismatch.png");
      Bun.write(filePath, "short");

      const result = downloader.validateDownload(filePath, 1000);
      expect(result).toBe(false);

      // Cleanup
      rmSync(filePath);
    });

    test("returns true when expectedSize is 0 or undefined", () => {
      const downloader = new AttachmentDownloader();

      const filePath = join(TEST_DIR, "no-size.png");
      Bun.write(filePath, "content");

      expect(downloader.validateDownload(filePath, 0)).toBe(true);
      expect(downloader.validateDownload(filePath, undefined as any)).toBe(true);

      // Cleanup
      rmSync(filePath);
    });
  });
});
