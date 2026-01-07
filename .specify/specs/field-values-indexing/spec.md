---
id: "018"
feature: "Field Values Indexing"
status: "completed"
created: "2025-12-23"
completed: "2025-12-23"
---

# Specification: Field Values Indexing

## Overview

Tana stores text-based field values inside tuple structures, but supertag-cli currently only indexes reference-type fields. This means fields like "Gestern war gut weil" (daily reflections) have their actual content invisible to searches and MCP tools. This feature adds comprehensive field value indexing and querying capabilities, making all field content discoverable and searchable.

**Problem:** When querying a day node, the MCP tool returns `fields: [{fieldName: "Focus", value: "Work"}]` but misses text-based fields entirely. The data exists in the database but isn't surfaced.

**Solution:** Index field values from tuple structures and provide tools to query them.

## User Scenarios

### Scenario 1: Query Field Values via MCP

**As a** user querying Tana data through an AI assistant
**I want to** see all field values when fetching a node
**So that** I get complete information including daily reflections, notes, and other text fields

**Acceptance Criteria:**
- [ ] `tana_node` returns text-based field values alongside reference fields
- [ ] Multi-value fields (multiple lines) are returned as arrays
- [ ] Field values include nested content (children of value nodes)
- [ ] Response format is consistent with existing field structure

### Scenario 2: Search Within Specific Fields

**As a** user searching my Tana workspace
**I want to** search only within a specific field's values
**So that** I can find entries where I mentioned "Tango" in my daily reflections, not in meeting transcripts

**Acceptance Criteria:**
- [ ] `tana_search` accepts a field filter parameter
- [ ] Search returns parent node context (which day/meeting contains the match)
- [ ] Full-text search within field values uses FTS5
- [ ] Results are ranked by relevance

### Scenario 3: Extract All Values of a Field

**As a** user wanting to analyze patterns in my data
**I want to** retrieve all values of a specific field across time
**So that** I can see all my daily reflections for the year in one query

**Acceptance Criteria:**
- [ ] New MCP tool retrieves all values for a named field
- [ ] Results can be filtered by date range
- [ ] Results can be filtered by parent node's supertag
- [ ] Results include parent node context (date, name)

### Scenario 4: CLI Field Queries

**As a** power user working from the command line
**I want to** query field values directly via CLI
**So that** I can pipe results to other tools or scripts

**Acceptance Criteria:**
- [ ] `supertag fields list` shows all field definitions with usage counts
- [ ] `supertag fields values <name>` retrieves values for a field
- [ ] Standard output formats supported (TSV, JSON, pretty)
- [ ] Date and tag filters available

### Scenario 5: Semantic Search with Field Context

**As a** user performing semantic searches
**I want** field content included in embeddings
**So that** semantic search finds relevant entries based on field content, not just node names

**Acceptance Criteria:**
- [ ] Embeddings include field values as context
- [ ] Field names are preserved in embedding text for context
- [ ] Re-embedding command available for existing data
- [ ] Semantic search returns matches from field content

### Scenario 6: Compound Field Queries

**As a** user managing structured data in Tana
**I want to** query nodes by supertag AND multiple field conditions
**So that** I can find specific items like "all todos for customer X with status active"

**Acceptance Criteria:**
- [ ] Query accepts supertag filter combined with field conditions
- [ ] Multiple field conditions can be specified (AND logic)
- [ ] Field conditions support exact match
- [ ] Field conditions support comparison operators (eq, contains, lt, gt) for flexibility
- [ ] Results return full node data including all field values
- [ ] CLI and MCP tool both support compound queries

## Functional Requirements

### FR-1: Field Values Table

The system must store field values in a dedicated table that captures the relationship between parent nodes, field definitions, and value content.

**Validation:** Query `field_values` table returns correct parent-field-value relationships for known test cases.

### FR-2: Field Values FTS Index

The system must provide full-text search capability across field values, searchable by both field name and content.

**Validation:** FTS query for term within specific field returns matching rows with relevance ranking.

### FR-3: Tuple Detection During Indexing

