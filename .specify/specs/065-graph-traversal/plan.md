---
feature: "Graph Traversal"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Graph Traversal (Related Nodes)

## Architecture Overview

Extend the existing reference graph functionality to support multi-hop traversal with direction filtering, relationship type filtering, and cycle detection. The implementation leverages the existing `references` table and query engine patterns.

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLI / MCP                               │
│  supertag related <nodeId>    │    tana_related { nodeId, ... } │
└─────────────────┬─────────────────────────────┬─────────────────┘
                  │                             │
                  ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     GraphTraversalService                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  traverse(nodeId, options)                                │   │
│  │  ├─ validateNode(nodeId)                                  │   │
│  │  ├─ initVisitedSet()                                      │   │
│  │  └─ bfsTraverse(nodeId, depth, direction, types)         │   │
│  │      ├─ getRelatedAtDepth() → batched node lookup         │   │
│  │      ├─ checkCycles(visitedSet)                           │   │
│  │      └─ buildRelationshipMetadata(path, distance)         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TanaQueryEngine                              │
│  Existing: getOutboundReferences(), getInboundReferences()      │
│  New:      getRelatedNodes(nodeId, direction, types, limit)     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SQLite Database                            │
│  references(from_node, to_node, reference_type)                  │
│  nodes(id, name, created, updated, parent_id)                    │
│  tag_applications(data_node_id, tag_id, tag_name)               │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Database | SQLite (existing) | References table already indexed for bi-directional lookups |
| ORM | Drizzle (existing) | Typed queries, already used in query engine |
| Validation | Zod (existing) | Input validation, MCP schema generation |
| Testing | Bun test (existing) | Consistent with codebase |

## Constitutional Compliance

- [x] **CLI-First:** `supertag related <nodeId>` command with --direction, --types, --depth, --limit flags
- [x] **Library-First:** `GraphTraversalService` as reusable module, callable from CLI, MCP, and tests
- [x] **Test-First:** Unit tests for traversal logic, cycle detection, edge cases; E2E tests for CLI/MCP
- [x] **Deterministic:** Pure graph traversal with deterministic BFS ordering, no probabilistic behavior
- [x] **Code Before Prompts:** All logic in TypeScript, no LLM prompts for traversal

## Data Model

### Entities

```typescript
// Input for related query
interface RelatedQuery {
  nodeId: string;
  direction: 'in' | 'out' | 'both';     // Traversal direction
  types: RelationshipType[];             // Filter by type
  depth: number;                          // Max hops (0-5)
  limit: number;                          // Max results
}

// Relationship types supported
type RelationshipType = 'child' | 'parent' | 'reference' | 'field';

// Metadata about how nodes are connected
interface RelationshipMetadata {
  type: RelationshipType;
  direction: 'in' | 'out';               // Relative to source node
  path: string[];                         // Node IDs from source to target
  distance: number;                       // Hops from source
}

// Output node with relationship context
interface RelatedNode {
  id: string;
  name: string;
  tags?: string[];                        // Supertags if any
  relationship: RelationshipMetadata;
}

// Full traversal result
interface RelatedResult {
  workspace: string;
  sourceNode: {
    id: string;
    name: string;
  };
  related: RelatedNode[];
  count: number;
  truncated: boolean;                     // True if limit exceeded
  warnings?: string[];                    // Unknown types, clamped depth, etc.
}
```

### Database Schema

No schema changes needed. Uses existing tables:

```sql
-- Already exists with indexes
CREATE TABLE references (
  id INTEGER PRIMARY KEY,
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  reference_type TEXT NOT NULL  -- 'inline_ref', 'parent', 'child'
);
CREATE INDEX idx_references_from ON references(from_node);
CREATE INDEX idx_references_to ON references(to_node);
CREATE INDEX idx_references_type ON references(reference_type);

-- Used for node lookups
CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, ...);

-- Used for tag enrichment
CREATE TABLE tag_applications (data_node_id TEXT, tag_name TEXT, ...);
```

## API Contracts

### Internal APIs

