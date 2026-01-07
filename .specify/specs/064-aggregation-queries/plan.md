---
feature: "Aggregation Queries"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Aggregation Queries

## Clarification Decisions

Resolving `[NEEDS CLARIFICATION]` items from spec:

1. **Percentages:** Support optional `--show-percent` flag to include percentages
2. **Top-N limiting:** Support `--top N` to return only top N groups by count
3. **Many unique values:** Default cap at 100 groups with warning, `--limit 0` for unlimited

## Architecture Overview

Extend the existing query infrastructure (Spec 063) with aggregation capabilities. Reuse `TanaQueryEngine` for filtering, add new `AggregationService` for grouping logic.

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                          │
├─────────────────────────────────────────────────────────────────┤
│  CLI: supertag aggregate    │    MCP: tana_aggregate           │
│  --tag task                 │    { find: "task",               │
│  --group-by Status          │      groupBy: ["Status"],        │
│  --where "Priority=High"    │      where: {...} }              │
└─────────────────────────────┴───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AggregationService (NEW)                     │
│  - parseGroupBy(fields: string[]): GroupBySpec[]                │
│  - buildAggregateQuery(ast: AggregateAST): SQLQuery             │
│  - formatResults(raw: SQLResult): AggregateResult               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  TanaQueryEngine (EXISTING)                     │
│  - WHERE clause building (reuse)                                │
│  - Tag filtering (reuse)                                        │
│  - Date range filtering (reuse)                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SQLite Database                             │
│  nodes, fields, tag_applications tables                         │
│  GROUP BY + COUNT(*) queries                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Database | SQLite (existing) | Already indexed, GROUP BY support |
| Query Builder | drizzle-orm | Existing infrastructure |
| Date Handling | Native Date + strftime | SQLite built-in functions |

## Constitutional Compliance

- [x] **CLI-First:** `supertag aggregate` command with full flag support
- [x] **Library-First:** `AggregationService` class for reuse by CLI, MCP, and server
- [x] **Test-First:** Unit tests for service, integration tests for CLI/MCP
- [x] **Deterministic:** Pure SQL aggregation, no probabilistic behavior
- [x] **Code Before Prompts:** All aggregation logic in TypeScript, no LLM calls

## Data Model

### Extended Types

```typescript
// Extend QueryAST with aggregation fields
export interface AggregateAST extends QueryAST {
  /** Fields to group by */
  groupBy: GroupBySpec[];
  /** Aggregation functions to apply */
  aggregate: AggregateFunction[];
  /** Show percentage of total */
  showPercent?: boolean;
  /** Limit to top N groups */
  top?: number;
}

export interface GroupBySpec {
  /** Field name or time period */
  field: string;
  /** For time grouping: day, week, month, quarter, year */
  period?: TimePeriod;
  /** For date fields: 'created' or 'updated' */
  dateField?: 'created' | 'updated';
}

export type TimePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface AggregateFunction {
  /** Function name */
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  /** Field to aggregate (for sum/avg/min/max) */
  field?: string;
  /** Alias for result */
  alias?: string;
}

export interface AggregateResult {
  /** Total count before grouping */
  total: number;
  /** Number of groups */
  groupCount: number;
  /** Grouped results */
  groups: Record<string, number | NestedGroups>;
  /** If showPercent enabled */
  percentages?: Record<string, number | NestedGroups>;
  /** Warning if groups capped */
  warning?: string;
}

type NestedGroups = Record<string, number>;
```

### No Database Schema Changes

Aggregation uses existing tables via SQL GROUP BY. No migrations needed.

## API Contracts

### Internal APIs

```typescript
// src/services/aggregation-service.ts

export class AggregationService {
  constructor(private db: Database) {}

  /**
   * Execute aggregation query
   */
  aggregate(ast: AggregateAST): AggregateResult;

  /**
   * Parse group-by specification from CLI string
   * "Status,month" -> [{ field: "Status" }, { period: "month" }]
   */
  parseGroupBy(groupBy: string): GroupBySpec[];

  /**
   * Build SQL GROUP BY clause
   */
  buildGroupBySQL(specs: GroupBySpec[]): { sql: string; params: any[] };

  /**
   * Format time period for grouping
   * SQLite: strftime('%Y-%m', created/1000, 'unixepoch')
   */
  formatTimePeriod(period: TimePeriod, field: string): string;
}
```

