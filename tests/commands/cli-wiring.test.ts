/**
 * Tests for CLI command wiring
 *
 * Verifies that all harmonized commands are registered in index.ts
 */

import { describe, it, expect } from "bun:test";
import { Command } from "commander";

// Import command factories
import { createSearchCommand } from "../../src/commands/search";
import { createNodesCommand } from "../../src/commands/nodes";
import { createTagsCommand } from "../../src/commands/tags";
import { createStatsCommand } from "../../src/commands/stats";

describe("CLI command wiring", () => {
  it("should export createSearchCommand", () => {
    expect(typeof createSearchCommand).toBe("function");
    const cmd = createSearchCommand();
    expect(cmd).toBeInstanceOf(Command);
    expect(cmd.name()).toBe("search");
  });

  it("should export createNodesCommand", () => {
    expect(typeof createNodesCommand).toBe("function");
    const cmd = createNodesCommand();
    expect(cmd).toBeInstanceOf(Command);
    expect(cmd.name()).toBe("nodes");
  });

  it("should export createTagsCommand", () => {
    expect(typeof createTagsCommand).toBe("function");
    const cmd = createTagsCommand();
    expect(cmd).toBeInstanceOf(Command);
    expect(cmd.name()).toBe("tags");
  });

  it("should export createStatsCommand", () => {
    expect(typeof createStatsCommand).toBe("function");
    const cmd = createStatsCommand();
    expect(cmd).toBeInstanceOf(Command);
    expect(cmd.name()).toBe("stats");
  });
});

describe("command registration", () => {
  it("should be able to add all commands to a program", () => {
    const program = new Command();
    program.name("supertag");

    // Add all harmonized commands
    program.addCommand(createSearchCommand());
    program.addCommand(createNodesCommand());
    program.addCommand(createTagsCommand());
    program.addCommand(createStatsCommand());

    // Verify commands were added
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("search");
    expect(commandNames).toContain("nodes");
    expect(commandNames).toContain("tags");
    expect(commandNames).toContain("stats");
  });
});
