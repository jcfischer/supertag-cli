/**
 * Enrichment Config Tests (F-104 T-1.2)
 *
 * Tests for enrichment configuration loading and tag-specific resolution.
 */

import { describe, it, expect } from "bun:test";
import {
  DEFAULT_ENRICHMENT_CONFIG,
  type GraphAwareEnrichmentConfig,
} from "../../src/types/enrichment";
import { getConfigForTag } from "../../src/embeddings/enrichment-config";

describe("Enrichment Config", () => {
  describe("DEFAULT_ENRICHMENT_CONFIG", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_ENRICHMENT_CONFIG.defaults.includeTagName).toBe(true);
      expect(DEFAULT_ENRICHMENT_CONFIG.defaults.includeFields).toEqual([
        "options",
        "date",
        "instance",
      ]);
      expect(DEFAULT_ENRICHMENT_CONFIG.defaults.maxFieldsPerTag).toBe(5);
      expect(DEFAULT_ENRICHMENT_CONFIG.overrides).toEqual({});
    });
  });

  describe("getConfigForTag", () => {
    it("returns defaults when no overrides exist", () => {
      const result = getConfigForTag(DEFAULT_ENRICHMENT_CONFIG, "meeting");
      expect(result).not.toBeNull();
      expect(result!.maxFieldsPerTag).toBe(5);
      expect(result!.includeFields).toBeUndefined();
    });

    it("returns null when tag is disabled", () => {
      const config: GraphAwareEnrichmentConfig = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        overrides: {
          internal: { disabled: true },
        },
      };
      expect(getConfigForTag(config, "internal")).toBeNull();
    });

    it("applies per-tag overrides", () => {
      const config: GraphAwareEnrichmentConfig = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        overrides: {
          meeting: {
            includeFields: ["Date", "Attendees"],
            maxFieldsPerTag: 3,
          },
        },
      };
      const result = getConfigForTag(config, "meeting");
      expect(result).not.toBeNull();
      expect(result!.includeFields).toEqual(["Date", "Attendees"]);
      expect(result!.maxFieldsPerTag).toBe(3);
    });

    it("is case-insensitive for tag names", () => {
      const config: GraphAwareEnrichmentConfig = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        overrides: {
          meeting: { maxFieldsPerTag: 2 },
        },
      };
      const result = getConfigForTag(config, "Meeting");
      expect(result).not.toBeNull();
      expect(result!.maxFieldsPerTag).toBe(2);
    });

    it("falls back to default maxFieldsPerTag when override does not specify it", () => {
      const config: GraphAwareEnrichmentConfig = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        overrides: {
          person: { includeFields: ["Role"] },
        },
      };
      const result = getConfigForTag(config, "person");
      expect(result).not.toBeNull();
      expect(result!.maxFieldsPerTag).toBe(5);
    });
  });
});
