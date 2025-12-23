# Output Formatting Specification

**Feature**: Consistent, Professional CLI Output Formatting
**Status**: Draft
**Created**: 2025-12-23

## Overview

This specification defines improvements to supertag-cli's terminal output formatting following Unix philosophy: **plain, pipe-friendly output by default** with optional human-friendly formatting.

## Output Modes

### Default Mode (Unix-style)
- Tab-separated values (TSV) for tabular data
- No emojis, no box-drawing, no color
- One record per line
- Suitable for `grep`, `awk`, `cut`, `sort`, pipes
- Machine-parseable without `--json`

### `--pretty` Mode
- Emojis for visual categorization
- Box-drawing characters for structure
- Aligned columns with headers
- Human-optimized, not for piping

### `--json` Mode
- Full structured data
- For programmatic consumption

## Date Formatting

### `--iso-dates` (DEFAULT)
- ISO 8601 format: `2025-12-17`
- Sortable, unambiguous, international

### `--human-dates`
- Localized format: `Dec 17, 2025`
- Relative when recent: `2 hours ago`

## Current State vs. Target State

### 1. Search Results

**Current Output:**
```
🔍 Search results for "meeting" (5):

1. "meeting" : "#meeting",
   ID: AInt1f2QagVo
   Rank: -7.89

2. Meeting, Meeting, Marathon.
   ID: 8eIlbhwi2QFz
   Rank: -7.67
```

**Target Output (default - Unix style):**
```
AInt1f2QagVo	"meeting" : "#meeting"	meeting
8eIlbhwi2QFz	Meeting, Meeting, Marathon
CLYvmr6p3S	Team Meeting	meeting
xWlLDlQYAn	Team Meeting - CSOC	meeting
hLeYi2zLJCpi	Zu unserem Treffportal-Meeting
```

**Target Output (`--pretty`):**
```
🔍 Search results for "meeting" (5 matches, 0.023s)

  ID            Name                              Context
  ──────────────────────────────────────────────────────────────
  AInt1f2QagVo  "meeting" : "#meeting"            #meeting
  8eIlbhwi2QFz  Meeting, Meeting, Marathon
  CLYvmr6p3S    Team Meeting                      #meeting
```

**Changes:**
- Default: TSV format (ID, Name, Context) - pipe to `cut -f2` for names only
- `--pretty`: Tabular layout with headers, emoji, timing
- Context column showing ancestor supertag (empty if none)

---

### 2. Tags Top

**Current Output:**
```
🏷️  Top 10 supertags by usage:

1. #meeting (2245 nodes)
2. #todo (945 nodes)
3. #spanish-sentence (869 nodes)
```

**Target Output (default - Unix style):**
```
meeting	2245
todo	945
spanish-sentence	869
person	804
day	708
```

**Target Output (`--pretty`):**
```
🏷️  Top 10 supertags by usage

  Rank  Tag                 Count
  ────────────────────────────────
  1     #meeting            2,245
  2     #todo                 945
  3     #spanish-sentence     869
  4     #person               804
  5     #day                  708

  ... and 571 more supertags
```

**Changes:**
- Default: TSV (tag, count) - no `#` prefix, raw numbers
- `--pretty`: Ranked table with thousands separators
- Unix: `supertag tags top | sort -t$'\t' -k2 -nr` to re-sort by count

---

### 3. Search with --show

**Current Output:**
```
🏷️  Nodes tagged with #todo (2):

📄 Mit Base Vision über komplementäre 24/7... #todo
   Created: 12/17/2025
   Fields:
   - ⚙️ Status:: Later
   - ⚙️ Vault:: Execute Stream Storage
   - ⚙️ Origin:: FW: Switch Community...
```

**Target Output (default - Unix style):**
```
---
id: 1ryEsECcazvL
name: Mit Base Vision über komplementäre 24/7...
tags: todo
created: 2025-12-17
Status: Later
Vault: Execute Stream Storage
Origin: FW: Switch Community...
---
id: xyz789abc
name: Do Design Course
tags: todo
created: 2025-12-17
Status: Later
Due date: 2025-12-17
children: Work
```

