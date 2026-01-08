/**
 * Attachment Discovery Tests
 * TDD tests for URL parsing and attachment discovery
 */

import { describe, test, expect } from "bun:test";
import {
  parseNodeForUrl,
  extractFilename,
  isFirebaseStorageUrl,
} from "../../src/services/attachment-discovery";

describe("Attachment Discovery", () => {
  describe("isFirebaseStorageUrl", () => {
    test("recognizes standard Firebase Storage URL", () => {
      const url = "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2F2025-01-01T12%3A00%3A00.000Z-image.png?alt=media&token=xyz";
      expect(isFirebaseStorageUrl(url)).toBe(true);
    });

    test("recognizes Firebase URL with port 443", () => {
      const url = "https://firebasestorage.googleapis.com:443/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser@example.com%2Fuploads%2Ffile.jpg?alt=media&token=xyz";
      expect(isFirebaseStorageUrl(url)).toBe(true);
    });

    test("rejects non-Firebase URLs", () => {
      expect(isFirebaseStorageUrl("https://example.com/file.png")).toBe(false);
      expect(isFirebaseStorageUrl("https://storage.googleapis.com/other")).toBe(false);
      expect(isFirebaseStorageUrl("not a url")).toBe(false);
    });

    test("rejects empty or null values", () => {
      expect(isFirebaseStorageUrl("")).toBe(false);
      expect(isFirebaseStorageUrl(null as any)).toBe(false);
      expect(isFirebaseStorageUrl(undefined as any)).toBe(false);
    });
  });

  describe("parseNodeForUrl", () => {
    test("extracts Firebase URL from node name", () => {
      const nodeName = "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2F2025-01-01T12%3A00%3A00.000Z-image.png?alt=media&token=xyz";
      const result = parseNodeForUrl(nodeName);
      expect(result).not.toBeNull();
      expect(result?.includes("firebasestorage.googleapis.com")).toBe(true);
    });

    test("extracts URL from markdown image syntax", () => {
      const nodeName = "![](https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2Fimage.png?alt=media&token=xyz)";
      const result = parseNodeForUrl(nodeName);
      expect(result).not.toBeNull();
    });

    test("handles HTML entity encoded ampersand", () => {
      const nodeName = "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2Ffile.png?alt=media&amp;token=xyz";
      const result = parseNodeForUrl(nodeName);
      expect(result).not.toBeNull();
      // Should decode &amp; to &
      expect(result?.includes("&amp;")).toBe(false);
      expect(result?.includes("&token=")).toBe(true);
    });

    test("returns null for non-attachment nodes", () => {
      expect(parseNodeForUrl("Regular node text")).toBeNull();
      expect(parseNodeForUrl("https://example.com/file.png")).toBeNull();
      expect(parseNodeForUrl("")).toBeNull();
    });

    test("extracts URL with port 443", () => {
      const nodeName = "https://firebasestorage.googleapis.com:443/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser@example.com%2Fuploads%2Ffile.jpg?alt=media&token=xyz";
      const result = parseNodeForUrl(nodeName);
      expect(result).not.toBeNull();
    });
  });

  describe("extractFilename", () => {
    test("extracts filename from URL-encoded path", () => {
      const url = "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2F2025-01-01T12%3A00%3A00.000Z-image.png?alt=media&token=xyz";
      const result = extractFilename(url);
      expect(result.filename).toBe("2025-01-01T12:00:00.000Z-image.png");
      expect(result.extension).toBe("png");
    });

    test("extracts filename with UUID prefix", () => {
      const url = "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2FECX10ILFf-3t02nANFqYs-P7yRGpq6Invr5MyxNj8-b-audio.m4a?alt=media&token=xyz";
      const result = extractFilename(url);
      expect(result.filename).toBe("ECX10ILFf-3t02nANFqYs-P7yRGpq6Invr5MyxNj8-b-audio.m4a");
      expect(result.extension).toBe("m4a");
    });

    test("handles .audio.webm double extension", () => {
      const url = "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2F2025-12-10T13%3A29%3A29.635Z-8M5Sv977nuo0.audio.webm?alt=media&token=xyz";
      const result = extractFilename(url);
      expect(result.filename).toBe("2025-12-10T13:29:29.635Z-8M5Sv977nuo0.audio.webm");
      expect(result.extension).toBe("webm");
    });

    test("handles uppercase extensions", () => {
      const url = "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2F2023-08-12T12%3A48%3A41.828Z-AE5281CF.JPG?alt=media&token=xyz";
      const result = extractFilename(url);
      expect(result.filename).toBe("2023-08-12T12:48:41.828Z-AE5281CF.JPG");
      expect(result.extension).toBe("jpg"); // Lowercase
    });

    test("handles URL-encoded special characters in filename", () => {
      const url = "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2FScreenshot%202025-08-19%20at%2013.53.53.png?alt=media&token=xyz";
      const result = extractFilename(url);
      expect(result.filename).toBe("Screenshot 2025-08-19 at 13.53.53.png");
      expect(result.extension).toBe("png");
    });

    test("returns unknown for unrecognized format", () => {
      const result = extractFilename("not a valid url");
      expect(result.filename).toBe("unknown");
      expect(result.extension).toBe("bin");
    });
  });
});
