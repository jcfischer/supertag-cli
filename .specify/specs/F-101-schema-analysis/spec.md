# Specification: F-101 Schema Analysis

## Context
> Identified as Tier 2 in the Tana Graph DB analysis.
> As Tana workspaces grow, supertag schemas accumulate redundancy and inconsistency. This tool provides automated health checks.

## Problem Statement

**Core Problem**: Tana workspaces accumulate supertags organically — tags get created for specific use cases, fields get duplicated across tags, inheritance hierarchies grow inconsistently. There's no automated way to audit schema health, detect redundancy, or suggest improvements.

**Current State**:
- `supertag tags visualize` generates Mermaid/DOT inheritance graphs
- `supertag tags inheritance` shows hierarchies
- `supertag tags top` shows usage statistics
- `supertag tags fields --all` reveals field structures
- No automated analysis that combines these views into actionable insights
- No detection of orphan tags, duplicate fields, or missing inheritance links

**Impact if Unsolved**: Schema quality degrades over time. Users create new tags instead of discovering existing ones. Field definitions diverge (same concept, different names/types across tags). The knowledge graph becomes harder to query effectively.

## Users & Stakeholders

**Primary User**: Tana power users managing complex workspaces
- Expects: `supertag schema audit` → report of issues with actionable suggestions
- Needs: severity levels, fix suggestions, safe to run (read-only)

**Secondary**:
- Workspace migration planning (understand schema before migrating)
- AI agent workspace understanding (what types exist, how they relate)
- Schema documentation generation

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | `supertag schema audit` command that analyzes the supertag taxonomy | Must |
| FR-2 | Detect orphan supertags: defined but have zero instances | Must |
| FR-3 | Detect duplicate fields: same name/purpose defined on multiple unrelated tags | Must |
| FR-4 | Detect missing inheritance: tags with identical fields that should share a parent | Should |
| FR-5 | Detect field type inconsistencies: same field name with different types across tags | Must |
| FR-6 | Detect unused fields: defined on a tag but never populated across any instance | Should |
| FR-7 | Report usage statistics per supertag: instance count, last used, field fill rates | Must |
| FR-8 | Severity levels for findings: `error`, `warning`, `info` | Must |
| FR-9 | `--format json` and `--format markdown` output modes | Must |
| FR-10 | `--fix` flag that outputs suggested Tana Paste to fix detected issues (dry-run, no auto-apply) | Should |
| FR-11 | `--tag <supertag>` flag to audit a single supertag and its hierarchy | Should |
| FR-12 | MCP tool `tana_schema_audit` with same capabilities | Must |
| FR-13 | Schema documentation generation: `--docs` flag outputs a human-readable schema reference | Should |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Full workspace audit completes in < 10 seconds |
| NFR-2 | Read-only operation — never modifies the database or Tana workspace |
| NFR-3 | Findings include specific node/field IDs for targeted fixing |
| NFR-4 | Works offline (SQLite database only — no Local API required) |

## Architecture

### Audit Pipeline

```
Input (workspace)
  → Load: all supertag definitions + field schemas
  → Count: instance counts per tag (from tag_applications table)
  → Analyze: run each detector against the loaded schema
  → Score: assign severity to each finding
  → Report: format as table/json/markdown with fix suggestions
```

### Detector Registry

```typescript
interface SchemaFinding {
  detector: string;           // e.g., "orphan-tags", "duplicate-fields"
  severity: 'error' | 'warning' | 'info';
  message: string;
  details: {
    tagId?: string;
    tagName?: string;
    fieldId?: string;
    fieldName?: string;
    suggestion?: string;
    relatedIds?: string[];
  };
}

interface SchemaDetector {
  name: string;
  description: string;
  detect(schema: WorkspaceSchema): SchemaFinding[];
}
```

### Detectors

| Detector | Severity | What It Finds |
|----------|----------|---------------|
| `orphan-tags` | warning | Tags with 0 instances |
| `duplicate-fields` | warning | Same field name on 2+ unrelated tags |
| `type-mismatch` | error | Same field name, different types across tags |
| `missing-inheritance` | info | Tags sharing 3+ identical fields without common parent |
| `unused-fields` | info | Fields with 0% fill rate across all instances |
| `low-usage-tags` | info | Tags with < 3 instances |
| `field-fill-rate` | info | Fields populated on < 10% of instances |

### Schema Documentation Output

When `--docs` is used, generate a markdown document:

```markdown
# Workspace Schema Reference

## Person (#person) — 142 instances
Extends: —
Fields:
  - Email (email) — 89% filled
  - Role (options: Manager, IC, Lead) — 76% filled
  - Company (instance → #company) — 62% filled
Used by: Meeting.Attendees, Project.Team Members

## Meeting (#meeting) — 89 instances
Extends: —
Fields:
  - Date (date) — 100% filled
  - Attendees (instance → #person, multi) — 95% filled
  - Action Items (plain, multi) — 72% filled
...
```

## Scope

### In Scope
- `supertag schema audit` CLI command
- `tana_schema_audit` MCP tool
- 7 schema detectors (orphan, duplicate, type-mismatch, missing-inheritance, unused, low-usage, fill-rate)
- Severity classification
- JSON and markdown reports
- Schema documentation generation
- Suggested fixes in Tana Paste format (dry-run only)

### Explicitly Out of Scope
- Automated fix application (too risky without human review)
- Cross-workspace schema comparison
- Schema migration tools (rename, merge, split tags)
- Historical schema tracking

### Designed For But Not Implemented
- Schema refactoring operations (rename tag, merge tags, move fields)
- Schema diff between snapshots ("what changed since last audit")
- Integration with schema visualization (Mermaid graph annotated with findings)

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Workspace with < 5 tags | Skip inheritance analysis; too few to be meaningful |
| System tags (docType, viewDef) | Exclude from audit — these are Tana internals |
| Tag with 1000+ instances | Count is accurate; field fill-rate sampling if > 500 instances |
| Fields inherited from parent tag | Don't flag as "duplicate" — inheritance is the mechanism |
| Tag name with special characters | Handle in reporting; escape for Tana Paste output |

## Success Criteria

- [ ] `supertag schema audit` produces a report with findings and severity levels
- [ ] Orphan tags (zero instances) are detected and reported
- [ ] Duplicate field names across unrelated tags are flagged
- [ ] Field type mismatches are flagged as errors
- [ ] `--format json` returns structured findings array
- [ ] `--docs` generates readable schema documentation
- [ ] `--tag person` audits only the #person supertag and its hierarchy
- [ ] `tana_schema_audit` MCP tool returns identical findings to CLI

## Dependencies

- Existing tag introspection infrastructure (`tags list`, `tags fields`, `tags inheritance`)
- Existing field schema parsing (`get_tag_schema`)
- tag_applications table for instance counting

---
*Spec created: 2026-02-22*
