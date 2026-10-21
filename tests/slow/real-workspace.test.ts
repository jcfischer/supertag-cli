/**
 * Test against Jens-Christian's real Tana workspace
 *
 * This validates the parser works with production data
 * NOTE: These tests require sample_data/ which contains private workspace exports
 */

import { describe, test, expect } from "bun:test";
import { TanaExportParser } from "../../src/parsers/tana-export";
import { existsSync } from "fs";

// Skip tests if sample_data is not available (private workspace exports)
const SAMPLE_DATA_EXISTS = existsSync("sample_data/M9rkJkwuED@2025-11-30.json");

describe.skipIf(!SAMPLE_DATA_EXISTS)("Real Workspace Parsing - M9rkJkwuED", () => {
  test("should parse Jens-Christian's full workspace", async () => {
    const parser = new TanaExportParser();
    const dump = await parser.parseFile("sample_data/M9rkJkwuED@2025-11-30.json");

    expect(dump.formatVersion).toBe(1);
    expect(dump.docs).toBeDefined();
    expect(dump.docs.length).toBeGreaterThan(0);

    console.log(`Parsed workspace with ${dump.docs.length} docs`);
  });

  test("should build complete graph from real workspace", async () => {
    const parser = new TanaExportParser();
    const dump = await parser.parseFile("sample_data/M9rkJkwuED@2025-11-30.json");
    const graph = parser.buildGraph(dump);

    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.supertags.size).toBeGreaterThan(0);
    expect(graph.fields.size).toBeGreaterThan(0);

    console.log(`
Real Workspace Statistics:
- Docs in export: ${dump.docs.length}
- Nodes indexed: ${graph.nodes.size}
- Trashed nodes: ${graph.trash.size}
- Supertags detected: ${graph.supertags.size}
- Fields detected: ${graph.fields.size}
- Inline references: ${graph.inlineRefs.length}
- Tag colors: ${graph.tagColors.size}
    `);

    // Log some supertag names
    const tagNames = Array.from(graph.supertags.values()).map((t) => t.tagName).slice(0, 10);
    console.log(`Sample supertags: ${tagNames.join(", ")}`);
  });
});
