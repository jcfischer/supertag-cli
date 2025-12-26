/**
 * Tests for transcript CLI commands
 *
 * Tests the transcript list, show, and search subcommands.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { getDatabasePath, resolveWorkspace } from "../../src/config/paths";
import { ConfigManager } from "../../src/config/manager";

describe("Transcript CLI Commands", () => {
  let hasTranscripts: boolean = false;
  let dbPath: string;

  beforeAll(() => {
    // Check if database exists and has transcripts
    const config = ConfigManager.getInstance().getConfig();
    const wsContext = resolveWorkspace(undefined, config);
    dbPath = wsContext.dbPath;

    if (!existsSync(dbPath)) {
      console.log(`Skipping transcript CLI tests - no database at ${dbPath}`);
      return;
    }

    const db = new Database(dbPath, { readonly: true });
    const transcriptCount = db
      .query(`
        SELECT COUNT(*) as count
        FROM nodes
        WHERE json_extract(raw_data, '$.props._docType') = 'transcript'
      `)
      .get() as { count: number };

    hasTranscripts = transcriptCount.count > 0;
    db.close();
  });

  describe("T-3.1: transcript list", () => {
    it("should display list of meetings with transcripts", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      const result = await $`bun run src/index.ts transcript list --limit 5`.text();

      // Should show some output
      expect(result.length).toBeGreaterThan(0);
    });

    it(
      "should support --json output",
      async () => {
        if (!hasTranscripts) {
          console.log("Skipping - no transcripts available");
          return;
        }

        const result =
          await $`bun run src/index.ts transcript list --limit 3 --json`.text();

        // Should be valid JSON
        const parsed = JSON.parse(result.trim());
        expect(Array.isArray(parsed)).toBe(true);
        if (parsed.length > 0) {
          expect(parsed[0]).toHaveProperty("meetingId");
          expect(parsed[0]).toHaveProperty("meetingName");
          expect(parsed[0]).toHaveProperty("transcriptId");
          expect(parsed[0]).toHaveProperty("lineCount");
        }
      },
      30000
    );
  });

  describe("T-3.2: transcript show", () => {
    it("should require meeting or transcript ID", async () => {
      try {
        await $`bun run src/index.ts transcript show`.quiet();
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: unknown) {
        // Commander throws error for missing argument (to stderr)
        const shellError = error as { stderr: Buffer };
        const output = shellError.stderr?.toString() ?? "";
        expect(output.toLowerCase()).toContain("missing");
      }
    });

    it("should display transcript lines for valid meeting", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      // First get a meeting ID
      const listResult = await $`bun run src/index.ts transcript list --limit 1 --json`.text();
      const meetings = JSON.parse(listResult.trim());

      if (meetings.length === 0) {
        console.log("Skipping - no meetings found");
        return;
      }

      const meetingId = meetings[0].meetingId;
      const result = await $`bun run src/index.ts transcript show ${meetingId} --limit 5`.text();

      // Should show transcript lines
      expect(result.length).toBeGreaterThan(0);
    }, 15000); // CLI compilation is slow, need 15s timeout

    it("should support --json output", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      // First get a meeting ID
      const listResult = await $`bun run src/index.ts transcript list --limit 1 --json`.text();
      const meetings = JSON.parse(listResult.trim());

      if (meetings.length === 0) {
        console.log("Skipping - no meetings found");
        return;
      }

      const meetingId = meetings[0].meetingId;
      const result = await $`bun run src/index.ts transcript show ${meetingId} --limit 3 --json`.text();

      // Should be valid JSON
      const parsed = JSON.parse(result.trim());
      expect(parsed).toHaveProperty("meeting");
      expect(parsed).toHaveProperty("lines");
      expect(Array.isArray(parsed.lines)).toBe(true);
    }, 15000); // CLI compilation is slow, need 15s timeout
  });

  describe("T-3.3: transcript search", () => {
    it("should require search query", async () => {
      try {
        await $`bun run src/index.ts transcript search`.quiet();
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: unknown) {
        // Commander throws error for missing argument (to stderr)
        const shellError = error as { stderr: Buffer };
        const output = shellError.stderr?.toString() ?? "";
        expect(output.toLowerCase()).toContain("missing");
      }
    });

    it("should return empty results for non-matching query", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      const result = await $`bun run src/index.ts transcript search xyznonexistentquery123 --json`.text();

      // Should return empty array
      const parsed = JSON.parse(result.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(0);
    });

    it("should find transcript lines matching query", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      // Search for a common word
      const result = await $`bun run src/index.ts transcript search meeting --limit 3 --json`.text();

      const parsed = JSON.parse(result.trim());
      expect(Array.isArray(parsed)).toBe(true);
      if (parsed.length > 0) {
        expect(parsed[0]).toHaveProperty("lineId");
        expect(parsed[0]).toHaveProperty("lineText");
        expect(parsed[0]).toHaveProperty("speaker");
      }
    });
  });
});
