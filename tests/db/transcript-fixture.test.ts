/**
 * Deterministic, hermetic tests for the transcript data-access layer.
 *
 * Replaces the live-DB integration coverage (see transcript.test.ts, which is
 * now gated behind RUN_INTEGRATION) with an in-memory fixture so these queries
 * run fast and on CI. Pure helpers are covered here too.
 */
import { describe, it, expect } from "bun:test";
import {
  isTranscriptNode,
  formatTranscriptTime,
  getMeetingsWithTranscripts,
  searchTranscripts,
} from "../../src/db/transcript";
import { buildTranscriptFixtureDb } from "../helpers/transcript-fixture";

describe("Transcript helpers (hermetic)", () => {
  it("isTranscriptNode identifies transcript docTypes", () => {
    expect(isTranscriptNode("transcript")).toBe(true);
    expect(isTranscriptNode("transcriptLine")).toBe(true);
    expect(isTranscriptNode("node")).toBe(false);
    expect(isTranscriptNode(null)).toBe(false);
    expect(isTranscriptNode(undefined)).toBe(false);
  });

  it("formatTranscriptTime converts ISO to MM:SS", () => {
    expect(formatTranscriptTime("1970-01-01T00:35:58.004Z")).toBe("35:58");
    expect(formatTranscriptTime("1970-01-01T01:05:30.000Z")).toBe("65:30");
    expect(formatTranscriptTime("1970-01-01T00:00:00.000Z")).toBe("0:00");
  });
});

describe("getMeetingsWithTranscripts (fixture)", () => {
  it("returns meetings that have a SYS_A199 transcript link, with line counts", () => {
    const db = buildTranscriptFixtureDb();
    const results = getMeetingsWithTranscripts(db, { limit: 10 });
    db.close();

    expect(results).toHaveLength(1);
    expect(results[0].meetingId).toBe("m1");
    expect(results[0].meetingName).toBe("Weekly Sync");
    expect(results[0].transcriptId).toBe("v1");
    expect(results[0].lineCount).toBe(2);
  });

  it("respects the limit option", () => {
    const db = buildTranscriptFixtureDb();
    const results = getMeetingsWithTranscripts(db, { limit: 0 });
    db.close();
    expect(results).toHaveLength(0);
  });
});

describe("searchTranscripts (fixture, LIKE fallback)", () => {
  it("finds transcript lines by content and resolves the speaker", () => {
    const db = buildTranscriptFixtureDb();
    const results = searchTranscripts(db, "roadmap");
    db.close();

    expect(results).toHaveLength(1);
    expect(results[0].lineId).toBe("ln1");
    expect(results[0].lineText).toBe("Discussing the roadmap");
    expect(results[0].speaker).toBe("Alice");
  });

  it("returns nothing for a non-matching query", () => {
    const db = buildTranscriptFixtureDb();
    const results = searchTranscripts(db, "zzz-no-such-content");
    db.close();
    expect(results).toHaveLength(0);
  });

  it("only matches transcriptLine nodes", () => {
    const db = buildTranscriptFixtureDb();
    // "Weekly Sync" is a meeting name, not a transcriptLine — must not match.
    const results = searchTranscripts(db, "Weekly");
    db.close();
    expect(results).toHaveLength(0);
  });
});
