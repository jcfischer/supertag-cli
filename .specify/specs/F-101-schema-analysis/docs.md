# F-101: Schema Analysis

## Summary

Schema analysis adds automated health checks to supertag-cli. The `supertag schema audit` command and `tana_schema_audit` MCP tool analyze workspace supertag schemas for redundancy, inconsistency, and quality issues. Seven pluggable detectors scan for orphan tags, low-usage tags, duplicate fields, type mismatches, unused fields, low fill rates, and missing inheritance opportunities. Each finding includes severity level, affected tags, and actionable fix suggestions.

No new dependencies were added — the feature builds entirely on existing SQLite infrastructure (supertag_fields, tag_applications, field_values tables) and the SupertagMetadataService.

## Architecture

```
CLI/MCP Entry Points
  supertag schema audit [options]  |  tana_schema_audit MCP tool
                    |                          |
                    v                          v
              SchemaAuditService
  loadWorkspaceSchema() -> runDetectors() -> formatReport()
                    |
    +---------------+---------------+
    v               v               v
  Detector        Detector        Detector
  Registry        Pipeline        Results
  - orphan-tags   1. Load         - findings[]
  - low-usage     2. Analyze      - severity
  - duplicate-    3. Score        - suggestions
    fields        4. Report
  - type-mismatch
  - unused-fields
  - fill-rate
  - missing-inheritance
```

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `src/types/schema-audit.ts` | Core types: SchemaFinding, SchemaDetector, WorkspaceSchema, SchemaAuditReport |
| `src/services/schema-audit-loader.ts` | WorkspaceSchema loader from SQLite (supertag_fields, tag_applications, field_values) |
| `src/services/schema-audit-detectors.ts` | 7 detector implementations: orphan, low-usage, duplicate, type-mismatch, unused, fill-rate, missing-inheritance |
| `src/services/schema-audit-registry.ts` | Detector registry and `runDetectors()` orchestrator |
| `src/services/schema-audit-service.ts` | Main SchemaAuditService: load schema, run detectors, format report |
| `src/services/schema-audit-docs.ts` | Markdown documentation generator for workspace schemas |
| `src/commands/schema.ts` | CLI command: `supertag schema audit` with severity/tag/fix/docs options |
| `src/mcp/tools/schema-audit.ts` | MCP tool handler: `tana_schema_audit` |
| `tests/schema-audit-loader.test.ts` | Loader unit tests (in-memory SQLite fixtures) |
| `tests/schema-audit-detectors.test.ts` | Detector tests (3+ cases per detector) |
| `tests/schema-audit-service.test.ts` | Service orchestration tests |
| `tests/schema-audit-docs.test.ts` | Documentation generator tests |

### Modified Files

| File | Change |
|------|--------|
| `src/mcp/index.ts` | Added `tana_schema_audit` tool definition and case handler |
| `src/mcp/schemas.ts` | Added `schemaAuditSchema` Zod definition |
| `src/mcp/tool-mode.ts` | Added `tana_schema_audit` to LITE_MODE_TOOLS and LITE_TOOL_MAPPING |
| `src/mcp/tool-registry.ts` | Added TOOL_METADATA and TOOL_SCHEMAS entries |
| `tests/mcp-lite-mode.test.ts` | Updated tool counts for lite mode (20 tools) |

## Detectors

| Detector | Severity | Trigger |
|----------|----------|---------|
| orphan-tags | warning | Tags with 0 instances (excludes system types) |
| low-usage-tags | info | Tags with 1-2 instances |
| duplicate-fields | warning | Same field name on unrelated tags (no inheritance link) |
| type-mismatch | error | Same field name with different inferred data types |
| unused-fields | info | Fields with 0% fill rate |
| fill-rate | info | Fields with <10% fill rate |
| missing-inheritance | info | 3+ identical fields on 2 tags without common parent |

## CLI Usage

```bash
# Full audit
supertag schema audit

# Filter by severity
supertag schema audit --severity warning

# Audit specific tag
supertag schema audit --tag meeting

# Generate fix suggestions (Tana Paste)
supertag schema audit --fix

# Generate schema documentation
supertag schema audit --docs
```

## MCP Tool

The `tana_schema_audit` tool is in lite mode (read-only, complements tana-local). Parameters: `workspace?`, `tag?`, `severity?`, `includeFixes?`, `generateDocs?`.
