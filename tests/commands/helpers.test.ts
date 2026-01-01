/**
 * Tests for shared command helpers used by CLI harmonization
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
  formatTableOutput,
} from "../../src/commands/helpers";
import { Command } from "commander";
import { getConfig } from "../../src/config/manager";

// Check if workspaces are configured (for CI vs local development)
let hasWorkspacesConfigured = false;
try {
  const configManager = getConfig();
  hasWorkspacesConfigured = Object.keys(configManager.getAllWorkspaces()).length > 0;
} catch {
  hasWorkspacesConfigured = false;
}

describe("resolveDbPath", () => {
  it("should return dbPath when explicitly provided", () => {
    const result = resolveDbPath({ dbPath: "/custom/path.db" });
    expect(result).toBe("/custom/path.db");
  });

  // These tests require workspace configuration - skip in CI
  it.skipIf(!hasWorkspacesConfigured)("should resolve workspace when provided", () => {
    const result = resolveDbPath({ workspace: "main" });
    expect(result).toContain(".db");
  });

  it.skipIf(!hasWorkspacesConfigured)("should use default workspace when no options provided", () => {
    const result = resolveDbPath({});
    expect(result).toContain(".db");
  });
});

describe("checkDb", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `supertag-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should return true when database exists", () => {
    const dbPath = join(testDir, "test.db");
    writeFileSync(dbPath, "");
    expect(checkDb(dbPath)).toBe(true);
  });

  it("should return false when database does not exist", () => {
    const dbPath = join(testDir, "nonexistent.db");
    expect(checkDb(dbPath)).toBe(false);
  });
});

describe("addStandardOptions", () => {
  it("should add all standard options to a command", () => {
    const cmd = new Command("test");
    addStandardOptions(cmd);

    // Get the options that were added
    const options = cmd.options.map(o => o.long);

    expect(options).toContain("--workspace");
    expect(options).toContain("--limit");
    expect(options).toContain("--json");
  });

  it("should add short aliases", () => {
    const cmd = new Command("test");
    addStandardOptions(cmd);

    const options = cmd.options.map(o => o.short);

    expect(options).toContain("-w");
    expect(options).toContain("-l");
  });

  it("should allow selective options", () => {
    const cmd = new Command("test");
    addStandardOptions(cmd, { includeShow: true, includeDepth: true });

    const options = cmd.options.map(o => o.long);

    expect(options).toContain("--show");
    expect(options).toContain("--depth");
  });

  // T-3.1: --format option (Spec 060)
  describe("--format option (Spec 060)", () => {
    it("should add --format option (no short alias to avoid conflicts)", () => {
      const cmd = new Command("test");
      addStandardOptions(cmd);

      const options = cmd.options;
      const formatOpt = options.find(o => o.long === "--format");

      expect(formatOpt).toBeDefined();
      // No short alias (-f) because it conflicts with -f/--field in search command
      expect(formatOpt?.short).toBeUndefined();
    });

    it("should include format description with valid choices", () => {
      const cmd = new Command("test");
      addStandardOptions(cmd);

      const formatOpt = cmd.options.find(o => o.long === "--format");
      const description = formatOpt?.description ?? "";

      expect(description).toContain("json");
      expect(description).toContain("table");
      expect(description).toContain("csv");
      expect(description).toContain("ids");
      expect(description).toContain("minimal");
      expect(description).toContain("jsonl");
    });

    it("should add --no-header option", () => {
      const cmd = new Command("test");
      addStandardOptions(cmd);

      const options = cmd.options.map(o => o.long);
      expect(options).toContain("--no-header");
    });

    it("should allow disabling format option via config", () => {
      const cmd = new Command("test");
      addStandardOptions(cmd, { includeFormat: false });

      const options = cmd.options.map(o => o.long);
      expect(options).not.toContain("--format");
    });
  });
});

describe("formatJsonOutput", () => {
  it("should format data as pretty JSON", () => {
    const data = { id: "123", name: "Test" };
    const output = formatJsonOutput(data);
    expect(output).toContain('"id": "123"');
    expect(output).toContain('"name": "Test"');
  });

  it("should handle arrays", () => {
    const data = [{ id: "1" }, { id: "2" }];
    const output = formatJsonOutput(data);
    expect(output).toContain("[");
    expect(output).toContain('"id": "1"');
  });
});

describe("formatTableOutput", () => {
  it("should format array of objects as table rows", () => {
    const data = [
      { name: "Node 1", id: "abc123" },
      { name: "Node 2", id: "def456" },
    ];
    const output = formatTableOutput(data, ["name", "id"]);
    expect(output).toContain("Node 1");
    expect(output).toContain("abc123");
    expect(output).toContain("Node 2");
  });

  it("should handle empty array", () => {
    const output = formatTableOutput([], ["name", "id"]);
    expect(output).toBe("No results found");
  });
});
