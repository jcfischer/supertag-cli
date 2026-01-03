---
id: "066"
feature: "Timeline & Temporal Queries"
status: "draft"
created: "2026-01-01"
---

# Specification: Timeline & Temporal Queries

## Overview

Add timeline-focused tools and commands for querying nodes by time periods, viewing activity patterns, and getting "what's recent" summaries. Enables understanding temporal patterns in Tana data.

## User Scenarios

### Scenario 1: Activity Timeline

**As a** user reviewing my week
**I want to** see what I created each day
**So that** I can recall my activities and progress

**Acceptance Criteria:**
- [ ] `supertag timeline --from 7d --granularity day` shows daily breakdown
- [ ] Each day shows count and key items
- [ ] Can filter by supertag: `--tag meeting`
- [ ] Supports week, month, quarter granularity

### Scenario 2: Recent Items Quick View

**As a** user starting work
**I want to** see recently created/updated items
**So that** I can quickly resume where I left off

**Acceptance Criteria:**
- [ ] `supertag recent --period 24h` shows last 24 hours
- [ ] `supertag recent --types meeting,task` filters by supertag
- [ ] Orders by most recent first
- [ ] Shows both created and updated items

### Scenario 3: Time-Range Query

**As an** AI agent answering "what meetings did I have last month?"
**I want to** query by date range
**So that** I can answer temporal questions efficiently

**Acceptance Criteria:**
- [ ] `tana_timeline` accepts `from` and `to` date parameters
- [ ] Supports relative dates: `7d`, `1m`, `1y`
- [ ] Supports absolute dates: `2025-12-01`
- [ ] Returns structured timeline data

### Scenario 4: Temporal Patterns

**As a** user analyzing habits
**I want to** see when I create most meetings/tasks
**So that** I can understand my productivity patterns

**Acceptance Criteria:**
- [ ] Can group by day-of-week: "most meetings on Tuesday"
- [ ] Can group by hour: "most tasks created in morning"
- [ ] Works with aggregation for counts

## Functional Requirements

### FR-1: Timeline Tool/Command

MCP tool and CLI command for timeline queries:

```typescript
// MCP
tana_timeline({
  tag: "meeting",              // optional: filter by supertag
  from: "2025-12-01",          // start date (or relative: "30d")
  to: "2025-12-31",            // end date (or relative: "today")
  granularity: "week",         // day, week, month, quarter, year
  limit: 100                   // max items per period
})

// CLI
supertag timeline --tag meeting --from 30d --granularity week
```

**Validation:** Returns timeline buckets with items.

### FR-2: Recent Command

Quick access to recently modified items:

```bash
supertag recent                          # Last 24 hours, all types
supertag recent --period 7d              # Last 7 days
supertag recent --types meeting,task     # Specific supertags
supertag recent --created                # Only created, not updated
supertag recent --updated                # Only updated
```

**Validation:** Returns items ordered by recency.

### FR-3: Granularity Levels

Timeline supports various time buckets:

| Granularity | Bucket Key | Example |
|-------------|------------|---------|
| `hour` | ISO datetime | `2025-12-31T14:00:00` |
| `day` | Date | `2025-12-31` |
| `week` | ISO week | `2025-W52` |
| `month` | Year-month | `2025-12` |
| `quarter` | Year-quarter | `2025-Q4` |
| `year` | Year | `2025` |

**Validation:** Each granularity produces correct bucket keys.

### FR-4: Relative Date Parsing

Support human-friendly relative dates:

| Format | Meaning |
|--------|---------|
| `today` | Start of today |
| `yesterday` | Start of yesterday |
| `7d`, `30d` | N days ago |
| `1w`, `2w` | N weeks ago |
| `1m`, `3m`, `6m` | N months ago |
| `1y` | 1 year ago |

**Validation:** All relative formats parse correctly.

### FR-5: Timeline Response Structure

Timeline returns bucketed results:

```typescript
{
  from: "2025-12-01",
  to: "2025-12-31",
  granularity: "week",
  buckets: [
    {
      key: "2025-W49",
      start: "2025-12-01",
      end: "2025-12-07",
      count: 5,
      items: [
        { id: "...", name: "Meeting A", created: "..." },
        // ...
      ]
    },
    // ...
  ],
  totalCount: 23
}
```

**Validation:** Response includes all time periods, even empty ones.

### FR-6: Recent Response Structure

Recent returns flat list ordered by time:

```typescript
{
  period: "7d",
  items: [
    { id: "...", name: "Task X", created: "...", updated: "...", tag: "task" },
    // ... ordered by most recent activity
  ],
  count: 42
}
```

**Validation:** Items ordered by most recent activity (created or updated).

## Non-Functional Requirements

- **Performance:** Timeline query < 500ms for 30-day range
- **Timezone:** Use configured timezone or UTC
- **Empty Buckets:** Include empty periods for complete timeline

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| TimelineQuery | Timeline request | `tag`, `from`, `to`, `granularity` |
| TimeBucket | Single time period | `key`, `start`, `end`, `count`, `items` |
| RecentQuery | Recent items request | `period`, `types`, `created`, `updated` |

## Success Criteria

- [ ] "What did I do last week?" answered in one call
- [ ] Timeline buckets align with calendar correctly
- [ ] Relative dates parse correctly across month/year boundaries
- [ ] Empty periods included for visualization

## Assumptions

- Nodes have reliable `created` timestamps
- `updated` timestamps available where applicable
- Users want calendar-aligned buckets

## [NEEDS CLARIFICATION]

- Should empty buckets be included or omitted?
- Should we support custom time buckets (e.g., "business days only")?
- How to handle timezone differences?

## Out of Scope

- Calendar view visualization
- Recurring events / patterns
- Time tracking / duration calculations
- Working hours analysis
- Calendar integration (Gcal, iCal)
