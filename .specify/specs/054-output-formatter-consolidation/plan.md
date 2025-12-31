---
feature: "Output Formatter Consolidation"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Output Formatter Consolidation

## Architecture Overview

Strategy pattern implementation that centralizes output formatting logic. Commands delegate all output rendering to a formatter instance, completely separating business logic from presentation.

```
┌────────────────────────────────────────────────────────────────────┐
│                         Commands Layer                              │
│  search.ts  stats.ts  tags.ts  nodes.ts  fields.ts  embed.ts  ...  │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                │ createFormatter({ mode })
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                     src/utils/output-formatter.ts                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   OutputFormatter Interface                  │   │
│  │  value() | header() | table() | record() | list() | tip()   │   │
│  │  divider() | error() | finalize()                           │   │
│  └───────────────────────────┬─────────────────────────────────┘   │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                │
│         │                    │                    │                │
│  ┌──────▼──────┐     ┌───────▼───────┐   ┌───────▼───────┐        │
│  │ UnixFormatter│     │ PrettyFormatter│   │ JsonFormatter │        │
│  │   (default)  │     │   (--pretty)   │   │   (--json)    │        │
│  └──────────────┘     └───────────────┘   └───────────────┘        │
└────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Testing | bun:test | Existing test infrastructure |
| Stream API | NodeJS.WriteStream | Standard Node stream for testability |

## Constitutional Compliance

- [x] **CLI-First:** Formatter selection via `--json`/`--pretty` flags, no change to CLI interface
- [x] **Library-First:** `createFormatter()` and formatters are reusable in any context
- [x] **Test-First:** TDD with comprehensive tests for each formatter before implementation
- [x] **Deterministic:** No probabilistic behavior - formatters produce identical output for identical input
- [x] **Code Before Prompts:** Pure TypeScript, no AI/prompt integration needed

## Data Model

### Entities

```typescript
/**
 * Output mode enum - matches existing CLI flag patterns
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

/**
 * Output formatting strategy interface
 */
export interface OutputFormatter {
  /** Format and output a single value */
  value(value: unknown): void;

  /** Output a header/title with optional emoji key */
  header(text: string, emoji?: keyof typeof EMOJI): void;

  /** Output tabular data */
  table(headers: string[], rows: (string | number | undefined)[][]): void;

  /** Output a key-value record */
  record(fields: Record<string, unknown>): void;

  /** Output a list of items */
  list(items: string[], bullet?: string): void;

  /** Output a separator/divider */
  divider(): void;

  /** Output a tip/hint */
  tip(message: string): void;

  /** Output an error */
  error(message: string): void;

  /** Finalize output (JSON formatter outputs buffered array) */
  finalize(): void;
}
```

### No Database Schema Changes

This is a pure presentation layer refactoring - no database changes needed.

## API Contracts

### Internal APIs

```typescript
/**
 * Create an output formatter based on options
 *
 * @param options - Formatter options including mode
 * @returns OutputFormatter instance
 */
export function createFormatter(options: FormatterOptions): OutputFormatter;

/**
 * Resolve output mode from CLI options and config
 *
 * Precedence: --json > --pretty > --no-pretty > config > default (unix)
 *
 * @param options - CLI options
 * @returns Resolved output mode
 */
export function resolveOutputMode(options: {
  json?: boolean;
  pretty?: boolean;
}): OutputMode;

// Re-export from existing output-options.ts
export { resolveOutputOptions } from './output-options';
```

### Typed Result Formatters (Optional Helpers)

```typescript
/**
 * Format search results with appropriate structure
 */
export function formatSearchResults(
  formatter: OutputFormatter,
  results: SearchResult[],
  query: string,
  options?: { showTip?: boolean }
): void;

/**
 * Format statistics with standard layout
 */
export function formatStats(
  formatter: OutputFormatter,
  stats: Record<string, number>,
  title: string,
  emoji?: keyof typeof EMOJI
): void;
```

## Implementation Strategy

### Phase 1: Foundation (Core Module)

Build the formatter infrastructure with TDD:

- [ ] Create `src/utils/output-formatter.ts` with interface definition
- [ ] Implement `UnixFormatter` class with tests
- [ ] Implement `PrettyFormatter` class with tests
- [ ] Implement `JsonFormatter` class with tests
- [ ] Implement `createFormatter()` factory with tests
- [ ] Implement `resolveOutputMode()` helper with tests
- [ ] Ensure all formatters handle edge cases (empty data, undefined values)

### Phase 2: Command Migration (Incremental)

Migrate commands one at a time, verifying behavior:

- [ ] Migrate `stats.ts` (simplest, good proof of concept)
- [ ] Migrate `tags.ts` - `top` subcommand
- [ ] Migrate `tags.ts` - `list` subcommand
- [ ] Migrate `search.ts` - FTS search output
- [ ] Migrate `search.ts` - semantic search output
- [ ] Migrate `search.ts` - tagged search output
- [ ] Migrate `nodes.ts`
- [ ] Migrate `fields.ts`
- [ ] Migrate `embed.ts` (stats subcommand output)
- [ ] Migrate `workspace.ts`
- [ ] Migrate `server.ts` (status output)

### Phase 3: Cleanup & Integration

- [ ] Remove duplicated output logic from commands
- [ ] Update any remaining console.log calls to use formatter
- [ ] Add typed result formatters for common patterns
- [ ] Update existing tests to use formatter assertions
- [ ] Documentation: add examples to code comments

## File Structure

```
src/
├── utils/
│   ├── format.ts                  # [Existing] Keep EMOJI, date utils
│   ├── output-options.ts          # [Existing] Keep resolveOutputOptions
│   └── output-formatter.ts        # [New] Strategy pattern implementation
├── commands/
│   ├── search.ts                  # [Modified] Use formatter
│   ├── stats.ts                   # [Modified] Use formatter
│   ├── tags.ts                    # [Modified] Use formatter
│   ├── nodes.ts                   # [Modified] Use formatter
│   ├── fields.ts                  # [Modified] Use formatter
│   ├── embed.ts                   # [Modified] Use formatter
│   ├── workspace.ts               # [Modified] Use formatter
│   └── server.ts                  # [Modified] Use formatter
│   └── helpers.ts                 # [Modified] May add formatter helpers

