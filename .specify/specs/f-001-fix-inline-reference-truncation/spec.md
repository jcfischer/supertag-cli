# F-001: Fix Inline Reference Truncation

## Overview

Field values containing multiple inline references are truncated to show only the first reference. The full text with all inline references should be preserved and displayed correctly.

## Problem Statement

When a Tana field value contains multiple inline references (e.g., "Meeting with [[John]] and [[Jane]] today"), only the first reference is extracted and displayed. This loses important relationship data and presents incomplete information to users.

## User Scenarios

### Scenario 1: Viewing a node with multi-reference field values

**Given** a node has a field "Attendees" with value containing two inline references:
  - "Meeting with John (ref: abc123) and Jane (ref: def456)"

**When** the user views the node using `supertag nodes show <id>`

**Then** the field value should display both references:
  - "Meeting with [[abc123]] and [[def456]]" (in minimal format)
  - Or resolved names: "Meeting with John and Jane" (in display format)

**Currently** only the first reference is shown:
  - "Meeting with [[abc123]]" (truncated)

### Scenario 2: MCP tool returns complete field data

**Given** an AI agent queries a node via `tana_node_show` MCP tool

**When** the node has field values with multiple inline references

**Then** the MCP response should include all inline references in the field value

**Currently** only the first reference is returned, losing relationship context for AI reasoning

### Scenario 3: Field value with references interspersed with text

**Given** a field value: "Reviewed by Alice (ref: id1), approved by Bob (ref: id2), filed by Carol (ref: id3)"

**When** displayed in any output format (table, JSON, CSV)

**Then** all three references should be preserved in the output

**Currently** only the first reference (Alice) is captured

### Scenario 4: Field value with adjacent references

**Given** a field value with back-to-back references: "[[id1]][[id2]][[id3]]"

**When** the value is formatted for display

**Then** all three references should be shown

**Currently** only [[id1]] is shown

## Functional Requirements

### FR-1: Extract All Inline References

The system shall extract ALL inline references from a field value, not just the first one.

**Acceptance Criteria:**
- Values with 2+ inline references return all references
- Order of references is preserved
- Text between and around references is preserved

### FR-2: Consistent Formatting Across All Output Channels

All display/formatting functions shall handle multiple inline references identically.

**Affected Components:**
- CLI `nodes show` command
- MCP `tana_node_show` tool
- Any other value display functions

**Acceptance Criteria:**
- Same input produces same output across CLI and MCP
- No channel truncates while another preserves

### FR-3: Preserve Surrounding Text Context

When formatting inline references, the surrounding text context shall be preserved.

**Acceptance Criteria:**
- Input: `"See <span data-inlineref-node="id1">John</span> and <span data-inlineref-node="id2">Jane</span> tomorrow"`
- Output (reference format): `"See [[id1]] and [[id2]] tomorrow"`
- The words "See", "and", "tomorrow" are preserved

### FR-4: Handle Edge Cases

The system shall correctly handle edge cases:

| Case | Input | Expected Output |
|------|-------|-----------------|
| No references | `"Plain text"` | `"Plain text"` |
| Single reference | `"Hello <span...>John</span>"` | `"Hello [[id]]"` |
| Adjacent references | `"<span...>A</span><span...>B</span>"` | `"[[idA]][[idB]]"` |
| References only | `"<span...>X</span>"` | `"[[idX]]"` |
| Empty display text | `"<span data-inlineref-node="id"></span>"` | `"[[id]]"` |

## Non-Functional Requirements

### NFR-1: Backward Compatibility

Existing behavior for single-reference values shall remain unchanged. Only multi-reference handling is affected.

### NFR-2: Performance

Processing multiple references shall not significantly impact display performance. Linear time complexity with respect to number of references.

## Success Criteria

1. All field values with multiple inline references display completely
2. Existing tests continue to pass
3. New tests cover multi-reference scenarios
4. Consistent behavior between CLI and MCP outputs

## Assumptions

1. Inline references in Tana use the `<span data-inlineref-node="NODE_ID">Display Text</span>` format
2. The stored value in the database already contains all inline references (truncation is at display time only)
3. The `[[node_id]]` format is acceptable for displaying references in text contexts

## Out of Scope

- Resolving reference IDs to human-readable names (separate feature)
- Modifying how inline references are stored in the database
- Changing the Tana Input API reference format
