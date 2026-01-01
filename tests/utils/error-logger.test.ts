/**
 * Tests for error logger
 * Spec: 073-error-context
 * Task: T-4.1, T-4.2
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  logError,
  readErrorLog,
  clearErrorLog,
  exportErrorLog,
  sanitizeForLogging,
  getErrorLogPath,
} from "../../src/utils/error-logger";
import { StructuredError } from "../../src/utils/structured-errors";

// Use a temp directory for tests
const TEST_DIR = "/tmp/supertag-error-logger-test";
const TEST_LOG_PATH = join(TEST_DIR, "errors.log");

describe("Error Logger", () => {
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

  describe("logError", () => {
    it("should log error to file", () => {
      const error = new StructuredError("API_ERROR", "API failed");
      logError(error, { logPath: TEST_LOG_PATH });

      expect(existsSync(TEST_LOG_PATH)).toBe(true);
      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      expect(content).toContain("API_ERROR");
      expect(content).toContain("API failed");
    });

    it("should include timestamp in log entry", () => {
      const error = new StructuredError("CONFIG_NOT_FOUND", "Config missing");
      logError(error, { logPath: TEST_LOG_PATH });

      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.timestamp).toBeDefined();
      // Should be valid ISO timestamp
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    it("should include command context when provided", () => {
      const error = new StructuredError("DATABASE_NOT_FOUND", "DB missing");
      logError(error, {
        logPath: TEST_LOG_PATH,
        context: { command: "supertag search project" },
      });

      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.command).toBe("supertag search project");
    });

    it("should include workspace context when provided", () => {
      const error = new StructuredError("TAG_NOT_FOUND", "Tag missing");
      logError(error, {
        logPath: TEST_LOG_PATH,
        context: { workspace: "books" },
      });

      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.workspace).toBe("books");
    });

    it("should append multiple errors", () => {
      logError(new StructuredError("ERROR_1", "First"), { logPath: TEST_LOG_PATH });
      logError(new StructuredError("ERROR_2", "Second"), { logPath: TEST_LOG_PATH });

      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(2);
    });

    it("should create parent directory if not exists", () => {
      const nestedPath = join(TEST_DIR, "nested", "deep", "errors.log");
      const error = new StructuredError("TEST", "test");
      logError(error, { logPath: nestedPath });

      expect(existsSync(nestedPath)).toBe(true);
    });

    it("should include details in debug mode", () => {
      const error = new StructuredError("API_ERROR", "Failed", {
        details: { endpoint: "/api/test" },
      });
      logError(error, { logPath: TEST_LOG_PATH, includeDetails: true });

      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.details).toBeDefined();
      expect(entry.details.endpoint).toBe("/api/test");
    });
  });

  describe("readErrorLog", () => {
    it("should read all log entries", () => {
      // Write some test entries
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "ERROR_1", message: "First" },
        { timestamp: "2025-01-01T11:00:00Z", code: "ERROR_2", message: "Second" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const result = readErrorLog({ logPath: TEST_LOG_PATH });
      expect(result.length).toBe(2);
      expect(result[0].code).toBe("ERROR_1");
      expect(result[1].code).toBe("ERROR_2");
    });

    it("should return last N entries", () => {
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "ERROR_1", message: "First" },
        { timestamp: "2025-01-01T11:00:00Z", code: "ERROR_2", message: "Second" },
        { timestamp: "2025-01-01T12:00:00Z", code: "ERROR_3", message: "Third" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const result = readErrorLog({ logPath: TEST_LOG_PATH, last: 2 });
      expect(result.length).toBe(2);
      expect(result[0].code).toBe("ERROR_2");
      expect(result[1].code).toBe("ERROR_3");
    });

    it("should return empty array for missing file", () => {
      const result = readErrorLog({ logPath: join(TEST_DIR, "nonexistent.log") });
      expect(result).toEqual([]);
    });

    it("should skip invalid JSON lines", () => {
      writeFileSync(
        TEST_LOG_PATH,
        `{"timestamp":"2025-01-01T10:00:00Z","code":"VALID","message":"OK"}
invalid json line
{"timestamp":"2025-01-01T11:00:00Z","code":"VALID2","message":"OK2"}`
      );

      const result = readErrorLog({ logPath: TEST_LOG_PATH });
      expect(result.length).toBe(2);
    });

    it("should filter by since date", () => {
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "OLD", message: "Old" },
        { timestamp: "2025-01-02T10:00:00Z", code: "NEW", message: "New" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const result = readErrorLog({
        logPath: TEST_LOG_PATH,
        since: new Date("2025-01-02T00:00:00Z"),
      });
      expect(result.length).toBe(1);
      expect(result[0].code).toBe("NEW");
    });
  });

  describe("clearErrorLog", () => {
    it("should remove log file", () => {
      writeFileSync(TEST_LOG_PATH, "test");
      expect(existsSync(TEST_LOG_PATH)).toBe(true);

      clearErrorLog({ logPath: TEST_LOG_PATH });
      expect(existsSync(TEST_LOG_PATH)).toBe(false);
    });

    it("should not throw for missing file", () => {
      expect(() => clearErrorLog({ logPath: join(TEST_DIR, "missing.log") })).not.toThrow();
    });
  });

  describe("exportErrorLog", () => {
    it("should return all entries as array", () => {
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "ERROR_1", message: "First" },
        { timestamp: "2025-01-01T11:00:00Z", code: "ERROR_2", message: "Second" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const result = exportErrorLog({ logPath: TEST_LOG_PATH });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it("should be JSON serializable", () => {
      const entries = [
        { timestamp: "2025-01-01T10:00:00Z", code: "ERROR_1", message: "First" },
      ];
      writeFileSync(TEST_LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n"));

      const result = exportErrorLog({ logPath: TEST_LOG_PATH });
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);
      expect(parsed[0].code).toBe("ERROR_1");
    });
  });

  describe("sanitizeForLogging", () => {
    it("should remove API keys from details", () => {
      const details = {
        apiKey: "secret-key-12345",
        data: "normal data",
      };
      const sanitized = sanitizeForLogging(details);

      expect(sanitized.apiKey).toBe("[REDACTED]");
      expect(sanitized.data).toBe("normal data");
    });

    it("should remove tokens", () => {
      const details = {
        token: "bearer-token-xyz",
        accessToken: "access-123",
        refreshToken: "refresh-456",
      };
      const sanitized = sanitizeForLogging(details);

      expect(sanitized.token).toBe("[REDACTED]");
      expect(sanitized.accessToken).toBe("[REDACTED]");
      expect(sanitized.refreshToken).toBe("[REDACTED]");
    });

    it("should remove passwords", () => {
      const details = {
        password: "hunter2",
        pass: "secret",
        pwd: "12345",
      };
      const sanitized = sanitizeForLogging(details);

      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.pass).toBe("[REDACTED]");
      expect(sanitized.pwd).toBe("[REDACTED]");
    });

    it("should remove secrets", () => {
      const details = {
        secret: "my-secret",
        clientSecret: "client-secret-123",
        apiSecret: "api-secret-456",
      };
      const sanitized = sanitizeForLogging(details);

      expect(sanitized.secret).toBe("[REDACTED]");
      expect(sanitized.clientSecret).toBe("[REDACTED]");
      expect(sanitized.apiSecret).toBe("[REDACTED]");
    });

    it("should handle nested objects", () => {
      const details = {
        config: {
          apiKey: "nested-key",
          endpoint: "https://api.example.com",
        },
      };
      const sanitized = sanitizeForLogging(details);

      expect((sanitized.config as any).apiKey).toBe("[REDACTED]");
      expect((sanitized.config as any).endpoint).toBe("https://api.example.com");
    });

    it("should handle arrays", () => {
      const details = {
        users: [
          { name: "Alice", password: "pass1" },
          { name: "Bob", password: "pass2" },
        ],
      };
      const sanitized = sanitizeForLogging(details);

      expect((sanitized.users as any)[0].password).toBe("[REDACTED]");
      expect((sanitized.users as any)[1].password).toBe("[REDACTED]");
      expect((sanitized.users as any)[0].name).toBe("Alice");
    });

    it("should preserve non-sensitive data", () => {
      const details = {
        name: "test",
        count: 42,
        enabled: true,
        items: ["a", "b", "c"],
      };
      const sanitized = sanitizeForLogging(details);

      expect(sanitized).toEqual(details);
    });

    it("should handle null and undefined", () => {
      const details = {
        nullValue: null,
        undefinedValue: undefined,
      };
      const sanitized = sanitizeForLogging(details);

      expect(sanitized.nullValue).toBeNull();
      expect(sanitized.undefinedValue).toBeUndefined();
    });
  });

  describe("getErrorLogPath", () => {
    it("should return path in cache directory", () => {
      const path = getErrorLogPath();
      expect(path).toContain("supertag");
      expect(path).toContain("errors.log");
    });
  });
});
