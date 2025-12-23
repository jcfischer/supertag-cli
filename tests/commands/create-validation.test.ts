/**
 * Create Command Field Validation Tests
 *
 * TDD tests for field validation warnings in create command.
 * Warns when field name doesn't match available fields.
 *
 * Note: These tests verify the create command's existing verbose mode
 * which shows field validation messages.
 */

import { describe, it, expect } from "bun:test";
import { $ } from "bun";

describe("Create Command Field Validation", () => {
  describe("field validation warnings in verbose mode", () => {
    it("should warn when field name doesn't match available fields", async () => {
      // Try to create with an invalid field name - use --verbose to see field validation
      // Using "meeting" supertag which exists in the default schema
      const result = await $`bun run src/index.ts create meeting "Team Sync" --InvalidField "test" --dry-run --verbose 2>&1`.text();

      // Should show warning about invalid field (in stderr via verbose output)
      expect(result).toContain("InvalidField");
      expect(result).toContain("not found in schema");
    });

    it("should show when fields are mapped correctly", async () => {
      // Using a real supertag and known field - use "todo" which has "Done" field
      const result = await $`bun run src/index.ts create todo "Test Task" --dry-run --verbose 2>&1`.text();

      // Should show the supertag was found and parsed
      expect(result).toContain("todo");
      expect(result).toContain("DRY RUN");
    });

    it("should skip unknown fields but still create node", async () => {
      // Even with an invalid field, the node should still be validated for creation
      const result = await $`bun run src/index.ts create todo "Test Task" --UnknownField "value" --dry-run --verbose 2>&1`.text();

      // Should show warning and still validate successfully
      expect(result).toContain("UnknownField → (not found in schema, skipped)");
      expect(result).toContain("Validation passed");
    });
  });
});
