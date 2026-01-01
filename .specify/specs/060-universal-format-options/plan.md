---
feature: "Universal Format Options"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Universal Format Options

## Architecture Overview

Extend the existing Strategy Pattern output formatter (Spec 054) from 3 modes to 6 formats. The current system already provides `unix`, `pretty`, and `json` modes - this plan adds `csv`, `ids`, `minimal`, and `jsonl` while unifying the CLI interface under a single `--format` flag.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI Commands                                │
│  (search, nodes, tags, fields, stats, transcript, embed)           │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │ resolveOutputFormat()
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     OutputFormatter Interface                        │
│  value() | header() | table() | record() | list() | finalize()      │
└─────────────────────────────────────────────────────────────────────┘
           │          │         │         │        │         │
           ▼          ▼         ▼         ▼        ▼         ▼
       ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌─────┐ ┌───────┐
       │ JSON  │ │ Table │ │  CSV  │ │  IDs  │ │ Min │ │ JSONL │
       │       │ │ (was  │ │ (new) │ │ (new) │ │(new)│ │ (new) │
       │       │ │pretty)│ │       │ │       │ │     │ │       │
       └───────┘ └───────┘ └───────┘ └───────┘ └─────┘ └───────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Testing | bun:test | Existing test infrastructure |
| CSV | Built-in | RFC 4180 is simple; no external deps needed |
| Table | Existing code | PrettyFormatter already has table logic |

## Constitutional Compliance

- [x] **CLI-First:** Exposes `--format` flag on all query commands
- [x] **Library-First:** `OutputFormatter` interface + implementations are reusable modules
- [x] **Test-First:** Each formatter gets unit tests before implementation
- [x] **Deterministic:** No probabilistic behavior - pure data transformation
- [x] **Code Before Prompts:** All format logic in TypeScript code

## Data Model

### Format Types

```typescript
// Extended from existing OutputMode
export type OutputFormat =
  | "json"    // Pretty-printed JSON array
  | "table"   // ASCII table with headers (was "pretty")
  | "csv"     // RFC 4180 compliant CSV
  | "ids"     // One ID per line, bare
  | "minimal" // JSON with only id, name, tags
  | "jsonl";  // JSON Lines (newline-delimited JSON)

// Format metadata for help text and validation
export interface FormatInfo {
  format: OutputFormat;
  description: string;
  example: string;
}
```

### Formatter Configuration

```typescript
export interface FormatterOptions {
  /** Output format */
  format: OutputFormat;
  /** Suppress header row (table/csv) */
  noHeader?: boolean;
  /** Max column width for table */
  maxWidth?: number;
  /** Use human-readable dates */
  humanDates?: boolean;
  /** Include verbose details */
  verbose?: boolean;
  /** Output stream (default: stdout) */
  stream?: NodeJS.WriteStream;
}
```

## API Contracts

### Internal APIs

```typescript
// Main factory function - updated signature
function createFormatter(options: FormatterOptions): OutputFormatter;

// Format resolution - replaces resolveOutputMode()
function resolveOutputFormat(options: {
  format?: OutputFormat;   // --format flag
  json?: boolean;          // --json legacy flag
  pretty?: boolean;        // --pretty legacy flag
}): OutputFormat;

// TTY detection for smart defaults
function getDefaultFormat(): OutputFormat;  // "table" if TTY, "json" if pipe

// New formatters (implement OutputFormatter interface)
class CsvFormatter implements OutputFormatter;
class IdsFormatter implements OutputFormatter;
class MinimalFormatter implements OutputFormatter;
class JsonlFormatter implements OutputFormatter;
```

### CLI Interface Changes

```
# Before (Spec 054)
supertag search "query" --json
supertag search "query" --pretty

# After (Spec 060)
supertag search "query" --format json
supertag search "query" --format table
supertag search "query" --format csv
supertag search "query" --format ids
supertag search "query" --format minimal
supertag search "query" --format jsonl

# Legacy flags still work (backward compatible)
supertag search "query" --json      # => --format json
supertag search "query" --pretty    # => --format table
```

## Implementation Strategy

### Phase 1: Foundation (Core Infrastructure)

Types, factory, and resolution logic.

