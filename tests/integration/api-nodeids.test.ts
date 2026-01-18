/**
 * Integration tests for Tana API nodeId return
 * Spec: F-090-create-returns-node-id
 * Task: T-1.1 (Investigation), T-4.3 (Extended tests)
 *
 * FINDING (2026-01-18): Tana Input API DOES return nodeIds.
 * The API returns { children: [{ nodeId, name, type }] } format.
 * The client was parsing the wrong field (nodeIds vs children[].nodeId).
 *
 * REQUIRES: TANA_API_TOKEN environment variable
 * SLOW: Makes real API calls - marked with @slow annotation
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { TanaApiClient } from "../../src/api/client";
import type { TanaApiNode } from "../../src/types/tana-api";

// Skip all tests if no API token
const TANA_API_TOKEN = process.env.TANA_API_TOKEN;
const API_ENDPOINT = "https://europe-west1-tagr-prod.cloudfunctions.net/addToNodeV2";

const describeWithToken = TANA_API_TOKEN ? describe : describe.skip;

describeWithToken("Tana API nodeIds response @slow", () => {
  let client: TanaApiClient;

  beforeAll(() => {
    if (!TANA_API_TOKEN) {
      throw new Error("TANA_API_TOKEN required for integration tests");
    }
    client = new TanaApiClient(TANA_API_TOKEN, API_ENDPOINT);
  });

  it("returns nodeId for single node create", async () => {
    const testNode: TanaApiNode = {
      name: `API Test Node - ${new Date().toISOString()}`,
    };

    const response = await client.postNodes("INBOX", [testNode]);

    console.log("API Response:", JSON.stringify(response, null, 2));

    expect(response.success).toBe(true);
    expect(response.nodeIds).toBeDefined();
    expect(Array.isArray(response.nodeIds)).toBe(true);
    expect(response.nodeIds!.length).toBe(1);
    expect(typeof response.nodeIds![0]).toBe("string");
    expect(response.nodeIds![0].length).toBeGreaterThan(0);

    console.log("SUCCESS: Tana API returns nodeId:", response.nodeIds![0]);
  });

  it("returns nodeId matching alphanumeric pattern", async () => {
    const testNode: TanaApiNode = {
      name: `Single Node Test - ${Date.now()}`,
    };

    const response = await client.postNodes("INBOX", [testNode]);

    expect(response.success).toBe(true);
    expect(response.nodeIds!.length).toBe(1);
    // Tana node IDs are alphanumeric strings
    expect(response.nodeIds![0]).toMatch(/^[a-zA-Z0-9_-]+$/);

    console.log("NodeId format verified:", response.nodeIds![0]);
  });

  it("returns multiple nodeIds for batch create", async () => {
    const testNodes: TanaApiNode[] = [
      { name: `Batch Test 1 - ${Date.now()}` },
      { name: `Batch Test 2 - ${Date.now()}` },
    ];

    const response = await client.postNodes("INBOX", testNodes);

    console.log("Batch API Response:", JSON.stringify(response, null, 2));

    expect(response.success).toBe(true);
    expect(response.nodeIds!.length).toBe(2);
    expect(response.nodeIds![0]).not.toBe(response.nodeIds![1]);

    console.log("Batch nodeIds:", response.nodeIds);
  });
});

// Test that runs without API token to verify skip behavior
describe("Tana API nodeIds - Token check", () => {
  it("should document token requirement", () => {
    if (!TANA_API_TOKEN) {
      console.log("TANA_API_TOKEN not set - skipping integration tests");
      console.log("Set TANA_API_TOKEN environment variable to run these tests");
    }
    expect(true).toBe(true);  // Always passes - just for documentation
  });
});
