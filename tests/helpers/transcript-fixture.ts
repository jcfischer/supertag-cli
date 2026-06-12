/**
 * Deterministic in-memory fixture for the transcript data-access queries.
 *
 * Models the minimal Tana node graph that `getMeetingsWithTranscripts` and
 * `searchTranscripts` (LIKE fallback — no `nodes_fts` table is created) walk:
 *
 *   meeting (m1)
 *     └─ metanode (_ownerId=m1) ─ children:[tuple]
 *          └─ tuple ─ children:['SYS_A199', transcript]   ← SYS_A199 = transcript link
 *               └─ transcript (_docType=transcript) ─ children:[line1, line2]
 *
 *   line1 (_docType=transcriptLine, "Discussing the roadmap")
 *     └─ metanode (_ownerId=line1) ─ children:[tuple]
 *          └─ tuple ─ children:['SYS_A252', speaker]       ← SYS_A252 = speaker
 *               └─ speaker ("Alice")
 *   line2 (_docType=transcriptLine, "Action items for next week")
 *
 * Replaces the old suite's dependency on the live 854k-node workspace DB, so
 * these queries are tested deterministically and run on CI.
 */
import { Database } from "bun:sqlite";

export function buildTranscriptFixtureDb(): Database {
  const db = new Database(":memory:");
  db.run(
    `CREATE TABLE nodes (
       id TEXT PRIMARY KEY,
       name TEXT,
       created INTEGER,
       raw_data TEXT
     )`
  );

  const insert = db.prepare(
    `INSERT INTO nodes (id, name, created, raw_data) VALUES (?, ?, ?, ?)`
  );
  const node = (id: string, name: string | null, created: number, raw: unknown) =>
    insert.run(id, name, created, JSON.stringify(raw));

  // Meeting (owner is not a *_TRASH node, so it survives the WHERE filter)
  node("m1", "Weekly Sync", 2000, { props: { _ownerId: "WS_OWNER" } });
  // Metanode attaching the transcript tuple to the meeting
  node("meta_m1", null, 0, { props: { _ownerId: "m1", _docType: "metanode" }, children: ["t1"] });
  // Tuple: SYS_A199 marks a transcript link -> transcript v1
  node("t1", null, 0, { children: ["SYS_A199", "v1"] });
  // Transcript node with two lines (line_count = 2)
  node("v1", null, 0, { props: { _docType: "transcript" }, children: ["ln1", "ln2"] });

  // Transcript lines
  node("ln1", "Discussing the roadmap", 0, { props: { _docType: "transcriptLine" } });
  node("ln2", "Action items for next week", 0, { props: { _docType: "transcriptLine" } });

  // Speaker metadata for ln1: metanode -> tuple(SYS_A252 -> speaker node "Alice")
  node("meta_ln1", null, 0, { props: { _ownerId: "ln1", _docType: "metanode" }, children: ["st1"] });
  node("st1", null, 0, { children: ["SYS_A252", "spk1"] });
  node("spk1", "Alice", 0, {});

  return db;
}
