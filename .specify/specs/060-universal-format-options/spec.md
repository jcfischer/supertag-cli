---
id: "060"
feature: "Universal Format Options"
status: "draft"
created: "2026-01-01"
---

# Specification: Universal Format Options

## Overview

Standardize output formatting across all CLI commands with a universal `--format` flag supporting multiple output modes: json, table, csv, ids, minimal, and jsonl. This enables better shell composability and consistent user experience.

## User Scenarios

### Scenario 1: Shell Pipeline Integration

**As a** CLI power user
**I want to** get just node IDs from a search
**So that** I can pipe them to other commands like `xargs`

**Acceptance Criteria:**
- [ ] `supertag search "project" --format ids` outputs one ID per line
- [ ] Output has no headers, decorations, or extra formatting
- [ ] Works with `xargs`: `supertag search "x" --format ids | xargs supertag nodes show`

### Scenario 2: Spreadsheet Export

**As a** user exporting data
**I want to** get CSV output
**So that** I can open results in Excel or import to other tools

**Acceptance Criteria:**
- [ ] `supertag search "meeting" --format csv` outputs valid CSV
- [ ] First row contains column headers
- [ ] Fields with commas/quotes are properly escaped
- [ ] Nested fields are flattened or JSON-stringified

### Scenario 3: Human-Readable Display

**As a** casual CLI user
**I want to** see results in a readable table format
**So that** I can quickly scan results without parsing JSON

**Acceptance Criteria:**
- [ ] `supertag search "task" --format table` displays aligned columns
- [ ] Long values are truncated with ellipsis
- [ ] Table width adapts to terminal width
- [ ] Colors are used for better readability (when TTY)

### Scenario 4: Streaming Large Results

**As a** user processing large result sets
**I want to** get JSON Lines output
**So that** I can process results one-by-one without loading all into memory

**Acceptance Criteria:**
- [ ] `supertag search "note" --format jsonl` outputs one JSON object per line
- [ ] Each line is valid, parseable JSON
- [ ] Works with `jq` streaming: `supertag search "x" --format jsonl | jq -c .name`

### Scenario 5: Minimal JSON for Scripts

**As a** script author
**I want to** get minimal JSON with just essential fields
**So that** I can reduce parsing complexity and data size

**Acceptance Criteria:**
- [ ] `--format minimal` returns only `id`, `name`, and `tags`
- [ ] No nested objects, children, or full field data
- [ ] Consistent structure regardless of query type

## Functional Requirements

### FR-1: Supported Format Types

The system must support these format types:

| Format | Output | Use Case |
|--------|--------|----------|
| `json` | Pretty-printed JSON array | Default, human-readable JSON |
| `table` | ASCII table with headers | Terminal display |
| `csv` | RFC 4180 compliant CSV | Spreadsheet import |
| `ids` | One ID per line, no decoration | Shell piping |
| `minimal` | JSON with only id, name, tags | Lightweight scripting |
| `jsonl` | JSON Lines (one object per line) | Streaming processing |

**Validation:** Each format produces valid, parseable output for its type.

### FR-2: Universal Application

All query commands must support the --format flag:

**Validation:**
- `supertag search` supports all formats
- `supertag nodes show` supports all formats
- `supertag nodes recent` supports all formats
- `supertag tags list` supports all formats
- `supertag fields query` supports all formats
- `supertag transcript list` supports all formats

### FR-3: Default Format Logic

Smart defaults based on context:

**Validation:**
- TTY (interactive terminal): default to `table`
- Pipe (stdout not TTY): default to `json`
- Explicit `--format` always overrides default
- `SUPERTAG_FORMAT` env var sets global default

### FR-4: Table Format Features

Table format must be readable and adaptive:

**Validation:**
- Columns auto-size based on content
- Max width respects terminal width (`$COLUMNS`)
- Long text truncated with `...`
- Unicode box-drawing characters for borders (optional)
- `--no-header` suppresses header row

### FR-5: CSV Escaping

CSV must handle special characters correctly:

**Validation:**
- Fields containing commas are quoted
- Fields containing quotes have quotes doubled
- Fields containing newlines are quoted
- Empty fields output as empty (not "null")

## Non-Functional Requirements

- **Performance:** Format conversion adds < 10ms overhead
- **Compatibility:** CSV follows RFC 4180, JSON follows RFC 8259
- **Accessibility:** Table format works in screen readers (simple ASCII mode)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| OutputFormat | Enum of format types | `json`, `table`, `csv`, `ids`, `minimal`, `jsonl` |
| Formatter | Format implementation | `format(data: any[]): string` |
| FormatConfig | Per-format settings | `headers: boolean`, `maxWidth: number` |

## Success Criteria

- [ ] All 6 format types implemented and documented
- [ ] All query commands support --format flag
- [ ] Smart defaults work (table for TTY, json for pipe)
- [ ] CSV exports open correctly in Excel/Google Sheets
- [ ] `--format ids | xargs` pattern works reliably

## Assumptions

- Terminal supports UTF-8
- Users understand format tradeoffs (table loses data fidelity)
- CSV consumers handle quoted fields correctly

## Out of Scope

- Custom format templates (e.g., `--format "{{name}}: {{id}}"`)
- Binary formats (protobuf, msgpack)
- XML output format
- Markdown table format
- HTML output format