During sync/index operations, the system must detect tuple nodes with `_sourceId` property and extract field values from their children.

**Validation:** After re-indexing, field_values table contains entries for known tuple-based fields.

### FR-4: Field Definition Resolution

The system must resolve field definition IDs to human-readable field names by traversing the definition tuple structure.

**Validation:** Field names in field_values table match expected names (e.g., "Gestern war gut weil" not raw IDs).

### FR-5: MCP Node Enhancement

The `tana_node` tool must return text-based field values in addition to existing reference fields.

**Validation:** Fetching a day node with known field values returns complete field data.

### FR-6: MCP Field Search Tool

A new MCP tool must allow querying all values of a specific field with filtering options.

**Validation:** Tool returns correct values for "Gestern war gut weil" field filtered by 2025 dates.

### FR-7: MCP Search Field Filter

The `tana_search` tool must accept an optional field parameter to constrain search to specific field values.

**Validation:** Search for "Tango" with field filter returns only matches within that field.

### FR-8: CLI Field Commands

CLI must provide commands to list fields and query field values.

**Validation:** `supertag fields values "Gestern war gut weil" --limit 10` returns expected results.

### FR-9: Embedding Context Enhancement

When generating embeddings, node text must include field values with field name context.

**Validation:** Embedding text for a day node includes "[Field Name]: value" format.

### FR-10: Compound Field Query Tool

A new MCP tool (`tana_query`) must support querying nodes by supertag combined with multiple field value conditions.

**Parameters:**
- `tag` (required): Supertag to filter by
- `fields`: Object of field conditions `{ "fieldName": "value" }` for exact match
- `fieldConditions`: Array of conditions `[{ field, op, value }]` for advanced filtering
  - Operators: `eq` (equals), `contains` (substring), `lt` (less than), `gt` (greater than)
- `limit`: Maximum results
- `includeFields`: Boolean to include all field values in response

**Validation:** Query for `tag: "todo", fields: { "customer": "Acme", "status": "active" }` returns only matching nodes.

### FR-11: CLI Compound Query Command

CLI must support compound queries via the `query` subcommand.

**Validation:** `supertag query todo --field "customer=Acme" --field "status=active"` returns correct results.

## Non-Functional Requirements

- **Performance:** Field value queries should complete in <100ms for typical result sets (<1000 rows)
- **Performance:** Re-indexing should not significantly increase sync time (acceptable: <20% overhead)
- **Compatibility:** Existing queries and tools must continue to work unchanged
- **Storage:** Field values table should not exceed 10% of main nodes table size

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| FieldValue | A single field value entry | parent_id, field_name, value_text, value_order |
| FieldDefinition | Cached field name resolution | field_def_id, field_name |
| Tuple | Container for field application | _sourceId, children[] |

## Success Criteria

- [ ] All text-based field values from test workspace are indexed (verify with known count)
- [ ] `tana_node` returns complete field data for day nodes with "Gestern war gut weil"
- [ ] Field-filtered search returns relevant results without false positives
- [ ] CLI `fields values` command outputs correctly formatted data
- [ ] Semantic search finds content within field values
- [ ] Compound query returns correct subset when filtering by tag + multiple fields
- [ ] No regression in existing search or node query functionality

## Assumptions

- Field definitions are stable (same _sourceId always refers to same field)
- Tuple structure follows pattern: children[0] = label ref, children[1+] = values
- Field values are text-based (not further nested tuples)
- The _sourceId property reliably identifies field application tuples

## [NEEDS CLARIFICATION]

- Should field values from nested children (grandchildren of tuple) be flattened or preserved hierarchically?
  -> nested children
- Should there be a mechanism to exclude certain fields from indexing (e.g., system fields)?
  -> yes
- What is the expected behavior for fields with empty values?
  -> they should be treated like NULL values

## Out of Scope

- Field value EDITING (this is read-only indexing)
- Field schema management or creation
- Real-time sync of field value changes (batch indexing only)
- Field value validation or type checking
- Cross-workspace field queries