**Target Output (`--pretty`):**
```
🏷️  Nodes tagged #todo (2 results)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#todo  Mit Base Vision über komplementäre 24/7...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Status:   Later
  Vault:    Execute Stream Storage
  Origin:   FW: Switch Community...
  Created:  Dec 17, 2025

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#todo  Do Design Course
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Status:   Later
  Due:      Dec 17, 2025
  Children:
    • Work
```

**Target Output (`--pretty --human-dates`):**
Same as `--pretty` but dates show as `Dec 17, 2025`

**Changes:**
- Default: YAML-like record format, `---` separators (grep-friendly)
- ISO dates by default (`2025-12-17`)
- `--human-dates` for localized dates
- `--pretty`: Card-style with box-drawing, aligned fields

---

### 4. Semantic Search

**Current Output:**
```
🔍 Searching: "productivity" [main]

Results:

  56.8%  Productivity #topic
        ID: AdUwSzNV6OYq
  49.3%  Productivity pain
        ID: KiuZeSN6LhfV
```

**Target Output (default - Unix style):**
```
0.568	AdUwSzNV6OYq	Productivity	topic
0.493	KiuZeSN6LhfV	Productivity pain
0.472	V-MELNZAVkmw	Also produktiv
```

**Target Output (`--pretty`):**
```
🔍 Semantic search: "productivity" (3 results)

  Score   Name                        Context
  ──────────────────────────────────────────────────────
  56.8%   Productivity                #topic
  49.3%   Productivity pain
  47.2%   Also produktiv

💡 Tip: Use --show for full node content
```

**Changes:**
- Default: TSV (score as decimal, ID, name, context)
- Scores as decimals (0.568) for sorting: `sort -t$'\t' -k1 -nr`
- `--pretty`: Percentage display, tips

---

### 5. Workspace List

**Current Output:**
```
Configured workspaces:

  ✓ main (default)
      rootFileId: M9rkJkwuED
      database: exists

  ✓ books
      rootFileId: u-5GVx_8nTUj
      database: exists
```

**Target Output (default - Unix style):**
```
main	M9rkJkwuED	indexed	1346720	default
books	u-5GVx_8nTUj	indexed	42156
```

**Target Output (`--pretty`):**
```
📂 Configured workspaces

  Alias     ID            Status    Nodes
  ─────────────────────────────────────────────
  main *    M9rkJkwuED    indexed   1,346,720
  books     u-5GVx_8nTUj  indexed      42,156

* default workspace
```

**Changes:**
- Default: TSV (alias, id, status, node_count, [default])
- Raw numbers for scripting
- `--pretty`: Formatted table with legend

---

### 6. Stats

**Current Output:**
```
📊 Database Statistics [main]:

   Total Nodes: 1,346,720
   Total Supertags: 576
   Total Fields: 1,194
   Total References: 23,319

📊 Embedding Statistics [main]:

   Storage: LanceDB (via resona)
   Model: bge-m3
   Dimensions: 1024
   Total: 784,756
   Coverage: 784756/599230 (131.0%)
```

**Target Output (default - Unix style):**
```
nodes	1346720
supertags	576
fields	1194
references	23319
embeddings	784756
embed_model	bge-m3
embed_dimensions	1024
embed_coverage	1.31
```

**Target Output (`--pretty`):**
```
📊 Statistics [main]

  Database
  ────────────────────────────
  Nodes:       1,346,720
  Supertags:         576
  Fields:          1,194
  References:     23,319

  Embeddings (bge-m3)
  ────────────────────────────
  Indexed:       784,756
  Coverage:        131.0%
  Dimensions:      1,024
```

**Changes:**
- Default: Key-value pairs (TSV), one per line
- Coverage as decimal (1.31 = 131%)
- Easy to grep: `supertag stats | grep nodes`
- `--pretty`: Grouped sections with visual hierarchy

---

### 7. Server Status

**Current Output:**
```
❌ Server is not running
```
(or when running, presumably similar plain text)

**Target Output (default - Unix style, not running):**
```
stopped
```

**Target Output (default - Unix style, running):**
```
running	3100	12345	9240
```
(status, port, pid, uptime_seconds)

**Target Output (`--pretty`, not running):**
```
⏹️  Server status: stopped

  Start with: supertag server start --port 3100
```

