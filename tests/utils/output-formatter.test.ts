/**
 * Tests for Output Formatter (Spec 054)
 *
 * Strategy pattern implementation for output formatting.
 * Tests written first following TDD.
 */

import { describe, it, expect } from "bun:test";
import { Writable } from "stream";

// Import types and implementations to test
import type {
  OutputFormatter,
  OutputMode,
  FormatterOptions,
} from "../../src/utils/output-formatter";


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

describe("OutputFormatter Interface (T-1.1)", () => {
  describe("OutputMode type", () => {
    it("should accept 'unix' as valid mode", () => {
      const mode: OutputMode = "unix";
      expect(mode).toBe("unix");
    });

    it("should accept 'pretty' as valid mode", () => {
      const mode: OutputMode = "pretty";
      expect(mode).toBe("pretty");
    });

    it("should accept 'json' as valid mode", () => {
      const mode: OutputMode = "json";
      expect(mode).toBe("json");
    });
  });

  describe("FormatterOptions interface", () => {
    it("should require mode property", () => {
      const options: FormatterOptions = { mode: "unix" };
      expect(options.mode).toBe("unix");
    });

    it("should accept optional humanDates", () => {
      const options: FormatterOptions = { mode: "pretty", humanDates: true };
      expect(options.humanDates).toBe(true);
    });

    it("should accept optional verbose", () => {
      const options: FormatterOptions = { mode: "pretty", verbose: true };
      expect(options.verbose).toBe(true);
    });

    it("should accept optional stream", () => {
      const { stream } = captureOutput();
      const options: FormatterOptions = { mode: "unix", stream };
      expect(options.stream).toBe(stream);
    });
  });

  describe("OutputFormatter interface methods", () => {
    // This test verifies the interface contract exists
    // Actual implementations are tested in their own describe blocks
    it("should define all required methods", () => {
      // Create a mock formatter to verify interface shape
      const mockFormatter: OutputFormatter = {
        value: (_value: unknown) => {},
        header: (_text: string, _emoji?: string) => {},
        table: (_headers: string[], _rows: (string | number | undefined)[][]) => {},
        record: (_fields: Record<string, unknown>) => {},
        list: (_items: string[], _bullet?: string) => {},
        divider: () => {},
        tip: (_message: string) => {},
        error: (_message: string) => {},
        finalize: () => {},
      };

      // Verify all methods exist
      expect(typeof mockFormatter.value).toBe("function");
      expect(typeof mockFormatter.header).toBe("function");
      expect(typeof mockFormatter.table).toBe("function");
      expect(typeof mockFormatter.record).toBe("function");
      expect(typeof mockFormatter.list).toBe("function");
      expect(typeof mockFormatter.divider).toBe("function");
      expect(typeof mockFormatter.tip).toBe("function");
      expect(typeof mockFormatter.error).toBe("function");
      expect(typeof mockFormatter.finalize).toBe("function");
    });
  });
});

// ============================================================================
// T-1.2: UnixFormatter Tests
// ============================================================================

import { UnixFormatter, PrettyFormatter, JsonFormatter, createFormatter, resolveOutputMode } from "../../src/utils/output-formatter";
import { setOutputConfig, clearOutputConfigOverride } from "../../src/utils/output-options";