tests/
├── utils/
│   └── output-formatter.test.ts   # [New] Comprehensive formatter tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing output format | High | Medium | Snapshot tests comparing old vs new output |
| JSON output structure changes | High | Low | Existing JSON tests as regression guard |
| Performance regression | Low | Low | Streaming output, no significant overhead |
| Migration incomplete | Medium | Low | Incremental migration with per-command tests |

## Dependencies

### External

- None - uses only Node.js built-in stream APIs

### Internal

- `src/utils/format.ts` - EMOJI constants, date formatters, table formatter
- `src/utils/output-options.ts` - resolveOutputOptions for config integration
- All command files in `src/commands/` - consumers of the new module

## Migration/Deployment

- [ ] No database migrations needed
- [ ] No environment variables needed
- [ ] No breaking changes to CLI interface
- [ ] Backward compatible - output format preserved

### Migration Validation

For each migrated command:
1. Run existing tests
2. Manual comparison of output before/after
3. Verify TSV output parses correctly with `cut -f1`
4. Verify JSON output parses with `jq`
5. Verify pretty output displays correctly in terminal

## Estimated Complexity

- **New files:** 1 (`src/utils/output-formatter.ts`)
- **Modified files:** ~10 (commands)
- **Test files:** 1 new + updates to existing command tests
- **Estimated LOC:** ~350 new, ~250 removed = ~100 net reduction
- **Estimated tasks:** 15-18

## Integration with Existing Code

### Relationship to format.ts

The new `output-formatter.ts` will:
- Import and use `EMOJI` from `format.ts`
- Import and use `table()` from `format.ts` for PrettyFormatter
- Import and use date formatters from `format.ts`
- NOT duplicate existing utilities

### Relationship to output-options.ts

The new module will:
- Use `resolveOutputOptions()` for config/CLI precedence
- Potentially add `resolveOutputMode()` as a simpler mode-only resolver
- Maintain backward compatibility with existing option resolution

### Example Migration Pattern

**Before (search.ts):**
```typescript
if (options.json) {
  console.log(formatJsonOutput(results));
} else if (outputOpts.pretty) {
  console.log(`\n${header(EMOJI.search, headerText)}:\n`);
  results.forEach((result, i) => { /* ... */ });
  console.log(tip("Use --show for details"));
} else {
  for (const result of results) {
    console.log(tsv(result.id, result.name, result.tags));
  }
}
```

**After (search.ts):**
```typescript
const formatter = createFormatter({
  mode: resolveOutputMode(options),
  humanDates: outputOpts.humanDates,
  verbose: outputOpts.verbose,
});

formatter.header(`Search results for "${query}" (${results.length})`, 'search');
formatter.table(
  ['ID', 'Name', 'Tags', 'Rank'],
  results.map(r => [r.id, r.name, r.tags.join(','), r.rank.toFixed(2)])
);
formatter.tip('Use --show for full node content');
formatter.finalize();
```

## Test Strategy

### Unit Tests for Formatters

```typescript
describe('UnixFormatter', () => {
  it('outputs TSV for table without headers');
  it('outputs YAML-like records');
  it('skips headers, tips, dividers');
  it('writes errors to stderr');
  it('handles undefined values in rows');
});

describe('PrettyFormatter', () => {
  it('outputs formatted table with headers');
  it('outputs headers with emoji');
  it('outputs tips with emoji');
  it('outputs aligned records');
  it('uses divider character');
});

describe('JsonFormatter', () => {
  it('buffers records and outputs array on finalize');
  it('outputs single object when one value');
  it('outputs empty array for no data');
  it('skips headers, tips, dividers');
});

describe('createFormatter', () => {
  it('creates UnixFormatter for mode unix');
  it('creates PrettyFormatter for mode pretty');
  it('creates JsonFormatter for mode json');
});

describe('resolveOutputMode', () => {
  it('returns json when --json flag');
  it('returns pretty when --pretty flag');
  it('returns unix as default');
  it('respects config when no flags');
});
```

### Integration Tests

- Each command should have tests verifying output in all three modes
- Existing command tests serve as regression guards
