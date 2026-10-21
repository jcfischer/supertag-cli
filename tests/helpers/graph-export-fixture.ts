/**
 * Graph fixture built by the PRODUCTION indexer (issues #99, #100).
 *
 * Writes a small synthetic Tana export and runs `TanaIndexer.indexExport` on it,
 * so `nodes`, `references`, `tag_applications`, `supertags` and `field_values`
 * hold exactly what a real sync would write — no hand-rolled schema or rows.
 *
 * Graph:
 *   log1 "Daily log" #log (oldest)
 *     └─ c1 "Talked to [Alice] about plans"        (inline ref on a child)
 *     └─ c2 "Notes"
 *          └─ c3 "Follow up with [Bob] later"     (inline ref on a grandchild)
 *   log2 "Quiet log" #log
 *     └─ reference child → project1 #project       (tagged: not log2's content)
 *   fillerLog0..N #log, newer than log1, no refs   (pushes log1 past LIMIT)
 *   project1 "Project Alpha" #project (in library)
 *     └─ p1 "Ask [Bob] about budget"
 *   meeting1 "Standup" #meeting
 *     Attendees:: Carol      Owner:: Alice
 *   alice, bob, carol #person
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TanaIndexer } from "../../src/db/indexer";

export interface GraphExportFixture {
  dbPath: string;
  cleanup: () => void;
}

type Doc = {
  id: string;
  props: Record<string, unknown>;
  children?: string[];
};

const T0 = 1_700_000_000_000;

function ref(id: string): string {
  return `<span data-inlineref-node="${id}"></span>`;
}

export async function createGraphExportFixture(
  options: { fillerLogs?: number } = {}
): Promise<GraphExportFixture> {
  const fillerLogs = options.fillerLogs ?? 120;
  const docs: Doc[] = [];
  const add = (d: Doc) => docs.push(d);

  // Supertag definitions: tagDef ← metanode ← tuple [SYS_A13, SYS_T01]
  for (const tag of ["log", "person", "meeting", "project"]) {
    add({ id: `tag_${tag}`, props: { name: tag, created: T0, _docType: "tagDef" }, children: [] });
    add({ id: `tag_${tag}_meta`, props: { created: T0, _ownerId: `tag_${tag}` }, children: [`tag_${tag}_def`] });
    add({ id: `tag_${tag}_def`, props: { created: T0, _ownerId: `tag_${tag}_meta`, _docType: "tuple" }, children: ["SYS_A13", "SYS_T01"] });
  }

  // Field definitions
  add({ id: "fd_attendees", props: { name: "Attendees", created: T0, _docType: "attrDef" }, children: [] });
  add({ id: "fd_owner", props: { name: "Owner", created: T0, _docType: "attrDef" }, children: [] });

  // Tag application: data node ← metanode ← tuple [SYS_A13, tagDef]
  const node = (id: string, name: string, tag: string | null, created: number, children: string[] = [], ownerId?: string) => {
    add({ id, props: { name, created, ...(ownerId ? { _ownerId: ownerId } : {}) }, children });
    if (tag) {
      add({ id: `${id}_meta`, props: { created, _ownerId: id }, children: [`${id}_tagtuple`] });
      add({ id: `${id}_tagtuple`, props: { created, _ownerId: `${id}_meta`, _docType: "tuple" }, children: ["SYS_A13", `tag_${tag}`] });
    }
  };

  node("alice", "Alice", "person", T0);
  node("bob", "Bob", "person", T0);
  node("carol", "Carol", "person", T0);

  node("project1", "Project Alpha", "project", T0, ["p1"]);
  node("p1", `Ask ${ref("bob")} about budget`, null, T0, [], "project1");

  node("log1", "Daily log", "log", T0 + 1, ["c1", "c2"]);
  node("c1", `Talked to ${ref("alice")} about plans`, null, T0 + 1, [], "log1");
  node("c2", "Notes", null, T0 + 1, ["c3"], "log1");
  node("c3", `Follow up with ${ref("bob")} later`, null, T0 + 1, [], "c2");

  node("log2", "Quiet log", "log", T0 + 2, ["project1"]);

  for (let i = 0; i < fillerLogs; i++) {
    node(`fillerLog${i}`, `Filler log ${i}`, "log", T0 + 1000 + i);
  }

  node("meeting1", "Standup", "meeting", T0 + 3, ["m1_attendees", "m1_owner"]);
  add({ id: "m1_attendees", props: { created: T0 + 3, _ownerId: "meeting1", _docType: "tuple", _sourceId: "fd_attendees" }, children: ["fd_attendees", "carol"] });
  add({ id: "m1_owner", props: { created: T0 + 3, _ownerId: "meeting1", _docType: "tuple", _sourceId: "fd_owner" }, children: ["fd_owner", "alice"] });

  const dir = mkdtempSync(join(tmpdir(), "supertag-graph-edges-"));
  const exportPath = join(dir, "export.json");
  const dbPath = join(dir, "tana-index.db");
  writeFileSync(
    exportPath,
    JSON.stringify({ formatVersion: 1, docs, editors: [], workspaces: { main: "ws1" } })
  );

  const indexer = new TanaIndexer(dbPath);
  try {
    await indexer.initializeSchema();
    await indexer.indexExport(exportPath);
  } finally {
    indexer.close();
  }

  return { dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