**Target Output (`--pretty`, running):**
```
▶️  Server status: running

  Port:       3100
  PID:        12345
  Uptime:     2h 34m

  Endpoints:
    • GET  /health
    • POST /search
    • POST /semantic-search
    • GET  /stats

  Stop with: supertag server stop
```

**Changes:**
- Default: Single word status, or TSV if running
- Uptime in seconds for scripting
- `--pretty`: Status icons, helpful commands, endpoint list

---

### 8. Embed Config

**Current Output:**
```
🔍 Embedding Configuration

Model:       bge-m3
Dimensions:  1024
Endpoint:    http://localhost:11434

Provider:    Ollama (via resona/LanceDB)
```

**Target Output (default - Unix style):**
```
model	bge-m3
provider	ollama
endpoint	http://localhost:11434
dimensions	1024
status	connected
```

**Target Output (`--pretty`):**
```
🧠 Embedding Configuration

  Model:       bge-m3
  Provider:    Ollama
  Endpoint:    http://localhost:11434
  Dimensions:  1,024

  Status: ✅ Connected
```

**Changes:**
- Default: Key-value TSV pairs
- Status as simple string (connected/disconnected/unconfigured)
- `--pretty`: Emoji, formatted display, status icon

---

## Design Principles

### 1. Unix Philosophy First
Default output follows Unix conventions:
- **One record per line** - easy to `wc -l`
- **Tab-separated values** - works with `cut`, `awk`, `sort`
- **No decoration** - no emojis, box-drawing, colors
- **Raw values** - numbers without separators, decimals not percentages
- **Predictable structure** - same columns every time

### 2. Zero Dependencies
Continue using plain JavaScript/TypeScript. No chalk, picocolors, cli-table, etc.

### 3. Global Flags

| Flag | Effect |
|------|--------|
| `--pretty` | Human-friendly output with emojis, tables, tips |
| `--no-pretty` | Force Unix output (overrides config) |
| `--json` | Full structured JSON output |
| `--iso-dates` | ISO 8601 dates: `2025-12-17` (DEFAULT) |
| `--human-dates` | Localized dates: `Dec 17, 2025` |
| `--verbose` | Include technical details (IDs, ranks, timing) |

### 4. Config-Based Defaults

Users can set `--pretty` as default via config:

```bash
supertag config --set output.pretty=true
supertag config --set output.humanDates=true
```

**Config file** (`~/.config/supertag/config.json`):
```json
{
  "output": {
    "pretty": true,
    "humanDates": false
  }
}
```

**Precedence** (highest to lowest):
1. CLI flags (`--pretty`, `--no-pretty`)
2. Config file (`output.pretty`)
3. Built-in default (Unix/TSV)

### 5. Date Formatting
- **Default (`--iso-dates`)**: `2025-12-17` - sortable, unambiguous
- **`--human-dates`**: `Dec 17, 2025` or `2 hours ago` for recent

### 6. Number Formatting
- **Default (Unix)**: Raw numbers `1346720`
- **`--pretty`**: Thousands separators `1,346,720`
- **Percentages**: Decimals in default (`0.568`), percent in pretty (`56.8%`)

### 7. Unicode Box Drawing (`--pretty` only)
Use Unicode box-drawing characters for visual structure:
- `─` horizontal line (U+2500)
- `━` heavy horizontal (U+2501)
- `│` vertical line (U+2502)

### 8. Standardized Emoji Usage (`--pretty` only)

| Category | Emoji | Usage |
|----------|-------|-------|
| Search | 🔍 | Search operations |
| Tags | 🏷️ | Supertag-related |
| Stats | 📊 | Statistics, counts |
| Database | 💾 | Database operations |
| Success | ✅ | Completion, validation |
| Error | ❌ | Failure, missing |
| Warning | ⚠️ | Caution, attention |
| Workspace | 📂 | Workspace operations |
| Embeddings | 🧠 | AI, semantic, embeddings |
| Server | ▶️/⏹️ | Running/Stopped |
| Node | 📄 | Individual node content |
| Tip | 💡 | Helpful suggestions |

### 9. Progressive Disclosure
- **Default**: Unix-style, pipe-friendly
- **`--pretty`**: Human-friendly with visual hierarchy
- **`--show`**: Expanded node details
- **`--verbose`**: Technical details (IDs, ranks, timing)
- **`--json`**: Full structured data

