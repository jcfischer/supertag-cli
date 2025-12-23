# Output Formatting - Implementation Plan

**Created**: 2025-12-23
**Updated**: 2025-12-23
**Estimated Tasks**: 14

## Core Philosophy

- **Unix-style output by default** - pipe-friendly, no decoration
- **`--pretty` for humans** - emojis, tables, visual hierarchy
- **`--iso-dates` default** - sortable, unambiguous
- **`--human-dates` opt-in** - localized, relative times

---

## Phase 1: Foundation

### T-1.1: Create format utility module (Unix output)

**File**: `src/utils/format.ts`

**Deliverables**:
1. `OutputOptions` interface
2. `tsv()` - tab-separated value output
3. `record()` - YAML-like key:value records for `--show`
4. `formatDateISO()` - ISO 8601 dates (default)
5. `formatDateHuman()` - localized dates
6. `formatDateRelative()` - relative times (e.g., "2 hours ago")
7. `formatNumber()` - raw or with separators
8. `formatPercentage()` - decimal (0.568) or percent (56.8%)

**Tests**: `tests/utils/format.test.ts`

```typescript
export interface OutputOptions {
  pretty?: boolean;
  json?: boolean;
  humanDates?: boolean;
  verbose?: boolean;
}

// Unix-style TSV output
export function tsv(...fields: (string | number | undefined)[]): string {
  return fields.map(f => f ?? '').join('\t');
}

// YAML-like record for --show
export function record(fields: Record<string, string | undefined>): string {
  return Object.entries(fields)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

// Date formatting
export function formatDateISO(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0]; // 2025-12-17
}

export function formatDateHuman(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }); // Dec 17, 2025
}

// Number formatting
export function formatNumber(n: number, pretty = false): string {
  return pretty ? n.toLocaleString('en-US') : String(n);
}

export function formatPercentage(n: number, pretty = false): string {
  return pretty ? `${(n * 100).toFixed(1)}%` : n.toFixed(3);
}
```

---

### T-1.2: Register global CLI flags + config support

**File**: `src/cli.ts` (or main entry point), `src/config.ts`

**Deliverables**:
1. `--pretty` / `--no-pretty` flags
2. `--iso-dates` flag (default, no-op)
3. `--human-dates` flag (localized dates)
4. `--verbose` flag (technical details)
5. Config schema for `output.pretty` and `output.humanDates`
6. Merge config defaults with CLI flags (CLI wins)

```typescript
// CLI flags
program
  .option('--pretty', 'Human-friendly output with formatting')
  .option('--no-pretty', 'Force Unix output (overrides config)')
  .option('--iso-dates', 'ISO 8601 date format (default)')
  .option('--human-dates', 'Human-readable date format')
  .option('--verbose', 'Include technical details');

// Config schema addition
interface OutputConfig {
  pretty?: boolean;
  humanDates?: boolean;
}

// Merge logic
function resolveOutputOptions(cliFlags: OutputOptions): OutputOptions {
  const config = loadConfig();
  return {
    pretty: cliFlags.pretty ?? config.output?.pretty ?? false,
    humanDates: cliFlags.humanDates ?? config.output?.humanDates ?? false,
    verbose: cliFlags.verbose ?? false,
  };
}
```

**Config commands**:
```bash
supertag config --set output.pretty=true
supertag config --set output.humanDates=true
```

---

### T-1.3: Create pretty-mode utilities

**File**: `src/utils/format.ts` (continued)

**Deliverables**:
1. `EMOJI` constants object
2. `padLeft()` / `padRight()` - string padding
3. `divider()` - box-drawing line generator
4. `header()` - section header with emoji
5. `table()` - aligned table with headers
6. `field()` - indented field display
7. `tip()` - helpful suggestion

```typescript
export const EMOJI = {
  search: '🔍',
  tags: '🏷️',
  stats: '📊',
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

export function padRight(s: string, width: number): string {
  return s.padEnd(width);
}

export function padLeft(s: string, width: number): string {
  return s.padStart(width);
}

export function divider(width = 60, char = '─'): string {
  return char.repeat(width);
}

export function header(emoji: string, title: string): string {
  return `${emoji} ${title}`;
}

export function tip(message: string): string {
  return `\n${EMOJI.tip} Tip: ${message}`;
}

interface TableOptions {
  align?: ('left' | 'right')[];
  indent?: number;
}

export function table(
  headers: string[],
  rows: string[][],
  options: TableOptions = {}
): string {
  const { align = [], indent = 2 } = options;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || '').length))
  );

  const formatRow = (row: string[]) =>
    row.map((cell, i) =>
      align[i] === 'right' ? padLeft(cell, widths[i]) : padRight(cell, widths[i])
    ).join('  ');

  const prefix = ' '.repeat(indent);
  return [
    prefix + formatRow(headers),
    prefix + widths.map(w => '─'.repeat(w)).join('──'),
    ...rows.map(r => prefix + formatRow(r))
  ].join('\n');
}
```

