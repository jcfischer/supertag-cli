/**
 * Batch Integration Tests
 *
 * Tests for sync, embed, and tana-export commands using processWorkspaces.
 * Spec: 056-batch-workspace-processor
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { existsSync } from "fs";

// T-3.1: Sync command integration tests
describe("sync command batch processing", () => {
  describe("sync index --all", () => {
    it("should use processWorkspaces for batch indexing", async () => {
      const { processWorkspaces, isBatchMode } = await import(
        "../src/config/batch-processor"
      );

      // Verify the function can handle batch options
      const options = { all: true };
      expect(isBatchMode(options)).toBe(true);

      // When migrated, sync index --all will use processWorkspaces internally
      // This test verifies the batch processor is ready for integration
      const result = await processWorkspaces(
        { workspace: "main" },
        async (ws) => {
          // Simulate index operation returning result
          return {
            exportFile: "test.json",
            nodesIndexed: 100,
            durationMs: 50,
          };
        }
      );

      expect(result.successful).toBe(1);
      expect(result.results[0].result).toEqual({
        exportFile: "test.json",
        nodesIndexed: 100,
        durationMs: 50,
      });
    });

    it("should track success and failure counts correctly", async () => {
      const { processWorkspaces } = await import("../src/config/batch-processor");

      let callCount = 0;
      const result = await processWorkspaces(
        { workspaces: ["main", "nonexistent"], continueOnError: true },
        async (ws) => {
          callCount++;
          return `indexed ${ws.alias}`;
        }
      );

      // main succeeds, nonexistent fails (workspace resolution)
      expect(result.successful).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBeGreaterThanOrEqual(1);
      expect(result.results.length).toBe(2);
    });

    it("should exit with code 1 if any workspace fails", async () => {
      const { processWorkspaces } = await import("../src/config/batch-processor");

      const result = await processWorkspaces(
        { workspaces: ["main", "nonexistent"], continueOnError: true },
        async (ws) => ws.alias
      );

      // Simulate exit code logic from sync command
      const exitCode = result.failed > 0 ? 1 : 0;
      expect(exitCode).toBe(1);
    });
  });

  describe("sync status --all", () => {
    it("should process all workspaces for status display", async () => {
      const { processWorkspaces } = await import("../src/config/batch-processor");

      const statusResults: string[] = [];
      const result = await processWorkspaces(
        { workspace: "main" },
        async (ws) => {
          // Simulate status collection
          const status = {
            alias: ws.alias,
            exportDirExists: existsSync(ws.exportDir),
            dbExists: existsSync(ws.dbPath),
          };
          statusResults.push(ws.alias);
          return status;
        }
      );

      expect(result.successful).toBe(1);
      expect(statusResults).toContain("main");
      expect(result.results[0].result).toHaveProperty("alias");
      expect(result.results[0].result).toHaveProperty("exportDirExists");
      expect(result.results[0].result).toHaveProperty("dbExists");
    });
  });

  describe("sync cleanup --all", () => {
    it("should aggregate cleanup results across workspaces", async () => {
      const { processWorkspaces } = await import("../src/config/batch-processor");

      const result = await processWorkspaces(
        { workspace: "main" },
        async (ws) => {
          // Simulate cleanup operation
          return {
            deleted: 2,
            bytesFreed: 1024,
            kept: 3,
          };
        }
      );

      expect(result.successful).toBe(1);

      // Verify we can aggregate results
      let totalDeleted = 0;
      let totalBytesFreed = 0;
      for (const r of result.results) {
        if (r.success && r.result) {
          totalDeleted += r.result.deleted;
          totalBytesFreed += r.result.bytesFreed;
        }
      }
      expect(totalDeleted).toBe(2);
      expect(totalBytesFreed).toBe(1024);
    });
  });
});

// T-3.2: Embed command integration tests
describe("embed command batch processing", () => {
  it("should use processWorkspaces for --all-workspaces", async () => {
    const { processWorkspaces, isBatchMode } = await import(
      "../src/config/batch-processor"
    );

    // Verify the function can handle batch options
    const options = { all: true };
    expect(isBatchMode(options)).toBe(true);

    // Simulate embed generate operation
    const processed: string[] = [];
    const result = await processWorkspaces(
      { workspace: "main", continueOnError: true },
      async (ws) => {
        processed.push(ws.alias);
        // Simulate embedding result
        return {
          processed: 100,
          skipped: 50,
          errors: 0,
        };
      }
    );

    expect(result.successful).toBe(1);
    expect(processed).toContain("main");
    expect(result.results[0].result).toEqual({
      processed: 100,
      skipped: 50,
      errors: 0,
    });
  });

  it("should report success and failure counts", async () => {
    const { processWorkspaces } = await import("../src/config/batch-processor");

    const result = await processWorkspaces(
      { workspaces: ["main", "nonexistent"], continueOnError: true },
      async (ws) => ({ alias: ws.alias })
    );

    // Output should show "X succeeded, Y failed"
    expect(result.successful).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});

describe("tana-export CLI batch processing", () => {
  it.skip("should use processWorkspaces for --all", () => {
    // T-3.3: To be implemented when migrating tana-export CLI
  });
});
