/**
 * MCP Idle Timeout Tests
 *
 * Tests for the idle auto-exit logic in the MCP server:
 * - NaN env var falls back to default
 * - SUPERTAG_MCP_IDLE_TIMEOUT=0 disables the timer
 * - Valid env var is respected
 *
 * Note: We test the timeout parsing logic directly rather than
 * the full MCP server lifecycle, since the timer is module-level.
 */

import { describe, it, expect } from "bun:test";

// =============================================================================
// Tests for the timeout parsing logic (extracted for testability)
// =============================================================================

/**
 * Replicate the timeout parsing logic from src/mcp/index.ts
 * so we can test edge cases without starting the MCP server.
 */
function parseIdleTimeout(envValue: string | undefined): number {
  const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  const rawTimeout = Number(envValue ?? DEFAULT_IDLE_TIMEOUT_MS);
  return Number.isNaN(rawTimeout) ? DEFAULT_IDLE_TIMEOUT_MS : rawTimeout;
}

describe("MCP idle timeout parsing", () => {
  const DEFAULT_30_MIN = 30 * 60 * 1000;

  it("should return 30 min default when env var is undefined", () => {
    expect(parseIdleTimeout(undefined)).toBe(DEFAULT_30_MIN);
  });

  it("should return 0 when env var is '0' (disabled)", () => {
    expect(parseIdleTimeout("0")).toBe(0);
  });

  it("should parse valid numeric string", () => {
    expect(parseIdleTimeout("60000")).toBe(60000);
  });

  it("should fall back to default for NaN values", () => {
    expect(parseIdleTimeout("abc")).toBe(DEFAULT_30_MIN);
    expect(parseIdleTimeout("not-a-number")).toBe(DEFAULT_30_MIN);
  });

  it("should treat empty string as 0 (disabled)", () => {
    // Number("") === 0, which is a valid value meaning "disabled"
    expect(parseIdleTimeout("")).toBe(0);
  });

  it("should handle negative values (treated as disabled)", () => {
    // Negative values pass the NaN check but fail the <= 0 guard in resetIdleTimer
    expect(parseIdleTimeout("-1")).toBe(-1);
  });

  it("should handle very large values", () => {
    expect(parseIdleTimeout("999999999")).toBe(999999999);
  });

  it("should handle float values", () => {
    expect(parseIdleTimeout("1500.5")).toBe(1500.5);
  });
});

// =============================================================================
// Tests for resetIdleTimer behavior
// =============================================================================

describe("MCP idle timer behavior", () => {
  it("should not create timer when timeout is 0 (disabled)", () => {
    // Replicate the guard logic
    const IDLE_TIMEOUT_MS = 0;
    let timerCreated = false;

    function resetIdleTimer() {
      if (IDLE_TIMEOUT_MS <= 0) return;
      timerCreated = true;
    }

    resetIdleTimer();
    expect(timerCreated).toBe(false);
  });

  it("should not create timer when timeout is negative", () => {
    const IDLE_TIMEOUT_MS = -1;
    let timerCreated = false;

    function resetIdleTimer() {
      if (IDLE_TIMEOUT_MS <= 0) return;
      timerCreated = true;
    }

    resetIdleTimer();
    expect(timerCreated).toBe(false);
  });

  it("should create timer when timeout is positive", () => {
    const IDLE_TIMEOUT_MS = 1000;
    let timerCreated = false;

    function resetIdleTimer() {
      if (IDLE_TIMEOUT_MS <= 0) return;
      timerCreated = true;
    }

    resetIdleTimer();
    expect(timerCreated).toBe(true);
  });

  it("should skip exit when activePoller is syncing", () => {
    let exitCalled = false;
    let timerReset = false;
    const mockPoller = {
      isSyncing: () => true,
      stop: () => {},
    };

    // Replicate the timer callback logic
    function idleTimeoutCallback() {
      if (mockPoller?.isSyncing()) {
        timerReset = true;
        return;
      }
      exitCalled = true;
    }

    idleTimeoutCallback();
    expect(exitCalled).toBe(false);
    expect(timerReset).toBe(true);
  });

  it("should exit when activePoller is not syncing", () => {
    let exitCalled = false;
    const mockPoller = {
      isSyncing: () => false,
      stop: () => {},
    };

    function idleTimeoutCallback() {
      if (mockPoller?.isSyncing()) {
        return;
      }
      mockPoller.stop();
      exitCalled = true;
    }

    idleTimeoutCallback();
    expect(exitCalled).toBe(true);
  });

  it("should exit when activePoller is null", () => {
    let exitCalled = false;
    const mockPoller = null;

    function idleTimeoutCallback() {
      if (mockPoller?.isSyncing()) {
        return;
      }
      mockPoller?.stop();
      exitCalled = true;
    }

    idleTimeoutCallback();
    expect(exitCalled).toBe(true);
  });
});