describe("UnixFormatter (T-1.2)", () => {
  describe("value()", () => {
    it("should output value as string with newline", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.value("hello");
      expect(getOutput()).toBe("hello\n");
    });

    it("should convert non-string values to string", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.value(42);
      expect(getOutput()).toBe("42\n");
    });

    it("should handle objects by stringifying", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.value({ id: "abc" });
      expect(getOutput()).toBe("[object Object]\n");
    });
  });

  describe("header()", () => {
    it("should be a no-op (skip headers in unix mode)", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.header("Search Results", "search");
      expect(getOutput()).toBe("");
    });
  });

  describe("table()", () => {
    it("should output TSV rows without headers", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.table(["ID", "Name"], [
        ["abc", "Node 1"],
        ["xyz", "Node 2"],
      ]);

      expect(getOutput()).toBe("abc\tNode 1\nxyz\tNode 2\n");
    });

    it("should handle undefined values as empty string", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.table(["ID", "Name", "Tags"], [
        ["abc", "Node 1", undefined],
      ]);

      expect(getOutput()).toBe("abc\tNode 1\t\n");
    });

    it("should handle numeric values", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.table(["ID", "Count"], [
        ["abc", 42],
      ]);

      expect(getOutput()).toBe("abc\t42\n");
    });

    it("should output nothing for empty rows", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.table(["ID", "Name"], []);
      expect(getOutput()).toBe("");
    });
  });

  describe("record()", () => {
    it("should output YAML-like key-value format", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.record({ id: "abc", name: "Test" });
      expect(getOutput()).toBe("---\nid: abc\nname: Test\n");
    });

    it("should skip undefined and null values", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.record({ id: "abc", name: undefined, tags: null });
      expect(getOutput()).toBe("---\nid: abc\n");
    });

    it("should handle empty record", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.record({});
      expect(getOutput()).toBe("---\n");
    });
  });

  describe("list()", () => {
    it("should output one item per line", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.list(["item1", "item2", "item3"]);
      expect(getOutput()).toBe("item1\nitem2\nitem3\n");
    });

    it("should ignore bullet parameter", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.list(["item1"], "•");
      expect(getOutput()).toBe("item1\n");
    });

    it("should output nothing for empty list", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.list([]);
      expect(getOutput()).toBe("");
    });
  });

  describe("divider()", () => {
    it("should be a no-op", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.divider();
      expect(getOutput()).toBe("");
    });
  });

  describe("tip()", () => {
    it("should be a no-op", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.tip("Use --show for details");
      expect(getOutput()).toBe("");
    });
  });

  describe("error()", () => {
    it("should output to stream with newline", () => {
      // For testing, we use the same stream - in production it writes to stderr
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.error("Something went wrong");
      // Note: In production this goes to stderr, but for testing we verify the message
      // The formatter should write to its error stream (stderr in production)
      expect(getOutput()).toBe(""); // error() writes to stderr, not stdout
    });
  });

  describe("finalize()", () => {
    it("should be a no-op (nothing to finalize in unix mode)", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new UnixFormatter({ mode: "unix", stream });

      formatter.value("test");
      const beforeFinalize = getOutput();
      formatter.finalize();
      expect(getOutput()).toBe(beforeFinalize);
    });
  });
});

// ============================================================================
// T-1.3: PrettyFormatter Tests
// ============================================================================

describe("PrettyFormatter (T-1.3)", () => {
  describe("value()", () => {
    it("should output value as string with newline", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.value("hello");
      expect(getOutput()).toBe("hello\n");
    });

    it("should convert non-string values to string", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.value(42);
      expect(getOutput()).toBe("42\n");
    });
  });

  describe("header()", () => {
    it("should output header with emoji", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.header("Search Results", "search");
      expect(getOutput()).toBe("\n🔍 Search Results\n");
    });

    it("should output header without emoji when not provided", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.header("Results");
      expect(getOutput()).toBe("\nResults\n");
    });
  });

  describe("table()", () => {
    it("should output formatted table with headers", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.table(["ID", "Name"], [
        ["abc", "Node 1"],
        ["xyz", "Node 2"],
      ]);

      const output = getOutput();
      // Should contain headers
      expect(output).toContain("ID");
      expect(output).toContain("Name");
      // Should contain separator line
      expect(output).toContain("─");
      // Should contain data rows
      expect(output).toContain("abc");
      expect(output).toContain("Node 1");
      expect(output).toContain("xyz");
      expect(output).toContain("Node 2");
    });

    it("should handle undefined values", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.table(["ID", "Name", "Tags"], [
        ["abc", "Node 1", undefined],
      ]);

      const output = getOutput();
      expect(output).toContain("abc");
      expect(output).toContain("Node 1");
    });

    it("should handle numeric values", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.table(["ID", "Count"], [
        ["abc", 42],
      ]);

      const output = getOutput();
      expect(output).toContain("42");
    });

    it("should output nothing for empty rows", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.table(["ID", "Name"], []);
      expect(getOutput()).toBe("");
    });
  });

  describe("record()", () => {
    it("should output aligned key-value pairs", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.record({ id: "abc", name: "Test" });

      const output = getOutput();
      // Keys are padded for alignment, so check for key and value separately
      expect(output).toContain("id");
      expect(output).toContain("abc");
      expect(output).toContain("name");
      expect(output).toContain("Test");
      // Should contain colon separators
      expect(output).toContain(":");
    });

    it("should skip undefined and null values", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.record({ id: "abc", name: undefined, tags: null });

      const output = getOutput();
      expect(output).toContain("id");
      expect(output).toContain("abc");
      expect(output).not.toContain("name");
      expect(output).not.toContain("tags");
    });

    it("should handle empty record", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.record({});
      expect(getOutput()).toBe("");
    });
  });

  describe("list()", () => {
    it("should output bulleted list", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.list(["item1", "item2", "item3"]);

      const output = getOutput();
      expect(output).toContain("•");
      expect(output).toContain("item1");
      expect(output).toContain("item2");
      expect(output).toContain("item3");
    });

    it("should use custom bullet", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.list(["item1"], "-");

      const output = getOutput();
      expect(output).toContain("-");
      expect(output).toContain("item1");
    });

    it("should output nothing for empty list", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.list([]);
      expect(getOutput()).toBe("");
    });
  });

  describe("divider()", () => {
    it("should output horizontal line", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.divider();

      const output = getOutput();
      expect(output).toContain("─");
      expect(output.length).toBeGreaterThan(10); // Should be a decent length
    });
  });

  describe("tip()", () => {
    it("should output tip with emoji", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.tip("Use --show for details");

      const output = getOutput();
      expect(output).toContain("💡");
      expect(output).toContain("Tip:");
      expect(output).toContain("Use --show for details");
    });
  });

  describe("error()", () => {
    it("should output to stderr (not stdout)", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.error("Something went wrong");
      // error() writes to stderr, not the provided stream
      expect(getOutput()).toBe("");
    });
  });

  describe("finalize()", () => {
    it("should be a no-op (nothing to finalize in pretty mode)", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new PrettyFormatter({ mode: "pretty", stream });

      formatter.value("test");
      const beforeFinalize = getOutput();
      formatter.finalize();
      expect(getOutput()).toBe(beforeFinalize);
    });
  });
});

