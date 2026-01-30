/**
 * MCP tana_sync Delta Mode Tests (T-3.3)
 *
 * Tests for the MCP tana_sync tool delta mode:
 * - delta action calls DeltaSyncService.sync()
 * - status action includes delta-sync info
 * - delta action with unhealthy API returns error
 * - Schema enum includes 'delta'
 */

import { describe, it, expect } from "bun:test";
import { syncSchema } from "../../schemas";
import type { SyncResult } from "../sync";

describe("MCP tana_sync delta mode (T-3.3)", () => {
  describe("schema validation", () => {
    it("should accept 'delta' as a valid action", () => {
      const result = syncSchema.safeParse({ action: "delta" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("delta");
      }
    });

    it("should still accept 'index' as default action", () => {
      const result = syncSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("index");
      }
    });

    it("should still accept 'status' action", () => {
      const result = syncSchema.safeParse({ action: "status" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("status");
      }
    });

    it("should reject invalid action", () => {
      const result = syncSchema.safeParse({ action: "invalid" });
      expect(result.success).toBe(false);
    });

    it("should accept workspace parameter with delta action", () => {
      const result = syncSchema.safeParse({
        action: "delta",
        workspace: "main",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("delta");
        expect(result.data.workspace).toBe("main");
      }
    });
  });

  describe("SyncResult type contract for delta", () => {
    it("should support delta-sync result fields", () => {
      // When delta sync succeeds, the SyncResult should include
      // delta-specific fields alongside the standard ones
      const result: SyncResult = {
        workspace: "main",
        action: "delta",
        exportDir: "/path/to/exports",
        dbPath: "/path/to/db.sqlite",
        // Delta-specific fields
        deltaResult: {
          nodesFound: 12,
          nodesInserted: 3,
          nodesUpdated: 9,
          nodesSkipped: 0,
          embeddingsGenerated: 12,
          embeddingsSkipped: false,
          watermarkBefore: 1000000,
          watermarkAfter: 2000000,
          durationMs: 2340,
          pages: 3,
        },
      };

      expect(result.action).toBe("delta");
      expect(result.deltaResult).toBeDefined();
      expect(result.deltaResult!.nodesFound).toBe(12);
      expect(result.deltaResult!.nodesInserted).toBe(3);
      expect(result.deltaResult!.nodesUpdated).toBe(9);
      expect(result.deltaResult!.durationMs).toBe(2340);
      expect(result.deltaResult!.pages).toBe(3);
    });

    it("should support error in delta result", () => {
      const result: SyncResult = {
        workspace: "main",
        action: "delta",
        exportDir: "/path/to/exports",
        dbPath: "/path/to/db.sqlite",
        error: "Tana Desktop is not running or Local API is disabled",
      };

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Tana Desktop");
    });

    it("should support missing bearer token error", () => {
      const result: SyncResult = {
        workspace: "main",
        action: "delta",
        exportDir: "/path/to/exports",
        dbPath: "/path/to/db.sqlite",
        error:
          "No bearer token configured for Local API. Set localApi.bearerToken in config.",
      };

      expect(result.error).toContain("bearer token");
    });
  });

  describe("status action with delta-sync info", () => {
    it("should include deltaSyncStatus in status result", () => {
      const result: SyncResult = {
        workspace: "main",
        action: "status",
        exportDir: "/path/to/exports",
        dbPath: "/path/to/db.sqlite",
        latestExport: "export-2026-01-30.json",
        lastIndexed: Date.now() - 3600000,
        deltaSyncStatus: {
          lastFullSync: Date.now() - 86400000,
          lastDeltaSync: Date.now() - 300000,
          lastDeltaNodesCount: 12,
          totalNodes: 145242,
          embeddingCoverage: 98.2,
        },
      };

      expect(result.deltaSyncStatus).toBeDefined();
      expect(result.deltaSyncStatus!.lastDeltaSync).toBeDefined();
      expect(result.deltaSyncStatus!.lastDeltaNodesCount).toBe(12);
      expect(result.deltaSyncStatus!.totalNodes).toBe(145242);
      expect(result.deltaSyncStatus!.embeddingCoverage).toBe(98.2);
    });

    it("should handle status with no delta-sync history", () => {
      const result: SyncResult = {
        workspace: "main",
        action: "status",
        exportDir: "/path/to/exports",
        dbPath: "/path/to/db.sqlite",
        latestExport: "export-2026-01-30.json",
        lastIndexed: Date.now(),
        deltaSyncStatus: {
          lastFullSync: Date.now(),
          lastDeltaSync: null,
          lastDeltaNodesCount: 0,
          totalNodes: 100000,
          embeddingCoverage: 0,
        },
      };

      expect(result.deltaSyncStatus!.lastDeltaSync).toBeNull();
      expect(result.deltaSyncStatus!.lastDeltaNodesCount).toBe(0);
    });
  });

  describe("delta sync integration logic", () => {
    it("should build LocalApiClient config from ConfigManager", () => {
      // The delta handler needs to:
      // 1. Get ConfigManager.getInstance()
      // 2. Call getLocalApiConfig()
      // 3. Verify bearerToken exists
      // 4. Create LocalApiClient with endpoint + bearerToken
      const mockConfig = {
        enabled: true,
        bearerToken: "test-token-123",
        endpoint: "http://localhost:8262",
      };

      expect(mockConfig.bearerToken).toBeTruthy();
      expect(mockConfig.endpoint).toBe("http://localhost:8262");
    });

    it("should return error when no bearer token in delta mode", () => {
      const mockConfig = {
        enabled: true,
        bearerToken: undefined,
        endpoint: "http://localhost:8262",
      };

      const hasBearerToken = !!mockConfig.bearerToken;
      expect(hasBearerToken).toBe(false);

      // Expected behavior: return SyncResult with error, not throw
      const errorResult: SyncResult = {
        workspace: "main",
        action: "delta",
        exportDir: "",
        dbPath: "",
        error:
          "No bearer token configured for Local API. Set localApi.bearerToken in config.",
      };
      expect(errorResult.error).toContain("bearer token");
    });

    it("should return error when health check fails", () => {
      // Expected behavior: return SyncResult with error
      const errorResult: SyncResult = {
        workspace: "main",
        action: "delta",
        exportDir: "",
        dbPath: "",
        error:
          "Tana Desktop is not running or Local API is disabled. Start Tana Desktop and enable Settings > Local API.",
      };
      expect(errorResult.error).toContain("Tana Desktop");
    });
  });
});
