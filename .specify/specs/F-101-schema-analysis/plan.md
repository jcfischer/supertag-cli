# Technical Plan: F-101 Schema Analysis

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CLI / MCP Entry Points                          │
│  supertag schema audit [options]    │    tana_schema_audit MCP tool      │
└─────────────────────────┬────────────────────────────┬───────────────────┘
                          │                            │
                          ▼                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        SchemaAuditService                                │
│  - loadWorkspaceSchema()    - runDetectors()    - formatReport()        │
└─────────────────────────┬────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Detector     │ │  Detector     │ │  Detector     │
│  Registry     │ │  Pipeline     │ │  Results      │
│               │ │               │ │               │
│ - orphan-tags │ │ 1. Load       │ │ - findings[]  │
│ - duplicate-  │ │ 2. Analyze    │ │ - severity    │
│   fields      │ │ 3. Score      │ │ - suggestions │
│ - type-       │ │ 4. Report     │ │               │
│   mismatch    │ │               │ │               │
│ - missing-    │ │               │ │               │
│   inheritance │ │               │ │               │
│ - unused-     │ │               │ │               │
│   fields      │ │               │ │               │
│ - low-usage   │ │               │ │               │
│ - fill-rate   │ │               │ │               │
└───────────────┘ └───────────────┘ └───────────────┘
        │                 │
        ▼                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      Existing Infrastructure                             │
│                                                                          │
│  ┌─────────────────────┐  ┌──────────────────────┐  ┌─────────────────┐ │
│  │ UnifiedSchemaService│  │SupertagMetadataService│  │ tag_applications│ │
│  │ - getSupertag()     │  │ - getFields()        │  │ (instance count)│ │
│  │ - searchSupertags() │  │ - getInheritanceTree│  │                 │ │
│  │ - getStats()        │  │ - getUsageStats()   │  │                 │ │
│  └─────────────────────┘  └──────────────────────┘  └─────────────────┘ │
│                                                                          │
│  ┌─────────────────────┐  ┌──────────────────────┐                      │
│  │ supertag_fields     │  │ field_values         │                      │
│  │ (field definitions) │  │ (field fill rates)  │                      │
│  └─────────────────────┘  └──────────────────────┘                      │
└──────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard, all existing commands use Bun |
| Database | SQLite (bun:sqlite) | Local-first, read-only audit, existing infrastructure |
| CLI | Commander.js | Matches existing `tags`, `schema` command patterns |
| Output | createFormatter() | Existing output-formatter.ts supports json/markdown/table |
| Testing | bun:test | Project standard, in-memory SQLite fixtures |

**No new dependencies required** - all functionality builds on existing infrastructure.

## Data Model

### Core Types

