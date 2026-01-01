/**
 * E2E tests for --select CLI option
 * Spec: 059-universal-select-parameter
 * Task: T-3.2, T-3.3, T-3.4
 */

import { describe, it, expect } from "bun:test";
import { $ } from "bun";

describe("--select CLI option", () => {
  describe("help text", () => {
    it("should show --select option in search help", async () => {
      const result = await $`bun run src/index.ts search --help`.text();

      expect(result).toContain("--select");
      expect(result).toContain("fields");
    });

    it("should show --select option in nodes show help", async () => {
      const result = await $`bun run src/index.ts nodes show --help`.text();

      expect(result).toContain("--select");
    });

    it("should show --select option in fields values help", async () => {
      const result = await $`bun run src/index.ts fields values --help`.text();

      expect(result).toContain("--select");
    });
  });

  describe("search command with --select", () => {
    it("should accept --select flag without error", async () => {
      // Running with --select should not cause a parsing error
      // Even if there's no workspace, the command should parse successfully
      try {
        await $`bun run src/index.ts search "test" --select id,name --json -w non-existent-workspace-for-test`.text();
      } catch (error: unknown) {
        // The error should be about workspace not found, not about --select flag
        if (error instanceof Error && 'stderr' in error) {
          const stderr = (error as { stderr: string }).stderr;
          expect(stderr).not.toContain("unknown option");
          expect(stderr).not.toContain("--select");
        }
      }
    });

    it("should accept multiple fields in --select", async () => {
      // Even with an invalid workspace, should parse the select option correctly
      try {
        await $`bun run src/index.ts search "test" --select "id,name,fields.Status" --json`.text();
      } catch (error: unknown) {
        if (error instanceof Error && 'stderr' in error) {
          const stderr = (error as { stderr: string }).stderr;
          // Should not have any parsing errors related to --select
          expect(stderr).not.toContain("unknown option");
        }
      }
    });
  });

  describe("nodes show command with --select", () => {
    it("should accept --select flag without error", async () => {
      try {
        await $`bun run src/index.ts nodes show test-node-id --select id,name --json`.text();
      } catch (error: unknown) {
        if (error instanceof Error && 'stderr' in error) {
          const stderr = (error as { stderr: string }).stderr;
          // Should not have parsing errors for --select
          expect(stderr).not.toContain("unknown option");
        }
      }
    });
  });

  describe("fields values command with --select", () => {
    it("should accept --select flag without error", async () => {
      try {
        await $`bun run src/index.ts fields values --mode list --select fieldName,count --json`.text();
      } catch (error: unknown) {
        if (error instanceof Error && 'stderr' in error) {
          const stderr = (error as { stderr: string }).stderr;
          // Should not have parsing errors for --select
          expect(stderr).not.toContain("unknown option");
        }
      }
    });
  });
});
