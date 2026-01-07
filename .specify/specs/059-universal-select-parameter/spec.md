---
id: "059"
feature: "Universal Select Parameter"
status: "completed"
created: "2026-01-01"
completed: "2026-01-01"
---

# Specification: Universal Select Parameter

## Overview

Add a `--select` parameter to all query commands (CLI) and tools (MCP) that allows users to specify which fields to return in results. This reduces output verbosity by up to 80%, saving tokens for AI agents and reducing noise for CLI users.

## User Scenarios

### Scenario 1: AI Agent Minimizing Token Usage

**As an** AI agent using MCP tools
**I want to** request only the fields I need
**So that** I reduce token consumption and stay within context limits

**Acceptance Criteria:**
- [ ] `tana_search` accepts `select` parameter with array of field names
- [ ] `tana_tagged` accepts `select` parameter
- [ ] `tana_semantic_search` accepts `select` parameter
- [ ] `tana_node` accepts `select` parameter
- [ ] Response only includes requested fields
- [ ] Requesting non-existent fields returns null/undefined, not error

### Scenario 2: CLI User Piping to Other Commands

**As a** CLI user
**I want to** get only node IDs for piping to other commands
**So that** I can compose shell workflows efficiently

**Acceptance Criteria:**
- [ ] `supertag search --select id` returns only IDs
- [ ] `supertag search --select id,name` returns ID and name
- [ ] Output is clean (no extra formatting) when selecting specific fields
- [ ] Works with all output formats (json, table, csv)

### Scenario 3: Selecting Nested Fields

**As a** user querying node details
**I want to** select nested field values
**So that** I can get specific Tana field data without full node contents

**Acceptance Criteria:**
- [ ] `--select fields.Status` returns only the Status field value
- [ ] `--select name,fields.Priority,fields.Due` returns multiple nested fields
- [ ] Dot notation works for `fields.*`, `tags`, `ancestor.*`
- [ ] Invalid nested paths return null, not error

## Functional Requirements

### FR-1: Select Parameter Syntax

The select parameter accepts a comma-separated list of field paths.

**Validation:**
- `--select id,name` → returns `{id: "...", name: "..."}`
- `--select fields.Status` → returns `{fields: {Status: "..."}}`
- Empty select → returns all fields (current behavior)

### FR-2: Consistent Across All Query Tools

All query tools/commands must support the select parameter identically.

**Validation:**
- `tana_search`, `tana_tagged`, `tana_semantic_search`, `tana_node`, `tana_field_values` all accept `select`
- CLI commands `search`, `nodes show`, `tags` all accept `--select`
- Same field paths work across all tools

### FR-3: Field Path Resolution

Support dot notation for nested field access.

**Validation:**
- `id` → top-level id field
- `name` → top-level name field
- `fields.Status` → Status value from fields object
- `ancestor.name` → ancestor's name
- `tags` → array of tag names
- `children.name` → array of children names (when depth > 0)

### FR-4: Type Preservation

Selected fields maintain their original types.

**Validation:**
- `created` returns Date object (or ISO string in JSON)
- `tags` returns array even if selecting single path
- Numeric fields return numbers, not strings

## Non-Functional Requirements

- **Performance:** Select should reduce response serialization time (fewer fields to serialize)
- **Backwards Compatibility:** Omitting select returns all fields (existing behavior)
- **Error Handling:** Invalid field paths return null, don't throw errors

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| SelectPath | A dot-notation field path | `path: string`, `segments: string[]` |
| SelectProjection | The projection to apply | `paths: SelectPath[]`, `includeAll: boolean` |

## Success Criteria

- [ ] 80% reduction in response size when using `--select id,name` vs full response
- [ ] All 5 main query tools support select parameter
- [ ] Nested field selection works for `fields.*` paths
- [ ] No breaking changes to existing queries without select

## Assumptions

- Field names don't contain dots (safe for dot notation)
- Users know the field names they want to select
- JSON output format is the primary target for field selection

## Out of Scope

- Computed/derived fields (e.g., `fullPath`, `depth`)
- Field aliasing (e.g., `--select name:title`)
- Exclusion syntax (e.g., `--select !children`)
- Wildcard patterns (e.g., `--select fields.*`)
