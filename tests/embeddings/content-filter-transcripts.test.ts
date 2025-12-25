/**
 * Tests for transcript filtering in content-filter.ts
 *
 * T-1.1: Transcripts should be excluded from SYSTEM_DOC_TYPES by default
 * T-1.2: includeTranscripts option should allow including transcript content
 */

import { describe, it, expect } from "bun:test";
import {
  SYSTEM_DOC_TYPES,
  CONTENT_DOC_TYPES,
  buildContentFilterQuery,
  type ContentFilterOptions,
} from "../../src/embeddings/content-filter";

describe("Transcript Filtering", () => {
  describe("T-1.1: SYSTEM_DOC_TYPES includes transcripts", () => {
    it("should include 'transcript' in SYSTEM_DOC_TYPES", () => {
      expect(SYSTEM_DOC_TYPES).toContain("transcript");
    });

    it("should include 'transcriptLine' in SYSTEM_DOC_TYPES", () => {
      expect(SYSTEM_DOC_TYPES).toContain("transcriptLine");
    });

    it("should NOT include 'transcript' in CONTENT_DOC_TYPES", () => {
      expect(CONTENT_DOC_TYPES).not.toContain("transcript");
    });

    it("should NOT include 'transcriptLine' in CONTENT_DOC_TYPES", () => {
      expect(CONTENT_DOC_TYPES).not.toContain("transcriptLine");
    });
  });

  describe("T-1.2: buildContentFilterQuery with includeTranscripts", () => {
    it("should exclude transcripts by default (excludeSystemTypes: true)", () => {
      const options: ContentFilterOptions = {
        excludeSystemTypes: true,
      };
      const { query } = buildContentFilterQuery(options);

      // Query should exclude system types including transcript and transcriptLine
      expect(query).toContain("NOT IN");
      expect(query).toContain("transcript");
      expect(query).toContain("transcriptLine");
    });

    it("should include transcripts when includeTranscripts is true", () => {
      const options: ContentFilterOptions = {
        excludeSystemTypes: true,
        includeTranscripts: true,
      };
      const { query } = buildContentFilterQuery(options);

      // When includeTranscripts is true, transcript types should NOT be in the exclusion list
      expect(query).toBeDefined();
      expect(query).not.toContain("'transcript'");
      expect(query).not.toContain("'transcriptLine'");

      // But other system types should still be excluded
      expect(query).toContain("'tuple'");
      expect(query).toContain("'metanode'");
    });

    it("should include all system types when excludeSystemTypes is false", () => {
      const options: ContentFilterOptions = {
        excludeSystemTypes: false,
      };
      const { query } = buildContentFilterQuery(options);

      // Should not have docType exclusion when excludeSystemTypes is false
      expect(query).not.toContain("NOT IN");
    });
  });
});
