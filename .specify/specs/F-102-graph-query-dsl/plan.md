# Technical Plan: F-102 Graph Query DSL

## Architecture Overview

```
CLI Input                     MCP Input
     │                             │
     ▼                             ▼
┌────────────────┐     ┌───────────────────┐
│  gquery.ts     │     │  graph-query.ts   │
│  (CLI command) │     │  (MCP tool)       │
└────────┬───────┘     └────────┬──────────┘
         │                      │
         └──────────┬───────────┘
                    ▼
         ┌──────────────────────┐
         │  graph-parser.ts     │  (new - different grammar from Spec 063)
         │  tokenizes + builds  │
         │  GraphQueryAST       │
         └──────────┬───────────┘
                    ▼
         ┌──────────────────────┐
         │  graph-planner.ts    │  (new - AST → QueryPlan)
         │  validates tags,     │
         │  fields, builds      │
         │  ordered steps       │
         └──────────┬───────────┘
                    ▼
         ┌──────────────────────┐
         │  graph-executor.ts   │  (new - executes QueryPlan)
         │  orchestrates        │
         │  existing services   │
         └──────┬────────┬──────┘
                │        │
      ┌─────────┘        └──────────────┐
      ▼                                  ▼
┌─────────────────┐         ┌─────────────────────┐
│ UnifiedQuery    │         │ GraphTraversal       │
│ Engine (063)    │         │ Service (065)        │
│ Tag/field finds │         │ Multi-hop traversal  │
└────────┬────────┘         └──────────┬──────────┘
         │                             │
         └──────────┬──────────────────┘
                    ▼
          ┌──────────────────┐
          │   SQLite DB      │
          │  (workspace)     │
          └──────────────────┘
```

The key insight: F-102 is a **DSL layer** on top of existing primitives. The graph executor
orchestrates `UnifiedQueryEngine` (Spec 063) and `GraphTraversalService` (Spec 065) rather
than querying SQLite directly. This reuses proven infrastructure and avoids duplicating SQL.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Parser | Recursive descent (TypeScript) | Consistent with existing parser.ts; no external grammar tools needed |
| Tokenizer | Reuse/extend `src/query/tokenizer.ts` | Same token types (keywords, strings, identifiers, operators) |
| AST | New `GraphQueryAST` types | Different structure from QueryAST — CONNECTED clauses don't fit |
| Execution | Orchestrates existing services | Reuse UnifiedQueryEngine + GraphTraversalService |
| CLI | Commander.js subcommand | Project standard |
| MCP | Tool in `src/mcp/tools/` | Project pattern |
| Tests | Bun test runner | Project standard |

## Data Model

### Graph Query AST

```typescript
// src/query/graph-types.ts

/** A single CONNECTED TO clause */
interface ConnectedClause {
  toTag: string;                   // target supertag name
  viaField?: string;               // optional field name for VIA
  where?: (WhereClause | WhereGroup)[]; // filters on the connected type
}

/** Projection item (simple field or dot-notation cross-type) */
interface ProjectionField {
  typeAlias?: string;              // "person" in "person.name"
  fieldName: string;               // "name" or "name" part of dot notation
  alias?: string;                  // AS alias for aggregations
  aggregateFn?: 'COUNT' | 'SUM' | 'AVG';
}

/** Top-level Graph Query AST */
interface GraphQueryAST {
  find: string;                    // primary supertag (FIND clause)
  where?: (WhereClause | WhereGroup)[]; // filters on primary type
  connected: ConnectedClause[];    // CONNECTED TO chain (ordered)
  depth?: number;                  // DEPTH modifier (default: 1 per hop)
  return: ProjectionField[];       // RETURN clause (required)
  limit?: number;                  // default 100
}
```

### Query Plan

```typescript
// Runtime plan (not persisted)
interface QueryPlan {
  steps: QueryStep[];
  estimatedHops: number;
}

type QueryStep =
  | { type: 'find_by_tag'; tag: string; filters: (WhereClause | WhereGroup)[]; resultSet: string }
  | { type: 'traverse'; fromSet: string; toTag: string; viaField?: string; resultSet: string }
  | { type: 'filter'; resultSet: string; conditions: (WhereClause | WhereGroup)[] }
  | { type: 'project'; fields: ProjectionField[] };
```

### Query Result

```typescript
interface GraphQueryResult {
  rows: Record<string, unknown>[];  // one per result node
  columns: string[];                // derived from RETURN clause
  count: number;
  hasMore: boolean;
  executionPlan?: string;           // for --explain flag
  queryTimeMs?: number;
}
```

## API Contracts

### CLI

```
supertag gquery <dsl-string> [options]

Options:
  --explain         Show execution plan without running the query
  --format <type>   Output format: table|json|csv|markdown (default: table)
  --limit <n>       Max results (default: 100)
  --depth <n>       Override traversal depth
  --workspace <w>   Workspace alias
  --offline         Use SQLite only, skip Live Read Backend
```

