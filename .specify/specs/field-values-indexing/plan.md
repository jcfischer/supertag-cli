---
feature: "Field Values Indexing"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Field Values Indexing

## Architecture Overview

This feature extends supertag-cli to index, store, and query text-based field values that currently exist only in tuple structures within the raw JSON data. The implementation adds a dedicated `field_values` table with FTS5 indexing, enhances the existing indexing pipeline, and provides new query capabilities through both MCP tools and CLI commands.

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    TANA EXPORT                          │
                    │  { nodes: [...], tuples with _sourceId + children }     │
                    └─────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              PARSER (tana-export.ts)                            │
│  ┌─────────────────┐    ┌─────────────────────────────┐    ┌───────────────┐   │
│  │ Extract Nodes   │ +  │ Extract Field Values [NEW]  │ +  │ Extract Tags  │   │
│  │ & Relationships │    │ (tuples with _sourceId)     │    │ & References  │   │
│  └─────────────────┘    └─────────────────────────────┘    └───────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               INDEXER (indexer.ts)                              │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                           DATABASE TABLES                                 │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────────────┐  ┌────────────────────┐  │  │
│  │  │  nodes  │  │ supertags │  │ field_values    │  │ field_values_fts   │  │  │
│  │  │         │  │           │  │ [NEW]           │  │ [NEW - FTS5]       │  │  │
│  │  └─────────┘  └──────────┘  └─────────────────┘  └────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
              ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
              │   MCP TOOLS     │  │   CLI COMMANDS  │  │   EMBEDDINGS    │
              │                 │  │                 │  │                 │
              │ • tana_node     │  │ • fields list   │  │ • Include field │
              │   (enhanced)    │  │ • fields values │  │   context in    │
              │ • tana_search   │  │ • query         │  │   embedding     │
              │   (field filter)│  │   (compound)    │  │   text          │
              │ • tana_query    │  │                 │  │                 │
              │   [NEW]         │  │                 │  │                 │
              └─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, used throughout |
| Database | SQLite (bun:sqlite) | Existing database, FTS5 support |
| FTS | SQLite FTS5 | Already used for nodes, efficient |
| CLI | Commander.js | Existing CLI framework |
| MCP | @modelcontextprotocol/sdk | Existing MCP integration |
| Testing | bun:test | PAI standard |

## Constitutional Compliance

- [x] **CLI-First:** New `supertag fields` and `supertag query` commands expose all functionality
- [x] **Library-First:** Core logic in `src/db/field-values.ts` and `src/query/field-query.ts` reusable by CLI/MCP
- [x] **Test-First:** TDD for all new functions - tests written before implementation
- [x] **Deterministic:** Pure data extraction and SQL queries - no probabilistic behavior
- [x] **Code Before Prompts:** All logic in TypeScript, prompts only for MCP tool descriptions

## Data Model

### Entities

```typescript
// Field value stored in database
interface StoredFieldValue {
  id: number;                 // Auto-increment primary key
  tupleId: string;            // The tuple node containing this field application
  parentId: string;           // The node this field belongs to (e.g., day node)
  fieldDefId: string;         // Field definition ID (e.g., 'zg7pciALsr')
  fieldName: string;          // Human-readable name (e.g., 'Gestern war gut weil')
  valueNodeId: string;        // The node containing the value
  valueText: string;          // The actual text content
  valueOrder: number;         // Order for multi-value fields (0, 1, 2...)
  created: number | null;     // Timestamp from parent node
}

// Query result including parent context
interface FieldValueResult {
  parentId: string;
  parentName: string;
  parentTags: string[];
  fieldName: string;
  valueText: string;
  valueOrder: number;
  created: number | null;
}

// Compound query condition
interface FieldCondition {
  field: string;              // Field name
  op: 'eq' | 'contains' | 'lt' | 'gt';  // Operator
  value: string;              // Value to match
}
```

### Database Schema

