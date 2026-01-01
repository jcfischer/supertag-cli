/**
 * Select Parameter MCP Tests
 * Spec: 059-universal-select-parameter
 * Task: T-2.1
 *
 * Tests for selectSchema and select parameter integration with MCP tools.
 */

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { selectSchema } from "../../src/mcp/schemas";

describe("selectSchema", () => {
  it("should be exported from schemas", () => {
    expect(selectSchema).toBeDefined();
  });

  it("should be a Zod schema", () => {
    expect(selectSchema).toHaveProperty("parse");
    expect(selectSchema).toHaveProperty("safeParse");
  });

  it("should accept undefined", () => {
    const result = selectSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it("should accept empty array", () => {
    const result = selectSchema.safeParse([]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("should accept array of strings", () => {
    const result = selectSchema.safeParse(["id", "name", "fields.Status"]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(["id", "name", "fields.Status"]);
  });

  it("should reject non-array values", () => {
    const result = selectSchema.safeParse("id,name");
    expect(result.success).toBe(false);
  });

  it("should reject array with non-string values", () => {
    const result = selectSchema.safeParse(["id", 123, "name"]);
    expect(result.success).toBe(false);
  });

  it("should have description for API documentation", () => {
    // Check that description is set (used by MCP for tool documentation)
    // Description is on the inner schema for optional types
    const description = selectSchema.description || selectSchema._def.innerType?._def?.description;
    expect(description).toBeDefined();
    expect(description).toContain("select");
  });
});
