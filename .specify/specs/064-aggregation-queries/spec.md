---
id: "064"
feature: "Aggregation Queries"
status: "approved"
created: "2026-01-01"
approved: "2026-01-07"
---

# Specification: Aggregation Queries

## Overview

Add aggregation capabilities to query nodes and return grouped/counted results. Enables answering questions like "how many tasks per status?" or "meetings per week this month" in a single call without returning all individual nodes.

## User Scenarios

### Scenario 1: Count by Field Value

**As a** user asking "how many tasks in each status?"
**I want to** get counts grouped by field
**So that** I see the distribution without listing all tasks

**Acceptance Criteria:**
- [ ] `supertag aggregate --tag task --group-by Status` returns counts per status
- [ ] Output: `{ "Done": 45, "In Progress": 12, "Open": 8 }`
- [ ] Works with any field, not just Status
- [ ] Handles null/empty field values

### Scenario 2: Time-Based Aggregation

**As a** user analyzing activity patterns
**I want to** see counts by time period
**So that** I understand when I create most meetings

**Acceptance Criteria:**
- [ ] `--group-by month` groups by creation month
- [ ] `--group-by week` groups by ISO week
- [ ] `--group-by day` groups by day
- [ ] Date range filtering works with grouping

### Scenario 3: Multiple Groupings

**As a** user doing cross-tabulation
**I want to** group by multiple fields
**So that** I can see two-dimensional breakdowns

**Acceptance Criteria:**
- [ ] `--group-by Status,Priority` creates nested grouping
- [ ] Output: `{ "Done": { "High": 10, "Low": 35 }, ... }`
- [ ] Limited to 2 grouping levels for simplicity

### Scenario 4: Aggregation with Filters

**As a** user analyzing a subset
**I want to** filter before aggregating
**So that** I can focus on relevant data

**Acceptance Criteria:**
- [ ] `--where "Priority = High" --group-by Status` filters then groups
- [ ] Date range filters work: `--after 2025-01-01 --group-by month`
- [ ] Tag filters work: aggregating a specific supertag

## Functional Requirements

### FR-1: Aggregate Tool/Command

MCP tool and CLI command for aggregation:

```typescript
// MCP
tana_aggregate({
  find: "task",                       // or tag: for supertag filter
  groupBy: ["Status"],                // field(s) to group by
  where: { "Priority": "High" },      // optional filters
  count: true,                        // count items
  // Future: sum, avg, min, max for numeric fields
})

// CLI
supertag aggregate --tag task --group-by Status
supertag aggregate --tag task --group-by Status --where "Priority = High"
```

**Validation:** Returns grouped counts matching query criteria.

### FR-2: Group By Field

Group results by a node field:

**Validation:**
- Groups by exact field values
- Null/empty values grouped under `"(none)"`
- Field names are case-insensitive match

### FR-3: Group By Time Period

Group results by time-based bucketing:

| Period | Grouping | Key Format |
|--------|----------|------------|
| `day` | By day | `2025-12-31` |
| `week` | By ISO week | `2025-W52` |
| `month` | By month | `2025-12` |
| `quarter` | By quarter | `2025-Q4` |
| `year` | By year | `2025` |

**Validation:**
- `--group-by month --field created` groups by creation month
- Default field is `created` for time grouping
- Can specify `--field updated` for update time

### FR-4: Multiple Group By

Support two-level grouping:

```bash
supertag aggregate --tag task --group-by Status,Priority
```

Returns:
```json
{
  "Done": { "High": 10, "Medium": 25, "Low": 10 },
  "In Progress": { "High": 5, "Medium": 7, "Low": 0 },
  "Open": { "High": 2, "Medium": 3, "Low": 3 }
}
```

**Validation:** Nested grouping works for 2 dimensions.

### FR-5: Aggregation Functions

Support basic aggregation functions:

| Function | Description | Applies To |
|----------|-------------|------------|
| `count` | Number of items | All |
| `sum` | Sum of values | Numeric fields |
| `avg` | Average | Numeric fields |
| `min` | Minimum | Numeric/Date |
| `max` | Maximum | Numeric/Date |

**Validation:**
- `count` is default and always available
- Numeric aggregations error on non-numeric fields
- Date min/max work for date fields

## Non-Functional Requirements

- **Performance:** Aggregation < 1s for 10,000 nodes
- **Accuracy:** Counts match manual counting of query results
- **Memory:** Stream processing, don't load all nodes into memory

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| AggregateQuery | Aggregation request | `find`, `groupBy`, `where`, `function` |
| AggregateResult | Grouped results | `groups: Record<string, number|object>` |
| TimeGroup | Time period bucket | `period`, `format` |

## Success Criteria

- [ ] "How many X per Y" questions answered in one call
- [ ] Time-based grouping works for day/week/month/year
- [ ] Two-dimensional grouping produces useful cross-tabs
- [ ] Results are accurate (match manual counting)

## Assumptions

- Field values are strings or can be stringified for grouping
- Time periods use UTC or configured timezone
- Users understand groupBy semantics

## [NEEDS CLARIFICATION]

- Should we support percentages in addition to counts?
- Should we support top-N limiting per group?
- How to handle fields with many unique values (>100 groups)?

## Out of Scope

- Pivot tables
- Running totals / cumulative sums
- Statistical functions (median, stddev)
- Custom bucket definitions
- Visualization/charting
