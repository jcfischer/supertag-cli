---
feature: "Supertag Metadata Storage"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Supertag Metadata Storage

## Architecture Overview

Store direct supertag relationships (fields, parents) in dedicated tables during indexing. Compute transitive inheritance on-demand using SQLite recursive CTEs. Expose through existing CLI command structure and MCP tools.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tana Export JSON                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TanaIndexer.indexFromFile()                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Extract Nodes  │  │ Extract Fields  │  │Extract Parents  │  │
│  │   (existing)    │  │  from tagDefs   │  │ from metaNodes  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼────────────────────┼────────────────────┼───────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SQLite Database                          │
│  ┌──────────┐  ┌────────────────┐  ┌──────────────────────────┐ │
│  │  nodes   │  │ supertag_fields│  │   supertag_parents       │ │
│  │(existing)│  │    (NEW)       │  │       (NEW)              │ │
│  └──────────┘  └────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SupertagMetadataService                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  getFields()    │  │getInheritance() │  │getAllFields()   │  │
│  │  (direct)       │  │(recursive CTE)  │  │(own+inherited)  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
            │                    │                    │
            ├────────────────────┴────────────────────┤
            ▼                                         ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│      CLI Commands         │           │       MCP Tools           │
│  tags inheritance <name>  │           │  tana_supertag_info       │
│  tags fields <name>       │           │  (enhanced tana_search)   │
│  search --tag --field     │           │                           │
└───────────────────────────┘           └───────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Database | SQLite (bun:sqlite) | Existing choice, recursive CTE support |
| ORM | Drizzle | Existing choice for schema definitions |
| CLI | Commander.js | Existing choice for command structure |
| MCP | @modelcontextprotocol/sdk | Existing MCP server infrastructure |

## Constitutional Compliance

- [x] **CLI-First:** New subcommands under existing `tags` command group
- [x] **Library-First:** Core logic in `SupertagMetadataService` class, reusable by CLI and MCP
- [x] **Test-First:** TDD for extraction logic, service methods, and CLI commands
- [x] **Deterministic:** Pure SQL queries with recursive CTEs, no probabilistic behavior
- [x] **Code Before Prompts:** All logic in TypeScript, no LLM prompts for data extraction

## Data Model

### New Database Tables

```sql
-- Supertag field definitions (extracted from tagDef tuple children)
CREATE TABLE supertag_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id TEXT NOT NULL,           -- tagDef node ID
  tag_name TEXT NOT NULL,         -- Human-readable tag name
  field_name TEXT NOT NULL,       -- Field label (from tuple's first child)
  field_label_id TEXT NOT NULL,   -- Node ID of the field label
  field_order INTEGER DEFAULT 0,  -- Position in tagDef children
  UNIQUE(tag_id, field_name)
);

CREATE INDEX idx_supertag_fields_tag ON supertag_fields(tag_id);
CREATE INDEX idx_supertag_fields_name ON supertag_fields(tag_name);

-- Direct inheritance relationships (extracted from metaNode tuples)
CREATE TABLE supertag_parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_tag_id TEXT NOT NULL,     -- Child tagDef node ID
  parent_tag_id TEXT NOT NULL,    -- Parent tagDef node ID
  UNIQUE(child_tag_id, parent_tag_id)
);

CREATE INDEX idx_supertag_parents_child ON supertag_parents(child_tag_id);
CREATE INDEX idx_supertag_parents_parent ON supertag_parents(parent_tag_id);
```

### TypeScript Interfaces

```typescript
// Stored in database
interface SupertagField {
  id: number;
  tagId: string;
  tagName: string;
  fieldName: string;
  fieldLabelId: string;
  fieldOrder: number;
}

interface SupertagParent {
  id: number;
  childTagId: string;
  parentTagId: string;
}

// Computed on demand
interface InheritedField {
  fieldName: string;
  originTagId: string;
  originTagName: string;
  depth: number;  // 0 = own field, 1+ = inherited
}

interface InheritanceNode {
  tagId: string;
  tagName: string;
  depth: number;
  parents: InheritanceNode[];  // For tree view
}
```

## API Contracts

### SupertagMetadataService

```typescript
class SupertagMetadataService {
  constructor(db: Database);

  // Direct field lookup (O(1) with index)
  getFields(tagId: string): SupertagField[];
  getFieldsByName(tagName: string): SupertagField[];

  // Direct parent lookup (O(1) with index)
  getDirectParents(tagId: string): Array<{tagId: string, tagName: string}>;

  // Transitive inheritance (recursive CTE)
  getInheritanceChain(tagId: string): InheritanceNode;  // Tree structure
  getAncestors(tagId: string): Array<{tagId: string, tagName: string, depth: number}>;  // Flat list

  // Combined field resolution
  getAllFields(tagId: string): InheritedField[];  // Own + inherited with origins

  // Validation
  validateFieldName(tagId: string, fieldName: string): {valid: boolean, origin?: string};

  // Find tag by name
  findTagIdByName(tagName: string): string | null;
}
```

### Extraction Functions (during indexing)

```typescript
// Extract field definitions from a tagDef node
function extractFieldsFromTagDef(
  tagDef: NodeDump,
  nodes: Map<string, NodeDump>
): Array<{fieldName: string, fieldLabelId: string, fieldOrder: number}>;

// Extract parent tag IDs from a tagDef's metaNode
function extractParentsFromTagDef(
  tagDef: NodeDump,
  nodes: Map<string, NodeDump>
): string[];  // Parent tag IDs

// Batch extraction during indexing
function extractSupertagMetadata(
  nodes: Map<string, NodeDump>,
  db: Database
): {fieldsExtracted: number, parentsExtracted: number};
```

### CLI Commands