```sql
-- Main field values table
CREATE TABLE field_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tuple_id TEXT NOT NULL,           -- Tuple node containing field
  parent_id TEXT NOT NULL,          -- Parent node (entity) the field belongs to
  field_def_id TEXT NOT NULL,       -- Field definition ID (_sourceId)
  field_name TEXT NOT NULL,         -- Resolved human-readable name
  value_node_id TEXT NOT NULL,      -- Node containing the value text
  value_text TEXT NOT NULL,         -- Actual text content
  value_order INTEGER DEFAULT 0,    -- Order for multi-value fields
  created INTEGER,                  -- Timestamp for date filtering
  FOREIGN KEY (parent_id) REFERENCES nodes(id),
  FOREIGN KEY (value_node_id) REFERENCES nodes(id)
);

-- Indexes for efficient querying
CREATE INDEX idx_field_values_parent ON field_values(parent_id);
CREATE INDEX idx_field_values_field_name ON field_values(field_name);
CREATE INDEX idx_field_values_field_def ON field_values(field_def_id);
CREATE INDEX idx_field_values_created ON field_values(created);

-- Full-text search on field values
CREATE VIRTUAL TABLE field_values_fts USING fts5(
  field_name,
  value_text,
  content='field_values',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER field_values_ai AFTER INSERT ON field_values BEGIN
  INSERT INTO field_values_fts(rowid, field_name, value_text)
  VALUES (new.id, new.field_name, new.value_text);
END;

CREATE TRIGGER field_values_ad AFTER DELETE ON field_values BEGIN
  INSERT INTO field_values_fts(field_values_fts, rowid, field_name, value_text)
  VALUES ('delete', old.id, old.field_name, old.value_text);
END;

CREATE TRIGGER field_values_au AFTER UPDATE ON field_values BEGIN
  INSERT INTO field_values_fts(field_values_fts, rowid, field_name, value_text)
  VALUES ('delete', old.id, old.field_name, old.value_text);
  INSERT INTO field_values_fts(rowid, field_name, value_text)
  VALUES (new.id, new.field_name, new.value_text);
END;

-- Field exclusions table (for system fields to skip)
CREATE TABLE field_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_name TEXT NOT NULL UNIQUE,
  reason TEXT
);
```

## API Contracts

### Internal APIs

```typescript
// src/db/field-values.ts - Database operations

/**
 * Extract field values from a parsed tuple node
 * @param tupleNode - Node with _docType='tuple' and _sourceId
 * @param nodes - Map of all nodes for lookups
 * @returns Array of field values found in tuple children
 */
function extractFieldValues(
  tupleNode: NodeDump,
  nodes: Map<string, NodeDump>
): ExtractedFieldValue[];

/**
 * Resolve field definition ID to human-readable name
 * @param fieldDefId - The _sourceId value
 * @param nodes - Map of all nodes for lookups
 * @returns Human-readable field name or null
 */
function resolveFieldName(
  fieldDefId: string,
  nodes: Map<string, NodeDump>
): string | null;

/**
 * Insert field values into database
 * @param db - SQLite database connection
 * @param values - Array of field values to insert
 */
function insertFieldValues(
  db: Database,
  values: StoredFieldValue[]
): void;

/**
 * Query field values by field name
 * @param db - Database connection
 * @param fieldName - Field name to query
 * @param options - Limit, date filters
 * @returns Field value results with parent context
 */
function queryFieldValues(
  db: Database,
  fieldName: string,
  options?: FieldQueryOptions
): FieldValueResult[];
```

```typescript
// src/query/field-query.ts - Compound query engine

/**
 * Query nodes by supertag and field conditions
 * @param db - Database connection
 * @param tag - Supertag to filter by
 * @param conditions - Field conditions (AND logic)
 * @param options - Limit, include fields
 * @returns Matching nodes with optional field data
 */
function compoundQuery(
  db: Database,
  tag: string,
  conditions: FieldCondition[],
  options?: CompoundQueryOptions
): QueryResult[];

/**
 * Build SQL for compound query with field joins
 * @param conditions - Array of field conditions
 * @returns SQL fragment and parameter bindings
 */
function buildFieldConditionSQL(
  conditions: FieldCondition[]
): { sql: string; params: unknown[] };
```

```typescript
// src/embeddings/context-builder.ts - Embedding enhancement

/**
 * Build embedding text including field values
 * @param node - Node to embed
 * @param fieldValues - Field values for this node
 * @returns Formatted text for embedding
 */
function buildEmbeddingTextWithFields(
  node: NodeDump,
  fieldValues: StoredFieldValue[]
): string;
```

### MCP Tool Schemas

```typescript
// tana_node (enhanced) - Already exists, add field values to response
// No schema changes needed, just enhanced response

// tana_search (enhanced) - Add optional field parameter
{
  name: "tana_search",
  description: "Full-text search with optional field filter",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      field: { type: "string", description: "Optional: search only within this field" },
      limit: { type: "number", default: 20 },
      // ... existing parameters
    }
  }
}

// tana_query (NEW) - Compound query tool
{
  name: "tana_query",
  description: "Query nodes by supertag and multiple field conditions",
  inputSchema: {
    type: "object",
    properties: {
      tag: { type: "string", description: "Supertag to filter by" },
      fields: {
        type: "object",
        description: "Simple field conditions as {fieldName: value} for exact match"
      },
      fieldConditions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            op: { enum: ["eq", "contains", "lt", "gt"] },
            value: { type: "string" }
          }
        },
        description: "Advanced field conditions with operators"
      },
      limit: { type: "number", default: 20 },
      includeFields: { type: "boolean", default: false }
    },
    required: ["tag"]
  }
}

// tana_field_values (NEW) - Query all values of a field
{
  name: "tana_field_values",
  description: "Get all values of a specific field across nodes",
  inputSchema: {
    type: "object",
    properties: {
      field: { type: "string", description: "Field name to query" },
      tag: { type: "string", description: "Optional: filter by parent supertag" },
      createdAfter: { type: "string", description: "Date filter (YYYY-MM-DD)" },
      createdBefore: { type: "string", description: "Date filter (YYYY-MM-DD)" },
      limit: { type: "number", default: 100 }
    },
    required: ["field"]
  }
}
```

