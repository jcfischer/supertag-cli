/**
 * Supertags that share a name (issue #123, refs #109)
 *
 * Indexes a synthetic export with the PRODUCTION indexer. Two tagDefs are named
 * "book": tag_book extends "source" and has 5 applications, tag_book_dup is
 * empty and comes later in the export. Two tagDefs are named "note" with no
 * parents and no fields: tag_note_a is empty, tag_note_b has 3 applications.
 *
 * Every tagDef must land in the supertags registry, and every name resolver
 * must pick the same tag: most parents, then most fields, then most
 * applications, then lowest tag ID.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TanaIndexer } from "../../src/db/indexer";
import { SupertagMetadataService } from "../../src/services/supertag-metadata-service";
import { UnifiedSchemaService } from "../../src/services/unified-schema-service";
import { resolveTagIds } from "../../src/services/tag-id-resolver";
import { VisualizationService } from "../../src/visualization/service";

type Doc = { id: string; props: Record<string, unknown>; children?: string[] };

const T0 = 1_700_000_000_000;

async function indexDuplicateTagExport(dir: string): Promise<string> {
  const docs: Doc[] = [];
  const add = (d: Doc) => docs.push(d);

  // tagDef ← metanode ← tuple [SYS_A13, SYS_T01, ...parents]
  const tag = (id: string, name: string, parentId?: string) => {
    add({ id, props: { name, created: T0, _docType: "tagDef", _metaNodeId: `${id}_meta` }, children: [] });
    add({ id: `${id}_meta`, props: { created: T0, _ownerId: id, _docType: "metanode" }, children: [`${id}_def`] });
    add({
      id: `${id}_def`,
      props: { created: T0, _ownerId: `${id}_meta`, _docType: "tuple" },
      children: parentId ? ["SYS_A13", "SYS_T01", parentId] : ["SYS_A13", "SYS_T01"],
    });
  };

  // data node ← metanode ← tuple [SYS_A13, tagDef]
  const node = (id: string, name: string, tagId: string) => {
    add({ id, props: { name, created: T0, _ownerId: "ws_STASH" }, children: [] });
    add({ id: `${id}_meta`, props: { created: T0, _ownerId: id, _docType: "metanode" }, children: [`${id}_tt`] });
    add({ id: `${id}_tt`, props: { created: T0, _ownerId: `${id}_meta`, _docType: "tuple" }, children: ["SYS_A13", tagId] });
  };

  add({ id: "ws_STASH", props: { name: "Library", created: T0 }, children: [] });
  tag("tag_source", "source");
  tag("tag_note_a", "note");
  tag("tag_book", "book", "tag_source");
  tag("tag_note_b", "note");
  tag("tag_book_dup", "book");

  for (let i = 0; i < 5; i++) node(`book${i}`, `Book ${i}`, "tag_book");
  for (let i = 0; i < 3; i++) node(`note${i}`, `Note ${i}`, "tag_note_b");

  const exportPath = join(dir, "export.json");
  const dbPath = join(dir, "tana-index.db");
  writeFileSync(exportPath, JSON.stringify({ formatVersion: 1, docs, editors: [], workspaces: { main: "ws" } }));

  const indexer = new TanaIndexer(dbPath);
  try {
    await indexer.initializeSchema();
    await indexer.indexExport(exportPath);
  } finally {
    indexer.close();
  }
  return dbPath;
}

describe("supertags with duplicate names", () => {
  let dir: string;
  let dbPath: string;
  let db: Database;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "supertag-dup-tags-"));
    dbPath = await indexDuplicateTagExport(dir);
    db = new Database(dbPath, { readonly: true });
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers every same-named tagDef in supertags", () => {
    const rows = db.query("SELECT tag_id FROM supertags ORDER BY tag_id").all() as Array<{ tag_id: string }>;
    expect(rows.map(r => r.tag_id)).toEqual(["tag_book", "tag_book_dup", "tag_note_a", "tag_note_b", "tag_source"]);
  });

  it("keeps the applications under the populated tag", () => {
    const rows = db
      .query("SELECT tag_id, COUNT(*) AS c FROM tag_applications GROUP BY tag_id ORDER BY tag_id")
      .all() as Array<{ tag_id: string; c: number }>;
    expect(rows).toEqual([
      { tag_id: "tag_book", c: 5 },
      { tag_id: "tag_note_b", c: 3 },
    ]);
  });

  it("UnifiedSchemaService.getSupertag picks the populated tag", () => {
    const schema = new UnifiedSchemaService(db);
    expect(schema.getSupertag("book")?.id).toBe("tag_book");
    expect(schema.getSupertag("note")?.id).toBe("tag_note_b");
  });

  it("SupertagMetadataService.findTagIdByName picks the populated tag", () => {
    const service = new SupertagMetadataService(db);
    expect(service.findTagIdByName("book")).toBe("tag_book");
    expect(service.findTagIdByName("note")).toBe("tag_note_b");
  });

  it("SupertagMetadataService.findAllTagsByName lists every candidate, the populated one first", () => {
    const service = new SupertagMetadataService(db);
    expect(service.findAllTagsByName("book").map(t => t.tagId)).toEqual(["tag_book", "tag_book_dup"]);
    expect(service.findAllTagsByName("note").map(t => [t.tagId, t.usageCount])).toEqual([
      ["tag_note_b", 3],
      ["tag_note_a", 0],
    ]);
  });

  it("tags visualize --from walks the populated tag's inheritance", () => {
    const ancestors = new VisualizationService(db).getAncestors("book");
    expect(ancestors?.nodes.map(n => n.id).sort()).toEqual(["tag_book", "tag_source"]);
  });

  it("tag add/remove name resolution picks the populated tag", () => {
    expect(resolveTagIds(["book", "note"], dbPath)).toEqual(["tag_book", "tag_note_b"]);
  });
});