### MCP Tool: `tana_graph_query`

```typescript
// Input schema
{
  dsl: string;             // The graph query DSL string
  explain?: boolean;       // Return plan without executing (default: false)
  format?: "json" | "markdown" | "csv";  // default: json
  limit?: number;          // Max results (default: 100)
  workspace?: string;      // Workspace alias
}

// Output
{
  rows: Record<string, unknown>[];
  columns: string[];
  count: number;
  hasMore: boolean;
  executionPlan?: string;  // When explain: true
}
```

## DSL Grammar (Formal)

```
graph_query  = FIND identifier
               where_clause?
               connected_clause*
               depth_clause?
               return_clause

find_clause  = "FIND" identifier

where_clause = "WHERE" condition ("AND" condition)*

condition    = field operator value
operator     = "=" | "!=" | ">" | "<" | ">=" | "<=" | "CONTAINS" | "LIKE"
value        = string | number | quoted_string
field        = identifier | quoted_identifier     // quoted for "Due Date"

connected    = "CONNECTED" "TO" identifier
               ("VIA" field)?
               ("WHERE" condition ("AND" condition)*)?

depth_clause = "DEPTH" number

return_clause = "RETURN" return_field ("," return_field)*
return_field  = (identifier ".")? field   // optional "person.name" dot notation
              | aggregate_fn "(" field ")" "AS" identifier

aggregate_fn  = "COUNT" | "SUM" | "AVG"
```

**Tokenizer additions** (extend existing `tokenizer.ts` keyword list):
- Keywords: `FIND`, `CONNECTED`, `TO`, `VIA`, `RETURN`, `DEPTH`, `CONTAINS`, `LIKE`, `AS`, `COUNT`, `SUM`, `AVG`
- Token type `DOT` for dot-notation projection
- Keep existing: `WHERE`, `AND`, `OR`, `NOT`, string/number/identifier/operator tokens

## Implementation Phases

### Phase 1: Types + Tokenizer Extension (T-1.1, T-1.2)

**T-1.1** — `src/query/graph-types.ts`
- `GraphQueryAST`, `ConnectedClause`, `ProjectionField` interfaces
- `QueryPlan`, `QueryStep` types
- `GraphQueryResult` type

**T-1.2** — Extend `src/query/tokenizer.ts`
- Add graph DSL keywords to `KEYWORDS` map: `FIND`, `CONNECTED`, `TO`, `VIA`, `RETURN`, `DEPTH`, `CONTAINS`, `LIKE`, `AS`, `COUNT`, `SUM`, `AVG`
- Add `TokenType.DOT` for dot-notation
- Existing `WHERE`, `AND`, `OR`, operators already present — no change needed

### Phase 2: Parser (T-2.1)

**T-2.1** — `src/query/graph-parser.ts`

Recursive descent parser following the grammar above. Pattern matches `src/query/parser.ts`:

```typescript
export class GraphParseError extends Error { ... }

class GraphParser {
  constructor(input: string) { ... }
  parse(): GraphQueryAST { ... }
  private parseFind(): string { ... }
  private parseWhere(): (WhereClause | WhereGroup)[] { ... }  // reuse WhereClause types from types.ts
  private parseConnected(): ConnectedClause { ... }
  private parseDepth(): number { ... }
  private parseReturn(): ProjectionField[] { ... }
  private parseProjectionField(): ProjectionField { ... }
}

export function parseGraphQuery(input: string): GraphQueryAST { ... }
```

Reuse `WhereClause`, `WhereGroup`, `QueryOperator` from `src/query/types.ts` — same condition syntax.

### Phase 3: Planner + Validator (T-3.1)

**T-3.1** — `src/query/graph-planner.ts`

Validates tag/field names against DB schema, then converts AST → `QueryPlan`:

```typescript
export class GraphQueryPlanner {
  constructor(private db: Database) {}

  async plan(ast: GraphQueryAST): Promise<QueryPlan> {
    await this.validateTagName(ast.find);
    for (const c of ast.connected) await this.validateTagName(c.toTag);
    // ... field validation for WHERE and VIA clauses
    return this.buildPlan(ast);
  }

  formatExplain(plan: QueryPlan): string { ... }   // for --explain flag

  private buildPlan(ast: GraphQueryAST): QueryPlan {
    const steps: QueryStep[] = [];
    // Step 1: find_by_tag for primary FIND
    steps.push({ type: 'find_by_tag', tag: ast.find, filters: ast.where ?? [], resultSet: 'R0' });
    // Steps 2..N: traverse for each CONNECTED TO
    for (let i = 0; i < ast.connected.length; i++) {
      const c = ast.connected[i];
      steps.push({ type: 'traverse', fromSet: `R${i}`, toTag: c.toTag, viaField: c.viaField, resultSet: `R${i+1}` });
      if (c.where?.length) steps.push({ type: 'filter', resultSet: `R${i+1}`, conditions: c.where });
    }
    steps.push({ type: 'project', fields: ast.return });
    return { steps, estimatedHops: ast.connected.length };
  }
}
```

