/**
 * E2E Integration Tests for Universal Format Options (Spec 060)
 *
 * Tests format resolution, TTY detection, and all 6 output formats.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Writable } from "stream";
import {
  createFormatter,
  TableFormatter,
  JsonFormatter,
  CsvFormatter,
  IdsFormatter,
  MinimalFormatter,
  JsonlFormatter,
  OUTPUT_FORMATS,
  type OutputFormat,
} from "../src/utils/output-formatter";
import {
  resolveOutputFormat,
  setOutputConfig,
  clearOutputConfigOverride,
} from "../src/utils/output-options";

// Helper to capture output for testing
function captureOutput(): { stream: NodeJS.WriteStream; getOutput: () => string } {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  }) as unknown as NodeJS.WriteStream;
  return { stream, getOutput: () => output };
}

describe("Format Integration Tests (Spec 060)", () => {
  afterEach(() => {
    // Clean up environment variables
    delete process.env.SUPERTAG_FORMAT;
    clearOutputConfigOverride();
  });

  describe("resolveOutputFormat precedence", () => {
    it("--format flag takes precedence over everything", () => {
      process.env.SUPERTAG_FORMAT = "csv";
      setOutputConfig({ format: "ids" });

      const format = resolveOutputFormat({ format: "jsonl", json: true });
      expect(format).toBe("jsonl");
    });

    it("--json flag takes precedence over env var and config", () => {
      process.env.SUPERTAG_FORMAT = "csv";
      setOutputConfig({ format: "ids" });

      const format = resolveOutputFormat({ json: true });
      expect(format).toBe("json");
    });

    it("--pretty flag takes precedence over env var and config", () => {
      process.env.SUPERTAG_FORMAT = "csv";
      setOutputConfig({ format: "ids" });

      const format = resolveOutputFormat({ pretty: true });
      expect(format).toBe("table");
    });

    it("SUPERTAG_FORMAT env var takes precedence over config", () => {
      process.env.SUPERTAG_FORMAT = "csv";
      setOutputConfig({ format: "ids" });

      const format = resolveOutputFormat({});
      expect(format).toBe("csv");
    });

    it("config format used when no flags or env var", () => {
      setOutputConfig({ format: "minimal" });

      const format = resolveOutputFormat({});
      expect(format).toBe("minimal");
    });

    it("TTY detection used as fallback", () => {
      // TTY -> table
      const formatTTY = resolveOutputFormat({}, { isTTY: true });
      expect(formatTTY).toBe("table");

      // Non-TTY -> json
      const formatPipe = resolveOutputFormat({}, { isTTY: false });
      expect(formatPipe).toBe("json");
    });
  });

  describe("all 6 formats produce valid output", () => {
    const testData = {
      headers: ["ID", "Name", "Tags"],
      rows: [
        ["abc123", "Test Node 1", "tag1, tag2"],
        ["def456", "Test Node 2", "tag3"],
      ],
    };

    it("json format produces valid JSON array", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "json", stream });

      formatter.table(testData.headers, testData.rows);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(Array.isArray(output)).toBe(true);
      expect(output).toHaveLength(2);
      expect(output[0].ID).toBe("abc123");
    });

    it("table format produces human-readable output", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "table", stream });

      formatter.table(testData.headers, testData.rows);
      formatter.finalize();

      const output = getOutput();
      expect(output).toContain("ID");
      expect(output).toContain("Name");
      expect(output).toContain("Test Node 1");
    });

    it("csv format produces RFC 4180 compliant output", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "csv", stream });

      formatter.table(testData.headers, testData.rows);
      formatter.finalize();

      const lines = getOutput().trim().split("\n");
      expect(lines).toHaveLength(3); // header + 2 rows
      expect(lines[0]).toBe("ID,Name,Tags");
      expect(lines[1]).toBe('abc123,Test Node 1,"tag1, tag2"'); // quotes around value with comma
    });

    it("ids format extracts only IDs", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "ids", stream });

      formatter.table(testData.headers, testData.rows);
      formatter.finalize();

      const lines = getOutput().trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("abc123");
      expect(lines[1]).toBe("def456");
    });

    it("minimal format projects to id, name, tags only", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "minimal", stream });

      formatter.table(["ID", "Name", "Tags", "Extra"], [
        ["abc", "Node 1", "tag1", "ignored"],
      ]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({ id: "abc", name: "Node 1", tags: "tag1" });
      expect(output.extra).toBeUndefined();
    });

    it("jsonl format produces one JSON object per line", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "jsonl", stream });

      formatter.table(testData.headers, testData.rows);
      formatter.finalize();

      const lines = getOutput().trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({
        ID: "abc123",
        Name: "Test Node 1",
        Tags: "tag1, tag2",
      });
    });
  });

  describe("OUTPUT_FORMATS metadata", () => {
    it("contains all 6 formats with valid metadata", () => {
      expect(OUTPUT_FORMATS).toHaveLength(6);

      const formats = OUTPUT_FORMATS.map((f) => f.format);
      expect(formats).toContain("json");
      expect(formats).toContain("table");
      expect(formats).toContain("csv");
      expect(formats).toContain("ids");
      expect(formats).toContain("minimal");
      expect(formats).toContain("jsonl");

      // Each format should have description and example
      for (const info of OUTPUT_FORMATS) {
        expect(info.description.length).toBeGreaterThan(10);
        expect(info.example.length).toBeGreaterThan(0);
      }
    });
  });

  describe("createFormatter factory", () => {
    it("creates correct formatter for each format", () => {
      const { stream } = captureOutput();

      expect(createFormatter({ format: "json", stream })).toBeInstanceOf(JsonFormatter);
      expect(createFormatter({ format: "table", stream })).toBeInstanceOf(TableFormatter);
      expect(createFormatter({ format: "csv", stream })).toBeInstanceOf(CsvFormatter);
      expect(createFormatter({ format: "ids", stream })).toBeInstanceOf(IdsFormatter);
      expect(createFormatter({ format: "minimal", stream })).toBeInstanceOf(MinimalFormatter);
      expect(createFormatter({ format: "jsonl", stream })).toBeInstanceOf(JsonlFormatter);
    });

    it("maintains backward compatibility with mode option", () => {
      const { stream } = captureOutput();

      expect(createFormatter({ mode: "json", stream })).toBeInstanceOf(JsonFormatter);
      expect(createFormatter({ mode: "pretty", stream })).toBeInstanceOf(TableFormatter);
    });
  });

  describe("CSV format edge cases", () => {
    it("properly escapes values with commas", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "csv", stream });

      formatter.table(["Name"], [["Value, with comma"]]);
      formatter.finalize();

      const lines = getOutput().trim().split("\n");
      expect(lines[1]).toBe('"Value, with comma"');
    });

    it("properly escapes values with quotes", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "csv", stream });

      formatter.table(["Name"], [['Value with "quotes"']]);
      formatter.finalize();

      const lines = getOutput().trim().split("\n");
      expect(lines[1]).toBe('"Value with ""quotes"""');
    });

    it("properly escapes values with newlines", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "csv", stream });

      formatter.table(["Name"], [["Line1\nLine2"]]);
      formatter.finalize();

      const lines = getOutput().split("\n");
      // Should be quoted and contain literal newline
      expect(lines[1]).toContain('"Line1');
    });

    it("respects --no-header option", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "csv", stream, noHeader: true });

      formatter.table(["ID", "Name"], [["abc", "Test"]]);
      formatter.finalize();

      const lines = getOutput().trim().split("\n");
      expect(lines).toHaveLength(1); // No header
      expect(lines[0]).toBe("abc,Test");
    });
  });

  describe("IDs format extraction", () => {
    it("finds ID column in various positions", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "ids", stream });

      // ID in first column
      formatter.table(["ID", "Name"], [["first", "Test"]]);
      formatter.finalize();

      expect(getOutput().trim()).toBe("first");
    });

    it("extracts id field from records", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "ids", stream });

      formatter.record({ id: "record-id", name: "Test" });
      formatter.finalize();

      expect(getOutput().trim()).toBe("record-id");
    });
  });

  describe("JSONL streaming behavior", () => {
    it("writes output immediately (not buffered)", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "jsonl", stream });

      formatter.table(["ID"], [["first"]]);
      expect(getOutput()).toBe('{"ID":"first"}\n'); // Immediate output

      formatter.table(["ID"], [["second"]]);
      expect(getOutput()).toBe('{"ID":"first"}\n{"ID":"second"}\n'); // Appended immediately
    });
  });

  describe("Minimal format projection", () => {
    it("handles missing fields with null", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "minimal", stream });

      formatter.record({ id: "abc" }); // Missing name and tags
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({ id: "abc", name: null, tags: null });
    });

    it("handles multiple records as array", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = createFormatter({ format: "minimal", stream });

      formatter.record({ id: "a", name: "First", tags: "t1" });
      formatter.record({ id: "b", name: "Second", tags: "t2" });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(Array.isArray(output)).toBe(true);
      expect(output).toHaveLength(2);
    });
  });
});
