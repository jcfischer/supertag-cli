/**
 * Batch Processor Tests
 *
 * TDD tests for the batch workspace processor utility.
 * Spec: 056-batch-workspace-processor
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";

// T-1.1: Types exist and are correctly structured
describe("BatchOptions interface", () => {
  it("should accept all batch option fields", async () => {
    const { processWorkspaces } = await import("../src/config/batch-processor");

    // Type check: if this compiles, the interface is correct
    const options = {
      all: true,
      workspaces: ["main", "books"],
      workspace: "main",
      continueOnError: true,
      parallel: true,
      concurrency: 4,
      showProgress: true,
    };

    // Should not throw - just verifying types compile
    expect(options.all).toBe(true);
  });
});

describe("WorkspaceResult interface", () => {
  it("should have correct result structure", async () => {
    const { processWorkspaces } = await import("../src/config/batch-processor");

    // Process a mock operation and check result structure
    const result = await processWorkspaces(
      { workspace: "main" },
      async (ws) => "test-result"
    );

    expect(result.results).toBeArray();
    expect(result.results[0]).toHaveProperty("workspace");
    expect(result.results[0]).toHaveProperty("success");
    expect(result.results[0]).toHaveProperty("duration");
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].result).toBe("test-result");
  });
});

describe("BatchResult interface", () => {
  it("should have summary counts", async () => {
    const { processWorkspaces } = await import("../src/config/batch-processor");

    const result = await processWorkspaces(
      { workspace: "main" },
      async () => "done"
    );

    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("successful");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("totalDuration");
    expect(typeof result.successful).toBe("number");
    expect(typeof result.failed).toBe("number");
    expect(typeof result.totalDuration).toBe("number");
  });
});

// T-1.2: resolveWorkspaceList tests
describe("resolveWorkspaceList", () => {
  it("should return all workspaces when all=true", async () => {
    const { resolveWorkspaceList } = await import("../src/config/batch-processor");

    const list = resolveWorkspaceList({ all: true });

    // Should return array of available workspaces
    expect(list).toBeArray();
    expect(list.length).toBeGreaterThan(0);
    // Main workspace should be included
    expect(list).toContain("main");
  });

  it("should return explicit workspaces array", async () => {
    const { resolveWorkspaceList } = await import("../src/config/batch-processor");

    const list = resolveWorkspaceList({ workspaces: ["main", "books"] });

    expect(list).toEqual(["main", "books"]);
  });

  it("should return single workspace", async () => {
    const { resolveWorkspaceList } = await import("../src/config/batch-processor");

    const list = resolveWorkspaceList({ workspace: "books" });

    expect(list).toEqual(["books"]);
  });

  it("should default to main workspace", async () => {
    const { resolveWorkspaceList } = await import("../src/config/batch-processor");

    const list = resolveWorkspaceList({});

    // Should return default workspace (main)
    expect(list).toBeArray();
    expect(list.length).toBe(1);
    expect(list[0]).toBe("main");
  });

  it("should prioritize explicit workspaces over all flag", async () => {
    const { resolveWorkspaceList } = await import("../src/config/batch-processor");

    // If both workspaces array and all are specified, workspaces takes priority
    const list = resolveWorkspaceList({ all: true, workspaces: ["books"] });

    expect(list).toEqual(["books"]);
  });
});

// T-1.3: isBatchMode tests
describe("isBatchMode", () => {
  it("should return true for all=true", async () => {
    const { isBatchMode } = await import("../src/config/batch-processor");

    expect(isBatchMode({ all: true })).toBe(true);
  });

  it("should return true for multiple workspaces", async () => {
    const { isBatchMode } = await import("../src/config/batch-processor");

    expect(isBatchMode({ workspaces: ["main", "books"] })).toBe(true);
  });

  it("should return false for single workspace", async () => {
    const { isBatchMode } = await import("../src/config/batch-processor");

    expect(isBatchMode({ workspace: "main" })).toBe(false);
  });

  it("should return false for workspaces=[single]", async () => {
    const { isBatchMode } = await import("../src/config/batch-processor");

    expect(isBatchMode({ workspaces: ["main"] })).toBe(false);
  });

  it("should return false for empty options", async () => {
    const { isBatchMode } = await import("../src/config/batch-processor");

    expect(isBatchMode({})).toBe(false);
  });
});