### Phase 4: Executor (T-4.1)

**T-4.1** — `src/query/graph-executor.ts`

Executes `QueryPlan` using existing services:

```typescript
export class GraphQueryExecutor {
  private queryEngine: UnifiedQueryEngine;
  private traversalService: GraphTraversalService;

  constructor(db: Database, dbPath: string) { ... }

  async execute(plan: QueryPlan, ast: GraphQueryAST, limit = 100): Promise<GraphQueryResult> {
    // Map of resultSet name → node ID arrays
    const sets = new Map<string, NodeSet>();

    for (const step of plan.steps) {
      switch (step.type) {
        case 'find_by_tag': {
          // Use UnifiedQueryEngine with tag filter + WHERE clauses
          const qast = buildQueryAST(step.tag, step.filters, limit);
          const result = await this.queryEngine.execute(qast);
          sets.set(step.resultSet, result.results);
          break;
        }
        case 'traverse': {
          // For each node in fromSet, traverse to toTag via viaField
          // Use GraphTraversalService.traverse() with field filter
          const fromNodes = sets.get(step.fromSet) ?? [];
          const toNodes = await this.traverseSet(fromNodes, step.toTag, step.viaField, ast.depth ?? 1);
          sets.set(step.resultSet, toNodes);
          break;
        }
        case 'filter': {
          // Apply WHERE conditions to result set in memory
          const nodes = sets.get(step.resultSet) ?? [];
          sets.set(step.resultSet, this.applyFilters(nodes, step.conditions));
          break;
        }
        case 'project': {
          // Extract requested fields from final result set
          // Last resultSet = `R${connected.length}`
          break;
        }
      }
    }
    return this.buildResult(sets, plan, ast.return, limit);
  }
}
```

**Traversal strategy for CONNECTED TO with VIA:**
- `VIA <field>`: filter `GraphTraversalService.traverse()` results to `type='field'` edges where the field name matches the VIA field
- Without VIA: accept all edge types (child, reference, field)
- Cycle detection: maintain `visitedIds: Set<string>` across all hops

**Large intermediate sets (> 1000 nodes at hop 1):**
- Emit a console warning and truncate to `limit * 10`
- Return `hasMore: true` in result

### Phase 5: CLI Command (T-5.1)

**T-5.1** — `src/commands/gquery.ts`

```typescript
export function createGQueryCommand(): Command {
  const cmd = new Command('gquery');
  cmd.description('Run a graph query using the Graph Query DSL')
     .argument('<query>', 'DSL query string (e.g., "FIND meeting CONNECTED TO person VIA Attendees RETURN name, person.name")')
     .option('--explain', 'Show execution plan without running the query')
     .option('--format <type>', 'Output format: table|json|csv|markdown', 'table')
     .option('--depth <n>', 'Override traversal depth', '1');
  addStandardOptions(cmd, { defaultLimit: '100' });
  cmd.action(async (queryStr: string, options) => { ... });
  return cmd;
}
```

Wire into `src/index.ts`:
```typescript
program.addCommand(createGQueryCommand());
```

**Error display for parse errors:**
```
❌ Graph query syntax error: Expected RETURN clause

  Query syntax:
    FIND <supertag> [WHERE <conditions>]
    [CONNECTED TO <supertag> [VIA <field>]]*
    [DEPTH <n>]
    RETURN <field1>, [type.field2], ...

  Example: FIND meeting CONNECTED TO person VIA Attendees RETURN name, person.name
```

### Phase 6: MCP Tool (T-6.1)

**T-6.1** — `src/mcp/tools/graph-query.ts`

Register as `tana_graph_query` in the MCP tool registry alongside `tana_query` (flat query).

```typescript
// src/mcp/tools/graph-query.ts
export async function handleGraphQuery(input: GraphQueryInput, workspace: string): Promise<MCPToolResult> {
  const ast = parseGraphQuery(input.dsl);
  const ws = resolveWorkspaceContext({ workspace });
  const db = new Database(ws.dbPath, { readonly: true });
  const planner = new GraphQueryPlanner(db);
  const plan = await planner.plan(ast);
  if (input.explain) {
    return { content: [{ type: 'text', text: planner.formatExplain(plan) }] };
  }
  const executor = new GraphQueryExecutor(db, ws.dbPath);
  const result = await executor.execute(plan, ast, input.limit ?? 100);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
```

Add to `src/mcp/tools/index.ts` registration.
Add to `src/mcp/schemas.ts` input schema (Zod).