### MCP Tool

```typescript
// tana_aggregate tool
{
  name: "tana_aggregate",
  description: "Aggregate nodes with grouping and counting",
  inputSchema: {
    find: { type: "string", description: "Supertag to find" },
    groupBy: { type: "array", items: { type: "string" } },
    where: { type: "object", description: "Filter conditions" },
    aggregate: { type: "array", default: [{ fn: "count" }] },
    showPercent: { type: "boolean", default: false },
    top: { type: "number", description: "Return top N groups" },
    limit: { type: "number", default: 100 }
  }
}
```

### CLI Command

```bash
supertag aggregate [options]

Options:
  --tag <supertag>       Supertag to aggregate (required)
  --group-by <fields>    Fields to group by (comma-separated)
  --where <condition>    Filter condition (e.g., "Priority=High")
  --after <date>         Created after date
  --before <date>        Created before date
  --fn <function>        Aggregation function (count|sum|avg|min|max)
  --show-percent         Include percentage of total
  --top <n>              Return only top N groups
  --format <type>        Output format (json|table|csv)
  -w, --workspace        Workspace alias
```

## Implementation Strategy

### Phase 1: Foundation (Types & Service)

- [ ] Add aggregation types to `src/query/types.ts`
- [ ] Create `src/services/aggregation-service.ts` with core logic
- [ ] Add unit tests for `AggregationService`
- [ ] Implement single-field GROUP BY
- [ ] Implement time period grouping (strftime)

### Phase 2: Core Features (CLI & MCP)

- [ ] Create `src/commands/aggregate.ts` CLI command
- [ ] Create `src/mcp/tools/aggregate.ts` MCP tool
- [ ] Implement two-level nesting for multi-field grouping
- [ ] Add `--show-percent` and `--top` options
- [ ] Add warning for >100 groups
- [ ] Integration tests for CLI and MCP

### Phase 3: Integration

- [ ] Register CLI command in `src/index.ts`
- [ ] Register MCP tool in `src/mcp/index.ts`
- [ ] Add to `tana_capabilities` output
- [ ] Update CLAUDE.md with new command
- [ ] Update CHANGELOG.md

## File Structure

```
src/
├── query/
│   └── types.ts              # [Modified] Add AggregateAST types
├── services/
│   └── aggregation-service.ts # [New] Core aggregation logic
├── commands/
│   └── aggregate.ts          # [New] CLI command
├── mcp/
│   ├── tools/
│   │   └── aggregate.ts      # [New] MCP tool
│   ├── schemas.ts            # [Modified] Add schema
│   ├── tool-registry.ts      # [Modified] Register tool
│   └── index.ts              # [Modified] Wire up tool
└── index.ts                  # [Modified] Register CLI command

tests/
├── services/
│   └── aggregation-service.test.ts  # [New] Unit tests
├── commands/
│   └── aggregate.test.ts            # [New] CLI tests
└── mcp/
    └── aggregate.test.ts            # [New] MCP tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance with large datasets | Medium | Medium | Use SQL GROUP BY (computed in DB), add LIMIT |
| Field values with special chars | Low | Medium | Proper SQL escaping via prepared statements |
| Time zone issues in grouping | Medium | Low | Document UTC behavior, use SQLite strftime |
| Memory with many groups | Low | Low | Cap at 100 groups by default |

## Dependencies

### External

None - uses only existing dependencies (Bun SQLite, drizzle-orm)

### Internal

- `src/query/types.ts` - Base query types
- `src/query/tana-query-engine.ts` - WHERE clause building
- `src/db/query-builder.ts` - SQL utilities
- `src/utils/output-formatter.ts` - Output formatting

## Migration/Deployment

- [ ] **Database migrations:** None needed
- [ ] **Environment variables:** None
- [ ] **Breaking changes:** None - new additive feature

## Estimated Complexity

- **New files:** 4 (service, CLI, MCP, tests)
- **Modified files:** 5 (types, schemas, registries, index files)
- **Test files:** 3
- **Estimated tasks:** ~12-15
