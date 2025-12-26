/**
 * tana_field_values MCP Tool Tests
 * Tasks T-5.1 to T-5.6: MCP tool for field value queries
 */

import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";
import { fieldValues } from "../field-values";
import { getDatabasePath } from "../../../config/paths";

// Check if we have a database to test against
const dbPath = getDatabasePath();
const hasDatabase = existsSync(dbPath);

describe("tana_field_values MCP Tool", () => {
  // Skip integration tests if no database exists
  const testFn = hasDatabase ? it : it.skip;

  describe("Unit Tests", () => {
    it("should export fieldValues function", () => {
      expect(typeof fieldValues).toBe("function");
    });
  });

  describe("list mode (T-5.1)", () => {
    testFn("should list available field names with counts", async () => {
      const result = await fieldValues({ mode: "list" });

      expect(result.mode).toBe("list");
      expect(result.fields).toBeDefined();
      expect(Array.isArray(result.fields)).toBe(true);
      expect(result.workspace).toBeDefined();
    });
  });

  describe("query mode (T-5.2)", () => {
    testFn("should require fieldName for query mode", async () => {
      await expect(fieldValues({ mode: "query" })).rejects.toThrow(
        "fieldName is required for query mode"
      );
    });

    testFn("should query values for a specific field", async () => {
      // First get available fields
      const listResult = await fieldValues({ mode: "list" });

      if (listResult.fields && listResult.fields.length > 0) {
        const fieldName = listResult.fields[0].fieldName;
        const result = await fieldValues({
          mode: "query",
          fieldName,
        });

        expect(result.mode).toBe("query");
        expect(result.results).toBeDefined();
        expect(Array.isArray(result.results)).toBe(true);
      }
    });

    testFn("should support limit parameter", async () => {
      const listResult = await fieldValues({ mode: "list" });

      if (listResult.fields && listResult.fields.length > 0) {
        const fieldName = listResult.fields[0].fieldName;
        const result = await fieldValues({
          mode: "query",
          fieldName,
          limit: 1,
        });

        expect(result.results!.length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("search mode (T-5.3)", () => {
    testFn("should require query for search mode", async () => {
      await expect(fieldValues({ mode: "search" })).rejects.toThrow(
        "query is required for search mode"
      );
    });

    testFn("should search across field values with FTS", async () => {
      // Search for a common word
      const result = await fieldValues({
        mode: "search",
        query: "gut OR good OR test",
        limit: 5,
      });

      expect(result.mode).toBe("search");
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });

    testFn(
      "should support field name filter in search",
      async () => {
        const listResult = await fieldValues({ mode: "list" });

        if (listResult.fields && listResult.fields.length > 0) {
          const fieldName = listResult.fields[0].fieldName;
          const result = await fieldValues({
            mode: "search",
            query: "a OR e OR i OR o OR u", // Common vowels to match most content
            fieldName,
          });

          expect(result.results).toBeDefined();
        }
      },
      120000
    );
  });

  describe("error handling (T-5.4)", () => {
    testFn("should throw for unknown mode", async () => {
      await expect(
        fieldValues({ mode: "invalid" as "list" })
      ).rejects.toThrow();
    });
  });

  describe("output format (T-5.5)", () => {
    testFn("should include workspace in list response", async () => {
      const result = await fieldValues({ mode: "list" });
      expect(result.workspace).toBeDefined();
      expect(typeof result.workspace).toBe("string");
    });

    testFn("should include count in list response", async () => {
      const result = await fieldValues({ mode: "list" });
      expect(typeof result.count).toBe("number");
    });
  });
});
