/**
 * Tests for nodes command group
 *
 * The nodes command consolidates:
 * - show node <id>
 * - query refs <id>
 * - query recent
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createNodesCommand } from "../../src/commands/nodes";
import { Command } from "commander";

describe("createNodesCommand", () => {
  it("should create a command named 'nodes'", () => {
    const cmd = createNodesCommand();
    expect(cmd.name()).toBe("nodes");
  });

  it("should have description mentioning node operations", () => {
    const cmd = createNodesCommand();
    expect(cmd.description().toLowerCase()).toContain("node");
  });
});

describe("nodes subcommands", () => {
  let cmd: Command;

  beforeEach(() => {
    cmd = createNodesCommand();
  });

  it("should have 'show' subcommand", () => {
    const subcommands = cmd.commands.map(c => c.name());
    expect(subcommands).toContain("show");
  });

  it("should have 'refs' subcommand", () => {
    const subcommands = cmd.commands.map(c => c.name());
    expect(subcommands).toContain("refs");
  });

  it("should have 'recent' subcommand", () => {
    const subcommands = cmd.commands.map(c => c.name());
    expect(subcommands).toContain("recent");
  });
});

describe("nodes show subcommand", () => {
  let showCmd: Command;

  beforeEach(() => {
    const cmd = createNodesCommand();
    showCmd = cmd.commands.find(c => c.name() === "show")!;
  });

  it("should require node-id argument", () => {
    const args = showCmd._args;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(true);
  });

  it("should have --depth option", () => {
    const options = showCmd.options.map(o => o.long);
    expect(options).toContain("--depth");
  });

  it("should have -d short alias for --depth", () => {
    const depthOption = showCmd.options.find(o => o.long === "--depth");
    expect(depthOption?.short).toBe("-d");
  });

  it("should have standard options", () => {
    const options = showCmd.options.map(o => o.long);
    expect(options).toContain("--workspace");
    expect(options).toContain("--json");
  });
});

describe("nodes refs subcommand", () => {
  let refsCmd: Command;

  beforeEach(() => {
    const cmd = createNodesCommand();
    refsCmd = cmd.commands.find(c => c.name() === "refs")!;
  });

  it("should require node-id argument", () => {
    const args = refsCmd._args;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(true);
  });

  it("should have standard options", () => {
    const options = refsCmd.options.map(o => o.long);
    expect(options).toContain("--workspace");
    expect(options).toContain("--json");
  });
});

describe("nodes recent subcommand", () => {
  let recentCmd: Command;

  beforeEach(() => {
    const cmd = createNodesCommand();
    recentCmd = cmd.commands.find(c => c.name() === "recent")!;
  });

  it("should have --limit option", () => {
    const options = recentCmd.options.map(o => o.long);
    expect(options).toContain("--limit");
  });

  it("should have standard options", () => {
    const options = recentCmd.options.map(o => o.long);
    expect(options).toContain("--workspace");
    expect(options).toContain("--json");
  });
});
