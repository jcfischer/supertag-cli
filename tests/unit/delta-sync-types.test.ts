import { describe, it, expect } from "bun:test";
import type {
  DeltaSyncResult,
  DeltaSyncStatus,
  DeltaSyncOptions,
} from "../../src/types/local-api";

describe("Delta-Sync Type Definitions (T-1.2)", () => {
  it("DeltaSyncResult has all required fields", () => {
    const result: DeltaSyncResult = {
      nodesFound: 10,
      nodesInserted: 3,
      nodesUpdated: 7,
      nodesSkipped: 0,
      embeddingsGenerated: 10,
      embeddingsSkipped: false,
      watermarkBefore: 1706000000000,
      watermarkAfter: 1706000300000,
      durationMs: 1500,
      pages: 1,
    };
    expect(result.nodesFound).toBe(10);
    expect(result.pages).toBe(1);
  });

  it("DeltaSyncStatus has all required fields", () => {
    const status: DeltaSyncStatus = {
      lastFullSync: 1706000000000,
      lastDeltaSync: 1706000300000,
      lastDeltaNodesCount: 12,
      totalNodes: 145000,
      embeddingCoverage: 98.5,
    };
    expect(status.lastFullSync).toBe(1706000000000);
    expect(status.embeddingCoverage).toBe(98.5);
  });

  it("DeltaSyncStatus supports null timestamps for never-synced state", () => {
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

  it("DeltaSyncOptions localApiClient interface matches expected shape", () => {
    const mockClient = {
      searchNodes: async () => [],
      health: async () => true,
    };
    const options: DeltaSyncOptions = {
      dbPath: "/tmp/test.db",
      localApiClient: mockClient,
    };
    expect(options.dbPath).toBe("/tmp/test.db");
  });
});
