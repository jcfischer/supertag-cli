/**
 * Create Command Field Validation Tests
 *
 * TDD tests for field validation warnings in create command.
 * Warns when field name doesn't match available fields.
 *
 * Note: These tests verify the create command's existing verbose mode
 * which shows field validation messages.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

describe("Create Command Field Validation", () => {
  const testDir = join(process.cwd(), "tmp-test-create-validation");
  const configDir = join(testDir, "config", "supertag");
  const dataDir = join(testDir, "data", "supertag", "workspaces", "main");

  // Store original env vars
  let origConfigHome: string | undefined;
  let origDataHome: string | undefined;

  beforeAll(() => {
    // Store original env vars
    origConfigHome = process.env.XDG_CONFIG_HOME;
    origDataHome = process.env.XDG_DATA_HOME;

    // Create test directory structure
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(configDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    // Create config file
    const config = {
      version: 1,
      workspaces: {
        main: {
          exportPath: join(testDir, "exports"),
          dataPath: dataDir,
        },
      },
      defaultWorkspace: "main",
    };
    writeFileSync(join(configDir, "config.json"), JSON.stringify(config, null, 2));

    // Create schema file with "meeting" and "todo" supertags
    const schema = {
      supertags: [
        {
          id: "meeting-id",
          name: "meeting",
          fields: [
            { id: "agenda-id", name: "Agenda", dataType: "text" },
            { id: "attendees-id", name: "Attendees", dataType: "text" },
          ],
        },
        {
          id: "todo-id",
          name: "todo",
          fields: [
            { id: "done-id", name: "Done", dataType: "boolean" },
            { id: "status-id", name: "Status", dataType: "text" },
          ],
        },
      ],
      lastUpdated: Date.now(),
    };
    writeFileSync(join(dataDir, "schema.json"), JSON.stringify(schema, null, 2));

    // Set env vars to use test directories
    process.env.XDG_CONFIG_HOME = join(testDir, "config");
    process.env.XDG_DATA_HOME = join(testDir, "data");
  });

  afterAll(() => {
    // Restore original env vars
    if (origConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = origConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (origDataHome !== undefined) {
      process.env.XDG_DATA_HOME = origDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }

    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("field validation warnings in verbose mode", () => {
    it("should warn when field name doesn't match available fields", async () => {
      // Try to create with an invalid field name - use --verbose to see field validation
      const result = await $`XDG_CONFIG_HOME=${join(testDir, "config")} XDG_DATA_HOME=${join(testDir, "data")} bun run src/index.ts create meeting "Team Sync" --InvalidField "test" --dry-run --verbose 2>&1`.text();

      // Should show warning about invalid field (in stderr via verbose output)
      expect(result).toContain("InvalidField");
      expect(result).toContain("not found in schema");
    });

    it("should show when fields are mapped correctly", async () => {
      // Using a real supertag and known field
      const result = await $`XDG_CONFIG_HOME=${join(testDir, "config")} XDG_DATA_HOME=${join(testDir, "data")} bun run src/index.ts create todo "Test Task" --dry-run --verbose 2>&1`.text();

      // Should show the supertag was found and parsed
      expect(result).toContain("todo");
      expect(result).toContain("DRY RUN");
    });

    it("should skip unknown fields but still create node", async () => {
      // Even with an invalid field, the node should still be validated for creation
      const result = await $`XDG_CONFIG_HOME=${join(testDir, "config")} XDG_DATA_HOME=${join(testDir, "data")} bun run src/index.ts create todo "Test Task" --UnknownField "value" --dry-run --verbose 2>&1`.text();

      // Should show warning and still validate successfully
      expect(result).toContain("UnknownField → (not found in schema, skipped)");
      expect(result).toContain("Validation passed");
    });
  });
});
