/**
 * Semantic search parity (#98)
 *
 * `supertag search --semantic` (CLI) and `tana_semantic_search` (MCP) must
 * return the same ordered node IDs for the same query, limit and threshold.
 * The embedding service is mocked with a fixed ranked list and the node data
 * lives in a throwaway seeded DB, so no live index or real embeddings are used.
 */

import { describe, it, expect, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { createSeededDb, type SeededDb } from "../helpers/seeded-db";
import { handleSemanticSearch } from "../../src/commands/search";
import { semanticSearch } from "../../src/mcp/tools/semantic-search";
import {
  deduplicateResults,
  runSemanticSearchPipeline,
  type EnrichedSearchResult,
  type SemanticEmbeddingService,
} from "../../src/embeddings/search-filter";

/** Ranked list the mocked embedding service returns, best match first. */
const RANKED: Array<{ nodeId: string; distance: number }> = [
  { nodeId: "n_trash", distance: 0.1 }, // trashed via its parent
  { nodeId: "n_wiki", distance: 0.15 },
  { nodeId: "n_wiki_ref", distance: 0.16 }, // "[[...]]" reference syntax
  { nodeId: "n_week_a", distance: 0.2 }, // "week" #note
  { nodeId: "n_week_b", distance: 0.22 }, // "week" untagged: distinct from #note
  { nodeId: "n_week_c", distance: 0.25 }, // "Week" #note: duplicate of n_week_a
  { nodeId: "n_ghost", distance: 0.3 }, // not in the DB
  { nodeId: "n_edge", distance: 0.7 }, // similarity exactly at the 0.3 threshold
  { nodeId: "n_below", distance: 0.71 }, // just under the threshold
];

function seedNodes(dbPath: string): void {
  const db = new Database(dbPath);
  const node = (id: string, name: string, parent: string | null, ownerId?: string) =>
    db.run(
      "INSERT INTO nodes (id, name, parent_id, created, updated, raw_data) VALUES (?, ?, ?, 0, 0, ?)",
      [id, name, parent, JSON.stringify({ id, props: ownerId ? { _ownerId: ownerId } : {} })]
    );
  const tag = (nodeId: string, tagName: string) =>
    db.run(
      "INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES (?, ?, ?, ?)",
      [`tuple_${nodeId}_${tagName}`, nodeId, `tag_${tagName}`, tagName]
    );

  node("trash_parent", "Deleted stuff", null, "ws_TRASH");
  node("n_trash", "LLM wiki draft", "trash_parent");
  node("n_wiki", "Karpathy's LLM Wiki", null);
  tag("n_wiki", "article");
  node("n_wiki_ref", "[[Karpathy's LLM Wiki]]", null);
  node("n_week_a", "week", null);
  tag("n_week_a", "note");
  node("n_week_b", "week", null);
  node("n_week_c", "Week", null);
  tag("n_week_c", "note");
  node("n_edge", "Barely related", null);
  node("n_below", "Unrelated", null);
  db.close();
}

function mockEmbeddingService(calls: number[]): SemanticEmbeddingService {
  return {
    async search(_query: string, k: number) {
      calls.push(k);
      return RANKED.slice(0, k).map((r) => ({ ...r, similarity: 1 - r.distance }));
    },
    async getStats() {
      return { totalEmbeddings: RANKED.length } as Awaited<ReturnType<SemanticEmbeddingService["getStats"]>>;
    },
    close() {},
  };
}

async function cliIds(
  dbPath: string,
  options: { limit?: number; minScore?: string; tag?: string },
  calls: number[]
): Promise<string[]> {
  const out: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.join(" ") + "\n");
  });
  try {
    await handleSemanticSearch(
      "llm wiki",
      { semantic: true, format: "ids", ...options },
      dbPath,
      {
        workspace: { alias: "test", dbPath },
        openEmbeddingService: () => mockEmbeddingService(calls),
      }
    );
  } finally {
    write.mockRestore();
    log.mockRestore();
  }
  return out.join("").split("\n").filter((l) => l.length > 0);
}