---

## Phase 2: Core Commands

### T-2.1: Update `tags top` command

**File**: `src/commands/tags.ts`

**Default (Unix)**:
```
meeting	2245
todo	945
```

**Pretty**:
```
🏷️  Top 10 supertags by usage

  Rank  Tag                 Count
  ────────────────────────────────
  1     #meeting            2,245
```

---

### T-2.2: Update `search` command (FTS)

**File**: `src/commands/search.ts`

**Default (Unix)**:
```
AInt1f2QagVo	"meeting" : "#meeting"	meeting
```

**Pretty**:
```
🔍 Search results for "meeting" (5 matches, 0.023s)

  ID            Name                              Context
  ──────────────────────────────────────────────────────────────
```

---

### T-2.3: Update `search --semantic` output

**File**: `src/commands/search.ts`

**Default (Unix)**:
```
0.568	AdUwSzNV6OYq	Productivity	topic
```

**Pretty**:
```
🔍 Semantic search: "productivity" (3 results)

  Score   Name                        Context
```

---

### T-2.4: Update `search --tag --show` output

**File**: `src/commands/search.ts` + `src/commands/show.ts`

**Default (Unix)**:
```
---
id: 1ryEsECcazvL
name: Mit Base Vision...
tags: todo
created: 2025-12-17
Status: Later
```

**Pretty**: Card-style with box-drawing separators

---

### T-2.5: Update `stats` command

**File**: `src/commands/stats.ts`

**Default (Unix)**:
```
nodes	1346720
supertags	576
embed_model	bge-m3
```

**Pretty**: Grouped sections with visual hierarchy

---

### T-2.6: Update `workspace list` command

**File**: `src/commands/workspace.ts`

**Default (Unix)**:
```
main	M9rkJkwuED	indexed	1346720	default
books	u-5GVx_8nTUj	indexed	42156
```

**Pretty**: Table with asterisk for default

---

## Phase 3: Secondary Commands

### T-3.1: Update `server status` command

**File**: `src/commands/server.ts`

**Default (Unix)**:
```
stopped
```
or
```
running	3100	12345	9240
```

**Pretty**: Status icons, endpoint list, helpful commands

---

### T-3.2: Update `embed config --show` command

**File**: `src/commands/embed.ts`

**Default (Unix)**:
```
model	bge-m3
provider	ollama
status	connected
```

**Pretty**: 🧠 emoji, connection status check

---

### T-3.3: Update `nodes show` command

**File**: `src/commands/show.ts`

Consistent with `search --show` format

---

## Phase 4: Polish

### T-4.1: Add --verbose flag behavior

**Files**: Multiple command files

- `--verbose` in search: shows IDs, ranks, timing
- `--verbose` in tags: shows tag IDs
- Document in help text

---

### T-4.2: Add tips (--pretty only)

```typescript
// Only show tips in --pretty mode
if (options.pretty && !options.show && results.length > 0) {
  console.log(tip('Use --show for full node content'));
}
```

---

## Task Dependencies

```
T-1.1 ─┬─> T-1.2 ─> T-1.3 ─┬─> T-2.1 ─> T-2.2 ─> T-2.3 ─> T-2.4
                           │
                           └─> T-2.5 ─> T-2.6 ─> T-3.1 ─> T-3.2 ─> T-3.3
                                                                      │
                                                         T-4.1 ─> T-4.2
```

---

## Verification Checklist

After each task:
- [ ] `bun test` passes
- [ ] Default output is TSV, pipe-friendly
- [ ] `--pretty` output has emojis and formatting
- [ ] `--json` output unchanged
- [ ] `--human-dates` shows localized dates
- [ ] Help text updated if flags added

---

## Files Changed Summary

| File | Tasks |
|------|-------|
| `src/utils/format.ts` (new) | T-1.1, T-1.3 |
| `tests/utils/format.test.ts` (new) | T-1.1, T-1.3 |
| `src/cli.ts` | T-1.2 |
| `src/commands/tags.ts` | T-2.1 |
| `src/commands/search.ts` | T-2.2, T-2.3, T-2.4 |
| `src/commands/show.ts` | T-2.4, T-3.3 |
| `src/commands/stats.ts` | T-2.5 |
| `src/commands/workspace.ts` | T-2.6 |
| `src/commands/server.ts` | T-3.1 |
| `src/commands/embed.ts` | T-3.2 |

---

## Breaking Changes

This is a **breaking change** for users parsing current output. Migration:

| Before | After |
|--------|-------|
| Parse emoji-prefixed output | Use default TSV or `--json` |
| Rely on current format | Add `--pretty` for old behavior |
| Parse dates as `12/17/2025` | Dates now ISO `2025-12-17` |
