# Specification: F-099 Bulk Field Extractor

## Context
> Identified as Tier 1 (high impact, buildable now) in the Tana Graph DB analysis.
> Makes the "supertags as database tables" metaphor concrete by exporting all instances of a supertag as a resolved table.

## Problem Statement

**Core Problem**: Extracting structured data from Tana for analysis requires N+1 queries — one to find all instances of a supertag, then one per instance to extract field values. There's no single command to export all instances of a type as a table with resolved field values.

**Current State**:
- `supertag fields values <field-name>` extracts values for one field across instances
- `supertag search --tag <tag>` finds all instances of a supertag
- `supertag nodes show <id>` reads individual nodes with fields
- No batch "export all instances with all fields resolved" operation
- Cross-reference fields (instance fields pointing to other nodes) return raw IDs, not resolved names

**Impact if Unsolved**: Users can't easily export Tana data for spreadsheet analysis, AI reasoning, or backup. The "supertag as database table" paradigm stays theoretical. Claude Code can't efficiently reason over structured datasets stored in Tana.

## Users & Stakeholders

**Primary User**: Users who want tabular exports of their Tana structured data
- Expects: `supertag fields export --tag book` → table with all books and their fields
- Needs: resolved references, multiple output formats, complete field coverage

**Secondary**:
- AI agents needing structured data for analytical reasoning
- Data migration workflows (Tana → other tools)
- Reporting and visualization pipelines

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | `supertag fields export --tag <supertag>` exports all instances with all field values | Must |
| FR-2 | Each row is one instance, each column is one field from the supertag schema | Must |
| FR-3 | `--resolve-references` flag resolves instance field values from node IDs to node names (default: true) | Must |
| FR-4 | Support `--format json`, `--format csv`, `--format markdown` output modes | Must |
| FR-5 | JSON output includes both raw IDs and resolved names for reference fields | Should |
| FR-6 | `--fields <field1,field2,...>` flag to export only specific fields | Should |
| FR-7 | `--where <field>=<value>` basic filtering on field values | Should |
| FR-8 | `--limit <n>` and `--offset <n>` for pagination | Should |
| FR-9 | `--sort <field>` and `--direction asc|desc` for ordering | Should |
| FR-10 | MCP tool `tana_export` with same capabilities | Must |
| FR-11 | Markdown table output renders clean tables suitable for embedding in notes | Must |
| FR-12 | Handle multi-value fields (e.g., multiple assignees) as comma-separated in CSV, arrays in JSON | Must |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Export of 100 instances completes in < 5 seconds |
| NFR-2 | Memory usage stays under 100MB for exports up to 1000 instances |
| NFR-3 | CSV output is RFC 4180 compliant (proper quoting, escaping) |
| NFR-4 | Works with both Local API and SQLite backends |

## Architecture

### Export Pipeline

```
Input (--tag <supertag>)
  → Schema: get_tag_schema → field definitions (names, types, IDs)
  → Instances: search by tag → all instance node IDs
  → Extract: for each instance, read all field values (batched)
  → Resolve: for instance/reference fields, resolve ID → name
  → Filter: apply --where, --sort, --limit
  → Format: render as json/csv/markdown with proper column headers
```

### Batched Field Extraction

Instead of N queries (one per instance), batch field extraction:

```typescript
interface ExportRow {
  id: string;
  name: string;
  fields: Record<string, FieldExportValue>;
}

interface FieldExportValue {
  raw: string | string[];           // Raw value(s)
  resolved?: string | string[];     // Resolved reference names
  type: 'text' | 'number' | 'date' | 'url' | 'email' | 'checkbox' | 'options' | 'instance';
}
```

### Reference Resolution

For `instance` type fields (references to other nodes):
1. Collect all referenced node IDs across all instances
2. Batch-resolve: single query to get names for all IDs
3. Map back to export rows

This avoids N*M queries for N instances with M reference fields.

## Scope

### In Scope
- `supertag fields export` CLI command
- `tana_export` MCP tool
- JSON, CSV, and markdown table output formats
- Reference resolution (ID → name)
- Basic filtering, sorting, pagination
- Multi-value field handling

### Explicitly Out of Scope
- Nested field export (fields of referenced nodes)
- Export to file directly (use shell redirection: `> output.csv`)
- Import from CSV back into Tana
- Incremental/delta export

### Designed For But Not Implemented
- Export schedules / watch mode
- Cross-supertag joins (export books with their authors' details)
- Aggregation in export (COUNT, SUM, AVG per field)

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Supertag has no instances | Return empty table with header row only |
| Supertag has no fields defined | Export name and ID columns only |
| Field has no value for some instances | Empty cell in CSV, null in JSON, `-` in markdown |
| Instance field references deleted node | Show `[deleted:<id>]` in resolved output |
| Supertag with 5000+ instances | Pagination required; warn if no --limit set and count > 500 |
| Field name contains commas | Properly quoted in CSV output per RFC 4180 |
| Multi-value field with 20+ values | Truncate display in markdown/CSV to first 5 with "...+15 more"; full list in JSON |

## Success Criteria

- [ ] `supertag fields export --tag book --format json` returns all books with all fields
- [ ] `supertag fields export --tag person --format csv > people.csv` produces valid CSV
- [ ] `supertag fields export --tag project --format markdown` renders a clean markdown table
- [ ] Instance fields show resolved names, not raw node IDs
- [ ] `--fields "Author,Year"` limits output to those two columns
- [ ] `--where "Status=Read"` filters to only matching instances
- [ ] `tana_export` MCP tool returns identical content to CLI
- [ ] Multi-value fields render as comma-separated in CSV and arrays in JSON

## Dependencies

- F-097 (Live Read Backend) — for data access
- Existing `fields values` infrastructure — for field extraction logic
- Existing tag schema introspection — for field definitions

---
*Spec created: 2026-02-22*
