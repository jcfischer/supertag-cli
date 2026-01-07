---
id: "054"
feature: "Output Formatter Consolidation"
status: "completed"
created: "2025-12-30"
completed: "2025-12-31"
priority: "medium"
---

# Specification: Output Formatter Consolidation

**Priority**: Medium (~250 LOC, improved maintainability)
**Related**: `output-formatting` spec (defines output modes and formats)

## Overview

This specification defines a strategy pattern implementation for output formatting, complementing the existing `output-formatting` spec. While that spec defines *what* the output should look like, this spec defines *how* to implement it with minimal code duplication.

## Problem Statement

### Current State: Switch Statements Everywhere

Each command implements output mode switching independently:

```typescript
// Repeated in every command:
if (options.json) {
  console.log(JSON.stringify(results));
} else if (options.pretty) {
  // Pretty output with emojis, tables, etc.
  console.log(`🔍 Search results for "${query}" (${results.length}):`);
  for (const result of results) {
    console.log(`  ${result.name} (${result.id})`);
  }
} else {
  // Unix TSV output
  for (const result of results) {
    console.log(`${result.id}\t${result.name}`);
  }
}
```

### Duplication Statistics

- **~15 commands** with similar switch statements
- **~250 lines** of duplicated output logic
- **3 output modes** (json, pretty, unix) multiplied across all commands

### Issues

1. **Inconsistent implementation** - Each command formats slightly differently
2. **Hard to add new mode** - Would require changing all commands
3. **Mixed concerns** - Commands mix business logic with formatting
4. **Testing difficulty** - Hard to test output formatting separately

## Proposed Solution

### Strategy Pattern Architecture

```
┌─────────────────────┐
│   OutputFormatter   │  (Interface)
├─────────────────────┤
│ format(data): void  │
│ header(text): void  │
│ table(rows): void   │
│ record(fields): void│
└─────────────────────┘
          △
          │ implements
    ┌─────┴─────┬─────────────┐
    │           │             │
┌───▼───┐ ┌─────▼─────┐ ┌─────▼─────┐
│ Unix  │ │  Pretty   │ │   JSON    │
│Format │ │  Format   │ │  Format   │
└───────┘ └───────────┘ └───────────┘
```

### New Module: `src/utils/output-formatter.ts`

## Interface Design

### OutputFormatter Interface

```typescript
/**
 * Output formatting strategy interface
 */
export interface OutputFormatter {
  /**
   * Format and output a single value
   */
  value(value: unknown): void;

  /**
   * Output a header/title
   */
  header(text: string, emoji?: string): void;

  /**
   * Output tabular data
   */
  table(headers: string[], rows: (string | number | undefined)[][]): void;

  /**
   * Output a key-value record
   */
  record(fields: Record<string, unknown>): void;

  /**
   * Output a list of items
   */
  list(items: string[], bullet?: string): void;

  /**
   * Output a separator/divider
   */
  divider(): void;

  /**
   * Output a tip/hint
   */
  tip(message: string): void;

  /**
   * Output an error
   */
  error(message: string): void;

  /**
   * Finalize output (for JSON formatter to output array)
   */
  finalize(): void;
}

/**
 * Output mode enum
 */
export type OutputMode = 'unix' | 'pretty' | 'json';

/**
 * Options for creating a formatter
 */
export interface FormatterOptions {
  mode: OutputMode;
  humanDates?: boolean;
  verbose?: boolean;
  stream?: NodeJS.WriteStream;
}
```

### createFormatter Factory

```typescript
/**
 * Create an output formatter based on options
 *
 * @param options - Formatter options including mode
 * @returns OutputFormatter instance
 *
 * @example
 * const formatter = createFormatter({ mode: 'pretty' });
 * formatter.header('Search Results', 'search');
 * formatter.table(['ID', 'Name'], [['abc', 'Node 1'], ['xyz', 'Node 2']]);
 *
 * @example
 * // Determine mode from CLI options
 * const mode = options.json ? 'json' : options.pretty ? 'pretty' : 'unix';
 * const formatter = createFormatter({ mode });
 */
export function createFormatter(options: FormatterOptions): OutputFormatter;
```

