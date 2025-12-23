/**
 * Tests for unified stats command
 *
 * The stats command consolidates:
 * - query stats (db)
 * - embed stats (embeddings)
 * - embed filter-stats (filter breakdown)
 */

import { describe, it, expect } from "bun:test";
import { createStatsCommand } from "../../src/commands/stats";

describe("createStatsCommand", () => {
  it("should create a command named 'stats'", () => {
    const cmd = createStatsCommand();
    expect(cmd.name()).toBe("stats");
  });

  it("should have description mentioning statistics", () => {
    const cmd = createStatsCommand();
    expect(cmd.description().toLowerCase()).toContain("stat");
  });
});

describe("stats command options", () => {
  it("should have --db flag for database stats only", () => {
    const cmd = createStatsCommand();
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--db");
  });

  it("should have --embed flag for embedding stats only", () => {
    const cmd = createStatsCommand();
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--embed");
  });

  it("should have --filter flag for filter breakdown", () => {
    const cmd = createStatsCommand();
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--filter");
  });

  it("should have standard options", () => {
    const cmd = createStatsCommand();
    const options = cmd.options.map(o => o.long);
    expect(options).toContain("--workspace");
    expect(options).toContain("--json");
  });
});
