# Implementation Tasks: F-101 Schema Analysis

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ✅ | Types |
| T-1.2 | ✅ | Schema loader |
| T-1.3 | ✅ | Loader tests |
| T-1.4 | ✅ | Loader edge cases |
| T-2.1 | ✅ | Detector interface + registry |
| T-2.2 | ✅ | orphan-tags detector |
| T-2.3 | ✅ | low-usage-tags detector |
| T-2.4 | ✅ | duplicate-fields detector |
| T-2.5 | ✅ | type-mismatch detector |
| T-2.6 | ✅ | unused-fields detector |
| T-2.7 | ✅ | fill-rate detector |
| T-2.8 | ✅ | missing-inheritance detector |
| T-2.9 | ✅ | Detector tests |
| T-3.1 | ✅ | SchemaAuditService |
| T-3.2 | ✅ | Service tests |
| T-3.3 | ✅ | --tag filter |
| T-3.4 | ✅ | --fix Tana Paste generation |
| T-4.1 | ✅ | CLI command registration |
| T-4.2 | ✅ | CLI output formatting |
| T-4.3 | ✅ | CLI exit codes |
| T-4.4 | ✅ | CLI E2E tests |
| T-5.1 | ✅ | MCP tool definition |
| T-5.2 | ✅ | MCP schema + registry |
| T-5.3 | ✅ | MCP lite mode |
| T-5.4 | ✅ | MCP tests |
| T-6.1 | ✅ | Documentation generator |
| T-6.2 | ✅ | Docs tests |

## Group 1: Foundation — Types and Schema Loader

### T-1.1: Create type definitions [T]
- **File:** src/types/schema-audit.ts
- **Test:** (tested via T-1.3)
- **Dependencies:** none
- **Description:** Define TypeScript interfaces: SchemaFindingSeverity, SchemaFinding, SchemaDetector, WorkspaceSchema, SupertagInfo, FieldInfo, InheritanceRelation, TagApplicationCount, FieldValueStats, SchemaAuditReport. Follow types from plan.

### T-1.2: Implement WorkspaceSchema loader [T]
- **File:** src/services/schema-audit-loader.ts
- **Test:** tests/schema-audit-loader.test.ts
- **Dependencies:** T-1.1
- **Description:** Implement `loadWorkspaceSchema(db: Database): WorkspaceSchema`. Query supertag_fields for supertags and fields, tag_applications for instance counts, inheritance via SupertagMetadataService, and field fill-rate statistics from field_values. Use the fill-rate SQL from the plan.

### T-1.3: Loader unit tests [T]
- **File:** tests/schema-audit-loader.test.ts
- **Dependencies:** T-1.2
- **Description:** Test loading workspace with multiple supertags, correct instance counts, correct fill rates, empty workspace gracefully handled. Use in-memory SQLite fixtures.

### T-1.4: Loader edge cases [T]
- **File:** tests/schema-audit-loader.test.ts
- **Dependencies:** T-1.3
- **Description:** Test workspace with <5 tags, tags with 1000+ instances (sampling), fields inherited from parent tags, tags with special characters.

## Group 2: Detectors

### T-2.1: Detector registry and interface [T]
- **File:** src/services/schema-audit-registry.ts
- **Test:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-1.1
- **Description:** Implement DETECTOR_REGISTRY array and `runDetectors(schema, options?)` function. Support optional detector name filtering.

### T-2.2: orphan-tags detector [T] [P with T-2.3..T-2.8]
- **File:** src/services/schema-audit-detectors.ts
- **Test:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-2.1
- **Description:** Detect supertags with `instanceCount === 0`. Severity: warning. Exclude system types (docType, viewDef, tuple).

### T-2.3: low-usage-tags detector [T] [P with T-2.2,T-2.4..T-2.8]
- **File:** src/services/schema-audit-detectors.ts
- **Test:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-2.1
- **Description:** Detect supertags with `instanceCount < 3` (but > 0). Severity: info.

### T-2.4: duplicate-fields detector [T] [P with T-2.2,T-2.3,T-2.5..T-2.8]
- **File:** src/services/schema-audit-detectors.ts
- **Test:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-2.1
- **Description:** Same fieldName on 2+ unrelated tags (no inheritance link). Severity: warning. Must check inheritance relationship before flagging.

### T-2.5: type-mismatch detector [T] [P with T-2.2..T-2.4,T-2.6..T-2.8]
- **File:** src/services/schema-audit-detectors.ts
- **Test:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-2.1
- **Description:** Same fieldName with different inferredDataType across tags. Severity: error.

### T-2.6: unused-fields detector [T] [P with T-2.2..T-2.5,T-2.7,T-2.8]
- **File:** src/services/schema-audit-detectors.ts
- **Test:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-2.1
- **Description:** Fields with `fillRate === 0`. Severity: info.

### T-2.7: fill-rate detector [T] [P with T-2.2..T-2.6,T-2.8]
- **File:** src/services/schema-audit-detectors.ts
- **Test:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-2.1
- **Description:** Fields with `fillRate < 10`. Severity: info.