---

## Implementation Architecture

### New File: `src/utils/format.ts`

```typescript
// Output mode detection
export interface OutputOptions {
  pretty?: boolean;
  json?: boolean;
  humanDates?: boolean;
  verbose?: boolean;
}

// Constants (only used in --pretty mode)
export const EMOJI = {
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

// Unix-style output
export function tsv(...fields: (string | number | undefined)[]): string;
export function tsvHeader(...fields: string[]): string; // Only in --pretty

// Date formatting
export function formatDate(date: Date | string, human?: boolean): string;
export function formatDateISO(date: Date | string): string;      // 2025-12-17
export function formatDateHuman(date: Date | string): string;    // Dec 17, 2025
export function formatDateRelative(date: Date | string): string; // 2 hours ago

// Number formatting
export function formatNumber(n: number, pretty?: boolean): string;
export function formatPercentage(n: number, pretty?: boolean): string;

// Pretty-mode utilities
export function padLeft(s: string, width: number): string;
export function padRight(s: string, width: number): string;
export function divider(char?: string, width?: number): string;
export function header(emoji: string, title: string): string;
export function table(headers: string[], rows: string[][], options?: TableOptions): string;
export function field(name: string, value: string, indent?: number): string;
export function tip(message: string): string;

// Record output (for --show)
export function record(fields: Record<string, string | undefined>): string;
```

### Global Options Registration

```typescript
// In src/cli.ts or similar
program
  .option('--pretty', 'Human-friendly output with formatting')
  .option('--json', 'JSON output')
  .option('--iso-dates', 'ISO 8601 date format (default)')
  .option('--human-dates', 'Human-readable date format')
  .option('--verbose', 'Include technical details');
```

### Migration Strategy

1. Create `src/utils/format.ts` with all utilities
2. Register global flags in CLI
3. Update commands one at a time:
   - Add Unix-style default output
   - Move current output to `--pretty` branch
4. Maintain backward compatibility for `--json`

---

## Command-by-Command Changes

| Command | Priority | Effort | Changes |
|---------|----------|--------|---------|
| `search` | High | Medium | Tabular output, timing, context column |
| `tags top` | High | Low | Tabular output, thousands separators |
| `search --tag --show` | High | Medium | Card-style separators, aligned fields |
| `stats` | Medium | Low | Grouped sections, aligned numbers |
| `workspace list` | Medium | Low | Tabular with node counts |
| `server status` | Medium | Low | Status icons, endpoints list |
| `embed config` | Low | Low | Connection status check |
| `nodes show` | Medium | Medium | Consistent with search --show |

---

## Success Criteria

1. All output follows consistent formatting patterns
2. No external dependencies added
3. All commands support `--json` for scripts
4. `--verbose` flag available for technical details
5. Numbers formatted with thousands separators
6. Tabular data uses column alignment
7. Visual hierarchy via emoji + box-drawing
8. Tests verify output format consistency

---

## Out of Scope

- Color output (would require dependency or ANSI codes)
- Interactive/TUI elements
- Progress bars (existing approach is fine)
- Help text formatting (Commander.js handles this)

---

## Decisions Made

1. **Color support**: Not in this version. May add `--color/--no-color` later.
2. **Quiet mode**: Not needed - Unix output is already minimal.
3. **Output versioning**: Not needed - TSV format is stable.
4. **Date format default**: ISO 8601 (`--iso-dates` is default, `--human-dates` opt-in)
5. **Default output style**: Unix (TSV, no emojis) - `--pretty` for human-friendly

## Unix Pipeline Examples

```bash
# Count todos
supertag search "" --tag todo | wc -l

# Get just node names
supertag search "meeting" | cut -f2

# Sort tags by count (descending)
supertag tags top --limit 100 | sort -t$'\t' -k2 -nr

# Find high-similarity semantic matches
supertag search "AI" --semantic | awk -F'\t' '$1 > 0.7'

# Get node count for main workspace
supertag stats | grep '^nodes' | cut -f2

# Check if server is running (for scripts)
if [ "$(supertag server status)" = "running" ]; then
  echo "Server is up"
fi

# Export all meeting IDs to a file
supertag search "" --tag meeting | cut -f1 > meeting-ids.txt
```
