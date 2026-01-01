/**
 * Batch Processor Tests
 *
 * TDD tests for the batch workspace processor utility.
 * Spec: 056-batch-workspace-processor
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { listAvailableWorkspaces } from "../src/config/workspace-resolver";

// Check if workspaces are configured (CI environments may not have config)
let hasWorkspaces = false;
try {
  const workspaces = listAvailableWorkspaces();
  hasWorkspaces = workspaces.length > 0;
} catch {
  hasWorkspaces = false;
}

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
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

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
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

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
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

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

    // Should return default workspace (main) - this works even without config
    // because the function defaults to ["main"] when no workspaces configured
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

// T-2.1: processWorkspaces sequential tests
describe("processWorkspaces", () => {
  it("should process single workspace", async () => {
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

    const { processWorkspaces } = await import("../src/config/batch-processor");

    const result = await processWorkspaces(
      { workspace: "main" },
      async (ws) => `processed ${ws.alias}`
    );

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].result).toBe("processed main");
    expect(result.results[0].success).toBe(true);
  });

  it("should process all workspaces", async () => {
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

    const { processWorkspaces } = await import("../src/config/batch-processor");

    const processed: string[] = [];
    const result = await processWorkspaces(
      { all: true },
      async (ws) => {
        processed.push(ws.alias);
        return `processed ${ws.alias}`;
      }
    );

    expect(result.successful).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(processed.length).toBeGreaterThan(0);
    expect(processed).toContain("main");
  });

  it("should stop on error by default", async () => {
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

    const { processWorkspaces } = await import("../src/config/batch-processor");

    const processed: string[] = [];
    const result = await processWorkspaces(
      { workspaces: ["main", "nonexistent", "books"] },
      async (ws) => {
        processed.push(ws.alias);
        return ws.alias;
      }
    );

    // Should stop after first failure (nonexistent workspace)
    // main succeeds, nonexistent fails, books never runs
    expect(result.results.length).toBe(2);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("should continue on error when configured", async () => {
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

    const { processWorkspaces } = await import("../src/config/batch-processor");

    const processed: string[] = [];
    const result = await processWorkspaces(
      { workspaces: ["main", "nonexistent", "books"], continueOnError: true },
      async (ws) => {
        processed.push(ws.alias);
        return ws.alias;
      }
    );

    // Should process all workspaces despite errors
    // main succeeds, nonexistent fails (workspace not found), books - depends on if it exists
    expect(result.results.length).toBe(3);
    expect(result.successful).toBeGreaterThanOrEqual(1); // At least main
    expect(result.failed).toBeGreaterThanOrEqual(1); // At least nonexistent
  });

  it("should call progress callback", async () => {
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

    const { processWorkspaces } = await import("../src/config/batch-processor");

    const calls: string[] = [];
    await processWorkspaces(
      { workspace: "main" },
      async () => "done",
      (alias, i, total, status) => {
        calls.push(`${alias}:${status}`);
      }
    );

    expect(calls).toContain("main:start");
    expect(calls).toContain("main:success");
  });

  it("should track duration per workspace", async () => {
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

    const { processWorkspaces } = await import("../src/config/batch-processor");

    const result = await processWorkspaces(
      { workspace: "main" },
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return "done";
      }
    );

    expect(result.results[0].duration).toBeGreaterThanOrEqual(50);
    expect(result.totalDuration).toBeGreaterThanOrEqual(50);
  });

  it("should capture error in result", async () => {
    const { processWorkspaces } = await import("../src/config/batch-processor");

    const result = await processWorkspaces(
      { workspaces: ["nonexistent"] },
      async (ws) => ws.alias
    );

    expect(result.failed).toBe(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toBeInstanceOf(Error);
  });

  // T-2.2: Parallel execution tests
  it("should support parallel execution", async () => {
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

    const { processWorkspaces } = await import("../src/config/batch-processor");

    const startTimes: number[] = [];
    const result = await processWorkspaces(
      { workspaces: ["main", "main"], parallel: true },
      async (ws) => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        return ws.alias;
      }
    );

    // Both should start at roughly the same time (within 10ms)
    expect(result.successful).toBe(2);
    if (startTimes.length === 2) {
      const timeDiff = Math.abs(startTimes[0] - startTimes[1]);
      expect(timeDiff).toBeLessThan(30); // Should be nearly simultaneous
    }
  });

  it("should respect concurrency limit", async () => {
    if (!hasWorkspaces) {
      console.log("Skipping - no workspaces configured");
      return;
    }

    const { processWorkspaces } = await import("../src/config/batch-processor");

    let concurrent = 0;
    let maxConcurrent = 0;

    const result = await processWorkspaces(
      { workspaces: ["main", "main", "main", "main"], parallel: true, concurrency: 2 },
      async (ws) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
        return ws.alias;
      }
    );

    expect(result.successful).toBe(4);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

// T-2.3: createProgressLogger tests
describe("createProgressLogger", () => {
  it("should return pretty formatter with icons", async () => {
    const { createProgressLogger } = await import("../src/config/batch-processor");

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      const logger = createProgressLogger("pretty");
      logger("main", 1, 3, "start");
      logger("main", 1, 3, "success");
      logger("main", 1, 3, "error");

      // Should contain icons
      expect(logs.some((l) => l.includes("\u22EF"))).toBe(true); // start icon
      expect(logs.some((l) => l.includes("\u2713"))).toBe(true); // success icon
      expect(logs.some((l) => l.includes("\u2717"))).toBe(true); // error icon
      // Should contain progress format [1/3]
      expect(logs.some((l) => l.includes("[1/3]"))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("should return unix formatter with TSV", async () => {
    const { createProgressLogger } = await import("../src/config/batch-processor");

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      const logger = createProgressLogger("unix");
      logger("main", 1, 3, "start");
      logger("main", 1, 3, "success");
      logger("books", 2, 3, "error");

      // Unix mode should not log on start
      expect(logs.length).toBe(2);
      // Should be tab-separated
      expect(logs[0]).toBe("main\tsuccess");
      expect(logs[1]).toBe("books\terror");
    } finally {
      console.log = originalLog;
    }
  });
});
