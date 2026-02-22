# Specification: F-102 Graph Query DSL

## Context
> Identified as Tier 3 in the Tana Graph DB analysis.
> Higher-level than spec 063 (Unified Query Language) which handles SQL-like queries against the flat index.
> This spec defines a graph-aware query language for traversing typed relationships.

## Problem Statement

**Core Problem**: Querying the Tana knowledge graph requires chaining multiple primitive operations manually — search for nodes, traverse relationships, extract fields, filter results. There's no declarative way to express multi-hop graph queries that Claude Code (or users) can compose naturally.

**Current State**:
- `supertag search` finds nodes (flat query)
- `supertag related` traverses connections (single starting point)
- `supertag fields values` extracts field data (single field)
- Spec 063 provides SQL-like query syntax for flat index queries
- No graph-aware query language that expresses traversal + filtering + projection in one statement

**Impact if Unsolved**: Complex graph queries require Claude Code to write multi-step scripts. Users can't express "find all meetings with people from project X who have open action items" in a single query. The knowledge graph's relationship structure is underutilized.

## Users & Stakeholders

**Primary User**: Claude Code / AI agents querying the Tana graph
- Expects: a query language that AI can generate from natural language
- Needs: composable, typed, handles multi-hop traversal with field extraction

**Secondary**:
- Power CLI users who want complex graph queries
- Report/dashboard builders
- Context assembler (F-098) — could use DSL internally

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | `supertag query <dsl-string>` command that executes graph queries | Must |
| FR-2 | `FIND <type>` clause: starting point by supertag type | Must |
| FR-3 | `WHERE <field> <op> <value>` clause: filter on field values | Must |
| FR-4 | `CONNECTED TO <type>` clause: traverse to related nodes of a type | Must |
| FR-5 | `VIA <field>` modifier: traverse through a specific field (typed edge) | Must |
| FR-6 | `RETURN <field1, field2, ...>` clause: project specific fields | Must |
| FR-7 | Multi-hop traversal: `CONNECTED TO X CONNECTED TO Y` chains | Should |
| FR-8 | Dot notation for related fields: `person.name`, `project.status` | Should |
| FR-9 | `DEPTH <n>` modifier: maximum traversal depth | Should |
| FR-10 | MCP tool `tana_query` with same capabilities | Must |
| FR-11 | Query compilation: DSL → sequence of supertag-cli operations → execution | Must |
| FR-12 | `--explain` flag that shows the execution plan without running the query | Should |
| FR-13 | `--format json|csv|markdown` output for query results | Must |
| FR-14 | Natural language to DSL: `--natural <question>` flag that uses AI to generate DSL | Could |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Simple queries (1-hop) complete in < 2 seconds |
| NFR-2 | Complex queries (3-hop) complete in < 10 seconds |
| NFR-3 | Query parser provides helpful error messages with suggestions |
| NFR-4 | DSL is human-readable and AI-generatable |

## Architecture

### Query Language Syntax

```
FIND <supertag>
  [WHERE <field> <operator> <value>]*
  [CONNECTED TO <supertag> [VIA <field>]]*
  [DEPTH <n>]
  RETURN <projection>
```

### Examples

**Simple: All open projects**
```
FIND project WHERE Status = "Active" RETURN name, Status, Due Date
```

**1-hop: Meetings with a specific person**
```
FIND meeting
  CONNECTED TO person VIA Attendees
  WHERE person.name = "Daniel Miessler"
  RETURN name, Date, Action Items
```

**2-hop: Action items from meetings about a project**
```
FIND project WHERE name = "SOC Defender XDR"
  CONNECTED TO person VIA Team Members
  CONNECTED TO meeting VIA Attendees
  RETURN meeting.name, meeting.Date, meeting.Action Items
```

**Aggregation: Count meetings per person**
```
FIND person
  CONNECTED TO meeting VIA Attendees
  RETURN name, COUNT(meeting) AS meeting_count
```

### Query Compilation

```
DSL string
  → Parse: tokenize + AST
  → Validate: check tag names exist, field names valid
  → Plan: determine execution order (which queries, which joins)
  → Execute: run planned operations sequentially
  → Project: extract requested fields from results
  → Format: output as json/csv/markdown
```

### Execution Plan

```typescript
interface QueryPlan {
  steps: QueryStep[];
  estimatedCost: number;  // Estimated result set size
}

type QueryStep =
  | { type: 'search'; tag: string; filters: Filter[] }
  | { type: 'traverse'; fromSet: string; toTag: string; viaField?: string }
  | { type: 'filter'; field: string; op: string; value: string }
  | { type: 'project'; fields: string[] }
  | { type: 'aggregate'; fn: 'COUNT' | 'SUM' | 'AVG'; field: string; alias: string };
```

### Parser

Use a simple recursive descent parser (no external grammar tool needed):

```
query     → FIND type clause* RETURN projection
clause    → WHERE condition | CONNECTED connected | DEPTH number
condition → field operator value
connected → TO type (VIA field)?
projection→ field (, field)*
field     → identifier (. identifier)?
operator  → = | != | > | < | >= | <= | CONTAINS | LIKE
```

## Scope

### In Scope
- `supertag query` CLI command
- `tana_query` MCP tool
- DSL parser with FIND, WHERE, CONNECTED TO, VIA, RETURN clauses
- Query compilation to execution plan
- Execution via existing supertag-cli primitives (search, related, fields)
- `--explain` mode
- JSON, CSV, markdown output

### Explicitly Out of Scope
- SQL compatibility (this is graph-first, not table-first)
- Mutation queries (INSERT, UPDATE, DELETE)
- Subqueries / nested FIND
- User-defined functions
- Query optimization / caching

### Designed For But Not Implemented
- Natural language → DSL translation (via AI)
- Query history / saved queries
- Query auto-completion in interactive mode
- Visual query builder

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Unknown supertag in FIND | Error: "Supertag 'xyz' not found. Did you mean: ..." (suggest similar) |
| Unknown field in WHERE | Error: "Field 'xyz' not found on #meeting. Available: Date, Attendees, ..." |
| CONNECTED TO with no matching relationships | Return empty result set |
| Circular traversal (A→B→A) | Track visited nodes; break cycles |
| Large intermediate result set (1000+ nodes at hop 1) | Warn and apply default limit; suggest adding WHERE |
| Multi-value field in WHERE | Match if any value satisfies the condition |
| Field name with spaces | Support quoted field names: `WHERE "Due Date" > "2025-01-01"` |

## Success Criteria

- [ ] `supertag query 'FIND project RETURN name, Status'` lists all projects with status
- [ ] Multi-hop query: `FIND project CONNECTED TO person VIA Team RETURN person.name` works
- [ ] `--explain` shows execution plan without running query
- [ ] `WHERE` filtering narrows results correctly
- [ ] `--format csv` produces valid tabular output from graph queries
- [ ] Unknown tag/field names produce helpful error messages
- [ ] `tana_query` MCP tool accepts DSL strings and returns results

## Dependencies

- F-065 (Graph Traversal) — relationship walking primitives
- F-097 (Live Read Backend) — data access layer
- Existing search and field query infrastructure
- Spec 063 (Unified Query Language) — flat query complement (no dependency, parallel effort)

---
*Spec created: 2026-02-22*
