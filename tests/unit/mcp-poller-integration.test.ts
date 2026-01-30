/**
 * MCP Poller Integration Tests (T-4.2)
 *
 * Tests for delta-sync poller lifecycle within the MCP server:
 * - Poller starts when bearer token and interval are configured
 * - Poller does NOT start without bearer token
 * - Poller does NOT start when interval is 0
 * - activePoller export is set/null appropriately
 * - initDeltaSyncPoller function handles configuration correctly
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { initDeltaSyncPoller } from "../../src/mcp/delta-sync-poller";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockApiClient() {
  return {
    searchNodes: mock(() => Promise.resolve([])),
    health: mock(() => Promise.resolve(true)),
  };
}

function createMockLogger() {
  return {
    info: mock((..._args: unknown[]) => {}),
    warn: mock((..._args: unknown[]) => {}),
    error: mock((..._args: unknown[]) => {}),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("MCP Poller Integration", () => {
  describe("initDeltaSyncPoller()", () => {
    it("should return a started poller when bearer token and interval > 0", () => {
      const logger = createMockLogger();
      const apiClient = createMockApiClient();

      const poller = initDeltaSyncPoller({
        localApiConfig: {
          enabled: true,
          bearerToken: "test-token-123",
          endpoint: "http://localhost:8262",
        },
        syncInterval: 5,
        dbPath: ":memory:",
        embeddingConfig: undefined,
        logger,
        localApiClientFactory: () => apiClient,
      });

      expect(poller).not.toBeNull();
      expect(poller!.isRunning()).toBe(true);

      // Cleanup
      poller!.stop();
    });

    it("should return null when bearer token is missing", () => {
      const logger = createMockLogger();

      const poller = initDeltaSyncPoller({
        localApiConfig: {
          enabled: true,
          bearerToken: undefined,
          endpoint: "http://localhost:8262",
        },
        syncInterval: 5,
        dbPath: ":memory:",
        embeddingConfig: undefined,
        logger,
      });

      expect(poller).toBeNull();
    });

    it("should return null when bearer token is empty string", () => {
      const logger = createMockLogger();

      const poller = initDeltaSyncPoller({
        localApiConfig: {
          enabled: true,
          bearerToken: "",
          endpoint: "http://localhost:8262",
        },
        syncInterval: 5,
        dbPath: ":memory:",
        embeddingConfig: undefined,
        logger,
      });

      expect(poller).toBeNull();
    });

    it("should return null when interval is 0 (disabled)", () => {
      const logger = createMockLogger();
      const apiClient = createMockApiClient();

      const poller = initDeltaSyncPoller({
        localApiConfig: {
          enabled: true,
          bearerToken: "test-token-123",
          endpoint: "http://localhost:8262",
        },
        syncInterval: 0,
        dbPath: ":memory:",
        embeddingConfig: undefined,
        logger,
        localApiClientFactory: () => apiClient,
      });

      expect(poller).toBeNull();
    });

    it("should return null when local API is disabled", () => {
      const logger = createMockLogger();
      const apiClient = createMockApiClient();

      const poller = initDeltaSyncPoller({
        localApiConfig: {
          enabled: false,
          bearerToken: "test-token-123",
          endpoint: "http://localhost:8262",
        },
        syncInterval: 5,
        dbPath: ":memory:",
        embeddingConfig: undefined,
        logger,
        localApiClientFactory: () => apiClient,
      });

      expect(poller).toBeNull();
    });

    it("should log initialization when poller starts", () => {
      const logger = createMockLogger();
      const apiClient = createMockApiClient();

      const poller = initDeltaSyncPoller({
        localApiConfig: {
          enabled: true,
          bearerToken: "test-token-123",
          endpoint: "http://localhost:8262",
        },
        syncInterval: 5,
        dbPath: ":memory:",
        embeddingConfig: undefined,
        logger,
        localApiClientFactory: () => apiClient,
      });

      // Should log that the poller was initialized
      const initLogs = logger.info.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("initialized")
      );
      expect(initLogs.length).toBe(1);

      poller?.stop();
    });

    it("should pass embedding config through to the poller", () => {
      const logger = createMockLogger();
      const apiClient = createMockApiClient();

      const embeddingConfig = { model: "mxbai-embed-large", endpoint: "http://localhost:11434" };

      const poller = initDeltaSyncPoller({
        localApiConfig: {
          enabled: true,
          bearerToken: "test-token-123",
          endpoint: "http://localhost:8262",
        },
        syncInterval: 10,
        dbPath: ":memory:",
        embeddingConfig,
        logger,
        localApiClientFactory: () => apiClient,
      });

      expect(poller).not.toBeNull();
      expect(poller!.isRunning()).toBe(true);

      poller!.stop();
    });

    it("should use custom localApiClientFactory when provided", () => {
      const logger = createMockLogger();
      const apiClient = createMockApiClient();
      const factory = mock(() => apiClient);

      const poller = initDeltaSyncPoller({
        localApiConfig: {
          enabled: true,
          bearerToken: "test-token-123",
          endpoint: "http://localhost:8262",
        },
        syncInterval: 5,
        dbPath: ":memory:",
        embeddingConfig: undefined,
        logger,
        localApiClientFactory: factory,
      });

      expect(factory).toHaveBeenCalled();
      expect(poller).not.toBeNull();

      poller?.stop();
    });
  });
});
