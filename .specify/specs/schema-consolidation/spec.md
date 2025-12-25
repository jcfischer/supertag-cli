---
id: "020"
feature: "Schema Consolidation"
status: "draft"
created: "2025-12-23"
---

# Specification: Schema Consolidation

## Overview

Consolidate two separate schema storage systems (SchemaRegistry JSON cache and database tables) into a unified database-backed schema storage. This eliminates the need for a separate `schema sync` command, ensures schema data is always fresh after indexing, and provides richer query capabilities while maintaining backward compatibility.

Currently, supertag schema information is stored in two places:
1. **SchemaRegistry** (`schema-registry.json`) - Complete but requires manual sync
2. **Database tables** (`supertag_fields`, `supertag_parents`) - Auto-synced but incomplete

This creates user confusion ("Why do I need to run two sync commands?") and data staleness issues.

## User Scenarios

### Scenario 1: Single Sync Operation

**As a** Supertag CLI user
**I want to** run one sync command that populates all schema data
**So that** I don't have to remember to run separate sync commands

**Acceptance Criteria:**
- [ ] Running `supertag sync index` populates all supertag metadata in the database
- [ ] Schema-registry.json is auto-generated after indexing completes
- [ ] `supertag schema sync` command remains available but is optional (for manual refresh)
- [ ] User sees confirmation that schema was synced as part of index output

### Scenario 2: Create Command with Full Field Validation

**As a** developer using the create command
**I want to** have field validation with data type inference from the database
**So that** I can create nodes with correctly formatted field values

**Acceptance Criteria:**
- [ ] `supertag create todo "My task" --due-date "tomorrow"` infers date type and formats correctly
- [ ] Field names are matched case-insensitively using normalized names
- [ ] Unknown fields produce helpful error messages suggesting similar field names
- [ ] Performance is equivalent to current JSON-based lookup (< 50ms for field resolution)

### Scenario 3: Schema Exploration from Database

**As a** user exploring my Tana schema
**I want to** query supertag information using database-backed commands
**So that** I get consistent, always-fresh results

**Acceptance Criteria:**
- [ ] `supertag tags show <tag>` displays description, color, and all fields with types
- [ ] `supertag schema search <query>` finds tags by normalized name
- [ ] Results include inherited fields with proper attribution
- [ ] Output matches current schema command output format

### Scenario 4: Backward Compatibility

**As a** user with existing scripts or tools
**I want to** continue using schema-registry.json if needed
**So that** my existing workflows don't break

**Acceptance Criteria:**
- [ ] schema-registry.json is generated after every sync index
- [ ] JSON format remains unchanged from current version
- [ ] `getSchemaRegistry()` function continues to work
- [ ] MCP tools that depend on schema registry continue to function

## Functional Requirements

### FR-1: Extended Database Schema

The database must store all supertag metadata currently in SchemaRegistry.

**New data captured:**
- Supertag: normalized_name, description, color
- Fields: normalized_name, description, inferred_data_type

**Validation:** Query database for any supertag and retrieve all properties that were previously only in JSON.

### FR-2: Data Type Inference

Field data types must be inferred during extraction and stored in the database.

**Supported types:** text, date, reference, url, number, checkbox

**Validation:** After sync, verify field types are stored and match expected inference rules.

### FR-3: Normalized Name Generation

Normalized names must be computed and stored for fuzzy matching.

**Rules:** Lowercase, remove special characters, collapse whitespace

**Validation:** Search for "to do" finds "to-do" and "To Do" supertags.

### FR-4: Auto-Generate Schema Cache

After sync index completes, schema-registry.json must be regenerated from database.

**Validation:** Delete schema-registry.json, run sync index, verify file is recreated with correct content.

### FR-5: Unified Schema Service

A single service must provide schema data to all consumers (CLI commands, MCP tools, create command).

**Validation:** All schema-consuming code paths use the unified service.

## Non-Functional Requirements

- **Performance:** Field lookup must complete in < 50ms (current JSON baseline)
- **Performance:** Schema cache generation must add < 500ms to sync index time
- **Reliability:** Database schema migration must preserve existing data
- **Compatibility:** No breaking changes to CLI command output formats

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| Supertag | A tag definition (tagDef) | id, name, normalized_name, description, color |
| Field | A field definition within a supertag | tag_id, name, normalized_name, label_id, order, data_type, description |
| Inheritance | Parent-child supertag relationship | child_tag_id, parent_tag_id |

## Success Criteria

- [ ] Single `sync index` command populates all schema data (no separate schema sync needed)
- [ ] `supertag tags show meeting` displays Date, Attendees with inferred types
- [ ] `supertag create` command works with database-backed field validation
- [ ] schema-registry.json is auto-generated and matches current format
- [ ] All 782+ existing tests continue to pass
- [ ] New tests cover database schema storage (minimum 20 new test cases)

## Assumptions

- Tana export format will continue to contain tagDef nodes with current structure
- Data type inference heuristics (from field names) are acceptable vs. explicit Tana metadata
- Color information is available in the export (needs verification)
- Description field exists on tagDef nodes (needs verification)

## [NEEDS CLARIFICATION]

- **Color extraction:** Where is supertag color stored in Tana exports? (props.color? tagDef children?)
  -> I don't know. Where does it come from for the schema sync?
- **Description extraction:** Where is supertag description stored? (props.description? separate node?)
  -> I don't know, find out
- **Field description:** Do fields have descriptions in Tana exports, or is this display-only?
  -> Yes. all nodes (fields are special nodes) can have descriptions
- **Migration strategy:** Should we migrate data from existing schema-registry.json, or re-extract from export?
  -> re-extract from export

## Out of Scope

- Modifying Tana export format
- Two-way sync (writing schema back to Tana)
- Schema versioning or history
- Schema validation rules beyond data type inference
- Real-time schema updates (still requires export + sync)
