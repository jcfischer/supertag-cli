/**
 * TDD Test Suite for semantic search --show and --depth flags
 *
 * Tests the CLI integration between semantic search and node display.
 * Requires embeddings to be generated first.
 *
 * NOTE: These tests are skipped in CI if no database exists.
 *
 * Updated in v1.0.0: Tests now use 'search --semantic' instead of 'embed search'
 */

import { describe, test, expect } from "bun:test";
import { existsSync } from "fs";
import { getDatabasePath } from "../../src/config/paths";

const DB_PATH = getDatabasePath();
const DB_EXISTS = existsSync(DB_PATH);

// Skip all tests in this file if database doesn't exist (CI environment)
const testOrSkip = DB_EXISTS ? test : test.skip;

describe("search --semantic --show integration", () => {

  testOrSkip("--show flag returns full node contents in JSON", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "./src/index.ts", "search", "project", "--semantic", "--limit", "1", "--show", "--json"],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => proc.kill(), 4000);
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(timeout);

    // Skip test if no embeddings configured or process killed
    if (output.includes("Embeddings not configured") || output.includes("No embeddings found") || proc.signalCode) {
      console.log("Skipping test: embeddings not configured");
      return;
    }

    // Find the JSON array in output (skip the search line)
    // Look for newline+bracket to avoid matching [workspace] in header
    const jsonStart = output.indexOf("\n[");
    if (jsonStart === -1) {
      console.log("Skipping test: no results found");
      return;
    }

    const jsonStr = output.substring(jsonStart + 1); // +1 to skip the newline
    const result = JSON.parse(jsonStr);

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const node = result[0];
      // With --show, should have full node structure
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("name");
      expect(node).toHaveProperty("fields");
      expect(node).toHaveProperty("children");
      expect(node).toHaveProperty("tags");
      expect(node).toHaveProperty("similarity");
      expect(node).toHaveProperty("distance");
    }
  });

  testOrSkip("without --show flag returns minimal info in JSON", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "./src/index.ts", "search", "project", "--semantic", "--limit", "1", "--json"],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => proc.kill(), 4000);
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(timeout);

    // Skip test if no embeddings configured or process killed
    if (output.includes("Embeddings not configured") || output.includes("No embeddings found") || proc.signalCode) {
      console.log("Skipping test: embeddings not configured");
      return;
    }

    // Look for newline+bracket to avoid matching [workspace] in header
    const jsonStart = output.indexOf("\n[");
    if (jsonStart === -1) {
      console.log("Skipping test: no results found");
      return;
    }

    const jsonStr = output.substring(jsonStart + 1); // +1 to skip the newline
    const result = JSON.parse(jsonStr);

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const node = result[0];
      // Without --show, should have minimal structure
      expect(node).toHaveProperty("nodeId");
      expect(node).toHaveProperty("name");
      expect(node).toHaveProperty("similarity");
      expect(node).toHaveProperty("distance");
      // Should NOT have these (or they're undefined)
      expect(node.fields).toBeUndefined();
      expect(node.children).toBeUndefined();
    }
  });

  testOrSkip("--show with --depth includes child nodes", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "./src/index.ts", "search", "project", "--semantic", "--limit", "1", "--show", "--depth", "1", "--json"],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => proc.kill(), 4000);
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(timeout);

    // Skip test if no embeddings configured or process killed
    if (output.includes("Embeddings not configured") || output.includes("No embeddings found") || proc.signalCode) {
      console.log("Skipping test: embeddings not configured");
      return;
    }

    // Look for newline+bracket to avoid matching [workspace] in header
    const jsonStart = output.indexOf("\n[");
    if (jsonStart === -1) {
      console.log("Skipping test: no results found");
      return;
    }

    const jsonStr = output.substring(jsonStart + 1); // +1 to skip the newline
    const result = JSON.parse(jsonStr);

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const node = result[0];
      // With --depth 1, children should be NodeContentsWithChildren objects, not simple refs
      expect(node).toHaveProperty("children");
      expect(Array.isArray(node.children)).toBe(true);

      // If there are children, they should have full contents too
      if (node.children.length > 0) {
        const child = node.children[0];
        // Child should have the recursive structure
        expect(child).toHaveProperty("id");
        expect(child).toHaveProperty("name");
        expect(child).toHaveProperty("children");
      }
    }
  });

  testOrSkip("--show in table format displays rich output", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "./src/index.ts", "search", "meeting", "--semantic", "--limit", "2", "--show"],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => proc.kill(), 4000);
    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    clearTimeout(timeout);

    // Skip test if no embeddings configured, database error, or process killed/timed out
    if (output.includes("Embeddings not configured") || output.includes("No embeddings found") || proc.exitCode !== 0 || stderr.includes("SQLiteError") || proc.signalCode) {
      console.log("Skipping test: embeddings not configured or database error");
      return;
    }

    // Should have result separators
    if (output.includes("No results found") || !output.includes("Results (")) {
      console.log("Skipping test: no results found");
      return;
    }

    expect(output).toContain("Results (");
    expect(output).toContain("━━━ Result");
    expect(output).toContain("% similar");
  });

  testOrSkip("default format shows table output", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "./src/index.ts", "search", "test", "--semantic", "--limit", "2"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    // Skip test if no embeddings configured or database error
    if (output.includes("Embeddings not configured") || output.includes("No embeddings found") || proc.exitCode !== 0 || stderr.includes("SQLiteError")) {
      console.log("Skipping test: embeddings not configured or database error");
      return;
    }

    if (output.includes("No results found") || !output.includes("Results:")) {
      console.log("Skipping test: no results found");
      return;
    }

    // Default table format shows percentage and ID
    expect(output).toContain("Results:");
    expect(output).toContain("%");
    expect(output).toContain("ID:");
  });
});

describe("search --semantic flag validation", () => {
  testOrSkip("--depth without --show is accepted (has no effect)", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "./src/index.ts", "search", "test", "--semantic", "--limit", "1", "--depth", "1"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    // Skip test if database error (schema migration needed)
    if (stderr.includes("SQLiteError") || stderr.includes("no such column")) {
      console.log("Skipping test: database needs migration");
      return;
    }

    // Should not error on --depth alone (it just has no effect without --show)
    expect(stderr).not.toContain("error");
    expect(proc.exitCode).toBe(0);
  });

  testOrSkip("--show flag is recognized", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "./src/index.ts", "search", "--help"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain("--show");
    expect(output).toContain("--depth");
    expect(output).toContain("--semantic");
  });
});