// ============================================================================
// T-1.4: JsonFormatter Tests
// ============================================================================

describe("JsonFormatter (T-1.4)", () => {
  describe("value()", () => {
    it("should buffer single value and output on finalize", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.value("hello");
      expect(getOutput()).toBe(""); // Nothing until finalize
      formatter.finalize();
      expect(getOutput()).toBe('"hello"\n');
    });

    it("should buffer multiple values and output array on finalize", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.value("one");
      formatter.value("two");
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual(["one", "two"]);
    });

    it("should handle numeric values", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.value(42);
      formatter.finalize();
      expect(getOutput()).toBe("42\n");
    });

    it("should handle object values", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.value({ id: "abc", name: "Test" });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({ id: "abc", name: "Test" });
    });
  });

  describe("header()", () => {
    it("should be a no-op (skip headers in json mode)", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.header("Search Results", "search");
      formatter.finalize();
      expect(getOutput()).toBe("[]\n"); // Empty array, header was ignored
    });
  });

  describe("table()", () => {
    it("should buffer rows as objects using headers as keys", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.table(["ID", "Name"], [
        ["abc", "Node 1"],
        ["xyz", "Node 2"],
      ]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([
        { ID: "abc", Name: "Node 1" },
        { ID: "xyz", Name: "Node 2" },
      ]);
    });

    it("should handle undefined values as null in JSON", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.table(["ID", "Name", "Tags"], [
        ["abc", "Node 1", undefined],
      ]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([
        { ID: "abc", Name: "Node 1", Tags: null },
      ]);
    });

    it("should handle numeric values", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.table(["ID", "Count"], [
        ["abc", 42],
      ]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([{ ID: "abc", Count: 42 }]);
    });

    it("should output empty array for empty rows", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.table(["ID", "Name"], []);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([]);
    });
  });

  describe("record()", () => {
    it("should buffer record object", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.record({ id: "abc", name: "Test" });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({ id: "abc", name: "Test" });
    });

    it("should handle undefined values as null in JSON", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.record({ id: "abc", name: undefined, count: 42 });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({ id: "abc", name: null, count: 42 });
    });

    it("should buffer multiple records as array", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.record({ id: "abc" });
      formatter.record({ id: "xyz" });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([{ id: "abc" }, { id: "xyz" }]);
    });

    it("should handle empty record", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.record({});
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({});
    });
  });

  describe("list()", () => {
    it("should buffer list items", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.list(["item1", "item2", "item3"]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual(["item1", "item2", "item3"]);
    });

    it("should ignore bullet parameter", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.list(["item1"], "•");
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual(["item1"]);
    });

    it("should output empty array for empty list", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.list([]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([]);
    });
  });

  describe("divider()", () => {
    it("should be a no-op", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.divider();
      formatter.finalize();
      expect(getOutput()).toBe("[]\n"); // Empty array, divider was ignored
    });
  });

  describe("tip()", () => {
    it("should be a no-op", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.tip("Use --show for details");
      formatter.finalize();
      expect(getOutput()).toBe("[]\n"); // Empty array, tip was ignored
    });
  });

  describe("error()", () => {
    it("should output to stderr (not stdout)", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.error("Something went wrong");
      // error() writes to stderr, not the provided stream
      expect(getOutput()).toBe("");
    });
  });

  describe("finalize()", () => {
    it("should output buffered data as JSON", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.table(["Name"], [["Test"]]);
      expect(getOutput()).toBe(""); // Nothing until finalize
      formatter.finalize();
      expect(getOutput()).not.toBe("");
    });

    it("should output empty array when no data buffered", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.finalize();
      expect(getOutput()).toBe("[]\n");
    });

    it("should only output once (subsequent calls are no-ops)", () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonFormatter({ mode: "json", stream });

      formatter.value("test");
      formatter.finalize();
      const firstOutput = getOutput();
      formatter.finalize();
      expect(getOutput()).toBe(firstOutput); // No additional output
    });
  });
});

