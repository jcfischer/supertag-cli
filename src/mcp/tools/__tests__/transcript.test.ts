/**
 * Tests for MCP transcript tools
 *
 * Tests tana_transcript_list, tana_transcript_show, tana_transcript_search
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { getDatabasePath, resolveWorkspace } from "../../../config/paths";
import { ConfigManager } from "../../../config/manager";
import {
  transcriptList,
  transcriptShow,
  transcriptSearch,
} from "../transcript";
import {
  transcriptListSchema,
  transcriptShowSchema,
  transcriptSearchSchema,
} from "../../schemas";

describe("MCP Transcript Tools", () => {
  let hasTranscripts: boolean = false;
  let dbPath: string;

  beforeAll(() => {
    const config = ConfigManager.getInstance().getConfig();
    const wsContext = resolveWorkspace(undefined, config);
    dbPath = wsContext.dbPath;

    if (!existsSync(dbPath)) {
      console.log(`Skipping MCP transcript tests - no database at ${dbPath}`);
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

  describe("tana_transcript_list", () => {
    it("should validate input schema", () => {
      // Valid input
      const valid = transcriptListSchema.parse({ limit: 10 });
      expect(valid.limit).toBe(10);

      // Default limit
      const defaults = transcriptListSchema.parse({});
      expect(defaults.limit).toBe(20);
    });

    it(
      "should return list of meetings with transcripts",
      async () => {
        if (!hasTranscripts) {
          console.log("Skipping - no transcripts available");
          return;
        }

        const result = await transcriptList({ limit: 5 });

        expect(result).toHaveProperty("workspace");
        expect(result).toHaveProperty("meetings");
        expect(result).toHaveProperty("count");
        expect(Array.isArray(result.meetings)).toBe(true);

        if (result.meetings.length > 0) {
          const meeting = result.meetings[0];
          expect(meeting).toHaveProperty("meetingId");
          expect(meeting).toHaveProperty("meetingName");
          expect(meeting).toHaveProperty("transcriptId");
          expect(meeting).toHaveProperty("lineCount");
        }
      },
      30000
    );

    it("should respect limit parameter", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      const result = await transcriptList({ limit: 2 });
      expect(result.meetings.length).toBeLessThanOrEqual(2);
    }, 15000); // May be slow with 90K+ transcript lines
  });

  describe("tana_transcript_show", () => {
    it("should validate input schema", () => {
      // Valid input
      const valid = transcriptShowSchema.parse({ id: "test123", limit: 50 });
      expect(valid.id).toBe("test123");
      expect(valid.limit).toBe(50);

      // Require id
      expect(() => transcriptShowSchema.parse({})).toThrow();
    });

    it("should return transcript lines for valid meeting", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      // First get a meeting
      const listResult = await transcriptList({ limit: 1 });
      if (listResult.meetings.length === 0) {
        console.log("Skipping - no meetings found");
        return;
      }

      const meetingId = listResult.meetings[0].meetingId;
      const result = await transcriptShow({ id: meetingId, limit: 5 });

      expect(result).toHaveProperty("workspace");
      expect(result).toHaveProperty("meeting");
      expect(result).toHaveProperty("lines");
      expect(result).toHaveProperty("count");
      expect(Array.isArray(result.lines)).toBe(true);

      if (result.lines.length > 0) {
        const line = result.lines[0];
        expect(line).toHaveProperty("id");
        expect(line).toHaveProperty("text");
        expect(line).toHaveProperty("order");
      }
    }, 15000); // Two sequential queries - may be slow

    it("should return empty lines for non-existent ID", async () => {
      const result = await transcriptShow({ id: "nonexistent123" });

      expect(result.lines).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  describe("tana_transcript_search", () => {
    it("should validate input schema", () => {
      // Valid input
      const valid = transcriptSearchSchema.parse({ query: "test", limit: 10 });
      expect(valid.query).toBe("test");
      expect(valid.limit).toBe(10);

      // Require query
      expect(() => transcriptSearchSchema.parse({})).toThrow();
    });

    it("should return empty results for non-matching query", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      const result = await transcriptSearch({
        query: "xyznonexistentquery123",
      });

      expect(result).toHaveProperty("workspace");
      expect(result).toHaveProperty("query");
      expect(result).toHaveProperty("results");
      expect(result.results).toEqual([]);
    });

    it("should find matching transcript lines", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      // Search for a common word
      const result = await transcriptSearch({ query: "meeting", limit: 5 });

      expect(result).toHaveProperty("results");
      expect(Array.isArray(result.results)).toBe(true);

      if (result.results.length > 0) {
        const match = result.results[0];
        expect(match).toHaveProperty("lineId");
        expect(match).toHaveProperty("lineText");
      }
    });

    it("should respect limit parameter", async () => {
      if (!hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      const result = await transcriptSearch({ query: "the", limit: 3 });
      expect(result.results.length).toBeLessThanOrEqual(3);
    });
  });
});
