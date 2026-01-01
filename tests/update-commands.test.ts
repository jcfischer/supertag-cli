/**
 * Update Commands Tests
 * TDD tests for update CLI commands (Spec 058)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

// =============================================================================
// T-2.4: Update CLI Command Tests
// =============================================================================

describe("update check command", () => {
  const testCacheDir = "/tmp/supertag-update-cmd-test";

  beforeEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
    mkdirSync(testCacheDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
  });

  it("should export createUpdateCommand function", async () => {
    const { createUpdateCommand } = await import("../src/commands/update");
    expect(createUpdateCommand).toBeDefined();
    expect(typeof createUpdateCommand).toBe("function");
  });

  it("should create command with subcommands", async () => {
    const { createUpdateCommand } = await import("../src/commands/update");
    const cmd = createUpdateCommand();

    expect(cmd.name()).toBe("update");

    // Get subcommand names
    const subcommands = cmd.commands.map((c: { name: () => string }) => c.name());
    expect(subcommands).toContain("check");
    expect(subcommands).toContain("download");
  });

  it("check subcommand should have --force option", async () => {
    const { createUpdateCommand } = await import("../src/commands/update");
    const cmd = createUpdateCommand();

    const checkCmd = cmd.commands.find((c: { name: () => string }) => c.name() === "check");
    expect(checkCmd).toBeDefined();

    const options = checkCmd.options.map((o: { long: string }) => o.long);
    expect(options).toContain("--force");
  });

  it("download subcommand should have --output option", async () => {
    const { createUpdateCommand } = await import("../src/commands/update");
    const cmd = createUpdateCommand();

    const downloadCmd = cmd.commands.find((c: { name: () => string }) => c.name() === "download");
    expect(downloadCmd).toBeDefined();

    const options = downloadCmd.options.map((o: { long: string }) => o.long);
    expect(options).toContain("--output");
  });
});

describe("formatBytes utility", () => {
  it("should format bytes correctly", async () => {
    const { formatBytes } = await import("../src/commands/update");

    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
  });

  it("should handle decimal places", async () => {
    const { formatBytes } = await import("../src/commands/update");

    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(2560000)).toBe("2.44 MB");
  });
});
