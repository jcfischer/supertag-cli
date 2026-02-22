# Documentation: F-099 Bulk Field Extractor

## Summary

The Bulk Field Extractor adds a `supertag table <supertag>` CLI command and `tana_table` MCP tool that exports all instances of a supertag as a resolved table with field values.

## Files Changed

### New Files
| File | Purpose |
|------|---------|
| `src/db/table-export.ts` | Core export logic: batched extraction, reference resolution, formatting |
| `src/commands/table.ts` | CLI command: `supertag table <supertag>` with format/filter options |
| `src/mcp/tools/table.ts` | MCP tool: `tana_table` wrapping exportTable() |
| `tests/table-export.test.ts` | 27 unit tests for export logic |

### Modified Files
| File | Change |
|------|--------|
| `src/index.ts` | Register table command |
| `src/mcp/index.ts` | Add `tana_table` case handler |
| `src/mcp/schemas.ts` | Add `tableSchema` Zod schema |
| `src/mcp/tool-registry.ts` | Register `tana_table` metadata |
| `src/mcp/tool-mode.ts` | Add `tana_table` to lite mode tools |
| `src/services/field-resolver.ts` | Add `resolveFieldsRaw()` method with batch chunking |
| `tests/mcp-lite-mode.test.ts` | Updated tool counts (17 lite, 8 query) |

## Architecture

### Export Pipeline
```
Input (<supertag>)
  1. Schema: get field definitions for the supertag
  2. Instances: find all nodes with the tag
  3. Extract: batch-query field_values for all instance IDs (via FieldResolver)
  4. Resolve: batch-resolve referenced node IDs to names
  5. Filter/Sort: apply --where, --sort, --limit
  6. Format: return structured rows for rendering
```

### Key Design Decisions

1. **FieldResolver consolidation**: Reuses `FieldResolver.resolveFieldsRaw()` for field extraction instead of duplicating SQL. All field extraction goes through one service.

2. **Batch reference resolution**: Collects all unique node IDs across all rows, resolves in a single query (with 500-batch chunking for SQLite parameter limits).

3. **MCP lite mode inclusion**: `tana_table` is included in lite mode for AI agent access to structured data.

## CLI Usage

```bash
# Basic export (default table format)
supertag table person

# JSON export
supertag table book --format json

# CSV export to file
supertag table project --format csv > projects.csv

# Filter and sort
supertag table book --where "Status=Read" --sort "Year" --direction desc

# Specific fields only
supertag table person --fields "Email,Company" --limit 50

# Skip reference resolution
supertag table project --no-resolve
```

## MCP Tool

Tool name: `tana_table`
Category: query
Mode: full + lite

Parameters: supertag (required), fields, where, sort, direction, limit, offset, resolve_references
