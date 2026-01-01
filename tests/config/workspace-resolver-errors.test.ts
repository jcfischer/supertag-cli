/**
 * Tests for workspace resolver structured errors
 * Spec: 073-error-context
 * Task: T-5.2
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import {
  resolveWorkspaceContext,
  WorkspaceNotFoundError,
  WorkspaceDatabaseMissingError,
  clearWorkspaceCache,
} from "../../src/config/workspace-resolver";
import { StructuredError } from "../../src/utils/structured-errors";
import type { TanaConfig } from "../../src/types";

// Test directory for workspace databases
const TEST_DIR = "/tmp/supertag-workspace-resolver-errors-test";

describe("Workspace Resolver Structured Errors", () => {
  const testConfig: TanaConfig = {
    token: "test-token",
    workspaces: {
      main: {
        rootFileId: "test-root-id",
        nodeid: "test-nodeid",
        exportDir: join(TEST_DIR, "exports"),
      },
      books: {
        rootFileId: "books-root-id",
        nodeid: "books-nodeid",
        exportDir: join(TEST_DIR, "books-exports"),
      },
    },
    defaultWorkspace: "main",
  };

  beforeEach(() => {
    // Clear cache and create test directory
    clearWorkspaceCache();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    clearWorkspaceCache();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("WorkspaceNotFoundError", () => {
    it("should be a StructuredError with WORKSPACE_NOT_FOUND code", () => {
      try {
        resolveWorkspaceContext({
          workspace: "nonexistent",
          config: testConfig,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(StructuredError);
        expect((error as StructuredError).code).toBe("WORKSPACE_NOT_FOUND");
      }
    });

    it("should include available workspaces in details", () => {
      try {
        resolveWorkspaceContext({
          workspace: "nonexistent",
          config: testConfig,
        });
        expect(true).toBe(false);
      } catch (error) {
        const structured = error as StructuredError;
        expect(structured.details?.requestedWorkspace).toBe("nonexistent");
        expect(structured.details?.availableWorkspaces).toEqual(["main", "books"]);
      }
    });

    it("should include suggestion with similar workspaces", () => {
      try {
        resolveWorkspaceContext({
          workspace: "bok", // Typo for "books"
          config: testConfig,
        });
        expect(true).toBe(false);
      } catch (error) {
        const structured = error as StructuredError;
        expect(structured.suggestion).toContain("books");
      }
    });

    it("should include recovery info for MCP", () => {
      try {
        resolveWorkspaceContext({
          workspace: "nonexistent",
          config: testConfig,
        });
        expect(true).toBe(false);
      } catch (error) {
        const structured = error as StructuredError;
        expect(structured.recovery).toBeDefined();
        expect(structured.recovery?.canRetry).toBe(false);
        expect(structured.recovery?.alternatives).toContain("main");
        expect(structured.recovery?.alternatives).toContain("books");
      }
    });

    it("should maintain backward compatibility with instanceof check", () => {
      try {
        resolveWorkspaceContext({
          workspace: "nonexistent",
          config: testConfig,
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceNotFoundError);
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe("WorkspaceDatabaseMissingError", () => {
    // Use a unique workspace alias that definitely won't have a database on disk
    const noDbConfig: TanaConfig = {
      token: "test-token",
      workspaces: {
        "test-no-db-workspace-xyz": {
          rootFileId: "no-db-root-id",
          nodeid: "no-db-nodeid",
          exportDir: join(TEST_DIR, "no-db-exports"),
        },
      },
      defaultWorkspace: "test-no-db-workspace-xyz",
    };

    it("should be a StructuredError with DATABASE_NOT_FOUND code", () => {
      try {
        resolveWorkspaceContext({
          workspace: "test-no-db-workspace-xyz",
          config: noDbConfig,
          requireDatabase: true,
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(StructuredError);
        expect((error as StructuredError).code).toBe("DATABASE_NOT_FOUND");
      }
    });

    it("should include workspace and path in details", () => {
      try {
        resolveWorkspaceContext({
          workspace: "test-no-db-workspace-xyz",
          config: noDbConfig,
          requireDatabase: true,
        });
        expect(true).toBe(false);
      } catch (error) {
        const structured = error as StructuredError;
        expect(structured.details?.workspace).toBe("test-no-db-workspace-xyz");
        expect(structured.details?.dbPath).toContain("test-no-db-workspace-xyz");
        expect(structured.details?.dbPath).toContain("tana-index.db");
      }
    });

    it("should suggest running sync command", () => {
      try {
        resolveWorkspaceContext({
          workspace: "test-no-db-workspace-xyz",
          config: noDbConfig,
          requireDatabase: true,
        });
        expect(true).toBe(false);
      } catch (error) {
        const structured = error as StructuredError;
        expect(structured.suggestion).toContain("sync");
      }
    });

    it("should include recovery command for MCP", () => {
      try {
        resolveWorkspaceContext({
          workspace: "test-no-db-workspace-xyz",
          config: noDbConfig,
          requireDatabase: true,
        });
        expect(true).toBe(false);
      } catch (error) {
        const structured = error as StructuredError;
        expect(structured.recovery).toBeDefined();
        expect(structured.recovery?.suggestedCommand).toContain("sync");
      }
    });

    it("should maintain backward compatibility with instanceof check", () => {
      try {
        resolveWorkspaceContext({
          workspace: "test-no-db-workspace-xyz",
          config: noDbConfig,
          requireDatabase: true,
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceDatabaseMissingError);
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe("toStructuredData()", () => {
    it("should serialize WorkspaceNotFoundError to JSON", () => {
      try {
        resolveWorkspaceContext({
          workspace: "nonexistent",
          config: testConfig,
        });
        expect(true).toBe(false);
      } catch (error) {
        const structured = error as StructuredError;
        const data = structured.toStructuredData();
        expect(data.code).toBe("WORKSPACE_NOT_FOUND");
        expect(data.message).toContain("not found");
        expect(data.details?.requestedWorkspace).toBe("nonexistent");
      }
    });

    it("should serialize WorkspaceDatabaseMissingError to JSON", () => {
      const noDbConfig: TanaConfig = {
        token: "test-token",
        workspaces: {
          "test-serialize-workspace": {
            rootFileId: "serialize-root-id",
            nodeid: "serialize-nodeid",
            exportDir: join(TEST_DIR, "serialize-exports"),
          },
        },
        defaultWorkspace: "test-serialize-workspace",
      };

      try {
        resolveWorkspaceContext({
          workspace: "test-serialize-workspace",
          config: noDbConfig,
          requireDatabase: true,
        });
        expect(true).toBe(false);
      } catch (error) {
        const structured = error as StructuredError;
        const data = structured.toStructuredData();
        expect(data.code).toBe("DATABASE_NOT_FOUND");
        expect(data.details?.workspace).toBe("test-serialize-workspace");
      }
    });
  });
});
