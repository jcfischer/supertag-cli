/**
 * DeltaSyncPoller Tests (T-4.1)
 *
 * Tests for the background polling wrapper around DeltaSyncService:
 * - start/stop lifecycle
 * - triggerNow() calls sync()
 * - Health-aware pause/resume
 * - Error resilience (never crashes)
 * - isSyncing() and isRunning() state queries
 * - getLastResult() tracking
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "fs";
import { DeltaSyncPoller } from "../../src/mcp/delta-sync-poller";
import type { DeltaSyncResult, SearchResultNode } from "../../src/types/local-api";

// =============================================================================
// Test Helpers
// =============================================================================

/** Create a temp database with proper schema + a full sync record */
function createTestDbPath(): string {
  const dbPath = `/tmp/delta-poller-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const db = new Database(dbPath);

  db.run(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      parent_id TEXT,
      node_type TEXT,
      created INTEGER,
      updated INTEGER,
      done_at INTEGER,
      raw_data TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tag_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_node_id TEXT NOT NULL,
      data_node_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      tag_name TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_export_file TEXT NOT NULL DEFAULT '',
      last_sync_timestamp INTEGER NOT NULL DEFAULT 0,
      total_nodes INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Seed a full sync record so delta-sync does not throw "no full sync found"
  db.run(
    "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'test.json', ?, 100)",
    [Date.now()]
  );

  db.close();
  return dbPath;
}

/** Create a mock local API client */
function createMockApiClient() {
  return {
    searchNodes: mock(() => Promise.resolve([] as SearchResultNode[])),
    health: mock(() => Promise.resolve(true)),
  };
}

/** Create a mock logger that captures calls */
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

describe("DeltaSyncPoller", () => {
  let poller: DeltaSyncPoller;
  let mockApiClient: ReturnType<typeof createMockApiClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let dbPath: string;

  beforeEach(() => {
    mockApiClient = createMockApiClient();
    mockLogger = createMockLogger();
    dbPath = createTestDbPath();
  });

  afterEach(() => {
    poller?.stop();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  });

  // ---------------------------------------------------------------------------
  // Lifecycle: start / stop / isRunning
  // ---------------------------------------------------------------------------

  describe("lifecycle", () => {
    it("should not be running before start()", () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      expect(poller.isRunning()).toBe(false);
    });

    it("should be running after start()", () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      poller.start();
      expect(poller.isRunning()).toBe(true);
    });

    it("should not be running after stop()", () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      poller.start();
      poller.stop();
      expect(poller.isRunning()).toBe(false);
    });

    it("should be idempotent on start() - no duplicate intervals", () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      poller.start();
      poller.start(); // second call should be a no-op
      expect(poller.isRunning()).toBe(true);

      // Logger should only log "started" once
      const startLogs = mockLogger.info.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("started")
      );
      expect(startLogs.length).toBe(1);
    });

    it("should log on start and stop", () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      poller.start();
      expect(mockLogger.info.mock.calls.length).toBeGreaterThanOrEqual(1);

      poller.stop();
      const stopLogs = mockLogger.info.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("stopped")
      );
      expect(stopLogs.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // triggerNow()
  // ---------------------------------------------------------------------------

  describe("triggerNow()", () => {
    it("should return a DeltaSyncResult", async () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      const result = await poller.triggerNow();

      expect(result).toHaveProperty("nodesFound");
      expect(result).toHaveProperty("nodesInserted");
      expect(result).toHaveProperty("nodesUpdated");
      expect(result).toHaveProperty("durationMs");
      expect(typeof result.nodesFound).toBe("number");
    });

    it("should work without starting the poller", async () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      expect(poller.isRunning()).toBe(false);
      const result = await poller.triggerNow();
      expect(result).toHaveProperty("nodesFound");
    });
  });

  // ---------------------------------------------------------------------------
  // isSyncing()
  // ---------------------------------------------------------------------------

  describe("isSyncing()", () => {
    it("should return false when idle", () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      expect(poller.isSyncing()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // tick() - health-aware pause/resume
  // ---------------------------------------------------------------------------

  describe("tick() health awareness", () => {
    it("should pause when health check fails", async () => {
      mockApiClient.health.mockImplementation(() => Promise.resolve(false));

      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      await poller.tick();

      const warnCalls = mockLogger.warn.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("unreachable")
      );
      expect(warnCalls.length).toBe(1);
    });

    it("should resume when health check recovers", async () => {
      mockApiClient.health.mockImplementation(() => Promise.resolve(false));

      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      // First tick: health fails -> pause
      await poller.tick();

      // Now recover
      mockApiClient.health.mockImplementation(() => Promise.resolve(true));

      // Second tick: health recovers -> resume and sync
      await poller.tick();

      const reconnectLogs = mockLogger.info.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("reconnected")
      );
      expect(reconnectLogs.length).toBe(1);
    });

    it("should not sync while paused", async () => {
      mockApiClient.health.mockImplementation(() => Promise.resolve(false));

      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      // First tick pauses
      await poller.tick();

      // searchNodes should NOT be called (no sync happened)
      expect(mockApiClient.searchNodes.mock.calls.length).toBe(0);
    });

    it("should log only on transition, not every tick", async () => {
      mockApiClient.health.mockImplementation(() => Promise.resolve(false));

      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      // Two ticks while unhealthy
      await poller.tick();
      await poller.tick();

      // Warning should only appear once (transition, not every tick)
      const warnCalls = mockLogger.warn.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("unreachable")
      );
      expect(warnCalls.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Error resilience
  // ---------------------------------------------------------------------------

  describe("error resilience", () => {
    it("should catch and log errors from health check", async () => {
      mockApiClient.health.mockImplementation(() =>
        Promise.reject(new Error("Network error"))
      );

      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      // Should NOT throw
      await poller.tick();

      expect(mockLogger.error.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("should catch and log errors from sync", async () => {
      mockApiClient.health.mockImplementation(() => Promise.resolve(true));
      mockApiClient.searchNodes.mockImplementation(() =>
        Promise.reject(new Error("API timeout"))
      );

      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      // Should NOT throw
      await poller.tick();

      expect(mockLogger.error.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("should continue running after errors", async () => {
      mockApiClient.health.mockImplementationOnce(() =>
        Promise.reject(new Error("Transient failure"))
      );

      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      poller.start();

      // Error tick should not crash
      await poller.tick();

      expect(poller.isRunning()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Sync cycle logging
  // ---------------------------------------------------------------------------

  describe("sync cycle logging", () => {
    it("should log when nodes are found during sync", async () => {
      const mockNodes: SearchResultNode[] = [
        {
          id: "node1",
          name: "Test Node",
          breadcrumb: [],
          tags: [],
          tagIds: [],
          workspaceId: "ws1",
          docType: "node",
          created: new Date().toISOString(),
          inTrash: false,
        },
      ];
      mockApiClient.searchNodes.mockImplementation(() =>
        Promise.resolve(mockNodes)
      );

      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      await poller.tick();

      const completeLogs = mockLogger.info.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("complete")
      );
      expect(completeLogs.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getLastResult()
  // ---------------------------------------------------------------------------

  describe("getLastResult()", () => {
    it("should return null before any sync", () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      expect(poller.getLastResult()).toBeNull();
    });

    it("should return the result after triggerNow()", async () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      await poller.triggerNow();

      const lastResult = poller.getLastResult();
      expect(lastResult).not.toBeNull();
      expect(lastResult).toHaveProperty("nodesFound");
    });

    it("should return the result after tick()", async () => {
      poller = new DeltaSyncPoller({
        intervalMinutes: 5,
        dbPath,
        localApiClient: mockApiClient,
        logger: mockLogger,
      });

      await poller.tick();

      const lastResult = poller.getLastResult();
      expect(lastResult).not.toBeNull();
    });
  });
});