## Implementation Strategy

### Phase 1: Foundation (Database & Types)

Build the data layer foundation without modifying existing code behavior.

- [ ] **P1.1** Add `StoredFieldValue` and related interfaces to `src/types/field-values.ts`
- [ ] **P1.2** Add `field_values` table schema to `src/db/schema.ts`
- [ ] **P1.3** Add `field_values_fts` virtual table and triggers
- [ ] **P1.4** Add `field_exclusions` table for system field filtering
- [ ] **P1.5** Create database migration handling (detect schema version, add tables if missing)
- [ ] **P1.6** Write tests for schema creation and migration

### Phase 2: Field Value Extraction (Parser Enhancement)

Extract field values during the parse phase.

- [ ] **P2.1** Create `src/db/field-values.ts` with extraction functions
- [ ] **P2.2** Implement `extractFieldValuesFromTuple()` - detect tuple with `_sourceId`, extract children
- [ ] **P2.3** Implement `resolveFieldName()` - follow definition chain to get human name
- [ ] **P2.4** Implement field exclusion logic (skip system fields)
- [ ] **P2.5** Handle multi-value fields (multiple children after label)
- [ ] **P2.6** Handle nested children (preserve hierarchy with concatenation)
- [ ] **P2.7** Handle empty values (treat as NULL, skip insertion)
- [ ] **P2.8** Write comprehensive tests for extraction logic

### Phase 3: Indexing Integration

Integrate field value extraction into the indexing pipeline.

- [ ] **P3.1** Modify `src/db/indexer.ts` to call field value extraction during node processing
- [ ] **P3.2** Batch insert field values for performance
- [ ] **P3.3** Clear and rebuild `field_values` table on full reindex
- [ ] **P3.4** Update checksum calculation to include field values
- [ ] **P3.5** Add indexing statistics (count of field values indexed)
- [ ] **P3.6** Write integration tests for full indexing pipeline

### Phase 4: Query Engine (Core Queries)

Build the query layer for field values.

- [ ] **P4.1** Create `src/query/field-query.ts` with query functions
- [ ] **P4.2** Implement `queryFieldValues()` - get values by field name with filters
- [ ] **P4.3** Implement `searchFieldValuesFTS()` - full-text search within field values
- [ ] **P4.4** Implement `compoundQuery()` - tag + multiple field conditions
- [ ] **P4.5** Add pagination support (offset, limit)
- [ ] **P4.6** Add sorting options (by date, by parent name)
- [ ] **P4.7** Write tests for all query functions

### Phase 5: MCP Tool Enhancement

Update and add MCP tools.

- [ ] **P5.1** Enhance `tana_node` to include field values from database (not raw JSON)
- [ ] **P5.2** Enhance `tana_search` with optional `field` parameter
- [ ] **P5.3** Create `tana_query` tool for compound queries
- [ ] **P5.4** Create `tana_field_values` tool for field value retrieval
- [ ] **P5.5** Update MCP schemas in `src/mcp/schemas.ts`
- [ ] **P5.6** Register new tools in `src/mcp/index.ts`
- [ ] **P5.7** Write MCP tool tests

### Phase 6: CLI Commands

Add CLI commands for field operations.

- [ ] **P6.1** Create `src/commands/fields.ts` with `fields` command group
- [ ] **P6.2** Implement `fields list` - show all field names with usage counts
- [ ] **P6.3** Implement `fields values <name>` - get values for a field
- [ ] **P6.4** Implement `fields search <query>` - FTS search in field values
- [ ] **P6.5** Create `src/commands/query.ts` with compound query command
- [ ] **P6.6** Implement `query <tag> --field "name=value"` syntax
- [ ] **P6.7** Add output format support (TSV, JSON, pretty)
- [ ] **P6.8** Register commands in main CLI entry point
- [ ] **P6.9** Write CLI integration tests

### Phase 7: Embedding Enhancement

