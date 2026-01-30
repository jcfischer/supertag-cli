/**
 * Sync Status CLI Tests (T-3.2)
 *
 * Tests for `sync status` enhancement with delta-sync info:
 * - Status output includes delta-sync section
 * - "Never" display when no delta-sync has run
 * - Relative time formatting for "ago" display
 */

import { describe, it, expect } from "bun:test";
import type { DeltaSyncStatus } from "../../src/types/local-api";

/**
 * Format a relative time string from a timestamp.
 * This mirrors the logic that will be used in the status command.
 */
function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diffMs = now - timestampMs;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return "just now";
}

/**
 * Format delta-sync status section for CLI output.
 * This mirrors the logic that will be added to the status command.
 */
function formatDeltaSyncStatus(status: DeltaSyncStatus): string[] {
  const lines: string[] = [];
  lines.push("Delta Sync:");

  if (status.lastDeltaSync !== null) {
    const dateStr = new Date(status.lastDeltaSync).toLocaleString();
    const relativeStr = formatRelativeTime(status.lastDeltaSync);
    lines.push(`  Last delta-sync: ${dateStr} (${relativeStr})`);
  } else {
    lines.push("  Last delta-sync: Never");
  }

  lines.push(`  Nodes synced: ${status.lastDeltaNodesCount}`);

  if (status.totalNodes > 0) {
    const coverage = status.embeddingCoverage.toFixed(1);
    lines.push(
      `  Embedding coverage: ${coverage}% (${status.totalNodes.toLocaleString()} nodes)`
    );
  }

  return lines;
}

describe("sync status with delta-sync info (T-3.2)", () => {
  describe("formatRelativeTime", () => {
    it("should show 'just now' for recent timestamps", () => {
      const now = Date.now();
      expect(formatRelativeTime(now)).toBe("just now");
      expect(formatRelativeTime(now - 30 * 1000)).toBe("just now");
    });

    it("should show minutes ago", () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      expect(formatRelativeTime(fiveMinutesAgo)).toBe("5 minutes ago");
    });

    it("should show singular minute", () => {
      const oneMinuteAgo = Date.now() - 90 * 1000;
      expect(formatRelativeTime(oneMinuteAgo)).toBe("1 minute ago");
    });

    it("should show hours ago", () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      expect(formatRelativeTime(twoHoursAgo)).toBe("2 hours ago");
    });

    it("should show singular hour", () => {
      const oneHourAgo = Date.now() - 70 * 60 * 1000;
      expect(formatRelativeTime(oneHourAgo)).toBe("1 hour ago");
    });

    it("should show days ago", () => {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      expect(formatRelativeTime(threeDaysAgo)).toBe("3 days ago");
    });

    it("should show singular day", () => {
      const oneDayAgo = Date.now() - 25 * 60 * 60 * 1000;
      expect(formatRelativeTime(oneDayAgo)).toBe("1 day ago");
    });

    it("should handle future timestamps gracefully", () => {
      const future = Date.now() + 60000;
      expect(formatRelativeTime(future)).toBe("just now");
    });
  });

  describe("formatDeltaSyncStatus", () => {
    it("should show delta-sync section with valid status", () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      const status: DeltaSyncStatus = {
        lastFullSync: Date.now() - 24 * 60 * 60 * 1000,
        lastDeltaSync: fiveMinutesAgo,
        lastDeltaNodesCount: 12,
        totalNodes: 145242,
        embeddingCoverage: 98.2,
      };

      const lines = formatDeltaSyncStatus(status);

      expect(lines[0]).toBe("Delta Sync:");
      expect(lines[1]).toContain("Last delta-sync:");
      expect(lines[1]).toContain("5 minutes ago");
      expect(lines[2]).toBe("  Nodes synced: 12");
      expect(lines[3]).toContain("Embedding coverage: 98.2%");
      expect(lines[3]).toContain("145,242 nodes");
    });

    it("should show 'Never' when no delta-sync has run", () => {
      const status: DeltaSyncStatus = {
        lastFullSync: Date.now() - 24 * 60 * 60 * 1000,
        lastDeltaSync: null,
        lastDeltaNodesCount: 0,
        totalNodes: 100000,
        embeddingCoverage: 0,
      };

      const lines = formatDeltaSyncStatus(status);

      expect(lines[0]).toBe("Delta Sync:");
      expect(lines[1]).toBe("  Last delta-sync: Never");
      expect(lines[2]).toBe("  Nodes synced: 0");
    });

    it("should handle zero total nodes", () => {
      const status: DeltaSyncStatus = {
        lastFullSync: null,
        lastDeltaSync: null,
        lastDeltaNodesCount: 0,
        totalNodes: 0,
        embeddingCoverage: 0,
      };

      const lines = formatDeltaSyncStatus(status);

      expect(lines[0]).toBe("Delta Sync:");
      expect(lines[1]).toBe("  Last delta-sync: Never");
      expect(lines[2]).toBe("  Nodes synced: 0");
      // No embedding coverage line when totalNodes is 0
      expect(lines.length).toBe(3);
    });

    it("should show embedding coverage as percentage", () => {
      const status: DeltaSyncStatus = {
        lastFullSync: Date.now(),
        lastDeltaSync: Date.now(),
        lastDeltaNodesCount: 50,
        totalNodes: 1000,
        embeddingCoverage: 75.5,
      };

      const lines = formatDeltaSyncStatus(status);
      expect(lines[3]).toContain("75.5%");
      expect(lines[3]).toContain("1,000 nodes");
    });
  });

  describe("DeltaSyncStatus type contract", () => {
    it("should have all required fields", () => {
      const status: DeltaSyncStatus = {
        lastFullSync: 1706600000000,
        lastDeltaSync: 1706603600000,
        lastDeltaNodesCount: 25,
        totalNodes: 150000,
        embeddingCoverage: 95.3,
      };

      expect(status.lastFullSync).toBe(1706600000000);
      expect(status.lastDeltaSync).toBe(1706603600000);
      expect(status.lastDeltaNodesCount).toBe(25);
      expect(status.totalNodes).toBe(150000);
      expect(status.embeddingCoverage).toBe(95.3);
    });

    it("should allow null for optional timestamp fields", () => {
      const status: DeltaSyncStatus = {
        lastFullSync: null,
        lastDeltaSync: null,
        lastDeltaNodesCount: 0,
        totalNodes: 0,
        embeddingCoverage: 0,
      };

      expect(status.lastFullSync).toBeNull();
      expect(status.lastDeltaSync).toBeNull();
    });
  });
});
