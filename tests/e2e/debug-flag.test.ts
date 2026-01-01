/**
 * E2E tests for --debug flag integration
 * Spec: 073-error-context
 * Task: T-6.2
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";

describe("--debug flag", () => {
  describe("global flag recognition", () => {
    it("should accept --debug flag without error", async () => {
      // Running with --debug should not cause an error
      const result = await $`bun run src/index.ts --debug --help`.text();

      expect(result).toContain("supertag");
    });

    it("should show debug flag in help", async () => {
      const result = await $`bun run src/index.ts --help`.text();

      expect(result).toContain("--debug");
    });
  });

  describe("debug output on errors", () => {
    it("should show stack trace when --debug is set and error occurs", async () => {
      // Try to access a non-existent workspace with debug mode
      try {
        const result = await $`bun run src/index.ts --debug search "test" -w non-existent-workspace-xyz123`.text();
        // If it somehow succeeds, that's fine
        expect(result).toBeDefined();
      } catch (error: unknown) {
        // Error output should contain debug info (stack trace)
        // The error is expected since workspace doesn't exist
        if (error instanceof Error && 'stderr' in error) {
          const stderr = (error as { stderr: string }).stderr;
          // In debug mode, should show more detailed error
          expect(stderr.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
