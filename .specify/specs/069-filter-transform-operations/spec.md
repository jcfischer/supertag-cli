---
id: "069"
feature: "Filter & Transform Operations"
status: "draft"
created: "2026-01-01"
---

# Specification: Filter & Transform Operations

## Overview

Add post-query filtering and result transformation tools that operate on already-retrieved data. Enables refining results without re-querying the database and reshaping data for specific use cases.

## User Scenarios

### Scenario 1: Filter Retrieved Results

**As an** AI agent that retrieved too many nodes
**I want to** filter results without re-querying
**So that** I can refine results efficiently in a multi-step workflow

**Acceptance Criteria:**
- [ ] `tana_filter` accepts a result set and filter conditions
- [ ] Supports field equality: `Status = Done`
- [ ] Supports field contains: `name ~ "project"`
- [ ] Supports date comparisons: `created > 2025-01-01`
- [ ] Returns filtered subset

### Scenario 2: Transform Result Shape

**As an** AI agent building context
**I want to** reshape results to extract specific data
**So that** I get exactly the structure I need

**Acceptance Criteria:**
- [ ] `tana_transform` reshapes result structure
- [ ] Can flatten nested fields
- [ ] Can extract specific paths
- [ ] Can rename fields
- [ ] Can compute derived values

### Scenario 3: CLI Filter Piping

**As a** CLI user with large result sets
**I want to** pipe results through filters
**So that** I can chain operations in shell scripts

**Acceptance Criteria:**
- [ ] `supertag filter` reads from stdin or previous command
- [ ] `supertag transform` reshapes piped data
- [ ] Works with all output formats (json, jsonl)
- [ ] Supports multiple chained operations

### Scenario 4: Complex Filter Expressions

**As a** user with sophisticated filtering needs
**I want to** combine multiple filter conditions
**So that** I can express complex criteria

**Acceptance Criteria:**
- [ ] AND conditions: `Status = Done AND Priority = High`
- [ ] OR conditions: `Status = Done OR Status = Archived`
- [ ] NOT conditions: `NOT Status = Done`
- [ ] Parentheses for grouping: `(A OR B) AND C`

## Functional Requirements

### FR-1: Filter Tool/Command

MCP tool and CLI command for filtering:

```typescript
// MCP
tana_filter({
  data: [...],                          // Result set from previous call
  where: "Status = Done AND Priority = High",
  // OR structured filter:
  conditions: [
    { field: "Status", op: "eq", value: "Done" },
    { field: "Priority", op: "eq", value: "High" }
  ],
  logic: "and"                          // "and" | "or"
})

// CLI
supertag search project | supertag filter "Status = Done"
supertag filter --input results.json "Priority = High"
```

**Validation:** Returns only items matching filter conditions.

### FR-2: Filter Operators

Support comprehensive filter operators:

| Operator | Syntax | Description |
|----------|--------|-------------|
| `eq` | `field = value` | Exact match |
| `neq` | `field != value` | Not equal |
| `contains` | `field ~ value` | Contains substring |
| `startsWith` | `field ^= value` | Starts with |
| `endsWith` | `field $= value` | Ends with |
| `gt` | `field > value` | Greater than |
| `gte` | `field >= value` | Greater or equal |
| `lt` | `field < value` | Less than |
| `lte` | `field <= value` | Less or equal |
| `in` | `field IN [a,b,c]` | Value in list |
| `exists` | `field EXISTS` | Field is present |
| `empty` | `field EMPTY` | Field is null/empty |

**Validation:** All operators work correctly with appropriate field types.

### FR-3: Transform Tool/Command

MCP tool and CLI command for transformation:

```typescript
// MCP
tana_transform({
  data: [...],                          // Result set from previous call
  operations: [
    { op: "select", fields: ["id", "name", "Status"] },
    { op: "flatten", path: "fields" },
    { op: "rename", from: "Status", to: "status" },
    { op: "compute", field: "isComplete", expr: "Status = 'Done'" }
  ]
})

// CLI
supertag transform --select "id,name,Status" --flatten fields
supertag transform --rename "Status:status" --compute "isComplete:Status='Done'"
```

**Validation:** Returns transformed data structure.

### FR-4: Transform Operations

Support these transformation operations:

| Operation | Description | Example |
|-----------|-------------|---------|
| `select` | Keep only specified fields | `select: ["id", "name"]` |
| `exclude` | Remove specified fields | `exclude: ["children", "content"]` |
| `flatten` | Flatten nested object | `flatten: "fields"` → moves fields.* to top level |
| `rename` | Rename field | `rename: { "Status": "status" }` |
| `extract` | Extract nested path | `extract: "fields.Priority"` |
| `compute` | Add computed field | `compute: { "done": "Status = 'Done'" }` |
| `group` | Group items by field | `group: "Status"` |
| `sort` | Sort by field | `sort: { field: "created", order: "desc" }` |
| `limit` | Take first N items | `limit: 10` |
| `skip` | Skip first N items | `skip: 5` |

**Validation:** Operations can be chained in sequence.

### FR-5: Chained Operations

Support operation chaining:

```bash
# CLI chaining
supertag search meeting \
  | supertag filter "Status = Done" \
  | supertag transform --select "id,name,created" \
  | supertag transform --sort "created:desc" \
  | supertag transform --limit 10

# MCP chaining (single call)
tana_filter({
  data: previousResults,
  where: "Status = Done",
  transform: [
    { op: "select", fields: ["id", "name", "created"] },
    { op: "sort", field: "created", order: "desc" },
    { op: "limit", count: 10 }
  ]
})
```

**Validation:** Chained operations execute in order.

### FR-6: Result Metadata

Preserve metadata through filter/transform:

```typescript
{
  original_count: 100,
  filtered_count: 25,
  transformed: true,
  operations_applied: ["filter:Status=Done", "select:id,name"],
  items: [...]
}
```

**Validation:** Metadata tracks what operations were applied.

## Non-Functional Requirements

- **Performance:** Filter 1000 items in < 50ms
- **Memory:** Stream processing for large datasets
- **Compatibility:** Works with all query result formats

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| FilterCondition | Single filter criterion | `field`, `operator`, `value` |
| FilterExpression | Combined filter logic | `conditions[]`, `logic` |
| TransformOperation | Single transform step | `op`, `params` |
| TransformPipeline | Sequence of transforms | `operations[]` |

## Success Criteria

- [ ] Multi-step refinement without re-querying database
- [ ] CLI piping works with standard Unix patterns
- [ ] Transform operations reshape data correctly
- [ ] Chained operations execute efficiently

## Assumptions

- Input data is valid JSON from previous supertag commands
- Field names are case-insensitive for matching
- Transform operations are deterministic

## [NEEDS CLARIFICATION]

- Should filter support regex patterns?
- Should transform support custom JavaScript expressions?
- How to handle missing fields in filter conditions?

## Out of Scope

- Database-level filtering (use `tana_query` instead)
- Joins between multiple result sets
- Aggregation (use `tana_aggregate` instead)
- Persistent saved filters
