/**
 * Workspace Resolver Tests
 *
 * TDD tests for the unified workspace resolver module.
 * Spec: 052-unified-workspace-resolver
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Import types and functions under test
import {
  WorkspaceNotFoundError,
  WorkspaceDatabaseMissingError,
  resolveWorkspaceContext,
  listAvailableWorkspaces,
  getDefaultWorkspace,
  clearWorkspaceCache,
  type ResolvedWorkspace,
  type ResolveOptions,
} from "../src/config/workspace-resolver";

import type { TanaConfig, WorkspaceConfig } from "../src/types";

/**
 * Create a test config with workspaces
 */
function createTestConfig(options?: {
  workspaces?: Record<string, WorkspaceConfig>;
  defaultWorkspace?: string;
}): TanaConfig {
  return {
    apiEndpoint: "https://test.api",
    defaultTargetNode: "INBOX",
    workspaces: options?.workspaces ?? {
      main: { rootFileId: "main-root", enabled: true },
      books: { rootFileId: "books-root", nodeid: "books-node", enabled: true },
      disabled: { rootFileId: "disabled-root", enabled: false },
    },
    defaultWorkspace: options?.defaultWorkspace ?? "main",
  };
}

// =============================================================================
// T-1.1: Error Types and Interfaces
// =============================================================================

describe("WorkspaceNotFoundError", () => {
  it("should include requested workspace in message", () => {
    const error = new WorkspaceNotFoundError("unknown", ["main", "books"]);
    expect(error.message).toContain("unknown");
    expect(error.name).toBe("WorkspaceNotFoundError");
  });

  it("should include available workspaces in message", () => {
    const error = new WorkspaceNotFoundError("typo", ["main", "books", "work"]);
    expect(error.message).toContain("main");
    expect(error.message).toContain("books");
    expect(error.message).toContain("work");
  });

  it("should handle empty available workspaces", () => {
    const error = new WorkspaceNotFoundError("any", []);
    expect(error.message).toContain("No workspaces configured");
  });

  it("should expose requestedWorkspace property", () => {
    const error = new WorkspaceNotFoundError("missing", ["main"]);
    expect(error.requestedWorkspace).toBe("missing");
  });

  it("should expose availableWorkspaces property", () => {
    const error = new WorkspaceNotFoundError("missing", ["main", "books"]);
    expect(error.availableWorkspaces).toEqual(["main", "books"]);
  });
});

describe("WorkspaceDatabaseMissingError", () => {
  it("should include workspace alias in message", () => {
    const error = new WorkspaceDatabaseMissingError("books", "/path/to/db");
    expect(error.message).toContain("books");
    expect(error.name).toBe("WorkspaceDatabaseMissingError");
  });

  it("should include database path in message", () => {
    const error = new WorkspaceDatabaseMissingError("main", "/home/user/.local/share/supertag/workspaces/main/tana-index.db");
    expect(error.message).toContain("/home/user/.local/share/supertag/workspaces/main/tana-index.db");
  });

  it("should suggest running sync command", () => {
    const error = new WorkspaceDatabaseMissingError("books", "/path/to/db");
    expect(error.message).toContain("supertag sync");
  });

  it("should expose workspace property", () => {
    const error = new WorkspaceDatabaseMissingError("main", "/path");
    expect(error.workspace).toBe("main");
  });

  it("should expose dbPath property", () => {
    const error = new WorkspaceDatabaseMissingError("main", "/path/to/db");
    expect(error.dbPath).toBe("/path/to/db");
  });
});

// =============================================================================
// T-1.2: resolveWorkspaceContext()
// =============================================================================

