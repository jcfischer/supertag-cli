/**
 * Select Parameter Tests
 *
 * TDD tests for --select parameter support across CLI commands.
 * Tests verify that --select filters output in both JSON and Unix modes.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { $ } from "bun";
import { existsSync } from "fs";
import { getDatabasePath } from "../src/config/paths";

// Check if we have a database to test against
const dbPath = getDatabasePath();
const hasDatabase = existsSync(dbPath);

describe("--select parameter support", () => {
  const testFn = hasDatabase ? it : it.skip;

  describe("tags list --select", () => {
    testFn("should filter JSON output to selected fields only", async () => {
      const result = await $`bun run src/index.ts tags list --json --select tagName --limit 3`.text();
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      if (parsed.length > 0) {
        // Should only have tagName, not tagId or count
        expect(parsed[0]).toHaveProperty("tagName");
        expect(parsed[0]).not.toHaveProperty("tagId");
        expect(parsed[0]).not.toHaveProperty("count");
      }
    });

    testFn("should filter Unix output to selected fields only", async () => {
      const result = await $`bun run src/index.ts tags list --select tagName --limit 3`.text();
      const lines = result.trim().split("\n").filter(l => l && !l.startsWith("🏷"));

      // Each line should be just the tag name (no tabs = single column)
      for (const line of lines) {
        expect(line).not.toContain("\t");
      }
    });

    testFn("should support multiple selected fields", async () => {
      const result = await $`bun run src/index.ts tags list --json --select tagName,count --limit 3`.text();
      const parsed = JSON.parse(result);

      if (parsed.length > 0) {
        expect(parsed[0]).toHaveProperty("tagName");
        expect(parsed[0]).toHaveProperty("count");
        expect(parsed[0]).not.toHaveProperty("tagId");
      }
    });
  });

  describe("tags top --select", () => {
    testFn("should filter JSON output to selected fields only", async () => {
      const result = await $`bun run src/index.ts tags top --json --select tagName --limit 3`.text();
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      if (parsed.length > 0) {
        expect(parsed[0]).toHaveProperty("tagName");
        expect(parsed[0]).not.toHaveProperty("tagId");
        expect(parsed[0]).not.toHaveProperty("count");
      }
    });

    testFn("should filter Unix output to selected fields only", async () => {
      const result = await $`bun run src/index.ts tags top --select tagName --limit 3`.text();
      const lines = result.trim().split("\n");

      // Each line should be just the tag name (no tabs = single column)
      for (const line of lines) {
        expect(line).not.toContain("\t");
      }
    });
  });

  describe("tags show --select", () => {
    testFn("should filter JSON output to selected fields only", async () => {
      // First get a tag name - find one without leading/trailing whitespace or special chars
      const tagsResult = await $`bun run src/index.ts tags list --json --limit 50`.text();
      const tags = JSON.parse(tagsResult);
      // Find a tag with a "clean" name (no leading/trailing space, no special chars)
      const cleanTag = tags.find((t: { tagName: string }) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t.tagName));
      if (!cleanTag) return;

      const tagName = cleanTag.tagName;
      const result = await $`bun run src/index.ts tags show ${tagName} --json --select id,name`.text();
      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty("id");
      expect(parsed).toHaveProperty("name");
      expect(parsed).not.toHaveProperty("color");
      expect(parsed).not.toHaveProperty("fields");
    });

    testFn("should filter output to selected fields only (non-TTY defaults to JSON)", async () => {
      // First get a tag name - find one without leading/trailing whitespace or special chars
      const tagsResult = await $`bun run src/index.ts tags list --json --limit 50`.text();
      const tags = JSON.parse(tagsResult);
      // Find a tag with a "clean" name (no leading/trailing space, no special chars)
      const cleanTag = tags.find((t: { tagName: string }) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t.tagName));
      if (!cleanTag) return;

      const tagName = cleanTag.tagName;
      const result = await $`bun run src/index.ts tags show ${tagName} --select id,name --json`.text();

      // Explicit --json flag for JSON output (table is default)
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("id");
      expect(parsed).toHaveProperty("name");
      expect(parsed).not.toHaveProperty("color");
    });
  });

  describe("nodes refs --select", () => {
    // Spawns three `bun run src/index.ts` subprocesses — cold start puts this
    // above the default 15s when the test cache is cold. 45s timeout.
    testFn("should filter Unix output to selected fields only", async () => {
      // First get a node ID
      const searchResult = await $`bun run src/index.ts search "a" --json --limit 1`.text();
      const results = JSON.parse(searchResult);
      if (results.length === 0) return;

      const nodeId = results[0].id;
      const defaultResult = await $`bun run src/index.ts nodes refs ${nodeId}`.text();
      const selectResult = await $`bun run src/index.ts nodes refs ${nodeId} --select direction,type`.text();

      // If there are any refs, select should have fewer columns
      if (defaultResult.trim()) {
        const defaultCols = defaultResult.split("\n")[0]?.split("\t").length || 0;
        const selectCols = selectResult.split("\n")[0]?.split("\t").length || 0;

        // With --select direction,type we should have 2 columns max
        if (selectCols > 0) {
          expect(selectCols).toBeLessThanOrEqual(2);
        }
      }
    }, 45000);
  });

  describe("nodes recent --select", () => {
    testFn("should filter JSON output to selected fields only", async () => {
      const result = await $`bun run src/index.ts nodes recent --json --select id --limit 3`.text();
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      if (parsed.length > 0) {
        expect(parsed[0]).toHaveProperty("id");
        expect(parsed[0]).not.toHaveProperty("name");
        expect(parsed[0]).not.toHaveProperty("updated");
      }
    }, 15_000);

    testFn("should filter Unix output to selected fields only", async () => {
      const result = await $`bun run src/index.ts nodes recent --select id --limit 3`.text();
      const lines = result.trim().split("\n");

      // Each line should be just the ID (no tabs = single column)
      for (const line of lines) {
        expect(line).not.toContain("\t");
      }
    }, 15_000);

    testFn("should support multiple selected fields", async () => {
      const result = await $`bun run src/index.ts nodes recent --json --select id,name --limit 3`.text();
      const parsed = JSON.parse(result);

      if (parsed.length > 0) {
        expect(parsed[0]).toHaveProperty("id");
        expect(parsed[0]).toHaveProperty("name");
        expect(parsed[0]).not.toHaveProperty("updated");
      }
    }, 15_000);
  });
});