### T-2.8: missing-inheritance detector [T] [P with T-2.2..T-2.7]
- **File:** src/services/schema-audit-detectors.ts
- **Test:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-2.1
- **Description:** 3+ identical field names on 2 tags without common parent. Severity: info. Skip if workspace has <5 tags.

### T-2.9: Detector test suite [T]
- **File:** tests/schema-audit-detectors.test.ts
- **Dependencies:** T-2.2..T-2.8
- **Description:** Each detector has 3+ test cases (positive, negative, edge case). Use in-memory SQLite fixtures.

## Group 3: Service Orchestration

### T-3.1: SchemaAuditService [T]
- **File:** src/services/schema-audit-service.ts
- **Test:** tests/schema-audit-service.test.ts
- **Dependencies:** T-1.2, T-2.1
- **Description:** Main `SchemaAuditService` class with `audit(options?)` returning `SchemaAuditReport`. Orchestrates loader + detectors.

### T-3.2: Service tests [T]
- **File:** tests/schema-audit-service.test.ts
- **Dependencies:** T-3.1
- **Description:** Full audit returns expected findings structure. Test summary counts. Test empty workspace.

### T-3.3: Tag filter [T]
- **File:** src/services/schema-audit-service.ts
- **Test:** tests/schema-audit-service.test.ts
- **Dependencies:** T-3.1
- **Description:** `--tag` filter limits audit to specified tag and its hierarchy.

### T-3.4: Fix suggestions [T]
- **File:** src/services/schema-audit-service.ts
- **Test:** tests/schema-audit-service.test.ts
- **Dependencies:** T-3.1
- **Description:** `--fix` mode generates Tana Paste suggestions in each finding.

## Group 4: CLI Integration

### T-4.1: CLI command registration [T]
- **File:** src/commands/schema.ts
- **Test:** tests/schema-audit-e2e.test.ts
- **Dependencies:** T-3.1
- **Description:** Add `audit` subcommand to existing `schema` command. Use addStandardOptions() for workspace/format.

### T-4.2: CLI output formatting [T]
- **File:** src/commands/schema.ts
- **Test:** tests/schema-audit-e2e.test.ts
- **Dependencies:** T-4.1
- **Description:** Use createFormatter() for json/markdown/table output. Default: table with severity coloring.

### T-4.3: CLI exit codes [T]
- **File:** src/commands/schema.ts
- **Test:** tests/schema-audit-e2e.test.ts
- **Dependencies:** T-4.1
- **Description:** Exit 0 if no errors, exit 1 if error-severity findings found.

### T-4.4: CLI E2E tests [T]
- **File:** tests/schema-audit-e2e.test.ts
- **Dependencies:** T-4.1..T-4.3
- **Description:** CLI output matches expected format. Exit codes are correct. JSON output is valid.

## Group 5: MCP Tool

### T-5.1: MCP tool definition [T]
- **File:** src/mcp/tools/schema-audit.ts
- **Test:** tests/mcp/schema-audit.test.ts
- **Dependencies:** T-3.1
- **Description:** Define `tana_schema_audit` tool with parameters: workspace?, tag?, severity?, includeFixes?, generateDocs?.

### T-5.2: MCP schema and registry [T]
- **File:** src/mcp/schemas.ts, src/mcp/tool-registry.ts
- **Test:** tests/mcp/schema-audit.test.ts
- **Dependencies:** T-5.1
- **Description:** Add to MCP_TOOL_SCHEMAS, register handler in tool-registry dispatch.

### T-5.3: MCP lite mode [T]
- **File:** src/mcp/tool-mode.ts
- **Test:** tests/mcp/schema-audit.test.ts
- **Dependencies:** T-5.2
- **Description:** Add tana_schema_audit to LITE_MODE_TOOLS (read-only tool).

### T-5.4: MCP tests [T]
- **File:** tests/mcp/schema-audit.test.ts
- **Dependencies:** T-5.1..T-5.3
- **Description:** Returns valid JSON response. Filters by tag. Works in lite mode.

## Group 6: Documentation Generation

### T-6.1: Documentation generator [T]
- **File:** src/services/schema-audit-docs.ts
- **Test:** tests/schema-audit-docs.test.ts
- **Dependencies:** T-1.2
- **Description:** Implement `generateDocs()` returning markdown. Show supertags with instance counts, fields with fill rates, inheritance info, cross-references.

### T-6.2: Docs tests [T]
- **File:** tests/schema-audit-docs.test.ts
- **Dependencies:** T-6.1
- **Description:** Valid markdown output. Includes inheritance info. Shows fill rates.

## Execution Order

1. T-1.1 (foundation — no deps)
2. T-1.2, T-2.1 (can run in parallel — both depend only on T-1.1)
3. T-1.3, T-1.4, T-2.2..T-2.8 (can run in parallel)
4. T-2.9, T-3.1, T-6.1 (after groups 1 + 2)
5. T-3.2..T-3.4 (after T-3.1)
6. T-4.1..T-4.4 (after T-3.1)
7. T-5.1..T-5.4 (after T-3.1, can parallel with group 4)
8. T-6.2 (after T-6.1)
