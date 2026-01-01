/**
 * Tests for errors CLI command
 * Spec: 073-error-context
 * Task: T-4.3
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { errorsCommand } from "../../src/commands/errors";

// Use a temp directory for tests
const TEST_DIR = "/tmp/supertag-errors-command-test";
const TEST_LOG_PATH = join(TEST_DIR, "errors.log");

describe("errorsCommand", () => {
  beforeEach(() => {
    // Create test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("list errors", () => {
    it("should show message when no errors", async () => {
      const output: string[] = [];
      const mockConsole = {
        log: (msg: string) => output.push(msg),
      };

      await errorsCommand(
        {},
        { logPath: TEST_LOG_PATH, console: mockConsole as any }
      );

      expect(output.join("\n")).toContain("No errors logged");
    });

    it("should list recent errors", async () => {
      // Write test entries
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "API_ERROR", message: "Failed" },
        { timestamp: "2025-01-01T11:00:00Z", code: "DATABASE_NOT_FOUND", message: "Not found" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const output: string[] = [];
      const mockConsole = {
        log: (msg: string) => output.push(msg),
      };

      await errorsCommand(
        {},
        { logPath: TEST_LOG_PATH, console: mockConsole as any }
      );

      const joined = output.join("\n");
      expect(joined).toContain("API_ERROR");
      expect(joined).toContain("DATABASE_NOT_FOUND");
    });

    it("should limit to --last N entries", async () => {
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "ERROR_1", message: "First" },
        { timestamp: "2025-01-01T11:00:00Z", code: "ERROR_2", message: "Second" },
        { timestamp: "2025-01-01T12:00:00Z", code: "ERROR_3", message: "Third" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const output: string[] = [];
      const mockConsole = {
        log: (msg: string) => output.push(msg),
      };

      await errorsCommand(
        { last: 2 },
        { logPath: TEST_LOG_PATH, console: mockConsole as any }
      );

      const joined = output.join("\n");
      expect(joined).not.toContain("ERROR_1");
      expect(joined).toContain("ERROR_2");
      expect(joined).toContain("ERROR_3");
    });
  });

  describe("--clear", () => {
    it("should clear error log", async () => {
      writeFileSync(TEST_LOG_PATH, '{"code":"TEST","message":"test"}');
      expect(existsSync(TEST_LOG_PATH)).toBe(true);

      const output: string[] = [];
      const mockConsole = {
        log: (msg: string) => output.push(msg),
      };

      await errorsCommand(
        { clear: true },
        { logPath: TEST_LOG_PATH, console: mockConsole as any }
      );

      expect(existsSync(TEST_LOG_PATH)).toBe(false);
      expect(output.join("\n")).toContain("cleared");
    });
  });

  describe("--export", () => {
    it("should export errors as JSON", async () => {
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "API_ERROR", message: "Failed" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const output: string[] = [];
      const mockConsole = {
        log: (msg: string) => output.push(msg),
      };

      await errorsCommand(
        { export: true },
        { logPath: TEST_LOG_PATH, console: mockConsole as any }
      );

      const joined = output.join("\n");
      // Should be valid JSON
      const parsed = JSON.parse(joined);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].code).toBe("API_ERROR");
    });

    it("should export empty array when no errors", async () => {
      const output: string[] = [];
      const mockConsole = {
        log: (msg: string) => output.push(msg),
      };

      await errorsCommand(
        { export: true },
        { logPath: TEST_LOG_PATH, console: mockConsole as any }
      );

      expect(output.join("")).toBe("[]");
    });
  });

  describe("--json", () => {
    it("should output in JSON format", async () => {
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "API_ERROR", message: "Failed" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const output: string[] = [];
      const mockConsole = {
        log: (msg: string) => output.push(msg),
      };

      await errorsCommand(
        { json: true },
        { logPath: TEST_LOG_PATH, console: mockConsole as any }
      );

      const joined = output.join("\n");
      const parsed = JSON.parse(joined);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });
});
