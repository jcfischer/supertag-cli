import { describe, expect, it, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/db/schema";
import { DataType } from "../../src/types";

/**
 * Tests for extracting field types from Tana's explicit typeChoice structure.
 *
 * Tana encodes field types in the export via:
 * - attrDef node has child "typeChoice" tuple
 * - typeChoice tuple has children like ["SYS_T06", "SYS_D03"]
 * - The SYS_D* code maps to the field type:
 *   - SYS_D01 = Checkbox
 *   - SYS_D03 = Date
 *   - SYS_D05 = Options from Supertag (reference)
 *   - SYS_D06 = Plain (text)
 *   - SYS_D08 = Number
 *   - SYS_D10 = URL
 *   - SYS_D11 = Email
 *   - SYS_D12 = Options (inline)
 *   - SYS_D13 = Tana User (reference)
 */
describe("extractFieldTypesFromExport", () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });

    // Create schema
    sqlite.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        doc_type TEXT,
        parent_id TEXT,
        owner_id TEXT,
        created INTEGER,
        raw_props TEXT
      );

      CREATE TABLE supertag_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_label_id TEXT NOT NULL,
        field_order INTEGER DEFAULT 0,
        normalized_name TEXT,
        description TEXT,
        inferred_data_type TEXT NOT NULL DEFAULT 'text',
        target_supertag_id TEXT,
        target_supertag_name TEXT,
        default_value_id TEXT,
        default_value_text TEXT
      );
    `);
  });

  afterAll(() => {
    sqlite.close();
  });

  beforeEach(() => {
    sqlite.exec("DELETE FROM nodes");
    sqlite.exec("DELETE FROM supertag_fields");
  });

  describe("SYS_D code mapping", () => {
    it("should map SYS_D01 to checkbox", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D01")).toBe("checkbox");
    });

    it("should map SYS_D03 to date", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D03")).toBe("date");
    });

    it("should map SYS_D05 to reference (Options from Supertag)", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D05")).toBe("reference");
    });

    it("should map SYS_D06 to text (Plain)", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D06")).toBe("text");
    });

    it("should map SYS_D08 to number", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D08")).toBe("number");
    });

    it("should map SYS_D10 to url", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D10")).toBe("url");
    });

    it("should map SYS_D11 to email", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D11")).toBe("email");
    });

    it("should map SYS_D12 to options", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D12")).toBe("options");
    });

    it("should map SYS_D13 to reference (Tana User)", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D13")).toBe("reference");
    });

    it("should return null for unknown codes", async () => {
      const { mapSysDCodeToDataType } = await import(
        "../../src/db/explicit-type-extraction"
      );
      expect(mapSysDCodeToDataType("SYS_D99")).toBeNull();
      expect(mapSysDCodeToDataType("SYS_T06")).toBeNull();
    });
  });

  describe("extractTypeFromTypeChoice", () => {
    it("should extract type from typeChoice children array", async () => {
      const { extractTypeFromTypeChoiceChildren } = await import(
        "../../src/db/explicit-type-extraction"
      );

      // Date field typeChoice children
      expect(extractTypeFromTypeChoiceChildren(["SYS_T06", "SYS_D03"])).toBe(
        "date"
      );

      // Checkbox field
      expect(extractTypeFromTypeChoiceChildren(["SYS_T06", "SYS_D01"])).toBe(
        "checkbox"
      );

      // Number field
      expect(extractTypeFromTypeChoiceChildren(["SYS_T06", "SYS_D08"])).toBe(
        "number"
      );

      // URL field
      expect(extractTypeFromTypeChoiceChildren(["SYS_T06", "SYS_D10"])).toBe(
        "url"
      );
    });

    it("should return null for children without SYS_D code", async () => {
      const { extractTypeFromTypeChoiceChildren } = await import(
        "../../src/db/explicit-type-extraction"
      );

      expect(extractTypeFromTypeChoiceChildren(["SYS_T06"])).toBeNull();
      expect(extractTypeFromTypeChoiceChildren([])).toBeNull();
      expect(extractTypeFromTypeChoiceChildren(undefined as any)).toBeNull();
    });
  });

  describe("extractFieldTypesFromDocs", () => {
    it("should extract types from field definitions in docs array", async () => {
      const { extractFieldTypesFromDocs } = await import(
        "../../src/db/explicit-type-extraction"
      );

      const docs = [
        // attrDef node (field definition)
        {
          id: "field1",
          props: { _docType: "attrDef", name: "Due date" },
          children: ["typeChoice1"],
        },
        // typeChoice tuple for the field
        {
          id: "typeChoice1",
          props: {
            _docType: "tuple",
            _sourceId: "SYS_A02",
            name: "typeChoice",
          },
          children: ["SYS_T06", "SYS_D03"],
        },
        // Another attrDef
        {
          id: "field2",
          props: { _docType: "attrDef", name: "Is active" },
          children: ["typeChoice2"],
        },
        // typeChoice for checkbox
        {
          id: "typeChoice2",
          props: {
            _docType: "tuple",
            _sourceId: "SYS_A02",
            name: "typeChoice",
          },
          children: ["SYS_T06", "SYS_D01"],
        },
      ];

      const types = extractFieldTypesFromDocs(docs);

      expect(types.get("field1")).toBe("date");
      expect(types.get("field2")).toBe("checkbox");
    });

    it("should handle fields without typeChoice", async () => {
      const { extractFieldTypesFromDocs } = await import(
        "../../src/db/explicit-type-extraction"
      );

      const docs = [
        {
          id: "field1",
          props: { _docType: "attrDef", name: "Notes" },
          children: [], // No typeChoice child
        },
      ];

      const types = extractFieldTypesFromDocs(docs);
      expect(types.get("field1")).toBeUndefined();
    });
  });

  describe("extractTargetSupertag", () => {
    it("should extract target supertag from 'Selected source supertag' tuple", async () => {
      const { extractTargetSupertag } = await import(
        "../../src/db/explicit-type-extraction"
      );

      // Simulate Tana export structure for Company field
      const docs = [
        // Field label node (Company)
        {
          id: "fieldLabel1",
          props: {
            name: "Company",
            _ownerId: "tupleNode1",
            _metaNodeId: "metaNode1",
          },
          children: ["typeChoice1", "sourceTuple1"],
        },
        // typeChoice tuple
        {
          id: "typeChoice1",
          props: {
            _docType: "tuple",
            name: "typeChoice",
            description: "Type of data stored in this attribute",
          },
          children: ["SYS_T06", "SYS_D05"], // SYS_D05 = reference
        },
        // "Selected source supertag" tuple
        {
          id: "sourceTuple1",
          props: {
            _docType: "tuple",
            description: "Selected source supertag",
          },
          children: ["SYS_A05", "companyTagDef"],
        },
        // Target supertag tagDef
        {
          id: "companyTagDef",
          props: {
            _docType: "tagDef",
            name: "company",
          },
          children: [],
        },
      ];

      const result = extractTargetSupertag(docs, "fieldLabel1");

      expect(result).toEqual({
        tagDefId: "companyTagDef",
        tagName: "company",
      });
    });

    it("should return null for non-reference fields", async () => {
      const { extractTargetSupertag } = await import(
        "../../src/db/explicit-type-extraction"
      );

      const docs = [
        {
          id: "fieldLabel1",
          props: {
            name: "DueDate",
          },
          children: ["typeChoice1"],
        },
        // typeChoice for date field (no target supertag)
        {
          id: "typeChoice1",
          props: {
            _docType: "tuple",
            name: "typeChoice",
          },
          children: ["SYS_T06", "SYS_D03"], // SYS_D03 = date
        },
      ];

      const result = extractTargetSupertag(docs, "fieldLabel1");
      expect(result).toBeNull();
    });

    it("should return null when target supertag tuple not found", async () => {
      const { extractTargetSupertag } = await import(
        "../../src/db/explicit-type-extraction"
      );

      const docs = [
        {
          id: "fieldLabel1",
          props: {
            name: "Company",
          },
          children: ["typeChoice1"], // Missing source tuple
        },
        {
          id: "typeChoice1",
          props: {
            _docType: "tuple",
            name: "typeChoice",
          },
          children: ["SYS_T06", "SYS_D05"],
        },
      ];

      const result = extractTargetSupertag(docs, "fieldLabel1");
      expect(result).toBeNull();
    });

    it("should return null when tagDef not found", async () => {
      const { extractTargetSupertag } = await import(
        "../../src/db/explicit-type-extraction"
      );

      const docs = [
        {
          id: "fieldLabel1",
          props: { name: "Company" },
          children: ["typeChoice1", "sourceTuple1"],
        },
        {
          id: "typeChoice1",
          props: {
            _docType: "tuple",
            name: "typeChoice",
          },
          children: ["SYS_T06", "SYS_D05"],
        },
        {
          id: "sourceTuple1",
          props: {
            _docType: "tuple",
            description: "Selected source supertag",
          },
          children: ["SYS_A05", "missingTagDef"], // tagDef doesn't exist
        },
      ];

      const result = extractTargetSupertag(docs, "fieldLabel1");
      expect(result).toBeNull();
    });
  });
});