```typescript
// src/types/schema-audit.ts

/**
 * Severity levels for schema findings
 */
export type SchemaFindingSeverity = 'error' | 'warning' | 'info';

/**
 * A single finding from a schema detector
 */
export interface SchemaFinding {
  detector: string;           // e.g., "orphan-tags", "duplicate-fields"
  severity: SchemaFindingSeverity;
  message: string;            // Human-readable description
  details: {
    tagId?: string;
    tagName?: string;
    fieldId?: string;
    fieldName?: string;
    suggestion?: string;      // Actionable fix suggestion
    relatedIds?: string[];    // Related nodes/tags for context
    fillRate?: number;        // For fill-rate detector (0-100)
    instanceCount?: number;   // For usage detectors
  };
  tanaPaste?: string;         // Optional Tana Paste fix (--fix mode)
}

/**
 * Detector interface - all 7 detectors implement this
 */
export interface SchemaDetector {
  name: string;
  description: string;
  detect(schema: WorkspaceSchema): SchemaFinding[];
}

/**
 * Loaded workspace schema for analysis
 */
export interface WorkspaceSchema {
  supertags: SupertagInfo[];
  fields: FieldInfo[];
  inheritance: InheritanceRelation[];
  tagApplications: TagApplicationCount[];
  fieldValues: FieldValueStats[];
}

/**
 * Supertag with instance count
 */
export interface SupertagInfo {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  color: string | null;
  instanceCount: number;
  lastUsed: number | null;
}

/**
 * Field definition with ownership
 */
export interface FieldInfo {
  fieldLabelId: string;
  fieldName: string;
  tagId: string;
  tagName: string;
  inferredDataType: string | null;
  targetSupertagId: string | null;
  order: number;
}

/**
 * Inheritance relationship
 */
export interface InheritanceRelation {
  childTagId: string;
  parentTagId: string;
}

/**
 * Tag application count
 */
export interface TagApplicationCount {
  tagId: string;
  instanceCount: number;
}

/**
 * Field value statistics for fill-rate calculation
 */
export interface FieldValueStats {
  fieldName: string;
  tagId: string;
  populatedCount: number;
  totalInstances: number;
  fillRate: number;  // populatedCount / totalInstances * 100
}

/**
 * Audit report structure
 */
export interface SchemaAuditReport {
  workspace: string;
  timestamp: string;
  summary: {
    totalSupertags: number;
    totalFields: number;
    findingsCount: { error: number; warning: number; info: number };
  };
  findings: SchemaFinding[];
}
```

## Implementation Phases

### Phase 1: Core Types and Schema Loader (Day 1)

**Files:**
- `src/types/schema-audit.ts` - Type definitions
- `src/services/schema-audit-loader.ts` - WorkspaceSchema loader

**Tasks:**
1. Define all TypeScript interfaces (SchemaFinding, SchemaDetector, WorkspaceSchema)
2. Implement `loadWorkspaceSchema(db: Database): WorkspaceSchema`
   - Query `supertag_fields` for all supertags and fields
   - Query `tag_applications` for instance counts
   - Query inheritance relationships (recursive CTE via SupertagMetadataService)
   - **New query:** Field fill-rate statistics from `field_values` grouped by field_name + parent tag

**Fill-rate query (new):**
```sql
SELECT
  fv.field_name,
  ta.tag_id,
  COUNT(DISTINCT fv.parent_id) as populated_count,
  (SELECT COUNT(*) FROM tag_applications ta2 WHERE ta2.tag_id = ta.tag_id) as total_instances,
  CAST(COUNT(DISTINCT fv.parent_id) AS REAL) * 100 /
    NULLIF((SELECT COUNT(*) FROM tag_applications ta2 WHERE ta2.tag_id = ta.tag_id), 0) as fill_rate
FROM field_values fv
JOIN tag_applications ta ON ta.data_node_id = fv.parent_id
GROUP BY fv.field_name, ta.tag_id
```

**Tests:** `tests/schema-audit-loader.test.ts`
- Loads workspace with multiple supertags
- Calculates correct instance counts
- Calculates correct fill rates
- Handles empty workspace gracefully

### Phase 2: Detector Registry and Core Detectors (Day 1-2)

**Files:**
- `src/services/schema-audit-detectors.ts` - All 7 detectors
- `src/services/schema-audit-registry.ts` - Detector registry

**Detectors (implement in order):**

| Detector | Logic | Severity |
|----------|-------|----------|
| `orphan-tags` | `instanceCount === 0` | warning |
| `low-usage-tags` | `instanceCount < 3` | info |
| `duplicate-fields` | Same `fieldName` on 2+ unrelated tags (no inheritance link) | warning |
| `type-mismatch` | Same `fieldName` with different `inferredDataType` across tags | error |
| `unused-fields` | `fillRate === 0` | info |
| `fill-rate` | `fillRate < 10` | info |
| `missing-inheritance` | 3+ identical field names on 2 tags without common parent | info |