async function mcpIds(
  dbPath: string,
  options: { limit?: number; minSimilarity?: number; raw?: boolean; includeContents?: boolean },
  calls: number[]
): Promise<string[]> {
  const result = await semanticSearch(
    {
      query: "llm wiki",
      limit: options.limit ?? 20,
      minSimilarity: options.minSimilarity,
      raw: options.raw ?? false,
      includeContents: options.includeContents ?? false,
      depth: 0,
      includeAncestor: true,
    },
    {
      workspace: { alias: "test", dbPath },
      openEmbeddingService: () => mockEmbeddingService(calls),
    }
  );
  return result.results.map((r) => String(r.nodeId));
}

describe("semantic search parity: CLI vs MCP (#98)", () => {
  let seeded: SeededDb | undefined;

  afterEach(() => {
    seeded?.cleanup();
    seeded = undefined;
  });

  function setup(): string {
    seeded = createSeededDb("semantic-parity");
    seedNodes(seeded.dbPath);
    return seeded.dbPath;
  }

  it("returns the same ordered IDs for the same query, limit and threshold", async () => {
    const dbPath = setup();
    const cliCalls: number[] = [];
    const mcpCalls: number[] = [];

    const cli = await cliIds(dbPath, { limit: 10, minScore: "0.3" }, cliCalls);
    const mcp = await mcpIds(dbPath, { limit: 10, minSimilarity: 0.3 }, mcpCalls);

    expect(cli).toEqual(["n_wiki", "n_week_a", "n_week_b", "n_edge"]);
    expect(mcp).toEqual(cli);
    expect(mcpCalls).toEqual(cliCalls);
  });

  it("keeps parity when MCP raw mode drops tags from the output", async () => {
    const dbPath = setup();
    const cli = await cliIds(dbPath, { limit: 10, minScore: "0.3" }, []);
    const mcpRaw = await mcpIds(dbPath, { limit: 10, minSimilarity: 0.3, raw: true }, []);
    expect(mcpRaw).toEqual(cli);
  });

  it("keeps parity when MCP includes node contents", async () => {
    const dbPath = setup();
    const cli = await cliIds(dbPath, { limit: 10, minScore: "0.3" }, []);
    const mcp = await mcpIds(dbPath, { limit: 10, minSimilarity: 0.3, includeContents: true }, []);
    expect(mcp).toEqual(cli);
  });

  it("does not let a trashed node take a slot at a small limit", async () => {
    const dbPath = setup();
    const cli = await cliIds(dbPath, { limit: 2 }, []);
    const mcp = await mcpIds(dbPath, { limit: 2 }, []);
    expect(cli).toEqual(["n_wiki", "n_week_a"]);
    expect(mcp).toEqual(cli);
  });
});

describe("runSemanticSearchPipeline", () => {
  let seeded: SeededDb | undefined;

  afterEach(() => {
    seeded?.cleanup();
    seeded = undefined;
  });

  it("over-fetches 3x more when a tag filter is set and keeps only that tag", async () => {
    seeded = createSeededDb("semantic-pipeline");
    seedNodes(seeded.dbPath);
    const calls: number[] = [];
    const db = new Database(seeded.dbPath, { readonly: true });
    try {
      const results = await runSemanticSearchPipeline(mockEmbeddingService(calls), db, "llm wiki", {
        limit: 10,
        tag: "note",
      });
      expect(results.map((r) => r.nodeId)).toEqual(["n_week_a"]);
      expect(calls).toEqual([150]);
    } finally {
      db.close();
    }
  });
});

describe("deduplicateResults", () => {
  it("returns the winning duplicate's own record, never a stand-in", () => {
    const input: EnrichedSearchResult[] = [
      { nodeId: "first", name: "Other", distance: 0.1, similarity: 0.9 },
      { nodeId: "low", name: "Same", tags: ["b", "a"], distance: 0.4, similarity: 0.6 },
      { nodeId: "high", name: "same", tags: ["a", "b"], distance: 0.2, similarity: 0.8 },
    ];
    const out = deduplicateResults(input);
    expect(out.map((r) => r.nodeId)).toEqual(["first", "high"]);
    expect(out[1]).toBe(input[2]);
  });

  it("does not reorder the caller's tag arrays", () => {
    const tags = ["zeta", "alpha"];
    deduplicateResults([{ nodeId: "x", name: "X", tags, distance: 0, similarity: 1 }]);
    expect(tags).toEqual(["zeta", "alpha"]);
  });
});