describe("resolveWorkspaceContext", () => {
  let tempDir: string;
  let testConfig: TanaConfig;

  beforeEach(() => {
    clearWorkspaceCache();
    // Create temp directory for test databases
    tempDir = join(tmpdir(), `supertag-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    testConfig = createTestConfig();
  });

  afterEach(() => {
    clearWorkspaceCache();
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should resolve default workspace when no alias provided", () => {
    // Create a mock database file
    const dbPath = join(tempDir, "main", "tana-index.db");
    mkdirSync(join(tempDir, "main"), { recursive: true });
    writeFileSync(dbPath, "");

    const ws = resolveWorkspaceContext({
      config: testConfig,
      requireDatabase: false,
    });

    expect(ws.alias).toBe("main");
    expect(ws.isDefault).toBe(true);
  });

  it("should resolve specific workspace by alias", () => {
    const ws = resolveWorkspaceContext({
      workspace: "books",
      config: testConfig,
      requireDatabase: false,
    });

    expect(ws.alias).toBe("books");
    expect(ws.isDefault).toBe(false);
    expect(ws.config.rootFileId).toBe("books-root");
  });

  it("should throw WorkspaceNotFoundError for unknown alias", () => {
    expect(() =>
      resolveWorkspaceContext({
        workspace: "nonexistent",
        config: testConfig,
        requireDatabase: false,
      })
    ).toThrow(WorkspaceNotFoundError);
  });

  it("should include available workspaces in WorkspaceNotFoundError", () => {
    try {
      resolveWorkspaceContext({
        workspace: "typo",
        config: testConfig,
        requireDatabase: false,
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkspaceNotFoundError);
      const error = e as WorkspaceNotFoundError;
      expect(error.availableWorkspaces).toContain("main");
      expect(error.availableWorkspaces).toContain("books");
    }
  });

  it("should throw WorkspaceDatabaseMissingError when requireDatabase and DB missing", () => {
    // Use a workspace alias that definitely doesn't have a database
    const configWithNonexistentDb = createTestConfig({
      workspaces: {
        "no-db-workspace": { rootFileId: "no-db-root", enabled: true },
      },
      defaultWorkspace: "no-db-workspace",
    });

    expect(() =>
      resolveWorkspaceContext({
        workspace: "no-db-workspace",
        config: configWithNonexistentDb,
        requireDatabase: true,
      })
    ).toThrow(WorkspaceDatabaseMissingError);
  });

  it("should allow missing database when requireDatabase is false", () => {
    const ws = resolveWorkspaceContext({
      workspace: "main",
      config: testConfig,
      requireDatabase: false,
    });

    expect(ws.alias).toBe("main");
  });

  it("should return ResolvedWorkspace with all required properties", () => {
    const ws = resolveWorkspaceContext({
      workspace: "books",
      config: testConfig,
      requireDatabase: false,
    });

    expect(ws).toHaveProperty("alias");
    expect(ws).toHaveProperty("config");
    expect(ws).toHaveProperty("dbPath");
    expect(ws).toHaveProperty("isDefault");
    expect(typeof ws.alias).toBe("string");
    expect(typeof ws.dbPath).toBe("string");
    expect(typeof ws.isDefault).toBe("boolean");
  });
});

// =============================================================================
// T-1.3: Caching Layer
// =============================================================================

describe("workspace caching", () => {
  beforeEach(() => {
    clearWorkspaceCache();
  });

  afterEach(() => {
    clearWorkspaceCache();
  });

  it("should return cached workspace on repeated calls", () => {
    const config = createTestConfig();

    const ws1 = resolveWorkspaceContext({
      workspace: "main",
      config,
      requireDatabase: false,
    });

    const ws2 = resolveWorkspaceContext({
      workspace: "main",
      config,
      requireDatabase: false,
    });

    // Same object reference means cache hit
    expect(ws1).toBe(ws2);
  });

  it("should cache different workspaces separately", () => {
    const config = createTestConfig();

    const main = resolveWorkspaceContext({
      workspace: "main",
      config,
      requireDatabase: false,
    });

    const books = resolveWorkspaceContext({
      workspace: "books",
      config,
      requireDatabase: false,
    });

    expect(main.alias).toBe("main");
    expect(books.alias).toBe("books");
    expect(main).not.toBe(books);
  });

  it("should clear cache with clearWorkspaceCache()", () => {
    const config = createTestConfig();

    const ws1 = resolveWorkspaceContext({
      workspace: "main",
      config,
      requireDatabase: false,
    });

    clearWorkspaceCache();

    const ws2 = resolveWorkspaceContext({
      workspace: "main",
      config,
      requireDatabase: false,
    });

    // Different object reference after cache clear
    expect(ws1).not.toBe(ws2);
    // But same values
    expect(ws1.alias).toBe(ws2.alias);
  });
});

// =============================================================================
// T-2.1: listAvailableWorkspaces()
// =============================================================================

describe("listAvailableWorkspaces", () => {
  it("should return all workspace aliases", () => {
    const config = createTestConfig();
    const workspaces = listAvailableWorkspaces(config);

    expect(workspaces).toContain("main");
    expect(workspaces).toContain("books");
    expect(workspaces).toContain("disabled");
  });

  it("should return empty array when no workspaces configured", () => {
    const config = createTestConfig({ workspaces: {} });
    const workspaces = listAvailableWorkspaces(config);

    expect(workspaces).toEqual([]);
  });

  it("should return empty array when workspaces is undefined", () => {
    const config: TanaConfig = {
      apiEndpoint: "https://test.api",
      defaultTargetNode: "INBOX",
    };
    const workspaces = listAvailableWorkspaces(config);

    expect(workspaces).toEqual([]);
  });
});

// =============================================================================
// T-2.2: getDefaultWorkspace()
// =============================================================================

describe("getDefaultWorkspace", () => {
  it("should return configured default workspace", () => {
    const config = createTestConfig({ defaultWorkspace: "books" });
    const defaultWs = getDefaultWorkspace(config);

    expect(defaultWs).toBe("books");
  });

  it("should return 'main' when no default configured", () => {
    const config = createTestConfig({ defaultWorkspace: undefined });
    const defaultWs = getDefaultWorkspace(config);

    expect(defaultWs).toBe("main");
  });

  it("should return 'main' for empty config", () => {
    const config: TanaConfig = {
      apiEndpoint: "https://test.api",
      defaultTargetNode: "INBOX",
    };
    const defaultWs = getDefaultWorkspace(config);

    expect(defaultWs).toBe("main");
  });
});

// =============================================================================
// T-2.3: withWorkspace()
// =============================================================================

describe("withWorkspace", () => {
  beforeEach(() => {
    clearWorkspaceCache();
  });

  afterEach(() => {
    clearWorkspaceCache();
  });

  // Import dynamically to avoid circular dependency issues
  const { withWorkspace } = require("../src/config/workspace-resolver");

  it("should pass resolved workspace to callback", async () => {
    const config = createTestConfig();

    const result = await withWorkspace(
      { workspace: "books", config, requireDatabase: false },
      (ws: ResolvedWorkspace) => ws.alias
    );

    expect(result).toBe("books");
  });

  it("should work with async callbacks", async () => {
    const config = createTestConfig();

    const result = await withWorkspace(
      { workspace: "main", config, requireDatabase: false },
      async (ws: ResolvedWorkspace) => {
        await new Promise((r) => setTimeout(r, 10));
        return `processed-${ws.alias}`;
      }
    );

    expect(result).toBe("processed-main");
  });

  it("should propagate errors from callback", async () => {
    const config = createTestConfig();

    await expect(
      withWorkspace(
        { workspace: "main", config, requireDatabase: false },
        () => {
          throw new Error("Callback error");
        }
      )
    ).rejects.toThrow("Callback error");
  });

  it("should propagate WorkspaceNotFoundError", async () => {
    const config = createTestConfig();

    await expect(
      withWorkspace(
        { workspace: "unknown", config, requireDatabase: false },
        () => "never reached"
      )
    ).rejects.toThrow(WorkspaceNotFoundError);
  });
});
