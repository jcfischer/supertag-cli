/**
 * Indexer Supertag Metadata Integration Tests
 *
 * TDD tests verifying that TanaIndexer extracts and stores supertag metadata
 * (field definitions and inheritance) during indexing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { TanaIndexer } from "../../src/db/indexer";

describe("TanaIndexer Supertag Metadata Integration", () => {
  const testDir = join(process.cwd(), "tmp-test-indexer-metadata");
  const dbPath = join(testDir, "test.db");
  const exportPath = join(testDir, "export.json");
  let indexer: TanaIndexer;

  beforeAll(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Remove previous database
    if (existsSync(dbPath)) {
      rmSync(dbPath);
    }
  });

  it("should create supertag_fields table during schema initialization", async () => {
    indexer = new TanaIndexer(dbPath);
    await indexer.initializeSchema();

    const db = new Database(dbPath);
    const result = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='supertag_fields'"
    ).get();

    expect(result).not.toBeNull();
    db.close();
    indexer.close();
  });

  it("should create supertag_parents table during schema initialization", async () => {
    indexer = new TanaIndexer(dbPath);
    await indexer.initializeSchema();

    const db = new Database(dbPath);
    const result = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='supertag_parents'"
    ).get();

    expect(result).not.toBeNull();
    db.close();
    indexer.close();
  });

  it("should extract supertag fields during indexing", async () => {
    // Create a minimal Tana export with a tagDef that has fields
    const tanaExport = {
      formatVersion: 1,
      editors: [] as Array<[string, number]>,
      summary: {
        leafCount: 5,
        calendarNodeCount: 0,
        tagCount: 1,
        fieldCount: 2,
      },
      docs: [
        // tagDef with 2 fields
        {
          id: "tagdef1",
          props: { name: "contact", _docType: "tagDef", created: 1000 },
          children: ["field-tuple1", "field-tuple2"],
        },
        {
          id: "field-tuple1",
          props: { _docType: "tuple", created: 1001 },
          children: ["label1", "val1"],
        },
        { id: "label1", props: { name: "Email", created: 1002 } },
        { id: "val1", props: { name: "", created: 1003 } },
        {
          id: "field-tuple2",
          props: { _docType: "tuple", created: 1004 },
          children: ["label2", "val2"],
        },
        { id: "label2", props: { name: "Phone", created: 1005 } },
        { id: "val2", props: { name: "", created: 1006 } },
      ],
      workspaces: { workspace1: "tagdef1" },
    };

    writeFileSync(exportPath, JSON.stringify(tanaExport));

    indexer = new TanaIndexer(dbPath);
    await indexer.initializeSchema();
    const result = await indexer.indexExport(exportPath);

    // Should have extracted fields
    expect(result.supertagFieldsExtracted).toBeDefined();
    expect(result.supertagFieldsExtracted).toBe(2);

    // Verify in database
    const db = new Database(dbPath);
    const fields = db.query("SELECT * FROM supertag_fields ORDER BY field_order").all() as Array<{
      tag_name: string;
      field_name: string;
    }>;

    expect(fields.length).toBe(2);
    expect(fields[0].tag_name).toBe("contact");
    expect(fields[0].field_name).toBe("Email");
    expect(fields[1].field_name).toBe("Phone");

    db.close();
    indexer.close();
  });

  it("should extract supertag inheritance during indexing", async () => {
    // Create export with inheritance: employee -> contact
    const tanaExport = {
      formatVersion: 1,
      editors: [] as Array<[string, number]>,
      summary: {
        leafCount: 10,
        calendarNodeCount: 0,
        tagCount: 2,
        fieldCount: 0,
      },
      docs: [
        // Parent tagDef
        {
          id: "contact-tagdef",
          props: { name: "contact", _docType: "tagDef", created: 1000 },
        },
        // Child tagDef with inheritance
        {
          id: "employee-tagdef",
          props: {
            name: "employee",
            _docType: "tagDef",
            _metaNodeId: "employee-meta",
            created: 2000,
          },
        },
        // metaNode with inheritance tuple
        {
          id: "employee-meta",
          props: { _docType: "metaNode", created: 2001 },
          children: ["extends-tuple"],
        },
        {
          id: "extends-tuple",
          props: { _docType: "tuple", created: 2002 },
          children: ["sys-a13", "contact-tagdef"],
        },
        {
          id: "sys-a13",
          props: { name: "SYS_A13", created: 2003 },
        },
      ],
      workspaces: { workspace1: "contact-tagdef" },
    };

    writeFileSync(exportPath, JSON.stringify(tanaExport));

    indexer = new TanaIndexer(dbPath);
    await indexer.initializeSchema();
    const result = await indexer.indexExport(exportPath);

    // Should have extracted parent relationship
    expect(result.supertagParentsExtracted).toBeDefined();
    expect(result.supertagParentsExtracted).toBe(1);

    // Verify in database
    const db = new Database(dbPath);
    const parents = db.query("SELECT * FROM supertag_parents").all() as Array<{
      child_tag_id: string;
      parent_tag_id: string;
    }>;

    expect(parents.length).toBe(1);
    expect(parents[0].child_tag_id).toBe("employee-tagdef");
    expect(parents[0].parent_tag_id).toBe("contact-tagdef");

    db.close();
    indexer.close();
  });

  it("should include extraction stats in IndexResult", async () => {
    const tanaExport = {
      formatVersion: 1,
      editors: [] as Array<[string, number]>,
      summary: { leafCount: 1, calendarNodeCount: 0, tagCount: 1, fieldCount: 1 },
      docs: [
        {
          id: "tagdef1",
          props: { name: "test", _docType: "tagDef", created: 1000 },
          children: ["tuple1"],
        },
        {
          id: "tuple1",
          props: { _docType: "tuple", created: 1001 },
          children: ["label1", "val1"],
        },
        { id: "label1", props: { name: "Field1", created: 1 } },
        { id: "val1", props: { name: "", created: 1 } },
      ],
      workspaces: { workspace1: "tagdef1" },
    };

    writeFileSync(exportPath, JSON.stringify(tanaExport));

    indexer = new TanaIndexer(dbPath);
    await indexer.initializeSchema();
    const result = await indexer.indexExport(exportPath);

    // Check IndexResult has new fields
    expect(typeof result.supertagFieldsExtracted).toBe("number");
    expect(typeof result.supertagParentsExtracted).toBe("number");

    indexer.close();
  });
});
