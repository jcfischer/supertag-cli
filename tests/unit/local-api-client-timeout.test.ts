/**
 * LocalApiClient timeout tests (v2.5.5 fix A)
 *
 * Verifies that hung HTTP responses surface as retryable TIMEOUT errors
 * instead of hanging forever. Regression test for the Windows 11 delta-sync
 * hang reported against v2.5.4.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { LocalApiClient } from "../../src/api/local-api-client";
import { StructuredError } from "../../src/utils/structured-errors";
import { createServer, type Server } from "http";

function startHangingServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    // This server accepts connections but never responds. Simulates a
    // Tana Desktop process that is wedged mid-request.
    const server = createServer((_req, _res) => {
      // intentionally do nothing
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      }
    });
  });
}

describe("LocalApiClient timeout handling", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const started = await startHangingServer();
    server = started.server;
    port = started.port;
  });

  afterAll(() => {
    server.close();
  });

  it("aborts a hung request after the configured timeout", async () => {
    const client = new LocalApiClient({
      endpoint: `http://127.0.0.1:${port}`,
      bearerToken: "test-token",
      timeoutMs: 150, // short timeout so the test completes quickly
    });

    const start = Date.now();
    let caught: unknown;
    try {
      await client.searchNodes({ textContains: "anything" });
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - start;

    expect(caught).toBeInstanceOf(StructuredError);
    expect((caught as StructuredError).code).toBe("TIMEOUT");

    // 3 attempts * 150ms timeout + backoff (100 + 400 + 900 = 1400) ~= under 5s
    expect(elapsed).toBeLessThan(5000);
    // Must have waited at least one timeout cycle
    expect(elapsed).toBeGreaterThanOrEqual(150);
  }, 10000);

  it("health() returns false when server hangs (never throws)", async () => {
    const client = new LocalApiClient({
      endpoint: `http://127.0.0.1:${port}`,
      bearerToken: "test-token",
      timeoutMs: 150,
    });

    const healthy = await client.health();
    expect(healthy).toBe(false);
  }, 10000);

  it("clears the timeout timer on a successful response (no lingering timers)", async () => {
    // Spy on clearTimeout to confirm it fires once per successful request.
    const originalClearTimeout = globalThis.clearTimeout;
    let clearCount = 0;
    globalThis.clearTimeout = ((id: NodeJS.Timeout | number) => {
      clearCount++;
      return originalClearTimeout(id as NodeJS.Timeout);
    }) as typeof clearTimeout;

    // Stand up a responsive server on a fresh port that matches HealthResponseSchema.
    const okServer = await new Promise<{ server: Server; port: number }>((resolve) => {
      const srv = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          nodeSpaceReady: true,
        }));
      });
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") resolve({ server: srv, port: addr.port });
      });
    });

    try {
      const client = new LocalApiClient({
        endpoint: `http://127.0.0.1:${okServer.port}`,
        bearerToken: "test-token",
        timeoutMs: 5000,
      });

      const before = clearCount;
      const healthy = await client.health();
      const after = clearCount;

      expect(healthy).toBe(true);
      // At least one clearTimeout call from our `finally` block.
      expect(after).toBeGreaterThan(before);
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
      okServer.server.close();
    }
  }, 10000);

  it("falls back to the default timeout when constructor receives invalid values", () => {
    // Non-finite / zero / negative should all be ignored in favor of the default.
    // We inspect via a timeout reaching the hanging server: if the fallback
    // (30_000ms default) were used, the test would hit its timeout. With the
    // explicit override to 150ms below via env var, the abort fires quickly.
    const origEnv = process.env.SUPERTAG_LOCAL_API_TIMEOUT_MS;
    try {
      process.env.SUPERTAG_LOCAL_API_TIMEOUT_MS = "150";

      // Passing invalid values should fall through to env/default resolution.
      const cases = [0, -1, NaN, Infinity];
      for (const bad of cases) {
        const client = new LocalApiClient({
          endpoint: `http://127.0.0.1:${port}`,
          bearerToken: "t",
          timeoutMs: bad,
        });
        // Access private via a cast — we're asserting the constructor does not
        // store the bad value.
        const resolved = (client as unknown as { timeoutMs: number }).timeoutMs;
        expect(resolved).toBe(150);
      }
    } finally {
      if (origEnv === undefined) {
        delete process.env.SUPERTAG_LOCAL_API_TIMEOUT_MS;
      } else {
        process.env.SUPERTAG_LOCAL_API_TIMEOUT_MS = origEnv;
      }
    }
  });
});
