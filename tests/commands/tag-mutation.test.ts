/**
 * supertag tag add/remove + MCP tana_tag_add/remove (Issue #111)
 *
 * Tag names resolve to IDs through the workspace index, and a failed tag
 * operation is reported as a failure (exit 1 / isError), never as success.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSeededDb, type SeededDb } from "../helpers/seeded-db";
import { runTagChange } from "../../src/commands/tag";
import { handleTagAdd, handleTagRemove } from "../../src/mcp/tools/tag-operations";
import type { TagOperationResponse } from "../../src/types/local-api";

type Call = { action: "add" | "remove"; nodeId: string; tagIds: string[] };

function fakeBackend(succeed: boolean, calls: Call[]) {
  const respond = (action: "add" | "remove") => async (nodeId: string, tagIds: string[]): Promise<TagOperationResponse> => {
    calls.push({ action, nodeId, tagIds });
    return {
      nodeId,
      nodeName: "My Node",
      action,
      results: tagIds.map((tagId) => ({
        tagId,
        tagName: succeed ? "todo" : "",
        success: succeed,
        message: succeed ? `${action === "add" ? "Added" : "Removed"} tag "todo"` : `Tag not found: ${tagId}`,
      })),
    };
  };
  return {
    supportsMutations: () => true,
    addTags: respond("add"),
    removeTags: respond("remove"),
  };
}

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => out.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => err.push(args.map(String).join(" "));
  return {
    out,
    err,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

describe("supertag tag add/remove (#111)", () => {
  let seeded: SeededDb;

  beforeEach(() => {
    seeded = createSeededDb("tag-mutation");
  });

  afterEach(() => {
    seeded.cleanup();
  });

  it("resolves a tag name to its ID before calling the API", async () => {
    const calls: Call[] = [];
    const io = captureConsole();
    let code: number;
    try {
      code = await runTagChange("add", "node1", "todo", {}, { backend: fakeBackend(true, calls), dbPath: seeded.dbPath });
    } finally {
      io.restore();
    }

    expect(calls).toEqual([{ action: "add", nodeId: "node1", tagIds: ["tag_todo"] }]);
    expect(code).toBe(0);
    expect(io.out[0]).toBe("Added tag to My Node (node1):");
  });

  it("passes the argument through unchanged with --tag-id", async () => {
    const calls: Call[] = [];
    const io = captureConsole();
    try {
      await runTagChange("add", "node1", "todo", { tagId: true }, { backend: fakeBackend(true, calls), dbPath: seeded.dbPath });
    } finally {
      io.restore();
    }

    expect(calls[0].tagIds).toEqual(["todo"]);
  });

  it("exits 1 and prints no success header when the tag is not applied", async () => {
    const io = captureConsole();
    let code: number;
    try {
      code = await runTagChange("add", "node1", "decision", {}, { backend: fakeBackend(false, []), dbPath: seeded.dbPath });
    } finally {
      io.restore();
    }

    expect(code).toBe(1);
    expect(io.out.join("\n")).not.toContain("Added tag to");
    expect(io.err.join("\n")).toContain("Tag not found: decision");
  });

  it("exits 1 when a remove fails", async () => {
    const io = captureConsole();
    let code: number;
    try {
      code = await runTagChange("remove", "node1", "decision", {}, { backend: fakeBackend(false, []), dbPath: seeded.dbPath });
    } finally {
      io.restore();
    }

    expect(code).toBe(1);
    expect(io.out.join("\n")).not.toContain("Removed tag from");
  });
});

describe("MCP tana_tag_add/remove (#111)", () => {
  let seeded: SeededDb;

  beforeEach(() => {
    seeded = createSeededDb("tag-mutation-mcp");
  });

  afterEach(() => {
    seeded.cleanup();
  });

  it("resolves tag names and reports success without isError", async () => {
    const calls: Call[] = [];
    const result = await handleTagAdd(
      { nodeId: "node1", tagIds: ["meeting"] },
      { backend: fakeBackend(true, calls), dbPath: seeded.dbPath }
    );

    expect(calls[0].tagIds).toEqual(["tag_meeting"]);
    expect(result.isError).toBeFalsy();
  });

  it("sets isError when a tag operation fails", async () => {
    const added = await handleTagAdd(
      { nodeId: "node1", tagIds: ["decision"] },
      { backend: fakeBackend(false, []), dbPath: seeded.dbPath }
    );
    const removed = await handleTagRemove(
      { nodeId: "node1", tagIds: ["decision"] },
      { backend: fakeBackend(false, []), dbPath: seeded.dbPath }
    );

    expect(added.isError).toBe(true);
    expect(added.content[0].text).not.toContain("Added tags to");
    expect(removed.isError).toBe(true);
  });
});
