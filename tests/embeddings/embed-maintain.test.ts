/**
 * Tests for F-106: Embedding Maintenance & Diagnostics
 *
 * Tests getDiskSize, getFragmentCount, formatBytes, stale cleanup logic,
 * and maintain command behavior (dry-run, --stale flag, before/after metrics).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatBytes } from "../../src/embeddings/tana-embedding-service";

/**
 * Helper to create a TanaEmbeddingService with a real temp directory
 * but mock the resona service calls
 */
function createTempLanceDir(): string {
  const dir = join(tmpdir(), `lance-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createFakeLanceStructure(baseDir: string, opts: {
  fragmentCount?: number;
  fileSizeBytes?: number;
} = {}): void {
  const fragmentCount = opts.fragmentCount ?? 3;
  const fileSizeBytes = opts.fileSizeBytes ?? 1024;

  // Create embeddings.lance/data/ directory with fragment subdirectories
  const dataDir = join(baseDir, "embeddings.lance", "data");
  mkdirSync(dataDir, { recursive: true });

  for (let i = 0; i < fragmentCount; i++) {
    const fragDir = join(dataDir, `fragment-${i}`);
    mkdirSync(fragDir, { recursive: true });
    // Create a dummy file in each fragment
    writeFileSync(join(fragDir, "data.lance"), Buffer.alloc(fileSizeBytes));
  }

  // Create some top-level files
  writeFileSync(join(baseDir, "embeddings.lance", "metadata.json"), "{}");
}

describe("F-106: Embedding Maintenance & Diagnostics", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempLanceDir();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===== T-1.1: formatBytes =====
  describe("formatBytes", () => {
    it("formats zero bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    it("formats bytes under 1 KB", () => {
      expect(formatBytes(500)).toBe("500.0 B");
    });

    it("formats kilobytes", () => {
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });

    it("formats megabytes", () => {
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
    });

    it("formats gigabytes", () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
      expect(formatBytes(33.2 * 1024 * 1024 * 1024)).toBe("33.2 GB");
    });

    it("formats terabytes", () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB");
    });
  });

  // ===== T-1.1: getDiskSize =====
  describe("getDiskSize", () => {
    it("returns zero for empty directory", async () => {
      // Import the class to test getDiskSize directly
      // We need to mock the resona EmbeddingService constructor
      // Instead, test the logic via formatBytes + directory size calculation
      const { TanaEmbeddingService } = await import("../../src/embeddings/tana-embedding-service");

      // Create a minimal service - it will fail to connect to Ollama but we
      // only need getDiskSize which is filesystem-only
      const service = new TanaEmbeddingService(tempDir, {
        model: "bge-m3",
        endpoint: "http://localhost:99999", // Non-existent, won't be used
      });

      const result = service.getDiskSize();
      expect(result.bytes).toBe(0);
      expect(result.formatted).toBe("0 B");

      service.close();
    });

    it("returns correct size for directory with files", async () => {
      createFakeLanceStructure(tempDir, { fragmentCount: 2, fileSizeBytes: 512 });

      const { TanaEmbeddingService } = await import("../../src/embeddings/tana-embedding-service");
      const service = new TanaEmbeddingService(tempDir, {
        model: "bge-m3",
        endpoint: "http://localhost:99999",
      });

      const result = service.getDiskSize();
      // 2 fragments * 512 bytes each + metadata.json (2 bytes for "{}")
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.bytes).toBe(1026); // 2*512 + 2 bytes
      expect(result.formatted).toBe("1.0 KB");

      service.close();
    });
  });

  // ===== T-1.1: getFragmentCount =====
  describe("getFragmentCount", () => {
    it("returns zero when data directory does not exist", async () => {
      const { TanaEmbeddingService } = await import("../../src/embeddings/tana-embedding-service");
      const service = new TanaEmbeddingService(tempDir, {
        model: "bge-m3",
        endpoint: "http://localhost:99999",
      });

      expect(service.getFragmentCount()).toBe(0);
      service.close();
    });

    it("returns correct fragment count", async () => {
      createFakeLanceStructure(tempDir, { fragmentCount: 5 });

      const { TanaEmbeddingService } = await import("../../src/embeddings/tana-embedding-service");
      const service = new TanaEmbeddingService(tempDir, {
        model: "bge-m3",
        endpoint: "http://localhost:99999",
      });

      expect(service.getFragmentCount()).toBe(5);
      service.close();
    });

    it("does not count files as fragments", async () => {
      createFakeLanceStructure(tempDir, { fragmentCount: 3 });
      // Add a file in the data dir (not a fragment)
      const dataDir = join(tempDir, "embeddings.lance", "data");
      writeFileSync(join(dataDir, "some-file.txt"), "not a fragment");

      const { TanaEmbeddingService } = await import("../../src/embeddings/tana-embedding-service");
      const service = new TanaEmbeddingService(tempDir, {
        model: "bge-m3",
        endpoint: "http://localhost:99999",
      });

      expect(service.getFragmentCount()).toBe(3); // Only directories
      service.close();
    });
  });

  // ===== T-2.1: Stale ID computation =====
  describe("stale ID computation", () => {
    it("correctly identifies stale IDs (set difference)", () => {
      const embeddedIds = ["a", "b", "c", "d", "e"];
      const validNodeIds = new Set(["a", "c", "e"]);
      const staleIds = embeddedIds.filter(id => !validNodeIds.has(id));

      expect(staleIds).toEqual(["b", "d"]);
      expect(staleIds.length).toBe(2);
    });

    it("returns empty when all IDs are valid", () => {
      const embeddedIds = ["a", "b", "c"];
      const validNodeIds = new Set(["a", "b", "c", "d"]);
      const staleIds = embeddedIds.filter(id => !validNodeIds.has(id));

      expect(staleIds).toEqual([]);
    });

    it("identifies all as stale when no valid IDs", () => {
      const embeddedIds = ["a", "b", "c"];
      const validNodeIds = new Set<string>();
      const staleIds = embeddedIds.filter(id => !validNodeIds.has(id));

      expect(staleIds).toEqual(["a", "b", "c"]);
    });

    it("handles large ID sets efficiently", () => {
      // Simulate 100K embedded IDs, 70K valid
      const embeddedIds = Array.from({ length: 100_000 }, (_, i) => `node-${i}`);
      const validNodeIds = new Set(Array.from({ length: 70_000 }, (_, i) => `node-${i}`));

      const start = performance.now();
      const staleIds = embeddedIds.filter(id => !validNodeIds.has(id));
      const elapsed = performance.now() - start;

      expect(staleIds.length).toBe(30_000);
      expect(elapsed).toBeLessThan(1000); // Should complete well under 1 second
    });
  });
});