### resolveOutputMode Helper

```typescript
/**
 * Resolve output mode from CLI options
 *
 * Precedence: --json > --pretty > --no-pretty > config > default (unix)
 *
 * @param options - CLI options
 * @param config - Optional config for default mode
 * @returns Resolved output mode
 */
export function resolveOutputMode(
  options: { json?: boolean; pretty?: boolean; noPretty?: boolean },
  config?: { output?: { pretty?: boolean } }
): OutputMode;
```

## Formatter Implementations

### UnixFormatter (Default)

```typescript
/**
 * Unix-style formatter: TSV, no decoration, pipe-friendly
 */
class UnixFormatter implements OutputFormatter {
  private out: NodeJS.WriteStream;

  constructor(options: FormatterOptions) {
    this.out = options.stream ?? process.stdout;
  }

  value(value: unknown): void {
    this.out.write(String(value) + '\n');
  }

  header(_text: string, _emoji?: string): void {
    // No headers in unix mode
  }

  table(_headers: string[], rows: (string | number | undefined)[][]): void {
    for (const row of rows) {
      this.out.write(row.map(v => v ?? '').join('\t') + '\n');
    }
  }

  record(fields: Record<string, unknown>): void {
    this.out.write('---\n');
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) {
        this.out.write(`${key}: ${value}\n`);
      }
    }
  }

  list(items: string[], _bullet?: string): void {
    for (const item of items) {
      this.out.write(item + '\n');
    }
  }

  divider(): void {
    // No dividers in unix mode
  }

  tip(_message: string): void {
    // No tips in unix mode
  }

  error(message: string): void {
    process.stderr.write(message + '\n');
  }

  finalize(): void {
    // Nothing to finalize
  }
}
```

### PrettyFormatter

```typescript
/**
 * Pretty formatter: emojis, tables, colors, human-friendly
 */
class PrettyFormatter implements OutputFormatter {
  private out: NodeJS.WriteStream;
  private humanDates: boolean;

  constructor(options: FormatterOptions) {
    this.out = options.stream ?? process.stdout;
    this.humanDates = options.humanDates ?? false;
  }

  value(value: unknown): void {
    this.out.write(String(value) + '\n');
  }

  header(text: string, emoji?: string): void {
    const emojiStr = emoji ? EMOJI[emoji as keyof typeof EMOJI] + '  ' : '';
    this.out.write(`${emojiStr}${text}\n\n`);
  }

  table(headers: string[], rows: (string | number | undefined)[][]): void {
    // Calculate column widths
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
    );

    // Header row
    const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
    this.out.write(`  ${headerRow}\n`);

    // Separator
    const separator = widths.map(w => '─'.repeat(w)).join('──');
    this.out.write(`  ${separator}\n`);

    // Data rows
    for (const row of rows) {
      const formattedRow = row.map((v, i) =>
        String(v ?? '').padEnd(widths[i])
      ).join('  ');
      this.out.write(`  ${formattedRow}\n`);
    }
    this.out.write('\n');
  }

  record(fields: Record<string, unknown>): void {
    const maxKeyLen = Math.max(...Object.keys(fields).map(k => k.length));
    this.divider();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) {
        this.out.write(`  ${key.padEnd(maxKeyLen)}:  ${value}\n`);
      }
    }
    this.out.write('\n');
  }

  list(items: string[], bullet = '•'): void {
    for (const item of items) {
      this.out.write(`    ${bullet} ${item}\n`);
    }
  }

  divider(): void {
    this.out.write('━'.repeat(60) + '\n');
  }

  tip(message: string): void {
    this.out.write(`💡 ${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`❌ ${message}\n`);
  }

  finalize(): void {
    // Nothing to finalize
  }
}

// Emoji constants
const EMOJI = {
  search: '🔍',
  tags: '🏷️',
  stats: '📊',
  database: '💾',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  workspace: '📂',
  embeddings: '🧠',
  serverRunning: '▶️',
  serverStopped: '⏹️',
  node: '📄',
  tip: '💡',
} as const;
```

### JsonFormatter

```typescript
/**
 * JSON formatter: structured output for programmatic consumption
 */
