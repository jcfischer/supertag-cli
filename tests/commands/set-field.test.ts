/**
 * supertag set-field (Issue #110)
 *
 * Field names resolve to attribute IDs through the index, a value combined
 * with --option-id is rejected, and an option write that lands on a different
 * option than requested exits non-zero.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSeededDb, type SeededDb } from "../helpers/seeded-db";
import { createSetFieldCommand, runSetField } from "../../src/commands/set-field";

type Call = { kind: "content" | "option"; nodeId: string; attributeId: string; value: string };

function fakeBackend(calls: Call[], appliedOptionId?: string) {
  return {
    supportsMutations: () => true,
    setFieldContent: async (nodeId: string, attributeId: string, content: string) => {
      calls.push({ kind: "content" as const, nodeId, attributeId, value: content });
      return { nodeId, attributeId, content, message: "ok" };
    },
    setFieldOption: async (nodeId: string, attributeId: string, optionId: string) => {
      calls.push({ kind: "option" as const, nodeId, attributeId, value: optionId });
      const applied = appliedOptionId ?? optionId;
      return { nodeId, attributeId, optionId: applied, optionName: `name of ${applied}`, message: "ok" };
    },
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

describe("supertag set-field (#110)", () => {
  let seeded: SeededDb;

  beforeEach(() => {
    seeded = createSeededDb("set-field");
    const db = new Database(seeded.dbPath);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name)
      VALUES ('tag_todo', 'todo', 'Status', 'attr_todo_status', 0, 'status'),
             ('tag_meeting', 'meeting', 'Status', 'attr_meeting_status', 0, 'status'),
             ('tag_meeting', 'meeting', 'Agenda', 'attr_agenda', 1, 'agenda')
    `);
    db.run(`INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_id, tag_name) VALUES ('t1', 'node1', 'tag_todo', 'todo')`);
    db.close();
  });

  afterEach(() => {
    seeded.cleanup();
  });

  async function run(nodeId: string, fieldName: string, value: string | undefined, options: Record<string, string | boolean>, backend: ReturnType<typeof fakeBackend>) {
    const io = captureConsole();
    try {
      const code = await runSetField(nodeId, fieldName, value, options, { backend, dbPath: seeded.dbPath });
      return { code, out: io.out.join("\n"), err: io.err.join("\n") };
    } finally {
      io.restore();
    }
  }

  it("resolves a field name through the node's supertags", async () => {
    const calls: Call[] = [];
    const { code } = await run("node1", "Status", "done", {}, fakeBackend(calls));

    expect(code).toBe(0);
    expect(calls).toEqual([{ kind: "content", nodeId: "node1", attributeId: "attr_todo_status", value: "done" }]);
  });

  it("resolves a field name that only one supertag defines when the node is not indexed", async () => {
    const calls: Call[] = [];
    const { code } = await run("fresh-node", "agenda", "intro", {}, fakeBackend(calls));

    expect(code).toBe(0);
    expect(calls[0].attributeId).toBe("attr_agenda");
  });

  it("does not borrow another supertag's field for an indexed node", async () => {
    const calls: Call[] = [];
    await run("node1", "Agenda", "intro", {}, fakeBackend(calls));

    expect(calls[0].attributeId).toBe("Agenda");
  });

  it("rejects an ambiguous field name instead of guessing", async () => {
    const calls: Call[] = [];
    const { code, err } = await run("fresh-node", "Status", "done", {}, fakeBackend(calls));

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toContain("--field-id");
    expect(err).toContain("attr_todo_status");
    expect(err).toContain("attr_meeting_status");
  });

  it("adds a --field-id hint when an unknown field name fails at the API", async () => {
    const backend = {
      ...fakeBackend([]),
      setFieldContent: async () => {
        throw new Error("Resource not found: /nodes/node1/fields/Confidence/content");
      },
    };
    const io = captureConsole();
    try {
      await expect(
        runSetField("node1", "Confidence", "4", {}, { backend, dbPath: seeded.dbPath })
      ).rejects.toThrow("Resource not found");
    } finally {
      io.restore();
    }
    expect(io.err.join("\n")).toContain("--field-id");
  });

  it("uses --field-id as given", async () => {
    const calls: Call[] = [];
    await run("node1", "Status", "done", { fieldId: "attr_explicit" }, fakeBackend(calls));

    expect(calls[0].attributeId).toBe("attr_explicit");
  });

  it("rejects a positional value combined with --option-id", async () => {
    const calls: Call[] = [];
    const { code, err } = await run("node1", "Status", "Completed", { optionId: "opt_done" }, fakeBackend(calls));

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toContain("--option-id");
  });

  it("exits 1 when the API applies a different option than requested", async () => {
    const { code, err } = await run("node1", "Status", undefined, { optionId: "opt_done" }, fakeBackend([], "opt_dropped"));

    expect(code).toBe(1);
    expect(err).toContain("opt_dropped");
  });

  it("exits 0 when the requested option is applied", async () => {
    const calls: Call[] = [];
    const { code } = await run("node1", "Status", undefined, { optionId: "opt_done" }, fakeBackend(calls));

    expect(code).toBe(0);
    expect(calls).toEqual([{ kind: "option", nodeId: "node1", attributeId: "attr_todo_status", value: "opt_done" }]);
  });

  it("accepts a dash-leading option ID in both --option-id spellings", async () => {
    for (const argv of [
      ["--field-id", "attr_x", "--option-id", "-MG-UldK1Pn2", "--", "node1", "Status"],
      ["--field-id", "attr_x", "--option-id=-MG-UldK1Pn2", "--", "node1", "Status"],
    ]) {
      const calls: Call[] = [];
      const io = captureConsole();
      try {
        await createSetFieldCommand({ backend: fakeBackend(calls), dbPath: seeded.dbPath })
          .parseAsync(argv, { from: "user" });
      } finally {
        io.restore();
      }
      expect(calls).toEqual([{ kind: "option", nodeId: "node1", attributeId: "attr_x", value: "-MG-UldK1Pn2" }]);
    }
  });
});
