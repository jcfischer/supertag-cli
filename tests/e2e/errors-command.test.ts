/**
 * E2E tests for errors command registration
 * Spec: 073-error-context
 * Task: T-6.1
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";

describe("supertag errors command", () => {
  let tempDir: string;
  let testLogPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "supertag-errors-test-"));
    testLogPath = join(tempDir, "errors.log");
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("command registration", () => {
    it("should show errors command in help", async () => {
      const result = await $`bun run src/index.ts --help`.text();

      expect(result).toContain("errors");
    });

    it("should accept --help flag on errors command", async () => {
      const result = await $`bun run src/index.ts errors --help`.text();

      expect(result).toContain("errors");
      expect(result).toContain("--last");
      expect(result).toContain("--clear");
      expect(result).toContain("--export");
    });
  });

  describe("command execution", () => {
    it("should run errors command without arguments", async () => {
      // Should not throw, just show "no errors logged" or list errors
      const result = await $`bun run src/index.ts errors`.text();

      // Either shows "No errors logged" or lists errors
      expect(result).toBeDefined();
    });

    it("should support --last flag", async () => {
      const result = await $`bun run src/index.ts errors --last 5`.text();

      expect(result).toBeDefined();
    });

    it("should support --json flag", async () => {
      const result = await $`bun run src/index.ts errors --json`.text();

      // Should be valid JSON
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("should support --export flag", async () => {
      const result = await $`bun run src/index.ts errors --export`.text();

      // Should be valid JSON
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });
});