class JsonFormatter implements OutputFormatter {
  private out: NodeJS.WriteStream;
  private buffer: unknown[] = [];
  private singleMode = false;

  constructor(options: FormatterOptions) {
    this.out = options.stream ?? process.stdout;
  }

  value(value: unknown): void {
    this.buffer.push(value);
    this.singleMode = true;
  }

  header(_text: string, _emoji?: string): void {
    // No headers in JSON mode
  }

  table(_headers: string[], rows: (string | number | undefined)[][]): void {
    // Convert to array of objects using headers as keys
    // This is called per-item, so just add to buffer
    this.buffer.push(...rows);
  }

  record(fields: Record<string, unknown>): void {
    this.buffer.push(fields);
  }

  list(items: string[], _bullet?: string): void {
    this.buffer.push(...items);
  }

  divider(): void {
    // No dividers in JSON mode
  }

  tip(_message: string): void {
    // No tips in JSON mode
  }

  error(message: string): void {
    this.buffer.push({ error: message });
  }

  finalize(): void {
    if (this.buffer.length === 0) {
      this.out.write('[]\n');
    } else if (this.singleMode && this.buffer.length === 1) {
      this.out.write(JSON.stringify(this.buffer[0], null, 2) + '\n');
    } else {
      this.out.write(JSON.stringify(this.buffer, null, 2) + '\n');
    }
  }
}
```

## Migration Example

### Before (search command)

```typescript
export async function searchCommand(query: string, options: SearchOptions) {
  const results = await performSearch(query, options);

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (options.pretty) {
    console.log(`🔍 Search results for "${query}" (${results.length}):\n`);
    console.log('  ID            Name');
    console.log('  ' + '─'.repeat(50));
    for (const result of results) {
      console.log(`  ${result.id.padEnd(12)}  ${result.name}`);
    }
    console.log('');
    console.log(`💡 Use --show for full node content`);
    return;
  }

  // Unix mode (default)
  for (const result of results) {
    console.log(`${result.id}\t${result.name}`);
  }
}
```

### After (search command)

```typescript
export async function searchCommand(query: string, options: SearchOptions) {
  const results = await performSearch(query, options);

  const formatter = createFormatter({
    mode: resolveOutputMode(options),
    humanDates: options.humanDates,
  });

  formatter.header(`Search results for "${query}" (${results.length})`, 'search');
  formatter.table(
    ['ID', 'Name'],
    results.map(r => [r.id, r.name])
  );
  formatter.tip('Use --show for full node content');
  formatter.finalize();
}
```

## Typed Result Formatters

For common result types, provide typed helper formatters:

```typescript
/**
 * Format search results
 */
export function formatSearchResults(
  formatter: OutputFormatter,
  results: SearchResult[],
  query: string
): void {
  formatter.header(`Search results for "${query}" (${results.length})`, 'search');
  formatter.table(
    ['ID', 'Name', 'Context'],
    results.map(r => [r.id, r.name, r.context])
  );
  formatter.tip('Use --show for full node content');
}

/**
 * Format node details
 */
export function formatNodeDetails(
  formatter: OutputFormatter,
  node: NodeDetails
): void {
  formatter.record({
    id: node.id,
    name: node.name,
    created: node.created,
    ...node.fields,
  });
}

/**
 * Format statistics
 */
export function formatStats(
  formatter: OutputFormatter,
  stats: DatabaseStats
): void {
  formatter.header('Statistics', 'stats');
  formatter.record({
    nodes: stats.nodes,
    supertags: stats.supertags,
    fields: stats.fields,
    references: stats.references,
  });
}
```

## Testing Strategy

### Unit Tests

```typescript
import { describe, it, expect } from 'bun:test';
import { createFormatter, UnixFormatter, PrettyFormatter, JsonFormatter } from './output-formatter';
import { Writable } from 'stream';

// Helper to capture output
function captureOutput(): { stream: Writable; getOutput: () => string } {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    }
  });
  return { stream: stream as any, getOutput: () => output };
}

