/**
 * Tests for transcript data access layer
 *
 * Tests transcript-specific queries for meeting transcripts.
 * Uses the real database for integration testing.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { getDatabasePath, resolveWorkspace } from "../../src/config/paths";
import { ConfigManager } from "../../src/config/manager";
import {
  isTranscriptNode,
  getTranscriptForMeeting,
  getTranscriptLines,
  getMeetingsWithTranscripts,
  searchTranscripts,
  formatTranscriptTime,
  type TranscriptSummary,
  type TranscriptLine,
  type TranscriptSearchResult,
} from "../../src/db/transcript";

describe("Transcript Data Access", () => {
  let db: Database;
  let hasTranscripts: boolean = false;

  beforeAll(() => {
    // Use default workspace database
    const config = ConfigManager.getInstance().getConfig();
    const wsContext = resolveWorkspace(undefined, config);

    if (!existsSync(wsContext.dbPath)) {
      console.log(`Skipping transcript tests - no database at ${wsContext.dbPath}`);
      return;
    }

    db = new Database(wsContext.dbPath, { readonly: true });

    // Check if there are any transcripts in the database
    const transcriptCount = db
      .query(`
        SELECT COUNT(*) as count
        FROM nodes
        WHERE json_extract(raw_data, '$.props._docType') = 'transcript'
      `)
      .get() as { count: number };

    hasTranscripts = transcriptCount.count > 0;
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
  });

  describe("T-2.1: Type definitions and helpers", () => {
    it("isTranscriptNode should identify transcript docType", () => {
      expect(isTranscriptNode("transcript")).toBe(true);
      expect(isTranscriptNode("transcriptLine")).toBe(true);
      expect(isTranscriptNode("node")).toBe(false);
      expect(isTranscriptNode(null)).toBe(false);
      expect(isTranscriptNode(undefined)).toBe(false);
    });

    it("formatTranscriptTime should convert ISO to MM:SS format", () => {
      // 35 minutes, 58 seconds into meeting
      expect(formatTranscriptTime("1970-01-01T00:35:58.004Z")).toBe("35:58");

      // 1 hour, 5 minutes, 30 seconds
      expect(formatTranscriptTime("1970-01-01T01:05:30.000Z")).toBe("65:30");

      // 0 seconds (start of meeting)
      expect(formatTranscriptTime("1970-01-01T00:00:00.000Z")).toBe("0:00");
    });
  });

  describe("T-2.2: getTranscriptForMeeting", () => {
    it("should return null for non-existent meeting", () => {
      if (!db) return;

      const result = getTranscriptForMeeting(db, "non-existent-id");
      expect(result).toBeNull();
    });

    it("should return transcript ID for meeting with transcript", () => {
      if (!db || !hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      // Find a meeting with a transcript (we know oLY8KLrNDjFy has one from previous research)
      const result = getTranscriptForMeeting(db, "oLY8KLrNDjFy");

      if (result) {
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });

  describe("T-2.3: getTranscriptLines", () => {
    it("should return empty array for non-existent transcript", () => {
      if (!db) return;

      const result = getTranscriptLines(db, "non-existent-id");
      expect(result).toEqual([]);
    });

    it("should return ordered transcript lines with metadata", () => {
      if (!db || !hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      // First get a transcript ID
      const transcriptId = getTranscriptForMeeting(db, "oLY8KLrNDjFy");
      if (!transcriptId) {
        console.log("Skipping - meeting has no transcript");
        return;
      }

      const lines = getTranscriptLines(db, transcriptId);

      expect(Array.isArray(lines)).toBe(true);
      if (lines.length > 0) {
        const line = lines[0];
        expect(line).toHaveProperty("id");
        expect(line).toHaveProperty("text");
        expect(line).toHaveProperty("order");

        // Check ordering
        for (let i = 1; i < lines.length; i++) {
          expect(lines[i].order).toBeGreaterThan(lines[i - 1].order);
        }
      }
    });
  });

  describe("T-2.4: getMeetingsWithTranscripts", () => {
    it("should return array of meeting summaries", () => {
      if (!db) return;

      const results = getMeetingsWithTranscripts(db, { limit: 10 });

      expect(Array.isArray(results)).toBe(true);

      if (results.length > 0) {
        const summary = results[0];
        expect(summary).toHaveProperty("meetingId");
        expect(summary).toHaveProperty("meetingName");
        expect(summary).toHaveProperty("transcriptId");
        expect(summary).toHaveProperty("lineCount");
        expect(typeof summary.lineCount).toBe("number");
      }
    });

    it("should respect limit option", () => {
      if (!db) return;

      const results = getMeetingsWithTranscripts(db, { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe("T-2.5: searchTranscripts", () => {
    it("should return empty array for non-matching query", () => {
      if (!db) return;

      const results = searchTranscripts(db, "xyznonexistentquery123");
      expect(results).toEqual([]);
    });

    it("should return transcript search results with meeting context", () => {
      if (!db || !hasTranscripts) {
        console.log("Skipping - no transcripts available");
        return;
      }

      // Search for a common word that's likely in transcripts
      const results = searchTranscripts(db, "meeting", { limit: 5 });

      if (results.length > 0) {
        const result = results[0];
        expect(result).toHaveProperty("lineId");
        expect(result).toHaveProperty("lineText");
        expect(result).toHaveProperty("meetingId");
        expect(result).toHaveProperty("meetingName");
        expect(result).toHaveProperty("rank");
      }
    });

    it("should respect limit option", () => {
      if (!db || !hasTranscripts) return;

      const results = searchTranscripts(db, "the", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });
});
