/**
 * Logger Tests
 *
 * TDD tests for the unified logger utility.
 * Spec: 057-unified-logger
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// T-1.1: Types exist and are correctly structured
describe("Logger Types", () => {
  it("should export LogLevel type", async () => {
    const { createLogger } = await import("../src/utils/logger");
    // Type check: LogLevel should accept these values
    const config = {
      level: "debug" as const,
      mode: "pretty" as const,
    };
    const logger = createLogger(config);
    expect(logger).toBeDefined();
  });

  it("should export LoggerConfig interface", async () => {
    const { createLogger } = await import("../src/utils/logger");
    // Type check: all config options should be accepted
    const config = {
      level: "info" as const,
      mode: "json" as const,
      verbose: true,
    };
    const logger = createLogger(config);
    expect(logger).toBeDefined();
  });

  it("should export Logger interface with all methods", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const logger = createLogger({ level: "debug", mode: "pretty" });

    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.isEnabled).toBe("function");
    expect(typeof logger.child).toBe("function");
  });
});

// T-1.2: Level filtering tests
describe("Level Filtering", () => {
  it("should filter debug when level is info", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const logger = createLogger({ level: "info", mode: "pretty" });

    expect(logger.isEnabled("debug")).toBe(false);
    expect(logger.isEnabled("info")).toBe(true);
    expect(logger.isEnabled("warn")).toBe(true);
    expect(logger.isEnabled("error")).toBe(true);
  });

  it("should filter debug and info when level is warn", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const logger = createLogger({ level: "warn", mode: "pretty" });

    expect(logger.isEnabled("debug")).toBe(false);
    expect(logger.isEnabled("info")).toBe(false);
    expect(logger.isEnabled("warn")).toBe(true);
    expect(logger.isEnabled("error")).toBe(true);
  });

  it("should only allow error when level is error", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const logger = createLogger({ level: "error", mode: "pretty" });

    expect(logger.isEnabled("debug")).toBe(false);
    expect(logger.isEnabled("info")).toBe(false);
    expect(logger.isEnabled("warn")).toBe(false);
    expect(logger.isEnabled("error")).toBe(true);
  });

  it("should allow all levels when level is debug", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const logger = createLogger({ level: "debug", mode: "pretty" });

    expect(logger.isEnabled("debug")).toBe(true);
    expect(logger.isEnabled("info")).toBe(true);
    expect(logger.isEnabled("warn")).toBe(true);
    expect(logger.isEnabled("error")).toBe(true);
  });

  it("should set level to debug when verbose is true", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const logger = createLogger({ level: "error", mode: "pretty", verbose: true });

    expect(logger.isEnabled("debug")).toBe(true);
  });
});

// T-1.3: Pretty mode formatter tests
describe("Pretty Mode Formatter", () => {
  it("should format debug with magnifying glass emoji", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "pretty",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.debug("test message");
    expect(output[0]).toContain("\u{1F50D}"); // magnifying glass
    expect(output[0]).toContain("test message");
  });

  it("should format info with info emoji", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "pretty",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.info("info message");
    expect(output[0]).toContain("\u2139"); // info symbol
    expect(output[0]).toContain("info message");
  });

  it("should format warn with warning emoji", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "pretty",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.warn("warn message");
    expect(output[0]).toContain("\u26A0"); // warning sign
    expect(output[0]).toContain("warn message");
  });

  it("should format error with X emoji", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "pretty",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.error("error message");
    expect(output[0]).toContain("\u274C"); // red X
    expect(output[0]).toContain("error message");
  });

  it("should include data in pretty format", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "pretty",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.info("message", { key: "value" });
    expect(output[0]).toContain("key");
    expect(output[0]).toContain("value");
  });
});

// T-1.4: Unix mode formatter tests
describe("Unix Mode Formatter", () => {
  it("should format as TSV with level prefix", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "unix",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.info("test message");
    expect(output[0]).toMatch(/^\[INFO\]\t/);
    expect(output[0]).toContain("test message");
  });

  it("should include data as key=value pairs", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "unix",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.info("message", { count: 42, name: "test" });
    expect(output[0]).toContain("count=42");
    expect(output[0]).toContain("name=test");
  });

  it("should use uppercase level names", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "unix",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.debug("msg");
    logger.warn("msg");
    logger.error("msg");

    expect(output[0]).toContain("[DEBUG]");
    expect(output[1]).toContain("[WARN]");
    expect(output[2]).toContain("[ERROR]");
  });
});

// T-1.5: JSON mode formatter tests
describe("JSON Mode Formatter", () => {
  it("should output valid JSON", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "json",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.info("test message");
    const parsed = JSON.parse(output[0]);
    expect(parsed).toHaveProperty("level");
    expect(parsed).toHaveProperty("message");
  });

  it("should include level and message in JSON", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "json",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.warn("warning!");
    const parsed = JSON.parse(output[0]);
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("warning!");
  });

  it("should include data in JSON output", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "json",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.info("msg", { count: 5, items: ["a", "b"] });
    const parsed = JSON.parse(output[0]);
    expect(parsed.data).toEqual({ count: 5, items: ["a", "b"] });
  });

  it("should include timestamp in JSON", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "json",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.info("msg");
    const parsed = JSON.parse(output[0]);
    expect(parsed).toHaveProperty("timestamp");
    expect(typeof parsed.timestamp).toBe("string");
  });
});

// T-2.1: LoggerImpl class tests
describe("LoggerImpl", () => {
  it("should not output when level is filtered", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "warn",
      mode: "pretty",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should appear");

    expect(output.length).toBe(1);
    expect(output[0]).toContain("should appear");
  });

  it("should use default stream when not provided", async () => {
    const { createLogger } = await import("../src/utils/logger");
    // Should not throw
    const logger = createLogger({ level: "debug", mode: "pretty" });
    expect(logger).toBeDefined();
  });
});

// T-2.2: Global logger tests
describe("Global Logger", () => {
  beforeEach(async () => {
    // Reset global logger before each test
    const { resetGlobalLogger } = await import("../src/utils/logger");
    resetGlobalLogger();
  });

  it("should throw when getGlobalLogger called before configure", async () => {
    const { getGlobalLogger, resetGlobalLogger } = await import("../src/utils/logger");
    resetGlobalLogger();

    expect(() => getGlobalLogger()).toThrow();
  });

  it("should return logger after configureGlobalLogger", async () => {
    const { configureGlobalLogger, getGlobalLogger } = await import("../src/utils/logger");
    configureGlobalLogger({ level: "info", mode: "pretty" });

    const logger = getGlobalLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("should report hasGlobalLogger correctly", async () => {
    const { configureGlobalLogger, hasGlobalLogger, resetGlobalLogger } = await import("../src/utils/logger");
    resetGlobalLogger();

    expect(hasGlobalLogger()).toBe(false);
    configureGlobalLogger({ level: "info", mode: "pretty" });
    expect(hasGlobalLogger()).toBe(true);
  });

  it("should create child logger with prefix", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "pretty",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    const child = logger.child("MyModule");
    child.info("test");

    expect(output[0]).toContain("[MyModule]");
    expect(output[0]).toContain("test");
  });

  it("should chain child prefixes", async () => {
    const { createLogger } = await import("../src/utils/logger");
    const output: string[] = [];
    const logger = createLogger({
      level: "debug",
      mode: "pretty",
      stream: { write: (s: string) => { output.push(s); return true; } } as any,
    });

    const child = logger.child("Parent").child("Child");
    child.info("test");

    expect(output[0]).toContain("[Parent:Child]");
  });
});
