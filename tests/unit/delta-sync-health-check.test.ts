/**
 * DeltaSyncService.ensureHealthyConnection() Tests
 *
 * Tests for the connection health check and auto-reconnect logic:
 * - Healthy connection: no reconnect
 * - Unhealthy connection: reconnect succeeds
 * - Close failure during reconnect: handled gracefully
 * - Logging: warns on unhealthy, info on re-established
 * - busy_timeout configured on reconnect
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "fs";
import { DeltaSyncService } from "../../src/services/delta-sync";
import type { SearchResultNode } from "../../src/types/local-api";

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDbPath(): string {
  const dbPath = `/tmp/delta-health-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
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

  // Seed a full sync record
  db.run(
    "INSERT INTO sync_metadata (id, last_export_file, last_sync_timestamp, total_nodes) VALUES (1, 'test.json', ?, 100)",
    [Date.now()]
  );

  db.close();
  return dbPath;
}

function createMockClient() {
  return {
    searchNodes: async () => [] as SearchResultNode[],
    health: async () => true,
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

describe("DeltaSyncService - ensureHealthyConnection()", () => {
  let service: DeltaSyncService;
  let dbPath: string;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    dbPath = createTestDbPath();
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    service?.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it("should not reconnect when connection is healthy", () => {
    service = new DeltaSyncService({
      dbPath,
      localApiClient: createMockClient(),
      logger: mockLogger,
    });

    service.ensureHealthyConnection();

    // No warn/info about reconnection
    const warnCalls = mockLogger.warn.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("unhealthy")
    );
    expect(warnCalls.length).toBe(0);
  });

  it("should reconnect when SELECT 1 fails", () => {
    service = new DeltaSyncService({
      dbPath,
      localApiClient: createMockClient(),
      logger: mockLogger,
    });

    // Close the internal DB to simulate stale connection
    // Access internals via the service's close + re-create trick:
    // We close the underlying connection by calling close(), then
    // create a new service pointing at the same file
    service.close();

    // Re-create so ensureHealthyConnection has a closed DB to detect
    service = new DeltaSyncService({
      dbPath,
      localApiClient: createMockClient(),
      logger: mockLogger,
    });

    // Manually break the connection by closing the internal db
    // @ts-expect-error - accessing private field for testing
    service.db.close();

    service.ensureHealthyConnection();

    // Should have logged the unhealthy connection
    const warnCalls = mockLogger.warn.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("unhealthy")
    );
    expect(warnCalls.length).toBe(1);

    // Should have logged re-establishment
    const infoCalls = mockLogger.info.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("re-established")
    );
    expect(infoCalls.length).toBe(1);

    // Connection should work now — verify by running a query
    service.ensureHealthyConnection(); // should not throw or warn again
    const secondWarnCalls = mockLogger.warn.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("unhealthy")
    );
    expect(secondWarnCalls.length).toBe(1); // still just the one from before
  });

  it("should handle close() gracefully during reconnect even if close is a no-op", () => {
    service = new DeltaSyncService({
      dbPath,
      localApiClient: createMockClient(),
      logger: mockLogger,
    });

    // Close the internal DB to simulate stale connection
    // In Bun, double-close doesn't throw, so we verify the reconnect
    // still works correctly regardless
    // @ts-expect-error - accessing private field for testing
    service.db.close();

    service.ensureHealthyConnection();

    // Should still have reconnected successfully
    const infoCalls = mockLogger.info.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("re-established")
    );
    expect(infoCalls.length).toBe(1);

    // Connection should work after reconnect
    service.ensureHealthyConnection();
    const secondWarnCalls = mockLogger.warn.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("unhealthy")
    );
    expect(secondWarnCalls.length).toBe(1); // only the first one
  });

  it("should configure busy_timeout on reconnected connection", () => {
    service = new DeltaSyncService({
      dbPath,
      localApiClient: createMockClient(),
      logger: mockLogger,
    });

    // Break connection
    // @ts-expect-error - accessing private field for testing
    service.db.close();

    service.ensureHealthyConnection();

    // Verify busy_timeout is set on the new connection
    // @ts-expect-error - accessing private field for testing
    const result = service.db.query("PRAGMA busy_timeout").get() as { timeout: number };
    expect(result.timeout).toBe(5000);
  });

  it("should configure busy_timeout in constructor", () => {
    service = new DeltaSyncService({
      dbPath,
      localApiClient: createMockClient(),
      logger: mockLogger,
    });

    // @ts-expect-error - accessing private field for testing
    const result = service.db.query("PRAGMA busy_timeout").get() as { timeout: number };
    expect(result.timeout).toBe(5000);
  });

  it("should allow sync to succeed after reconnect", async () => {
    service = new DeltaSyncService({
      dbPath,
      localApiClient: createMockClient(),
      logger: mockLogger,
    });

    service.ensureSchema();

    // Break connection
    // @ts-expect-error - accessing private field for testing
    service.db.close();

    // Sync should recover via ensureHealthyConnection at start of sync()
    const result = await service.sync();
    expect(result).toHaveProperty("nodesFound");
    expect(typeof result.nodesFound).toBe("number");
  });
});