- [ ] Define `OutputFormat` type and extend `FormatterOptions`
- [ ] Create `resolveOutputFormat()` with TTY detection
- [ ] Add SUPERTAG_FORMAT env var support
- [ ] Update `createFormatter()` factory to handle all 6 formats
- [ ] Add `FormatInfo` metadata for help text
- [ ] Rename `PrettyFormatter` → `TableFormatter` (internal refactor)

### Phase 2: New Formatter Implementations

One class per new format, following existing patterns.

- [ ] **CsvFormatter** - RFC 4180 escaping, header row, proper quoting
- [ ] **IdsFormatter** - Extract ID from data, one per line, no decoration
- [ ] **MinimalFormatter** - JSON with only id/name/tags projection
- [ ] **JsonlFormatter** - One JSON object per line (no array wrapper)

### Phase 3: CLI Integration

Update commands and add options.

- [ ] Add `--format <type>` option to `addStandardOptions()`
- [ ] Support `--no-header` for table/csv
- [ ] Update all query commands to use `resolveOutputFormat()`
- [ ] Add `SUPERTAG_FORMAT` config file support
- [ ] Remove explicit `--json`/`--pretty` (keep as deprecated aliases)

### Phase 4: Command Migration

Update each command to use the new system.

Commands to update:
- [ ] `search.ts` - main search command
- [ ] `nodes.ts` - show, recent, children, path, tree, ancestors
- [ ] `tags.ts` - list, show, search
- [ ] `fields.ts` - query, values
- [ ] `transcript.ts` - list, show, search
- [ ] `stats.ts` - general stats command
- [ ] `embed.ts` - search results

### Phase 5: Documentation & Testing

- [ ] Add format examples to README
- [ ] Update SKILL.md with format options
- [ ] End-to-end tests for shell pipelines

## File Structure

```
src/
├── utils/
│   └── output-formatter.ts     # [Modified] Add 4 new formatters, update types
├── utils/
│   └── output-options.ts       # [Modified] Add format resolution, env var
├── commands/
│   ├── helpers.ts              # [Modified] Add --format to addStandardOptions
│   ├── search.ts               # [Modified] Use new format system
│   ├── nodes.ts                # [Modified] Use new format system
│   ├── tags.ts                 # [Modified] Use new format system
│   ├── fields.ts               # [Modified] Use new format system
│   ├── transcript.ts           # [Modified] Use new format system
│   ├── stats.ts                # [Modified] Use new format system
│   └── embed.ts                # [Modified] Use new format system

tests/
├── output-formatter.test.ts    # [Modified] Add tests for new formatters
├── csv-formatter.test.ts       # [New] RFC 4180 compliance tests
├── ids-formatter.test.ts       # [New] ID extraction tests
├── minimal-formatter.test.ts   # [New] Projection tests
├── jsonl-formatter.test.ts     # [New] Streaming format tests
└── format-integration.test.ts  # [New] E2E shell pipeline tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing `--json`/`--pretty` users | High | Medium | Keep as deprecated aliases, document migration |
| CSV escaping edge cases | Medium | Medium | Comprehensive RFC 4180 test suite |
| TTY detection fails in edge cases | Low | Low | Explicit `--format` always overrides detection |
| Performance with large result sets | Low | Low | jsonl format for streaming; lazy evaluation |

## Dependencies

### External

- None - all implementations use built-in TypeScript/Bun APIs

### Internal

- `src/utils/output-formatter.ts` - Existing formatter infrastructure
- `src/utils/output-options.ts` - Existing output config resolution
- `src/commands/helpers.ts` - Standard option registration

## Migration/Deployment

- [ ] Database migrations needed? **No**
- [ ] Environment variables? **Yes - SUPERTAG_FORMAT**
- [ ] Breaking changes? **No - legacy flags preserved as aliases**

### Backward Compatibility

```typescript
// In resolveOutputFormat()
if (options.json === true) return "json";     // --json => json
if (options.pretty === true) return "table";  // --pretty => table
if (options.pretty === false) return "json";  // --no-pretty => json (pipe default)
```

## Estimated Complexity

- **New files:** ~5 (test files)
- **Modified files:** ~10 (formatters, helpers, commands)
- **Test files:** ~6 (unit + integration)
- **Estimated tasks:** ~15-20