describe('UnixFormatter', () => {
  it('should output TSV for table', () => {
    const { stream, getOutput } = captureOutput();
    const formatter = createFormatter({ mode: 'unix', stream });

    formatter.table(['ID', 'Name'], [['abc', 'Node 1'], ['xyz', 'Node 2']]);

    expect(getOutput()).toBe('abc\tNode 1\nxyz\tNode 2\n');
  });

  it('should skip headers', () => {
    const { stream, getOutput } = captureOutput();
    const formatter = createFormatter({ mode: 'unix', stream });

    formatter.header('Title', 'search');

    expect(getOutput()).toBe('');
  });

  it('should output YAML-like records', () => {
    const { stream, getOutput } = captureOutput();
    const formatter = createFormatter({ mode: 'unix', stream });

    formatter.record({ id: 'abc', name: 'Test' });

    expect(getOutput()).toBe('---\nid: abc\nname: Test\n');
  });
});

describe('PrettyFormatter', () => {
  it('should output formatted table with headers', () => {
    const { stream, getOutput } = captureOutput();
    const formatter = createFormatter({ mode: 'pretty', stream });

    formatter.table(['ID', 'Name'], [['abc', 'Node 1']]);

    expect(getOutput()).toContain('ID');
    expect(getOutput()).toContain('Name');
    expect(getOutput()).toContain('─');
    expect(getOutput()).toContain('abc');
  });

  it('should output headers with emoji', () => {
    const { stream, getOutput } = captureOutput();
    const formatter = createFormatter({ mode: 'pretty', stream });

    formatter.header('Search Results', 'search');

    expect(getOutput()).toContain('🔍');
    expect(getOutput()).toContain('Search Results');
  });
});

describe('JsonFormatter', () => {
  it('should buffer and output JSON array on finalize', () => {
    const { stream, getOutput } = captureOutput();
    const formatter = createFormatter({ mode: 'json', stream });

    formatter.record({ id: 'abc' });
    formatter.record({ id: 'xyz' });
    formatter.finalize();

    const output = JSON.parse(getOutput());
    expect(output).toEqual([{ id: 'abc' }, { id: 'xyz' }]);
  });

  it('should output single object when one value', () => {
    const { stream, getOutput } = captureOutput();
    const formatter = createFormatter({ mode: 'json', stream });

    formatter.value({ id: 'abc', name: 'Test' });
    formatter.finalize();

    const output = JSON.parse(getOutput());
    expect(output).toEqual({ id: 'abc', name: 'Test' });
  });
});

describe('resolveOutputMode', () => {
  it('should return json when --json flag set', () => {
    expect(resolveOutputMode({ json: true })).toBe('json');
  });

  it('should return pretty when --pretty flag set', () => {
    expect(resolveOutputMode({ pretty: true })).toBe('pretty');
  });

  it('should return unix when --no-pretty overrides config', () => {
    expect(resolveOutputMode(
      { noPretty: true },
      { output: { pretty: true } }
    )).toBe('unix');
  });

  it('should use config default when no flags', () => {
    expect(resolveOutputMode({}, { output: { pretty: true } })).toBe('pretty');
  });

  it('should default to unix', () => {
    expect(resolveOutputMode({})).toBe('unix');
  });
});
```

## Success Criteria

1. **Single output implementation** - Each format logic in one place
2. **Easy mode switching** - Commands just pick mode, don't implement formatting
3. **New mode support** - Adding a mode means one new class, not touching all commands
4. **Testable** - Formatters testable in isolation
5. **Type-safe** - Full TypeScript support for formatter interface
6. **~250 lines saved** - Reduced duplication across commands

## Out of Scope

- ANSI color codes (may add later as PrettyFormatter enhancement)
- Interactive output (spinners, progress bars)
- Paging/pagination (handled separately)
- File output (formatters write to streams, caller controls destination)

## Dependencies

- None (standalone module)

## Related Specs

- **output-formatting** - Defines output format standards (this implements them)
- **Unified Workspace Resolver** - Commands use both together