Include field context in embeddings.

- [ ] **P7.1** Create `src/embeddings/context-builder.ts` for embedding text generation
- [ ] **P7.2** Modify embedding generation to include field values with `[FieldName]: value` format
- [ ] **P7.3** Add `--include-fields` flag to `embed generate` command
- [ ] **P7.4** Implement selective field inclusion (exclude large/noisy fields)
- [ ] **P7.5** Write tests for embedding text generation

### Phase 8: Documentation & Polish

Complete documentation and edge case handling.

- [ ] **P8.1** Update SKILL.md with new MCP tools and CLI commands
- [ ] **P8.2** Update README.md with field query examples
- [ ] **P8.3** Add field-related troubleshooting to docs
- [ ] **P8.4** Add performance benchmarks for field value queries
- [ ] **P8.5** Final integration testing across all components

## File Structure

```
src/
├── db/
│   ├── schema.ts           # [MODIFIED] Add field_values tables
│   ├── indexer.ts          # [MODIFIED] Call field extraction during index
│   └── field-values.ts     # [NEW] Field value extraction and storage
├── types/
│   ├── tana-dump.ts        # [MODIFIED] Add field value interfaces
│   └── field-values.ts     # [NEW] Field value type definitions
├── query/
│   ├── tana-query-engine.ts # [MODIFIED] Add field query methods
│   └── field-query.ts      # [NEW] Compound query engine
├── mcp/
│   ├── index.ts            # [MODIFIED] Register new tools
│   ├── schemas.ts          # [MODIFIED] Add new tool schemas
│   └── tools/
│       ├── node.ts         # [MODIFIED] Include field values
│       ├── search.ts       # [MODIFIED] Add field filter
│       ├── query.ts        # [NEW] Compound query tool
│       └── field-values.ts # [NEW] Field values tool
├── commands/
│   ├── fields.ts           # [NEW] fields list/values/search
│   └── query.ts            # [NEW] compound query command
├── embeddings/
│   ├── content-filter.ts   # [MODIFIED] Include field context
│   └── context-builder.ts  # [NEW] Build embedding text with fields
└── index.ts                # [MODIFIED] Register new commands

tests/
├── db/
│   ├── field-values.test.ts     # [NEW] Extraction tests
│   └── schema-migration.test.ts # [NEW] Migration tests
├── query/
│   └── field-query.test.ts      # [NEW] Compound query tests
├── mcp/
│   ├── query-tool.test.ts       # [NEW] MCP tool tests
│   └── field-values-tool.test.ts # [NEW]
├── commands/
│   ├── fields.test.ts           # [NEW] CLI tests
│   └── query.test.ts            # [NEW]
└── integration/
    └── field-indexing.test.ts   # [NEW] End-to-end tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Schema migration breaks existing databases** | High | Medium | Add version detection, backup before migration, run migration in transaction |
| **Performance regression on large databases** | Medium | Medium | Batch inserts, index optimization, benchmark before/after |
| **Incomplete field name resolution** | Medium | Low | Fallback to ID if name unresolvable, log warnings |
| **FTS index size explosion** | Medium | Low | Monitor size, consider content filtering for very long values |
| **Tuple structure variations** | Medium | Medium | Handle edge cases gracefully, log unknown patterns |
| **Breaking changes to MCP responses** | High | Low | Ensure backwards compatibility, field values are additive |

## Dependencies

### External

- `bun:sqlite` - SQLite database (already in use)
- `@modelcontextprotocol/sdk` - MCP server (already in use)
- `commander` - CLI framework (already in use)

### Internal

- `src/db/schema.ts` - Database schema definitions
- `src/db/indexer.ts` - Indexing pipeline
- `src/query/tana-query-engine.ts` - Query infrastructure
- `src/mcp/index.ts` - MCP tool registration
- `src/parsers/tana-export.ts` - Export parsing (reference for tuple structure)

## Migration/Deployment

### Database Migration

- **Automatic detection**: Check for `field_values` table existence on startup
- **Safe migration**: Add tables in transaction, don't drop existing tables
- **Reindex required**: After upgrade, users should run `supertag sync index` to populate field values

### Deployment Steps

1. Build new binary with `./scripts/build.sh`
2. Replace existing binary
3. Run `supertag sync index` to populate field values table
4. Verify with `supertag fields list`

### Breaking Changes

- **None** - All changes are additive
- Existing queries continue to work unchanged
- New field values are optional enhancements

### Environment Variables

- No new environment variables required

## Estimated Complexity

- **New files:** ~10
- **Modified files:** ~8
- **Test files:** ~8
- **Estimated tasks:** ~35-40 individual tasks across 8 phases
