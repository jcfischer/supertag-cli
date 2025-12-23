/**
 * Tests for Field Values Type Definitions
 * Task T-1.1: Create field value type definitions
 */

import { describe, it, expect } from "bun:test";
import type {
  StoredFieldValue,
  FieldValueResult,
  FieldCondition,
  ExtractedFieldValue,
  FieldQueryOptions,
  CompoundQueryOptions,
} from "../../src/types/field-values";
import {
  StoredFieldValueSchema,
  FieldConditionSchema,
  FieldQueryOptionsSchema,
} from "../../src/types/field-values";

describe("Field Value Types", () => {
  describe("StoredFieldValue", () => {
    it("should validate a complete stored field value", () => {
      const value: StoredFieldValue = {
        id: 1,
        tupleId: "tuple123",
        parentId: "parent456",
        fieldDefId: "zg7pciALsr",
        fieldName: "Gestern war gut weil",
        valueNodeId: "value789",
        valueText: "Schön geprobt",
        valueOrder: 0,
        created: 1702900800000,
      };

      expect(value.id).toBe(1);
      expect(value.fieldName).toBe("Gestern war gut weil");
      expect(value.valueText).toBe("Schön geprobt");
    });

    it("should allow null created timestamp", () => {
      const value: StoredFieldValue = {
        id: 2,
        tupleId: "tuple123",
        parentId: "parent456",
        fieldDefId: "def789",
        fieldName: "Notes",
        valueNodeId: "value123",
        valueText: "Some note",
        valueOrder: 0,
        created: null,
      };

      expect(value.created).toBeNull();
    });

    it("should validate using Zod schema", () => {
      const valid = {
        id: 1,
        tupleId: "t1",
        parentId: "p1",
        fieldDefId: "f1",
        fieldName: "Field",
        valueNodeId: "v1",
        valueText: "Value",
        valueOrder: 0,
        created: null,
      };

      const result = StoredFieldValueSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject invalid stored field value", () => {
      const invalid = {
        id: 1,
        // missing required fields
      };

      const result = StoredFieldValueSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("FieldValueResult", () => {
    it("should include parent context", () => {
      const result: FieldValueResult = {
        parentId: "day123",
        parentName: "2025-12-18",
        parentTags: ["day"],
        fieldName: "Gestern war gut weil",
        valueText: "Theater probe",
        valueOrder: 0,
        created: 1702900800000,
      };

      expect(result.parentName).toBe("2025-12-18");
      expect(result.parentTags).toContain("day");
    });
  });

  describe("FieldCondition", () => {
    it("should support eq operator", () => {
      const condition: FieldCondition = {
        field: "Status",
        op: "eq",
        value: "Active",
      };

      expect(condition.op).toBe("eq");
    });

    it("should support contains operator", () => {
      const condition: FieldCondition = {
        field: "Notes",
        op: "contains",
        value: "urgent",
      };

      expect(condition.op).toBe("contains");
    });

    it("should support lt and gt operators", () => {
      const ltCondition: FieldCondition = {
        field: "Priority",
        op: "lt",
        value: "5",
      };
      const gtCondition: FieldCondition = {
        field: "Priority",
        op: "gt",
        value: "1",
      };

      expect(ltCondition.op).toBe("lt");
      expect(gtCondition.op).toBe("gt");
    });

    it("should validate using Zod schema", () => {
      const valid = {
        field: "Status",
        op: "eq",
        value: "Done",
      };

      const result = FieldConditionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject invalid operator", () => {
      const invalid = {
        field: "Status",
        op: "invalid_op",
        value: "Done",
      };

      const result = FieldConditionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("ExtractedFieldValue", () => {
    it("should represent value extracted from tuple", () => {
      const extracted: ExtractedFieldValue = {
        tupleId: "tuple123",
        parentId: "parent456",
        fieldDefId: "zg7pciALsr",
        fieldName: "Gestern war gut weil",
        valueNodeId: "value789",
        valueText: "Schön geprobt",
        valueOrder: 0,
      };

      expect(extracted.tupleId).toBe("tuple123");
      expect(extracted.fieldDefId).toBe("zg7pciALsr");
    });
  });

  describe("FieldQueryOptions", () => {
    it("should support date filtering", () => {
      const options: FieldQueryOptions = {
        limit: 100,
        offset: 0,
        createdAfter: "2025-01-01",
        createdBefore: "2025-12-31",
        parentTag: "day",
        orderBy: "created",
        orderDir: "desc",
      };

      expect(options.createdAfter).toBe("2025-01-01");
      expect(options.parentTag).toBe("day");
    });

    it("should validate using Zod schema", () => {
      const valid = {
        limit: 50,
        orderBy: "created",
        orderDir: "asc",
      };

      const result = FieldQueryOptionsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe("CompoundQueryOptions", () => {
    it("should support includeFields flag", () => {
      const options: CompoundQueryOptions = {
        limit: 20,
        offset: 0,
        includeFields: true,
        orderBy: "created",
        orderDir: "desc",
      };

      expect(options.includeFields).toBe(true);
    });
  });
});