**Registry pattern:**
```typescript
const DETECTOR_REGISTRY: SchemaDetector[] = [
  orphanTagsDetector,
  lowUsageTagsDetector,
  duplicateFieldsDetector,
  typeMismatchDetector,
  unusedFieldsDetector,
  fillRateDetector,
  missingInheritanceDetector,
];

export function runDetectors(
  schema: WorkspaceSchema,
  options?: { detectors?: string[] }
): SchemaFinding[] {
  const activeDetectors = options?.detectors
    ? DETECTOR_REGISTRY.filter(d => options.detectors!.includes(d.name))
    : DETECTOR_REGISTRY;

  return activeDetectors.flatMap(d => d.detect(schema));
}
```

**Tests:** `tests/schema-audit-detectors.test.ts`
- Each detector has 3+ test cases (positive, negative, edge case)
- Test with in-memory SQLite fixtures

### Phase 3: SchemaAuditService (Day 2)

**Files:**
- `src/services/schema-audit-service.ts` - Main service orchestration

**API:**
```typescript
export class SchemaAuditService {
  constructor(private db: Database) {}

  /**
   * Run full audit on workspace
   */
  audit(options?: {
    tag?: string;        // Audit single tag and hierarchy
    detectors?: string[];
    includeFixes?: boolean;
  }): SchemaAuditReport

  /**
   * Generate schema documentation
   */
  generateDocs(): string  // Markdown format
}
```

**Tests:** `tests/schema-audit-service.test.ts`
- Full audit returns expected findings structure
- `--tag` filter limits to specified hierarchy
- `--fix` generates Tana Paste suggestions

### Phase 4: CLI Command (Day 2)

**Files:**
- `src/commands/schema.ts` - Add `audit` subcommand (or new `schema-audit.ts`)

**Command structure:**
```bash
supertag schema audit [options]
  --format <json|markdown|table>  Output format (default: table)
  --tag <name>                    Audit single supertag hierarchy
  --fix                           Include Tana Paste fix suggestions
  --docs                          Generate schema documentation
  --severity <level>              Filter by minimum severity
  -w, --workspace <alias>         Workspace to audit
```

**Implementation:**
- Use `addStandardOptions()` for workspace/format consistency
- Use `createFormatter()` for output formatting
- Exit code: 0 if no errors, 1 if errors found

**Tests:** E2E tests in `tests/schema-audit-e2e.test.ts`
- CLI output matches expected format
- Exit codes are correct
- JSON output is valid and parseable

### Phase 5: MCP Tool (Day 3)

**Files:**
- `src/mcp/tools/schema-audit.ts` - MCP tool definition
- `src/mcp/schemas.ts` - Add schema
- `src/mcp/tool-registry.ts` - Register tool
- `src/mcp/tool-mode.ts` - Add to lite mode if applicable

**Tool definition:**
```typescript
// Tool name: tana_schema_audit
// Parameters:
{
  workspace?: string;   // Workspace alias
  tag?: string;         // Single tag to audit
  severity?: string;    // Minimum severity filter
  includeFixes?: boolean;
  generateDocs?: boolean;
}

// Response: JSON SchemaAuditReport
```

**Registration pattern** (following existing tools):
1. Add to `MCP_TOOL_SCHEMAS` in schemas.ts
2. Add handler to tool-registry.ts dispatch
3. Add to `LITE_MODE_TOOLS` if appropriate (likely yes - read-only)

**Tests:** `tests/mcp/schema-audit.test.ts`
- Returns valid JSON response
- Filters by tag when specified
- Works in lite mode

### Phase 6: Documentation Generation (Day 3)

**Files:**
- `src/services/schema-audit-docs.ts` - Documentation generator

**Output format:**
```markdown
# Workspace Schema Reference

## Person (#person) - 142 instances
Extends: -
Fields:
  - Email (email) - 89% filled
  - Role (options: Manager, IC, Lead) - 76% filled
  - Company (instance -> #company) - 62% filled
Used by: Meeting.Attendees, Project.Team Members

## Meeting (#meeting) - 89 instances
...
```

**Tests:** `tests/schema-audit-docs.test.ts`
- Generates valid markdown
- Includes inheritance info
- Shows fill rates

