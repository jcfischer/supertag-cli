/**
 * Tests for tags command group
 *
 * The tags command consolidates:
 * - query tags
 * - query top-tags
 * - schema show <name>
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createTagsCommand } from "../../src/commands/tags";
import { Command } from "commander";

describe("createTagsCommand", () => {
  it("should create a command named 'tags'", () => {
    const cmd = createTagsCommand();
    expect(cmd.name()).toBe("tags");
  });

  it("should have description mentioning supertags", () => {
    const cmd = createTagsCommand();
    expect(cmd.description().toLowerCase()).toContain("tag");
  });
});

describe("tags subcommands", () => {
  let cmd: Command;

  beforeEach(() => {
    cmd = createTagsCommand();
  });

  it("should have 'list' subcommand", () => {
    const subcommands = cmd.commands.map(c => c.name());
    expect(subcommands).toContain("list");
  });

  it("should have 'top' subcommand", () => {
    const subcommands = cmd.commands.map(c => c.name());
    expect(subcommands).toContain("top");
  });

  it("should have 'show' subcommand", () => {
    const subcommands = cmd.commands.map(c => c.name());
    expect(subcommands).toContain("show");
  });
});

describe("tags list subcommand", () => {
  let listCmd: Command;

  beforeEach(() => {
    const cmd = createTagsCommand();
    listCmd = cmd.commands.find(c => c.name() === "list")!;
  });

  it("should have --limit option", () => {
    const options = listCmd.options.map(o => o.long);
    expect(options).toContain("--limit");
  });

  it("should have standard options", () => {
    const options = listCmd.options.map(o => o.long);
    expect(options).toContain("--workspace");
    expect(options).toContain("--json");
  });
});

describe("tags top subcommand", () => {
  let topCmd: Command;

  beforeEach(() => {
    const cmd = createTagsCommand();
    topCmd = cmd.commands.find(c => c.name() === "top")!;
  });

  it("should have --limit option", () => {
    const options = topCmd.options.map(o => o.long);
    expect(options).toContain("--limit");
  });

  it("should have standard options", () => {
    const options = topCmd.options.map(o => o.long);
    expect(options).toContain("--workspace");
    expect(options).toContain("--json");
  });
});

describe("tags show subcommand", () => {
  let showCmd: Command;

  beforeEach(() => {
    const cmd = createTagsCommand();
    showCmd = cmd.commands.find(c => c.name() === "show")!;
  });

  it("should require tagname argument", () => {
    const args = showCmd._args;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(true);
  });

  it("should have standard options", () => {
    const options = showCmd.options.map(o => o.long);
    expect(options).toContain("--workspace");
    expect(options).toContain("--json");
  });
});