```typescript
// src/services/graph-traversal.ts
class GraphTraversalService {
  constructor(dbPath: string);

  /**
   * Traverse graph from a source node
   * @throws StructuredError with NODE_NOT_FOUND if node doesn't exist
   */
  async traverse(query: RelatedQuery): Promise<RelatedResult>;

  close(): void;
}

// src/query/tana-query-engine.ts (extension)
class TanaQueryEngine {
  /**
   * Get related nodes in a single direction with type filtering
   * Used internally by GraphTraversalService
   */
  async getRelatedNodes(
    nodeId: string,
    direction: 'in' | 'out',
    types: RelationshipType[],
    limit: number
  ): Promise<Array<{ nodeId: string; type: RelationshipType }>>;
}
```

### MCP Tool

```typescript
// tana_related tool
{
  name: "tana_related",
  description: "Find nodes related to a given node through references, children, and field links. Returns nodes connected within the specified depth.",
  inputSchema: {
    nodeId: string,           // Required: source node ID
    direction: "in" | "out" | "both",  // Default: "both"
    types: string[],          // Default: ["reference", "child", "parent", "field"]
    depth: number,            // Default: 1, max: 5
    limit: number,            // Default: 50, max: 100
    workspace: string,        // Optional: workspace alias
    select: string[]          // Optional: field projection
  }
}
```

### CLI Command

```bash
# Basic usage
supertag related <nodeId>

# Direction filtering
supertag related <nodeId> --direction in    # Incoming references only
supertag related <nodeId> --direction out   # Outgoing references only

# Type filtering
supertag related <nodeId> --types reference,child

# Depth control
supertag related <nodeId> --depth 2         # Up to 2 hops away

# Output formats (Spec 060)
supertag related <nodeId> --format json
supertag related <nodeId> --format csv
supertag related <nodeId> --format ids      # For piping

# Combined
supertag related <nodeId> -d out -t reference --depth 2 --limit 20 --format json
```

## Implementation Strategy

### Phase 1: Foundation (Service Layer)

Build the core traversal service with BFS algorithm:

- [ ] Create `src/services/graph-traversal.ts` with `GraphTraversalService` class
- [ ] Implement BFS traversal with visited set for cycle detection
- [ ] Add type mapping: `inline_ref` → `reference`, support all 4 types
- [ ] Add depth limiting (clamp to max 5)
- [ ] Add result limiting with truncation flag
- [ ] Write unit tests for traversal logic

### Phase 2: Query Engine Extension

Extend query engine with efficient batch queries:

- [ ] Add `getRelatedNodes()` method to `TanaQueryEngine`
- [ ] Optimize for batched node lookups (avoid N+1 queries)
- [ ] Add tag enrichment for result nodes
- [ ] Write unit tests for query methods

### Phase 3: MCP Tool

Create MCP tool following existing patterns:

- [ ] Add `relatedSchema` to `src/mcp/schemas.ts`
- [ ] Create `src/mcp/tools/related.ts` with handler
- [ ] Register tool in `src/mcp/tool-registry.ts`
- [ ] Add tool to capabilities list (category: 'query')
- [ ] Write integration tests

### Phase 4: CLI Command

Create CLI command following `nodes refs` pattern:

- [ ] Add `related` command to `src/commands/nodes.ts` (or new file)
- [ ] Support all output formats (table, json, csv, ids, minimal, jsonl)
- [ ] Add standard options (workspace, limit, select)
- [ ] Write E2E tests

### Phase 5: Documentation & Polish

- [ ] Update README with new command/tool
- [ ] Add examples to `--help` output
- [ ] Add to CHANGELOG
- [ ] Update SKILL.md with capability

## File Structure

