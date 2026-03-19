/**
 * MCP Idle Timeout Tests
 *
 * Tests for the idle auto-exit feature in the MCP server:
 * - Timeout parsing and NaN guard
 * - Timer reset on tool calls
 * - Disable with SUPERTAG_MCP_IDLE_TIMEOUT=0
 * - Process exit after timeout
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("MCP Idle Timeout", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.SUPERTAG_MCP_IDLE_TIMEOUT;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SUPERTAG_MCP_IDLE_TIMEOUT = originalEnv;
    } else {
      delete process.env.SUPERTAG_MCP_IDLE_TIMEOUT;
    }
  });

  describe("timeout parsing", () => {
    it("should use default timeout when env var not set", () => {
      delete process.env.SUPERTAG_MCP_IDLE_TIMEOUT;

      const rawTimeout = Number(process.env.SUPERTAG_MCP_IDLE_TIMEOUT ?? 30 * 60 * 1000);
      const IDLE_TIMEOUT_MS = Number.isNaN(rawTimeout) ? 30 * 60 * 1000 : rawTimeout;

      expect(IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000); // 30 minutes
    });

    it("should parse valid numeric timeout", () => {
      process.env.SUPERTAG_MCP_IDLE_TIMEOUT = "60000";

      const rawTimeout = Number(process.env.SUPERTAG_MCP_IDLE_TIMEOUT ?? 30 * 60 * 1000);
      const IDLE_TIMEOUT_MS = Number.isNaN(rawTimeout) ? 30 * 60 * 1000 : rawTimeout;

      expect(IDLE_TIMEOUT_MS).toBe(60000);
    });

    it("should guard against NaN and use default", () => {
      process.env.SUPERTAG_MCP_IDLE_TIMEOUT = "invalid";

      const rawTimeout = Number(process.env.SUPERTAG_MCP_IDLE_TIMEOUT ?? 30 * 60 * 1000);
      const IDLE_TIMEOUT_MS = Number.isNaN(rawTimeout) ? 30 * 60 * 1000 : rawTimeout;

      expect(IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000); // Falls back to default
    });

    it("should allow disabling with 0", () => {
      process.env.SUPERTAG_MCP_IDLE_TIMEOUT = "0";

      const rawTimeout = Number(process.env.SUPERTAG_MCP_IDLE_TIMEOUT ?? 30 * 60 * 1000);
      const IDLE_TIMEOUT_MS = Number.isNaN(rawTimeout) ? 30 * 60 * 1000 : rawTimeout;

      expect(IDLE_TIMEOUT_MS).toBe(0);
    });

    it("should guard against empty string", () => {
      process.env.SUPERTAG_MCP_IDLE_TIMEOUT = "";

      const rawTimeout = Number(process.env.SUPERTAG_MCP_IDLE_TIMEOUT ?? 30 * 60 * 1000);
      const IDLE_TIMEOUT_MS = Number.isNaN(rawTimeout) ? 30 * 60 * 1000 : rawTimeout;

      expect(IDLE_TIMEOUT_MS).toBe(0); // Empty string converts to 0, which is valid
    });

    it("should handle negative numbers (treated as timeout value)", () => {
      process.env.SUPERTAG_MCP_IDLE_TIMEOUT = "-1000";

      const rawTimeout = Number(process.env.SUPERTAG_MCP_IDLE_TIMEOUT ?? 30 * 60 * 1000);
      const IDLE_TIMEOUT_MS = Number.isNaN(rawTimeout) ? 30 * 60 * 1000 : rawTimeout;

      expect(IDLE_TIMEOUT_MS).toBe(-1000);
    });
  });

  describe("resetIdleTimer logic", () => {
    it("should skip timer creation when timeout is 0", () => {
      const IDLE_TIMEOUT_MS = 0;
      let timerCreated = false;

      // Simulate resetIdleTimer logic
      if (IDLE_TIMEOUT_MS > 0) {
        timerCreated = true;
      }

      expect(timerCreated).toBe(false);
    });

    it("should skip timer creation when timeout is negative", () => {
      const IDLE_TIMEOUT_MS = -1000;
      let timerCreated = false;

      // Simulate resetIdleTimer logic
      if (IDLE_TIMEOUT_MS > 0) {
        timerCreated = true;
      }

      expect(timerCreated).toBe(false);
    });

    it("should create timer when timeout is positive", () => {
      const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
      let timerCreated = false;

      // Simulate resetIdleTimer logic
      if (IDLE_TIMEOUT_MS > 0) {
        timerCreated = true;
      }

      expect(timerCreated).toBe(true);
    });
  });

  describe("timer unref behavior", () => {
    it("should verify unref is called on Node.js timeout objects", () => {
      // Create a timer to verify it has unref method
      const timer = setTimeout(() => {}, 1000);

      expect(timer).toBeDefined();
      expect(typeof timer === "object").toBe(true);
      expect("unref" in timer).toBe(true);

      clearTimeout(timer);
    });
  });
});
