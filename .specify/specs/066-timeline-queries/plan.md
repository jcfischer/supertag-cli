---
spec: "066"
status: "completed"
created: "2026-01-23"
completed: "2026-01-23"
---

# Implementation Plan: Timeline & Temporal Queries

## Implementation Strategy

Implement timeline queries in three layers: core infrastructure (date parsing, bucket generation), service layer (database queries), and interface layer (CLI commands, MCP tools).

## Phase 1: Core Infrastructure

### 1.1 Timeline Types and Utilities
- Create `src/query/timeline.ts` with types:
  - `TimeGranularity`: hour | day | week | month | quarter | year
  - `TimelineQuery`: tag, from, to, granularity, limit, offset
  - `TimeBucket`: key, start, end, count, items, truncated
  - `TimelineResponse`: from, to, granularity, buckets, totalCount, warnings
  - `RecentQuery`: period, types, createdOnly, updatedOnly, limit
  - `RecentResponse`: period, items, count

### 1.2 Date Parsing Functions
- `parsePeriodToMs()`: Convert "7d", "1w", "1m" to milliseconds
- `resolveTimelineRange()`: Parse from/to with validation and swapping
- `getBucketKey()`: Generate bucket key for timestamp at granularity
- `getBucketRange()`: Get start/end dates for a bucket key
- `generateBucketKeys()`: Generate all bucket keys for a date range

### 1.3 Granularity Handling
- ISO week numbers (YYYY-Wnn) for week granularity
- Quarter format (YYYY-Qn) for quarter granularity
- Handle February edge cases in month ranges
- Handle year boundary edge cases

## Phase 2: Service Layer

### 2.1 TimelineService Class
- Create `src/services/timeline-service.ts`
- `timeline(query)`: Execute timeline query, bucket results
- `recent(query)`: Execute recent items query
- Internal `queryItemsInRangeRaw()`: Database query for date range

### 2.2 Database Integration
- Query `nodes` table with `created` and `updated` timestamps
- Join with `tag_applications` for tag filtering
- Handle null timestamps (exclude from results)
- Use existing `resolveWorkspaceContext()` for workspace handling

## Phase 3: Interface Layer

### 3.1 CLI Commands
- Create `src/commands/timeline.ts`
- `createTimelineCommand()`: supertag timeline
- `createRecentCommand()`: supertag recent
- Support all output formats via `addStandardOptions()`

### 3.2 MCP Tools
- Add schemas to `src/mcp/schemas.ts`
- Create `src/mcp/tools/timeline.ts`
- Register in `src/mcp/tool-registry.ts`
- Add handlers to `src/mcp/index.ts`

## Phase 4: Testing and Documentation

### 4.1 Unit Tests
- Test bucket key generation for all granularities
- Test date parsing with relative and absolute dates
- Test range generation including edge cases
- Test bucket range calculation

### 4.2 Documentation
- Update README.md with TIMELINE section
- Update SKILL.md with MCP tools and CLI commands
- Add to capabilities categories

## File Changes

| File | Action | Purpose |
|------|--------|---------|
| `src/query/timeline.ts` | Create | Core infrastructure |
| `src/services/timeline-service.ts` | Create | Database queries |
| `src/commands/timeline.ts` | Create | CLI commands |
| `src/mcp/tools/timeline.ts` | Create | MCP tool implementations |
| `src/mcp/schemas.ts` | Modify | Add Zod schemas |
| `src/mcp/tool-registry.ts` | Modify | Register tools |
| `src/mcp/index.ts` | Modify | Add handlers |
| `src/index.ts` | Modify | Register CLI commands |
| `tests/query/timeline.test.ts` | Create | Unit tests |
| `README.md` | Modify | Documentation |
| `SKILL.md` | Modify | MCP/CLI docs |

## Dependencies

- Existing date utilities in `src/query/date-resolver.ts`
- Query builder utilities in `src/db/query-builder.ts`
- Workspace resolver in `src/config/workspace-resolver.ts`
- Output formatter in `src/utils/output-formatter.ts`

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Timestamp format mismatch | Internal interface with raw numbers, convert at API boundary |
| ISO week calculation complexity | Use standard Date methods with manual week calculation |
| Empty buckets confusing | Include all buckets in range, even empty |
| Large date ranges slow | Default 30 days, warn on larger ranges |
