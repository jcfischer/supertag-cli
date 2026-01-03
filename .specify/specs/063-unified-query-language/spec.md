---
id: "063"
feature: "Unified Query Language"
status: "complete"
created: "2026-01-01"
completed: "2026-01-02"
---

# Specification: Unified Query Language

## Overview

Implement a unified query tool (`tana_query`) and CLI command (`supertag query`) that replaces multi-step discovery→query→filter workflows with a single expressive query. Supports filtering by tags, fields, dates, and relationships in one call.

## User Scenarios

### Scenario 1: Complex Filtered Query

**As an** AI agent answering "show me active projects with overdue tasks"
**I want to** express this as a single query
**So that** I avoid multiple tool calls and manual filtering

**Acceptance Criteria:**
- [ ] Single query finds tasks where parent is tagged "project" and Status="Active"
- [ ] Can filter by field values: `where: { "Status": "Active" }`
- [ ] Can filter by date: `where: { "Due Date": { before: "today" } }`
- [ ] Can filter by parent properties: `where: { "parent.tags": "project" }`

### Scenario 2: CLI Query with SQL-like Syntax

**As a** CLI power user
**I want to** write queries in a readable format
**So that** I can quickly find nodes without memorizing flags

**Acceptance Criteria:**
- [ ] `supertag query "find task where Status = Done"` works
- [ ] `supertag query "find meeting where created > 2025-12-01"` works
- [ ] Syntax is intuitive and documented
- [ ] Errors show helpful syntax hints

### Scenario 3: Query with Projection

**As a** user who needs specific fields
**I want to** select which fields to return
**So that** I get only the data I need

**Acceptance Criteria:**
- [ ] `select: ["name", "fields.Status", "created"]` returns only those fields
- [ ] Can select nested paths: `fields.Status`, `parent.name`
- [ ] Can select aggregates in future (count, sum)

### Scenario 4: Sorted and Limited Results

**As a** user querying for recent items
**I want to** sort and limit results
**So that** I get the most relevant items first

**Acceptance Criteria:**
- [ ] `orderBy: "created"` or `orderBy: "-created"` for descending
- [ ] `limit: 10` returns only top 10
- [ ] `offset: 20` skips first 20 (pagination)
- [ ] Cursor-based pagination for stable large results

## Functional Requirements

### FR-1: Query Structure (MCP)

The `tana_query` tool accepts a structured query object:

```typescript
tana_query({
  find: "meeting",                    // supertag to find
  where: {
    "Attendees": { contains: "John" },
    "created": { after: "2025-12-01" },
    "fields.Status": "Active"
  },
  select: ["name", "created", "fields.Status"],
  orderBy: "-created",               // - prefix for descending
  limit: 20,
  offset: 0
})
```

**Validation:** Returns matching nodes with only selected fields.

### FR-2: Query Syntax (CLI)

The CLI accepts a human-readable query string:

```bash
supertag query "find meeting where Attendees ~ John and created > 2025-12-01 order by -created limit 20"
```

**Operators:**
- `=` exact match
- `~` contains
- `>`, `<`, `>=`, `<=` comparison
- `and`, `or` logical operators
- `not` negation

**Validation:** Parser handles all operators and produces valid query.

### FR-3: Where Clause Operators

Supported comparison operators:

| Operator | Meaning | Example |
|----------|---------|---------|
| `=`, `eq` | Exact match | `Status = Done` |
| `~`, `contains` | Substring/array contains | `Attendees ~ John` |
| `>`, `after` | Greater than / after date | `created > 2025-01-01` |
| `<`, `before` | Less than / before date | `Due < today` |
| `>=`, `<=` | Greater/less or equal | `Priority >= 2` |
| `exists` | Field has value | `Due exists` |
| `not` | Negation | `not Status = Done` |

**Validation:** All operators work for appropriate field types.

### FR-4: Special Values

Support for relative date values:

| Value | Meaning |
|-------|---------|
| `today` | Start of today |
| `yesterday` | Start of yesterday |
| `7d`, `30d` | 7/30 days ago |
| `1w`, `1m`, `1y` | 1 week/month/year ago |

**Validation:** `created > 7d` finds nodes created in last 7 days.

### FR-5: Relationship Queries

Query across relationships:

**Validation:**
- `parent.tags contains project` - nodes whose parent is tagged "project"
- `parent.name = "Q4 Planning"` - nodes under specific parent
- `children.tags contains task` - nodes with task children

## Non-Functional Requirements

- **Performance:** Query execution < 500ms for typical queries
- **Limits:** Maximum 1000 results per query
- **Compatibility:** Query results match what separate tools would return

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| Query | Parsed query structure | `find`, `where`, `select`, `orderBy`, `limit` |
| WhereClause | Filter conditions | `field`, `operator`, `value` |
| QueryResult | Query response | `results[]`, `count`, `hasMore` |

## Success Criteria

- [ ] Single query replaces 3+ tool call workflows
- [ ] CLI syntax is learnable without documentation
- [ ] All current `tana_tagged` + filter patterns expressible as queries
- [ ] Performance comparable to native tools

## Assumptions

- Field names don't contain operators (`=`, `>`, etc.)
- Date parsing follows ISO 8601 or common formats
- Users understand basic query syntax concepts

## Clarifications (Resolved)

- **Full-text search:** Yes, `name ~ "pattern"` triggers FTS5 search within queries
- **Joins:** Basic parent joins via `parent.tags` and `parent.name` filters (no full JOIN syntax)
- **OR syntax:** Parentheses grouping: `(Status = Done or Status = Active)`

## Out of Scope

- Aggregation functions (see spec 064)
- Subqueries
- Regular expression matching
- Geographic/spatial queries
- Full SQL compatibility
