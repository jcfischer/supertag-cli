---
id: "026"
feature: "Explicit Field Types in Node Creation"
status: "completed"
created: "2025-12-27"
completed: "2025-12-27"
---

# Specification: Explicit Field Types in Node Creation

## Overview

Switch `createNode()` to use explicit field types from the database (`supertag_fields.inferred_data_type`) instead of name-based heuristics when creating nodes via the Input API.

## User Scenarios

### Scenario 1: Creating node with date field

**As a** CLI/MCP user
**I want to** create a node with a date field value
**So that** Tana correctly formats it as a date (not plain text)

**Acceptance Criteria:**
- [ ] Date field values include `dataType: "date"` in API payload
- [ ] Field type comes from database, not field name heuristics

### Scenario 2: Fallback when no database

**As a** user without synced database
**I want to** create nodes using schema registry
**So that** the tool works even before first sync

**Acceptance Criteria:**
- [ ] Falls back to SchemaRegistry when database doesn't exist
- [ ] No errors when database is missing

## Functional Requirements

### FR-1: Use database field types

When database exists, `createNode()` must use `buildNodePayloadFromDatabase()` to get explicit field types.

**Validation:** Payload includes correct `dataType` for date/url/reference fields

### FR-2: Graceful fallback

When database doesn't exist, fall back to `buildNodePayload()` with SchemaRegistry.

**Validation:** No errors when database missing; uses name heuristics

## Success Criteria

- [ ] `createNode()` uses database types when available
- [ ] Date fields get `dataType: "date"` in payload
- [ ] URL fields get `dataType: "url"` in payload
- [ ] Reference fields get `dataType: "reference"` in payload
- [ ] Fallback works when no database
- [ ] All existing tests pass

## Out of Scope

- Modifying how field types are extracted from Tana exports (already done)
- Changing UnifiedSchemaService (already works correctly)
