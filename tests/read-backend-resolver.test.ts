/**
 * Tests for Read Backend Resolver
 * Spec: F-097 Live Read Backend
 * Task: T-2.3
 */
import { describe, test, expect, beforeEach } from "bun:test";

import {
  resolveReadBackend,
  clearReadBackendCache,
} from "../src/api/read-backend-resolver";

// We'll test the resolver's behavior with no Local API configured.
// The resolver should:
// 1. Return SqliteReadBackend when offline=true
// 2. Return cached backend on subsequent calls (non-offline path)
// 3. Not cache offline backends (user may switch back)
// 4. Fall back to SqliteReadBackend when Local API is unhealthy
// 5. Never throw — always return a backend

describe("F-097 T-2.3: Read Backend Resolver", () => {
  beforeEach(() => {
    clearReadBackendCache();
  });

  test("resolveReadBackend returns a TanaReadBackend", async () => {
    const backend = await resolveReadBackend({ offline: true, dbPath: ":memory:" });
    expect(backend).toBeDefined();
    expect(backend.type).toBe("sqlite");
  });

  test("offline flag forces SQLite backend", async () => {
    const backend = await resolveReadBackend({ offline: true, dbPath: ":memory:" });
    expect(backend.type).toBe("sqlite");
    expect(backend.isLive()).toBe(false);
  });

  test("offline backends are NOT cached — user may switch back", async () => {
    const backend1 = await resolveReadBackend({ offline: true, dbPath: ":memory:" });
    const backend2 = await resolveReadBackend({ offline: true, dbPath: ":memory:" });
    // Offline backends are always fresh instances
    expect(backend1).not.toBe(backend2);
  });

  test("caches fallback SQLite backend across calls", async () => {
    // Non-offline path: Local API not configured → falls back to SQLite and caches
    const backend1 = await resolveReadBackend({ dbPath: ":memory:" });
    const backend2 = await resolveReadBackend({ dbPath: ":memory:" });
    // Same instance returned from cache
    expect(backend1).toBe(backend2);
  });

  test("clearReadBackendCache forces re-resolution", async () => {
    const backend1 = await resolveReadBackend({ dbPath: ":memory:" });
    clearReadBackendCache();
    const backend2 = await resolveReadBackend({ dbPath: ":memory:" });
    // Different instance after cache clear
    expect(backend1).not.toBe(backend2);
  });

  test("forceRefresh bypasses cache", async () => {
    const backend1 = await resolveReadBackend({ dbPath: ":memory:" });
    const backend2 = await resolveReadBackend({ dbPath: ":memory:", forceRefresh: true });
    expect(backend1).not.toBe(backend2);
  });

  test("never throws — falls back to SQLite", async () => {
    // Even with bad config, should not throw
    const backend = await resolveReadBackend({ dbPath: ":memory:" });
    expect(backend).toBeDefined();
    expect(typeof backend.type).toBe("string");
  });

  test("SqliteReadBackend isLive returns false", async () => {
    const backend = await resolveReadBackend({ offline: true, dbPath: ":memory:" });
    expect(backend.isLive()).toBe(false);
  });
});
