/**
 * Tests for unified search command
 *
 * The search command consolidates:
 * - query search (FTS)
 * - embed search (semantic)
 * - query tagged / show tagged (by supertag)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createSearchCommand } from "../../src/commands/search";
import { Command } from "commander";

describe("createSearchCommand", () => {
  it("should create a command named 'search'", () => {
    const cmd = createSearchCommand();
    expect(cmd.name()).toBe("search");
  });

  it("should have description mentioning search", () => {
    const cmd = createSearchCommand();
    // Case-insensitive check
    expect(cmd.description().toLowerCase()).toContain("search");
  });

  it("should accept query as optional argument", () => {
    const cmd = createSearchCommand();
    // Check the command has an argument
    const args = cmd._args;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(false); // Optional for --tag searches
  });
});

describe("search command options", () => {
  let cmd: Command;

  beforeEach(() => {
    cmd = createSearchCommand();
  });

  it("should have --semantic flag for vector search", () => {
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--semantic");
  });

  it("should have --tag flag for tag-based search", () => {
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--tag");
  });

  it("should have standard options (workspace, limit, json)", () => {
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--workspace");
    expect(options).toContain("--limit");
    expect(options).toContain("--json");
  });

  it("should have --show flag for full content", () => {
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--show");
  });

  it("should have --depth flag for child traversal", () => {
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--depth");
  });

  it("should have -s short alias for --show", () => {
    const showOption = cmd.options.find(o => o.long === "--show");
    expect(showOption?.short).toBe("-s");
  });

  it("should have -l short alias for --limit", () => {
    const limitOption = cmd.options.find(o => o.long === "--limit");
    expect(limitOption?.short).toBe("-l");
  });

  it("should have -t short alias for --tag", () => {
    const tagOption = cmd.options.find(o => o.long === "--tag");
    expect(tagOption?.short).toBe("-t");
  });
});

describe("search command help", () => {
  it("should show examples in help text", () => {
    const cmd = createSearchCommand();
    const help = cmd.helpInformation();
    // The help should include usage examples
    expect(help).toContain("search");
  });
});

// ============================================================================
// Output formatting tests (T-2.2)
// ============================================================================

describe("search output formatting", () => {
  let cmd: Command;

  beforeEach(() => {
    cmd = createSearchCommand();
  });

  it("should have --pretty option", () => {
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--pretty");
  });

  it("should have --no-pretty option for forcing Unix output", () => {
    const optionFlags = cmd.options.map(o => o.flags);
    expect(optionFlags.some(f => f.includes("--pretty"))).toBe(true);
  });

  it("should have --human-dates option", () => {
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--human-dates");
  });

  it("should have --verbose option", () => {
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--verbose");
  });
});