// ============================================================================
// T-1.5: createFormatter Factory Tests
// ============================================================================

describe("createFormatter factory (T-1.5)", () => {
  it("should create UnixFormatter for mode 'unix'", () => {
    const { stream } = captureOutput();
    const formatter = createFormatter({ mode: "unix", stream });
    expect(formatter).toBeInstanceOf(UnixFormatter);
  });

  it("should create PrettyFormatter for mode 'pretty'", () => {
    const { stream } = captureOutput();
    const formatter = createFormatter({ mode: "pretty", stream });
    expect(formatter).toBeInstanceOf(PrettyFormatter);
  });

  it("should create JsonFormatter for mode 'json'", () => {
    const { stream } = captureOutput();
    const formatter = createFormatter({ mode: "json", stream });
    expect(formatter).toBeInstanceOf(JsonFormatter);
  });

  it("should pass through humanDates option", () => {
    const { stream } = captureOutput();
    const formatter = createFormatter({ mode: "unix", stream, humanDates: true });
    // Formatter should be created successfully
    expect(formatter).toBeInstanceOf(UnixFormatter);
  });

  it("should pass through verbose option", () => {
    const { stream } = captureOutput();
    const formatter = createFormatter({ mode: "unix", stream, verbose: true });
    // Formatter should be created successfully
    expect(formatter).toBeInstanceOf(UnixFormatter);
  });

  it("should pass through stream option", () => {
    const { stream, getOutput } = captureOutput();
    const formatter = createFormatter({ mode: "unix", stream });
    formatter.value("test");
    expect(getOutput()).toBe("test\n");
  });

  it("should default to stdout when no stream provided", () => {
    // Just verify it doesn't throw
    const formatter = createFormatter({ mode: "unix" });
    expect(formatter).toBeInstanceOf(UnixFormatter);
  });
});

// ============================================================================
// T-1.6: resolveOutputMode Helper Tests
// ============================================================================

import { afterEach } from "bun:test";

describe("resolveOutputMode helper (T-1.6)", () => {
  afterEach(() => {
    clearOutputConfigOverride();
  });

  describe("CLI flag precedence", () => {
    it("should return 'json' when --json flag is set", () => {
      const mode = resolveOutputMode({ json: true });
      expect(mode).toBe("json");
    });

    it("should return 'pretty' when --pretty flag is set", () => {
      const mode = resolveOutputMode({ pretty: true });
      expect(mode).toBe("pretty");
    });

    it("should prefer --json over --pretty when both set", () => {
      const mode = resolveOutputMode({ json: true, pretty: true });
      expect(mode).toBe("json");
    });
  });

  describe("config precedence", () => {
    it("should return 'pretty' when config.pretty is true", () => {
      setOutputConfig({ pretty: true });
      const mode = resolveOutputMode({});
      expect(mode).toBe("pretty");
    });

    it("should return 'unix' when config.pretty is false", () => {
      setOutputConfig({ pretty: false });
      const mode = resolveOutputMode({});
      expect(mode).toBe("unix");
    });

    it("should prefer CLI --json over config.pretty", () => {
      setOutputConfig({ pretty: true });
      const mode = resolveOutputMode({ json: true });
      expect(mode).toBe("json");
    });

    it("should prefer CLI --pretty=false over config.pretty=true", () => {
      setOutputConfig({ pretty: true });
      const mode = resolveOutputMode({ pretty: false });
      expect(mode).toBe("unix");
    });
  });

  describe("defaults", () => {
    it("should return 'unix' as default when no flags or config", () => {
      clearOutputConfigOverride();
      const mode = resolveOutputMode({});
      expect(mode).toBe("unix");
    });

    it("should return 'unix' when passed undefined options", () => {
      const mode = resolveOutputMode(undefined as unknown as {});
      expect(mode).toBe("unix");
    });
  });
});
