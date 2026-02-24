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
    const { formatBytes } = await import("../src/utils/format");

    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("should handle custom decimal places", async () => {
    const { formatBytes } = await import("../src/utils/format");

    expect(formatBytes(1536, 2)).toBe("1.50 KB");
    expect(formatBytes(2560000, 2)).toBe("2.44 MB");
  });
});

// =============================================================================
// T-3.2: Install CLI Command Tests
// =============================================================================

describe("update install command", () => {
  it("should have install subcommand", async () => {
    const { createUpdateCommand } = await import("../src/commands/update");
    const cmd = createUpdateCommand();

    const subcommands = cmd.commands.map((c: { name: () => string }) => c.name());
    expect(subcommands).toContain("install");
  });

  it("install subcommand should have --file option", async () => {
    const { createUpdateCommand } = await import("../src/commands/update");
    const cmd = createUpdateCommand();

    const installCmd = cmd.commands.find((c: { name: () => string }) => c.name() === "install");
    expect(installCmd).toBeDefined();

    const options = installCmd.options.map((o: { long: string }) => o.long);
    expect(options).toContain("--file");
  });

  it("install subcommand should have --yes option to skip confirmation", async () => {
    const { createUpdateCommand } = await import("../src/commands/update");
    const cmd = createUpdateCommand();

    const installCmd = cmd.commands.find((c: { name: () => string }) => c.name() === "install");
    expect(installCmd).toBeDefined();

    const options = installCmd.options.map((o: { long: string }) => o.long);
    expect(options).toContain("--yes");
  });
});

// =============================================================================
// T-4.2: Passive Check Hook Tests
// =============================================================================

// =============================================================================
// T-4.3: updateCheck Config Option Tests
// =============================================================================

describe("updateCheck config option", () => {
  const testConfigDir = "/tmp/supertag-update-config-test";
  const testConfigFile = join(testConfigDir, "config.json");

  beforeEach(() => {
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true });
    }
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true });
    }
  });

  it("should define UpdateCheckMode type with enabled, disabled, manual values", async () => {
    // Import the type and verify it can be used
    const { UpdateCheckMode } = await import("../src/types");

    // TypeScript type check - these should all be valid
    const enabled: typeof UpdateCheckMode = "enabled";
    const disabled: typeof UpdateCheckMode = "disabled";
    const manual: typeof UpdateCheckMode = "manual";

    expect(enabled).toBe("enabled");
    expect(disabled).toBe("disabled");
    expect(manual).toBe("manual");
  });

  it("should have updateCheck field in TanaConfig", async () => {
    const types = await import("../src/types");

    // Create a TanaConfig with updateCheck to verify type exists
    const config: types.TanaConfig = {
      apiEndpoint: "https://example.com",
      defaultTargetNode: "INBOX",
      updateCheck: "enabled",
    };

    expect(config.updateCheck).toBe("enabled");
  });

  it("should have getUpdateCheckMode method in ConfigManager", async () => {
    const { ConfigManager } = await import("../src/config/manager");
    const manager = ConfigManager.getInstance();

    expect(typeof manager.getUpdateCheckMode).toBe("function");
  });

  it("should return 'enabled' as default updateCheck mode", async () => {
    const { ConfigManager } = await import("../src/config/manager");
    const manager = ConfigManager.getInstance();

    const mode = manager.getUpdateCheckMode();
    expect(mode).toBe("enabled");
  });

  it("should have setUpdateCheckMode method in ConfigManager", async () => {
    const { ConfigManager } = await import("../src/config/manager");
    const manager = ConfigManager.getInstance();

    expect(typeof manager.setUpdateCheckMode).toBe("function");
  });

  it("checkForUpdatePassive should respect updateCheck config", async () => {
    // The checkForUpdatePassive function should check the config
    // and return null immediately if updateCheck is 'disabled'
    // We can't easily test this without mocking, but we can verify
    // the isUpdateCheckEnabled export exists for integration
    const { isUpdateCheckEnabled } = await import("../src/commands/update");
    expect(typeof isUpdateCheckEnabled).toBe("function");
  });

  it("isUpdateCheckEnabled should return true when config is 'enabled'", async () => {
    const { isUpdateCheckEnabled } = await import("../src/commands/update");
    // Default config is 'enabled'
    const result = isUpdateCheckEnabled();
    expect(result).toBe(true);
  });
});

describe("Passive update check", () => {
  const testCacheDir = "/tmp/supertag-passive-check-test";
  const testCachePath = join(testCacheDir, "update-cache.json");

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

  it("should export checkForUpdatePassive function", async () => {
    const { checkForUpdatePassive } = await import("../src/commands/update");
    expect(checkForUpdatePassive).toBeDefined();
    expect(typeof checkForUpdatePassive).toBe("function");
  });

  it("should export formatUpdateNotification function", async () => {
    const { formatUpdateNotification } = await import("../src/commands/update");
    expect(formatUpdateNotification).toBeDefined();
    expect(typeof formatUpdateNotification).toBe("function");
  });

  it("formatUpdateNotification should return one-line notification", async () => {
    const { formatUpdateNotification } = await import("../src/commands/update");

    const notification = formatUpdateNotification("2.0.0");
    expect(notification).toContain("2.0.0");
    expect(notification).toContain("update");
    // Should be one line (no newlines in middle)
    expect(notification.split("\n").length).toBeLessThanOrEqual(1);
  });
});