## File Structure

```
src/
├── query/
│   ├── graph-types.ts          [NEW] - GraphQueryAST, QueryPlan, GraphQueryResult types
│   ├── graph-parser.ts         [NEW] - DSL tokenizer + recursive descent parser
│   ├── graph-planner.ts        [NEW] - AST → QueryPlan + tag/field validation
│   ├── graph-executor.ts       [NEW] - QueryPlan execution via existing services
│   ├── tokenizer.ts            [EDIT] - Add graph DSL keywords (FIND, CONNECTED, TO, VIA, RETURN, DEPTH, AS, COUNT, SUM, AVG)
│   ├── types.ts                [REUSE] - WhereClause, WhereGroup, QueryOperator reused
│   ├── parser.ts               [UNCHANGED] - Spec 063 flat query parser
│   └── unified-query-engine.ts [UNCHANGED] - Used by executor
├── commands/
│   └── gquery.ts               [NEW] - `supertag gquery` CLI command
├── mcp/
│   ├── tools/
│   │   └── graph-query.ts      [NEW] - `tana_graph_query` MCP tool
│   └── schemas.ts              [EDIT] - Add GraphQueryInput Zod schema
├── index.ts                    [EDIT] - Register createGQueryCommand()
└── services/
    └── graph-traversal.ts      [REUSE] - Existing traversal service

tests/
├── query/
│   ├── graph-parser.test.ts    [NEW] - Parser unit tests
│   ├── graph-planner.test.ts   [NEW] - Planner + validation tests
│   └── graph-executor.test.ts  [NEW] - Execution tests (in-memory DB)
└── commands/
    └── gquery.test.ts          [NEW] - CLI integration tests
```

## Dependencies

| Dependency | Type | Notes |
|-----------|------|-------|
| `UnifiedQueryEngine` (Spec 063) | Internal | For FIND step execution |
| `GraphTraversalService` (Spec 065) | Internal | For CONNECTED TO traversal |
| `resolveWorkspaceContext` | Internal | Workspace DB resolution |
| `createFormatter` | Internal | Output formatting (reuse from other commands) |
| `WhereClause`/`WhereGroup` from `query/types.ts` | Internal | WHERE condition types |
| `addStandardOptions` from `commands/helpers.ts` | Internal | CLI option registration |
| No new npm packages required | — | All infrastructure already in place |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| **VIA field matching is ambiguous** — field names from WHERE/VIA vs actual Tana field names (case sensitivity, spaces) | Medium | Match case-insensitively; quoted field names (`VIA "Due Date"`) should work as-is |
| **Large intermediate result sets** — FIND returns 5000 nodes, then CONNECTED TO tries to traverse all | High | Warn + auto-limit at hop 1 (`limit * 10`); add suggestion to add WHERE to FIND |
| **Cycle detection** — A references B, B references A creates infinite loop | High | Track visited node IDs in a `Set<string>` per execution; break when revisiting |
| **Tag validation requires DB roundtrip** — planner must validate tag names exist | Low | Query once from `tag_definitions` table; cache in planner instance |
| **Dot notation RETURN projection** — `person.name` requires knowing which resultSet corresponds to `person` | Medium | Track typeAlias → resultSet mapping built during plan step; resolve at project step |
| **`tana_graph_query` vs `tana_query` confusion for AI agents** | Low | Clear tool description distinguishing graph traversal vs flat index queries |
| **Tokenizer keyword conflicts** — adding `FIND` as keyword breaks existing Spec 063 parser if tokenizer is shared | Low | Add graph keywords only when creating `GraphParser`; pass flag to tokenizer OR create separate `graphTokenize()` function |

## Key Design Decisions

### 1. Separate DSL, not extension of Spec 063
The graph query grammar is structurally different (FIND/CONNECTED TO/RETURN vs find/where/order by).
Reusing the Spec 063 parser would require significant refactoring and risk breaking existing functionality.
A separate `graph-parser.ts` with shared `WhereClause` types is cleaner.

### 2. `supertag gquery` not `supertag query --graph`
Keeping graph queries as a distinct command avoids flag proliferation on `query`.
Both commands remain in the same binary. Users can learn them independently.

### 3. Executor orchestrates existing services, not raw SQL
The graph executor does not write new SQLite queries. It chains `UnifiedQueryEngine.execute()`
and `GraphTraversalService.traverse()`. This trades some performance for correctness:
existing services handle pagination, field normalization, and error cases already.

### 4. RETURN is required (not optional)
Without an explicit RETURN clause, projection is undefined. Making it required prevents
accidentally returning 1000-field objects per node. AI agents can always use `RETURN *` for all fields.

### 5. Cycle detection per execution, not globally
Visited node set is per-query execution. This prevents infinite loops without persisting
any state between queries.
