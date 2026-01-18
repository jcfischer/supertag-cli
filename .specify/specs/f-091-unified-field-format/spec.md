---
quick-start: true
created: 2026-01-18T09:50:00.000Z
status: draft
---

# Specification: unified-field-format

> **QUICK START SPEC** - Refine before production use

## Overview

Unify field passing format between MCP tools and CLI commands. Currently, MCP expects nested `fields: {}` while CLI expects flat top-level field keys. This causes confusion and silent failures when users mix formats.

## Problem Statement

**Observed Issue (2026-01-18):**
When creating Tana nodes with fields, users encounter different behaviors:

1. **MCP `tana_create` tool:**
   ```json
   {"fields": {"Due Date": "2026-01-20", "⚙️ Vault": "w5NUQv374T8L"}}
   ```
   → Fields silently skipped with message: `fields → (not found in schema, skipped)`

2. **CLI `supertag create` command:**
   ```json
   {"name": "Task", "Due Date": "2026-01-20", "⚙️ Vault": "w5NUQv374T8L"}
   ```
   → Works correctly, fields mapped properly

**Impact:**
- AI agents using MCP tools cannot set fields reliably
- Silent failures cause nodes to be created with missing data
- Users must debug by switching to CLI with `--verbose` to see what works

## User Scenarios

### Scenario 1: AI Agent Creating Todo via MCP
**Given** an AI agent calling `tana_create` with fields
**When** the agent uses nested `fields: {}` format (common in APIs)
**Then** the fields should be processed correctly, not silently skipped

**Acceptance Criteria:**
- [ ] `{"fields": {"Status": "Done"}}` works same as `{"Status": "Done"}`
- [ ] No silent skipping - either process or error explicitly
- [ ] Field mapping shows in verbose/debug output

### Scenario 2: User Using CLI with JSON Input
**Given** a user calling `supertag create` with `--json`
**When** the user tries either field format
**Then** both should work consistently

**Acceptance Criteria:**
- [ ] `--json '{"name": "Task", "fields": {"Status": "Done"}}'` works
- [ ] `--json '{"name": "Task", "Status": "Done"}'` works (existing)
- [ ] Clear error message if field name doesn't match schema

### Scenario 3: Format Mismatch Error
**Given** a user provides an unrecognized field format
**When** the field cannot be mapped to the supertag schema
**Then** a clear error message explains the issue

**Acceptance Criteria:**
- [ ] Error message lists valid field names for the supertag
- [ ] Error message shows what was provided vs what was expected
- [ ] Suggestions offered for likely typos (fuzzy match)

## Functional Requirements

### FR-1: Accept Both Field Formats
The node builder must accept fields in both formats:

**Nested format:**
```json
{
  "name": "Task name",
  "fields": {
    "Due Date": "2026-01-20",
    "⚙️ Vault": "NODE_ID"
  }
}
```

**Flat format:**
```json
{
  "name": "Task name",
  "Due Date": "2026-01-20",
  "⚙️ Vault": "NODE_ID"
}
```

**Requirements:**
- Nested `fields: {}` is normalized to flat format internally
- If both exist, nested fields take precedence (explicit intent)
- Reserved keys (`name`, `supertag`, `children`, `target`) never treated as fields

### FR-2: Eliminate Silent Failures
Never silently skip fields. Instead:

1. **Known field** → Map and include in payload
2. **Unknown field, close match** → Error with suggestion
3. **Unknown field, no match** → Error listing valid fields
4. **System key (name, etc.)** → Use as system key, not field

**Requirements:**
- `--verbose` shows all field mapping decisions
- Default output mentions if any fields were not mapped
- Error includes supertag name and available fields

### FR-3: Consistent MCP and CLI Behavior
The MCP `tana_create` tool and CLI `create` command must behave identically.

**Requirements:**
- Same input JSON produces same result via MCP and CLI
- Same error messages for invalid inputs
- Same field mapping logic (single code path)

### FR-4: Clear Error Messages
When field mapping fails, provide actionable feedback.

**Example error:**
```
Field mapping error for supertag 'todo':
  - "Statsu" not found. Did you mean "⚙️ Status"?
  - "Priority" not found. Available fields:
    • Due Date (date)
    • ⚙️ Vault (reference → Vault)
    • ⚙️ Focus (options → Type | Focus)
    • ⚙️ Status (options)
```

## Non-Functional Requirements

### NFR-1: Backwards Compatibility
Existing flat-format usage must continue to work unchanged.

### NFR-2: Performance
Field normalization must not add measurable latency (<1ms overhead).

## Success Criteria

1. MCP `tana_create` with nested `fields: {}` creates nodes with correct field values
2. CLI `supertag create --json` accepts both formats
3. Invalid field names produce clear error messages, not silent skips
4. Tests cover both formats for MCP and CLI
5. Documentation updated to show both accepted formats

## Technical Context

**Key files to modify:**
- `src/create/node-builder.ts` - Field parsing logic
- `src/mcp/tools/create.ts` - MCP tool implementation
- `src/cli/commands/create.ts` - CLI command implementation

**Current code path:**
1. MCP tool receives input → passes to CreateService
2. CLI parses JSON → passes to CreateService
3. CreateService calls `buildCreatePayload()` in node-builder
4. node-builder maps fields to Tana attribute IDs

**Fix location:** `node-builder.ts` where JSON is parsed for field values.

## Assumptions

1. Both formats can coexist - no breaking changes to existing users
2. Field names are case-sensitive (matching Tana behavior)
3. Nested format is `fields: {}` specifically, not other key names