## File Structure

```
src/
├── types/
│   └── schema-audit.ts              # NEW: Type definitions
├── services/
│   ├── schema-audit-service.ts      # NEW: Main orchestration
│   ├── schema-audit-loader.ts       # NEW: WorkspaceSchema loader
│   ├── schema-audit-detectors.ts    # NEW: 7 detector implementations
│   ├── schema-audit-registry.ts     # NEW: Detector registry
│   ├── schema-audit-docs.ts         # NEW: Documentation generator
│   ├── unified-schema-service.ts    # EXISTING: Supertag queries
│   └── supertag-metadata-service.ts # EXISTING: Field/inheritance queries
├── commands/
│   └── schema.ts                    # MODIFY: Add audit subcommand
└── mcp/
    ├── tools/
    │   └── schema-audit.ts          # NEW: MCP tool
    ├── schemas.ts                   # MODIFY: Add tool schema
    ├── tool-registry.ts             # MODIFY: Register tool
    └── tool-mode.ts                 # MODIFY: Add to lite mode

tests/
├── schema-audit-loader.test.ts      # NEW
├── schema-audit-detectors.test.ts   # NEW
├── schema-audit-service.test.ts     # NEW
├── schema-audit-e2e.test.ts         # NEW
├── schema-audit-docs.test.ts        # NEW
└── mcp/
    └── schema-audit.test.ts         # NEW
```

## Dependencies

### Existing Services (Reuse)

| Service | Used For |
|---------|----------|
| `UnifiedSchemaService` | Supertag lookup, field retrieval, stats |
| `SupertagMetadataService` | Inheritance tree, field validation |
| `createFormatter()` | Output formatting (json/markdown/table) |
| `withDatabase()` | Database connection wrapper |
| `resolveWorkspaceContext()` | Workspace resolution |
| `addStandardOptions()` | CLI option consistency |

### Database Tables (Read-Only)

| Table | Query Purpose |
|-------|---------------|
| `supertag_fields` | Field definitions, data types |
| `tag_applications` | Instance counts per tag |
| `field_values` | Field fill-rate calculation |
| `nodes` | Node metadata (for lastUsed timestamps) |

### No New External Dependencies

All functionality uses existing project infrastructure:
- `bun:sqlite` - Already in use
- `commander` - Already in use
- Project's output-formatter.ts - Already in use

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Fill-rate query performance on large workspaces | Medium | Medium | Add LIMIT sampling for workspaces with >500 instances per tag; show "(sampled)" indicator |
| Missing inheritance data in some exports | Low | Low | Graceful degradation - skip missing-inheritance detector if no inheritance data |
| System tags polluting results | Medium | High | Filter out `docType`, `viewDef`, `tuple` system types by default |
| Duplicate field false positives | Medium | Medium | Check inheritance relationship before flagging - fields on related tags are intentional |
| Large number of findings overwhelming output | Low | Medium | Add `--severity` filter; default to showing summary in table mode |
| Fill-rate calculation for inherited fields | Low | Medium | Count instances of all tags in hierarchy, not just direct applications |

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Workspace with < 5 tags | Skip missing-inheritance analysis (insufficient data) |
| Tag with 1000+ instances | Sample first 500 for fill-rate (performance) |
| Fields inherited from parent | Exclude from duplicate-fields detector (intentional inheritance) |
| Tag names with special characters | Escape in Tana Paste output; handle in display |
| Empty workspace | Return empty report with zero findings |

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Types + Loader | 2 hours | None |
| Phase 2: Detectors | 3 hours | Phase 1 |
| Phase 3: Service | 1.5 hours | Phase 2 |
| Phase 4: CLI | 1.5 hours | Phase 3 |
| Phase 5: MCP Tool | 1 hour | Phase 3 |
| Phase 6: Docs | 1.5 hours | Phase 3 |
| **Total** | **~10.5 hours** | |

---
*Plan created: 2026-02-22*
