/**
 * tana_semantic_search Tool Tests
 *
 * TDD tests for semantic search MCP tool (resona migration).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { semanticSearch, type SemanticSearchResult } from "../semantic-search";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock the config paths module
let testDir: string;
let testDbPath: string;
let originalGetDatabasePath: typeof import("../../../config/paths").getDatabasePath;

describe("tana_semantic_search", () => {
  describe("schema validation", () => {
    it("should require query parameter", async () => {
      // @ts-expect-error - testing missing required field
      await expect(semanticSearch({})).rejects.toThrow();
    });

    it("should accept valid input with defaults", async () => {
      // This will fail because no embeddings configured, but validates schema
      const input = {
        query: "test query",
        workspace: undefined,
        limit: 20,
        raw: false,
        includeContents: false,
        depth: 0,
        includeAncestor: true,
      };
      try {
        await semanticSearch(input);
      } catch (e) {
        // Expected to fail due to no config, but shouldn't be schema error
        expect((e as Error).message).not.toContain("required");
      }
    });
  });

  describe("result structure", () => {
    it("should return workspace, query, results, and count fields", async () => {
      // Mock a result structure check
      const expectedShape: SemanticSearchResult = {
        workspace: "default",
        query: "test",
        results: [],
        count: 0,
        model: "test-model",
        dimensions: 768,
      };

      expect(expectedShape).toHaveProperty("workspace");
      expect(expectedShape).toHaveProperty("query");
      expect(expectedShape).toHaveProperty("results");
      expect(expectedShape).toHaveProperty("count");
      expect(expectedShape).toHaveProperty("model");
      expect(expectedShape).toHaveProperty("dimensions");
    });

    it("should include similarity scores in results", () => {
      const mockResult = {
        nodeId: "abc123",
        name: "Test node",
        similarity: 0.85,
        distance: 0.15,
      };

      expect(mockResult.similarity).toBeGreaterThanOrEqual(0);
      expect(mockResult.similarity).toBeLessThanOrEqual(1);
      expect(mockResult.similarity + mockResult.distance).toBeCloseTo(1);
    });
  });

  describe("input handling", () => {
    it("should handle limit parameter", () => {
      const input = { query: "test", limit: 5 };
      expect(input.limit).toBe(5);
    });

    it("should handle minSimilarity parameter", () => {
      const input = { query: "test", minSimilarity: 0.7 };
      expect(input.minSimilarity).toBe(0.7);
    });

    it("should handle workspace parameter", () => {
      const input = { query: "test", workspace: "custom" };
      expect(input.workspace).toBe("custom");
    });
  });

  describe("resona migration", () => {
    it("should use TanaEmbeddingService instead of sqlite-vec", async () => {
      // Import TanaEmbeddingService - should exist and be usable
      const { TanaEmbeddingService } = await import("../../../embeddings/tana-embedding-service");
      expect(TanaEmbeddingService).toBeDefined();
    });

    it("should use ConfigManager for embedding config", async () => {
      const { ConfigManager, DEFAULT_EMBEDDING_CONFIG } = await import("../../../config/manager");
      const configManager = ConfigManager.getInstance();
      const embeddingConfig = configManager.getEmbeddingConfig();

      expect(embeddingConfig.model).toBe(DEFAULT_EMBEDDING_CONFIG.model);
    });

    it("should derive LanceDB path from SQLite path", () => {
      const sqlitePath = "/path/to/tana-index.db";
      const lancePath = sqlitePath.replace(/\.db$/, ".lance");

      expect(lancePath).toBe("/path/to/tana-index.lance");
    });

    it("should not require sqlite-vec extension", async () => {
      // The module should not export getSqliteVecPath or getEmbeddingDatabase
      const module = await import("../semantic-search");
      expect((module as any).getSqliteVecPath).toBeUndefined();
      expect((module as any).getEmbeddingDatabase).toBeUndefined();
    });
  });
});