```typescript
// tags inheritance <tagname> [--flat]
interface InheritanceOptions extends StandardOptions {
  flat?: boolean;  // Flat list vs tree view
}

// tags fields <tagname> [--all] [--inherited] [--own]
interface FieldsOptions extends StandardOptions {
  all?: boolean;       // Show all fields (default)
  inherited?: boolean; // Show only inherited
  own?: boolean;       // Show only own fields
}

// search --tag <tag> --field <field> --query <text>
// (extends existing search command)
interface SearchOptions extends StandardOptions {
  tag?: string;
  field?: string;
  query?: string;
}
```

### MCP Tool

```typescript
// tana_supertag_info tool
interface SupertagInfoParams {
  tagname: string;
  includeInheritance?: boolean;  // default: true
  includeFields?: boolean;       // default: true
  inheritanceFormat?: 'tree' | 'flat';  // default: 'flat'
}

interface SupertagInfoResult {
  tag: {id: string, name: string};
  fields: {
    own: Array<{name: string, labelId: string}>;
    inherited: Array<{name: string, origin: string, depth: number}>;
  };
  inheritance: {
    directParents: Array<{id: string, name: string}>;
    allAncestors: Array<{id: string, name: string, depth: number}>;
  };
}
```

## Implementation Strategy

### Phase 1: Foundation (Database + Extraction)

**Goal:** Store supertag metadata during indexing

- [ ] Add `supertag_fields` table to schema
- [ ] Add `supertag_parents` table to schema
- [ ] Write `extractFieldsFromTagDef()` function with tests
- [ ] Write `extractParentsFromTagDef()` function with tests
- [ ] Integrate extraction into `TanaIndexer.indexFromFile()`
- [ ] Update `IndexResult` to include new counts

### Phase 2: Core Service

**Goal:** Query and compute inheritance

- [ ] Create `SupertagMetadataService` class
- [ ] Implement `getFields()` and `getFieldsByName()`
- [ ] Implement `getDirectParents()`
- [ ] Implement recursive CTE for `getAncestors()`
- [ ] Implement `getInheritanceChain()` (tree builder)
- [ ] Implement `getAllFields()` (own + inherited)
- [ ] Implement `validateFieldName()`
- [ ] Full test coverage for all methods

### Phase 3: CLI Commands

**Goal:** Expose via command line

- [ ] Add `tags inheritance <tagname>` subcommand
- [ ] Add `tags fields <tagname>` subcommand
- [ ] Enhance `search` command with `--tag` and `--field` filters
- [ ] Add field validation warning to `create` command
- [ ] Update help text and examples

### Phase 4: MCP Integration

**Goal:** Expose via MCP tools

- [ ] Create `tana_supertag_info` MCP tool
- [ ] Enhance `tana_search` with field filter parameter
- [ ] Update MCP schemas and documentation
- [ ] Test with Claude Desktop

## File Structure

```
src/
├── db/
│   ├── schema.ts                    # [Modified] Add supertag_fields, supertag_parents
│   ├── indexer.ts                   # [Modified] Call extractSupertagMetadata()
│   ├── supertag-metadata.ts         # [NEW] Extraction functions
│   └── migrate.ts                   # [Modified] Add migration for new tables
├── services/
│   └── supertag-metadata-service.ts # [NEW] Query service with recursive CTE
├── commands/
│   ├── tags.ts                      # [Modified] Add inheritance, fields subcommands
│   ├── search.ts                    # [Modified] Add --tag, --field options
│   └── create.ts                    # [Modified] Add field validation warning
├── mcp/
│   ├── tools/
│   │   ├── supertag-info.ts         # [NEW] tana_supertag_info tool
│   │   └── search.ts                # [Modified] Add field filter
│   └── schemas.ts                   # [Modified] Add new tool schemas
└── types/
    └── supertag-metadata.ts         # [NEW] TypeScript interfaces

tests/
├── db/
│   ├── supertag-metadata.test.ts    # [NEW] Extraction function tests
│   └── supertag-metadata-service.test.ts # [NEW] Service tests
├── commands/
│   └── tags-metadata.test.ts        # [NEW] CLI command tests
└── mcp/
    └── supertag-info.test.ts        # [NEW] MCP tool tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Complex inheritance causes slow queries | Medium | Low | Recursive CTE with depth limit; test with meeting (8 levels) |
| Circular inheritance in data | High | Very Low | Add cycle detection in recursive CTE |
| Indexing time increases significantly | Medium | Low | Batch inserts; measure before/after |
| Schema migration breaks existing DBs | High | Low | Add migration step; test with existing databases |
| Diamond inheritance field conflicts | Low | Medium | Document behavior (closest wins); add warning |

## Dependencies

### External

None - using existing dependencies (bun:sqlite, drizzle-orm, commander)

### Internal

- `TanaIndexer` - Add extraction call during indexing
- `TanaQueryEngine` - May extend for field-based queries
- `SchemaRegistry` - Reference for comparison, may consolidate later
- `field-values.ts` - Similar extraction pattern to follow

## Migration/Deployment

- [x] **Database migrations needed:** Yes - add two new tables
- [ ] **Environment variables:** None
- [ ] **Breaking changes:** None - additive only
- [ ] **Rebuild binary:** Yes - after implementation

**Migration strategy:**
1. New tables created on first index after upgrade
2. Existing databases continue to work (tables added on next `sync index`)
3. No data loss - metadata extracted fresh from nodes table

## Estimated Complexity

- **New files:** 5 (extraction, service, types, 2 test files)
- **Modified files:** 7 (schema, indexer, migrate, tags, search, create, mcp)
- **Test files:** 4 (unit + integration)
- **Estimated tasks:** ~20-25 (across 4 phases)
