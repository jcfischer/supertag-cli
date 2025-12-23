---
id: "019"
feature: "Supertag Metadata Storage"
status: "draft"
created: "2025-12-23"
---

# Specification: Supertag Metadata Storage

## Overview

Store supertag field definitions and inheritance relationships in dedicated database tables to enable fast queries for inheritance visualization, field discovery, node creation with validation, and field-based search. Direct relationships are stored during indexing; transitive inheritance is computed on demand.

## User Scenarios

### Scenario 1: View Supertag Inheritance

**As a** Tana user
**I want to** see the complete inheritance tree of any supertag
**So that** I understand what behaviors and fields a supertag inherits

**Acceptance Criteria:**
- [ ] Can view inheritance as a tree structure showing parent→child relationships
- [ ] Can view inheritance as a flattened list with depth levels
- [ ] ROOT supertags (no parents) are clearly marked
- [ ] Works for supertags with deep inheritance (4+ levels)
- [ ] Works for supertags with multiple parents (diamond inheritance)

### Scenario 2: Discover Supertag Fields

**As a** Tana user
**I want to** see all fields available for a supertag, including inherited fields
**So that** I know what data I can query or set when working with that supertag

**Acceptance Criteria:**
- [ ] Shows fields defined directly on the supertag
- [ ] Shows fields inherited from parent supertags
- [ ] Indicates which supertag each field originates from
- [ ] Shows field value counts from the database
- [ ] Can filter to show only own fields or only inherited fields

### Scenario 3: Create Nodes with Field Validation

**As a** developer using the Input API
**I want to** create nodes with fields validated against the supertag schema
**So that** I don't accidentally use invalid field names or miss required fields

**Acceptance Criteria:**
- [ ] Input API validates field names against supertag's available fields (own + inherited)
- [ ] Warning when using a field name not defined on the supertag
- [ ] Can discover available fields for a supertag before creating nodes
- [ ] Dry-run mode shows which fields would be applied

### Scenario 4: Query Nodes by Field Values

**As a** Tana user
**I want to** find nodes based on their field values
**So that** I can answer questions like "find all meetings where Location contains Zurich"

**Acceptance Criteria:**
- [ ] Can search field_values filtered by supertag
- [ ] Can combine supertag filter with field name filter
- [ ] Can combine with text search within field values
- [ ] Returns parent nodes (the tagged items), not just field value rows
- [ ] Shows the matching field value in results

## Functional Requirements

### FR-1: Store Supertag Field Definitions

During indexing, extract and store field definitions from tagDef nodes.

**Data captured:**
- Tag ID and name
- Field name (from tuple's first child)
- Field label node ID
- Field order (position in tagDef children)

**Validation:** Query returns all fields for a given supertag matching what's visible in Tana UI.

### FR-2: Store Direct Inheritance Relationships

During indexing, extract and store direct parent relationships from metaNode structures.

**Data captured:**
- Child tag ID
- Parent tag ID (each direct parent as separate row)

**Validation:** Query returns direct parents matching Tana's "extends" display.

### FR-3: Compute Transitive Inheritance On Demand

Provide mechanism to resolve full inheritance chain from stored direct relationships.

**Behavior:**
- Traverse parent relationships recursively
- Return all ancestors with their depth level
- Handle multiple inheritance paths (diamond pattern)
- Detect and handle circular references gracefully

**Validation:** Full chain matches manual traversal shown in documentation.

### FR-4: Resolve All Fields Including Inherited

Combine own fields with inherited fields from all ancestors.

**Behavior:**
- Start with supertag's own fields
- Add fields from each ancestor (breadth-first by depth)
- Track origin supertag for each field
- Handle field name conflicts (closer ancestor wins, or flag as conflict)

**Validation:** Field list matches fields visible when creating a node with that supertag in Tana.

### FR-5: Validate Fields During Node Creation

When creating nodes via Input API, validate field names against available fields.

**Behavior:**
- Resolve all available fields for the target supertag(s)
- Warn if provided field name doesn't match any available field
- Continue with creation (warning, not error) for flexibility

**Validation:** Creating node with invalid field shows warning; valid fields work normally.

### FR-6: Query Nodes by Supertag and Field Value

Enable searching for nodes based on supertag and field criteria.

**Query patterns:**
- All nodes with supertag X where field Y contains Z
- All nodes with supertag X (or inheriting from X) with field Y
- Full-text search within field values scoped to supertag

**Validation:** Query "meetings where Location contains Zurich" returns expected results.

### FR-7: CLI Commands for Inheritance and Fields

Provide command-line interface for supertag metadata queries.

**Commands:**
- Show inheritance tree for a supertag
- Show flattened inheritance list with depths
- List all fields (own + inherited) for a supertag
- Query nodes by supertag and field value

**Validation:** CLI commands produce correct, formatted output.

### FR-8: MCP Tools for Inheritance and Fields

Expose supertag metadata through MCP server.

**Tools:**
- Query supertag inheritance
- Query supertag fields
- Enhanced node search with field filters

**Validation:** MCP tools return structured data matching CLI output.

## Non-Functional Requirements

- **Performance:** Inheritance resolution for depth ≤ 10 completes in < 100ms
- **Performance:** Field lookup for any supertag completes in < 50ms
- **Storage:** Additional tables add < 5% to database size
- **Consistency:** Metadata tables stay in sync with nodes table during reindex

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| SupertagField | A field defined on a supertag | tag_id, field_name, field_label_id, field_order |
| SupertagParent | Direct inheritance relationship | child_tag_id, parent_tag_id |
| InheritedField | Resolved field with origin | field_name, origin_tag_id, depth |

## Success Criteria

- [ ] `supertag tags inheritance meeting` shows complete 8-level tree
- [ ] `supertag tags fields meeting --all` shows own + inherited fields with origins
- [ ] `supertag create meeting "Test" --location "Zurich"` validates "location" field
- [ ] `supertag search --tag meeting --field Location --query "Zurich"` returns matching meetings
- [ ] MCP tool `tana_supertag_info` returns inheritance and fields
- [ ] Indexing time increases by < 10% with metadata extraction
- [ ] All existing tests continue to pass

## Assumptions

- Supertag inheritance structure doesn't change frequently (schema is relatively stable)
- Inheritance depth rarely exceeds 10 levels
- Field name conflicts across inheritance chain are rare
- Users accept eventual consistency (must reindex after Tana schema changes)

## Out of Scope

- Real-time sync with Tana (requires reindex to update metadata)
- Field type validation (only name validation, not value types)
- Required field enforcement (Tana doesn't expose this in exports)
- Automatic schema change detection
- Graphical inheritance visualization (CLI tree output only)