```
src/
├── services/
│   └── graph-traversal.ts          # [New] Core traversal logic
├── query/
│   └── tana-query-engine.ts        # [Modified] Add getRelatedNodes()
├── mcp/
│   ├── schemas.ts                  # [Modified] Add relatedSchema
│   ├── tools/
│   │   └── related.ts              # [New] MCP tool handler
│   └── tool-registry.ts            # [Modified] Register tool
├── commands/
│   └── nodes.ts                    # [Modified] Add related command
│       OR
│   └── related.ts                  # [New] If large enough to separate
└── types/
    └── graph.ts                    # [New] Type definitions

tests/
├── unit/
│   ├── graph-traversal.test.ts     # [New] Service tests
│   └── related-query.test.ts       # [New] Query engine tests
└── e2e/
    └── related.test.ts             # [New] CLI/MCP integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Dense graph causes timeout | Medium | Low | Timeout at 5s, return partial results with `timeout: true` flag |
| Memory exhaustion on deep traversal | Medium | Low | Stream results, limit to 100 nodes, limit depth to 5 |
| Missing relationship types in data | Low | Medium | Fall back gracefully, warn in response |
| N+1 query performance | Medium | Medium | Batch node lookups, use `findNodesByIds()` |
| Cycles cause infinite loops | High | High | Visited set prevents re-visiting nodes |

## Failure Mode Analysis

### How This Code Can Fail

| Failure Mode | Trigger | Detection | Degradation | Recovery |
|-------------|---------|-----------|-------------|----------|
| Node not found | Invalid nodeId | Query returns empty | Return structured error | User corrects ID |
| Cycle in graph | Circular refs | Visited set check | Mark `cycleDetected`, continue | Return partial results |
| Query timeout | Large graph | 5s timer | Return partial with `timeout: true` | User reduces depth/limit |
| Empty references table | No refs indexed | Table check | Empty result array | User runs sync |

### Assumptions That Could Break

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| References table indexed | Database corruption | Schema validation on startup |
| Avg < 20 connections/node | Dense knowledge graphs | Log warning if node has 100+ refs |
| Depth 5 sufficient | Users need deeper traversal | Track requests for depth > 5 |

### Blast Radius

- **Files touched:** ~7 files (4 new, 3 modified)
- **Systems affected:** MCP tool suite, CLI commands
- **Rollback strategy:** Feature is additive; remove tool registration and command to disable

## Dependencies

### External

- None (uses existing packages: drizzle-orm, zod, commander)

### Internal

- `TanaQueryEngine` - Extended with new query method
- `resolveWorkspaceContext()` - Workspace resolution
- `withDatabase()` - Database access wrapper
- `StructuredError` - Error handling
- `createFormatter()` - Output formatting (Spec 060)
- `applyProjection()` - Select parameter support (Spec 059)

## Migration/Deployment

- [x] Database migrations needed? **No** - uses existing tables
- [x] Environment variables? **No**
- [x] Breaking changes? **No** - additive feature only

## Estimated Complexity

- **New files:** ~4 (service, tool, types, tests)
- **Modified files:** ~3 (query engine, schemas, tool registry)
- **Test files:** ~2 (unit + e2e)
- **Estimated tasks:** ~12-15
- **Debt score:** 2 (low complexity, follows established patterns)

## Longevity Assessment

### Maintainability Indicators

| Indicator | Status | Notes |
|-----------|--------|-------|
| **Readability:** Can a developer understand this in 6 months? | Yes | Follows existing patterns, well-documented |
| **Testability:** Can changes be verified without manual testing? | Yes | Full unit and E2E test coverage planned |
| **Documentation:** Is the "why" captured, not just the "what"? | Yes | Spec captures use cases, plan captures decisions |

### Evolution Vectors

| What Might Change | Preparation | Impact |
|------------------|-------------|--------|
| New relationship types (sibling, cousin) | Types enum extensible | Low |
| Weighted relationships | RelationshipMetadata extensible | Medium |
| Cross-workspace traversal | Workspace param already exists | Medium |
| Path-finding algorithms | GraphTraversalService is foundation | Low |

### Deletion Criteria

When should this code be deleted?

- [ ] Feature superseded by: Built-in Tana graph API
- [ ] Dependency deprecated: N/A (uses core SQLite)
- [ ] User need eliminated: Knowledge graph traversal no longer needed
- [ ] Maintenance cost exceeds value when: < 10 monthly uses and maintenance issues arise
