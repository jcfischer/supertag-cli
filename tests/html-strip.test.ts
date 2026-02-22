/**
 * Tests for HTML stripping utility
 * Issue #42: tana_query field filtering fails on option fields with HTML formatting
 */

import { describe, test, expect } from "bun:test";
import { stripHtml } from "../src/utils/html";

describe("stripHtml", () => {
  test("strips span tags with data attributes", () => {
    expect(stripHtml('<span data-color="blue">DONE</span>')).toBe("DONE");
  });

  test("strips nested HTML tags", () => {
    expect(stripHtml("<b>bold</b> and <i>italic</i>")).toBe("bold and italic");
  });

  test("returns plain text unchanged", () => {
    expect(stripHtml("plain text")).toBe("plain text");
  });

  test("handles empty string", () => {
    expect(stripHtml("")).toBe("");
  });

  test("strips multiple span tags", () => {
    expect(
      stripHtml('<span data-color="red">HIGH</span> <span>PRIORITY</span>')
    ).toBe("HIGH PRIORITY");
  });

  test("strips self-closing tags", () => {
    expect(stripHtml("text<br/>more")).toBe("textmore");
  });

  test("handles tags with complex attributes", () => {
    expect(
      stripHtml('<span data-inlineref-node="abc123" class="ref">John</span>')
    ).toBe("John");
  });
});
