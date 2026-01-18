# F-091 Documentation: Unified Field Format

## Overview

This feature unifies the field input format between MCP (nested) and CLI (flat) interfaces, allowing both to work interchangeably through a single normalization layer.

## Changes

### New Files

- `src/services/field-normalizer.ts` - Core normalization utility with `normalizeFieldInput()` function

### Modified Files

- `src/services/node-builder.ts` - Integrated field normalizer at entry point
- `src/commands/create.ts` - Uses shared normalizer for JSON input

## API Changes

### MCP `tana_create` Tool

**New supported format (nested - recommended):**
```json
{
  "supertag": "todo",
  "name": "My Task",
  "fields": {
    "Status": "In Progress",
    "Priority": "High"
  }
}
```

**Legacy format (flat - still supported):**
```json
{
  "supertag": "todo",
  "name": "My Task",
  "Status": "In Progress",
  "Priority": "High"
}
```

### CLI `--json` Input

Both formats now work identically:

```bash
# Flat format (existing)
supertag create todo --json '{"name": "Task", "Status": "Done"}'

# Nested format (new)
supertag create todo --json '{"name": "Task", "fields": {"Status": "Done"}}'
```

## Precedence Rules

When both nested and flat fields are present (mixed format):
- **Nested fields take precedence** over flat fields for the same key
- All fields are merged into the final output

Example:
```json
{
  "name": "Task",
  "Status": "Flat Value",
  "fields": {
    "Status": "Nested Value"
  }
}
```
Result: `Status = "Nested Value"`

## Reserved Keys

The following keys are never treated as fields at the top level:
- `name`, `title`, `label`, `heading`, `subject`, `summary`
- `supertag`, `children`, `target`, `workspace`, `dryRun`, `fields`

**Note:** Inside the nested `fields` object, these can be used as field names.

## Migration Guide

No migration needed. Existing code continues to work unchanged. The nested format is recommended for new integrations as it provides clearer separation between metadata and field values.
