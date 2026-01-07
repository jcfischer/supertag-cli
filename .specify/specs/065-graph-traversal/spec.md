---
id: "065"
feature: "Graph Traversal"
status: "implemented"
created: "2026-01-01"
implemented: "2026-01-07"
updated: "2026-01-07"
---

# Specification: Graph Traversal (Related Nodes)

## Overview

Add tools and commands to traverse the Tana node graph, finding nodes related to a given node through parent/child relationships, references, and field links. Enables answering "what's connected to this?" without multiple node lookups.

## System Context

### Upstream Dependencies

| Dependency | Purpose | Failure Impact |
|------------|---------|----------------|
| `nodes` table | Source of node data | Query fails completely |
| `references` table | Inline reference data | Missing reference relationships |
| `tag_applications` table | Tag relationships | Missing tag-based connections |
| SQLite database | Storage layer | Service unavailable |

### Downstream Consumers

| Consumer | Usage | Breaking Change Risk |
|----------|-------|---------------------|
| MCP clients | `tana_related` tool calls | API changes break agents |
| CLI users | `supertag related` command | Flag/output changes break scripts |
| Future path-finding features | Graph primitives | Internal API changes |

### Implicit Coupling

- Result format couples to `tana_node` and other MCP tools (consistency expected)
- Performance assumptions couple to database indexing strategy
- Depth limits couple to typical Tana graph density

## User Scenarios

### Scenario 1: Find All Related Content

**As an** AI agent building context for a project
**I want to** find all nodes related to a project node
**So that** I can provide comprehensive context in one call

**Acceptance Criteria:**
- [ ] `tana_related` returns nodes connected to the given node
- [ ] Includes children, referenced nodes, and referencing nodes
- [ ] Configurable depth for traversal
- [ ] Can filter by relationship type

**Failure Behavior:** Returns empty array with warning if node not found. Returns partial results with `truncated: true` if limit exceeded.

### Scenario 2: Show Node References

**As a** user understanding how a concept is used
**I want to** see all nodes that reference a specific node
**So that** I can understand its context and importance

**Acceptance Criteria:**
- [ ] `supertag related <nodeId> --direction in` shows incoming references
- [ ] Shows which nodes link to this node via inline refs or field values
- [ ] Includes the context (parent node) of each reference

**Failure Behavior:** Returns empty array if no references found (not an error).

### Scenario 3: Explore Outgoing Links

**As a** user following a trail of thoughts
**I want to** see what a node links to
**So that** I can follow the connection graph

**Acceptance Criteria:**
- [ ] `supertag related <nodeId> --direction out` shows outgoing links
- [ ] Includes references in node content
- [ ] Includes field values that are node references

**Failure Behavior:** Returns empty array if node has no outgoing links.

### Scenario 4: Relationship Depth Traversal

**As a** user exploring a knowledge graph
**I want to** traverse multiple levels of relationships
**So that** I can see indirect connections

**Acceptance Criteria:**
- [ ] `--depth 2` finds nodes 2 hops away
- [ ] Each result includes its distance from the source
- [ ] Cycles are detected and handled (don't infinite loop)
- [ ] Results are deduplicated

**Failure Behavior:** Cycles detected return visited nodes once with shortest path. Timeout at 5s returns partial results with `timeout: true`.

## Functional Requirements

### FR-1: Related Tool/Command

MCP tool and CLI command for graph traversal:

```typescript
// MCP
tana_related({
  nodeId: "abc123",
  direction: "both",           // "in", "out", or "both"
  types: ["reference", "child", "field"],  // relationship types
  depth: 2,                    // max traversal depth
  limit: 50                    // max results
})

// CLI
supertag related <nodeId> --direction both --depth 2
```

**Validation:** Returns related nodes with relationship metadata.

**Failure Behavior:** Invalid nodeId returns structured error with `NODE_NOT_FOUND` code.

### FR-2: Relationship Types

Support different relationship types:

| Type | Direction | Description |
|------|-----------|-------------|
| `child` | out | Direct children of the node |
| `parent` | in | Direct parent of the node |
| `reference` | both | Inline references (`[[node]]`) |
| `field` | both | Field values that are node references |

**Validation:** Can filter by one or more relationship types.

**Failure Behavior:** Unknown relationship type ignored with warning in response.

### FR-3: Direction Parameter

Control traversal direction:

| Direction | Meaning |
|-----------|---------|
| `in` | Nodes that reference/contain this node |
| `out` | Nodes that this node references/contains |
| `both` | Both directions |

**Validation:** Direction correctly filters relationship direction.

**Failure Behavior:** Invalid direction returns validation error.

### FR-4: Depth Traversal

Multi-hop traversal with depth tracking:

**Validation:**
- `depth: 0` returns only directly connected nodes
- `depth: 1` returns direct + one hop away
- Each result includes `distance` field
- Circular references don't cause infinite loops
- Default max depth is 3

**Failure Behavior:** Depth > 5 clamped to 5 with warning. Cycle detected adds `cycleDetected: true` to affected paths.

### FR-5: Result Structure

Each related node includes relationship metadata:

```typescript
{
  nodeId: "def456",
  name: "Related Node",
  relationship: {
    type: "reference",
    direction: "in",         // this node references source
    path: ["abc123", "def456"],  // traversal path
    distance: 1
  }
}
```

**Validation:** Results include enough metadata to understand the relationship.

## Non-Functional Requirements

- **Performance:** Depth-1 traversal < 200ms, depth-2 < 1s
- **Limits:** Max 100 results, max depth 5
- **Memory:** Stream results, don't build full graph in memory
- **Graceful Degradation:** Partial results better than failure

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| RelatedQuery | Traversal request | `nodeId`, `direction`, `types`, `depth` |
| Relationship | Connection metadata | `type`, `direction`, `distance`, `path` |
| RelatedNode | Node with relationship | `nodeId`, `name`, `relationship` |

## Success Criteria

- [ ] Single call finds all directly related nodes
- [ ] Depth traversal works without infinite loops
- [ ] Relationship type filtering reduces noise
- [ ] Results include enough context to understand connections
- [ ] Graceful handling of edge cases (cycles, missing nodes, timeouts)

## Assumptions

| Assumption | Invalidation Condition | Mitigation |
|------------|----------------------|------------|
| References indexed in database | `references` table empty or missing | Fall back to node content parsing |
| Graph not too dense (avg < 20 connections) | Nodes with 100+ connections common | Add connection count limits per node |
| Users understand graph concepts | User confusion in feedback | Add examples to help text |
| SQLite can handle recursive queries | Performance issues at scale | Pre-compute common traversals |

## Failure Mode Analysis

| Failure Mode | Likelihood | Impact | Detection | Recovery |
|--------------|------------|--------|-----------|----------|
| Node not found | Medium | Low | Query returns null | Return structured error |
| Cycle in graph | High | Medium | Visited set check | Return partial with flag |
| Query timeout | Low | Medium | Timer | Return partial results |
| Memory exhaustion | Low | High | Result count check | Stream + limit |
| Missing references table | Low | High | Table existence check | Graceful degradation |

## Out of Scope

- Shortest path algorithms
- Graph visualization
- Community detection / clustering
- Weighted relationships
- Cross-workspace relationships
- Sibling relationships (same parent)
- Path queries (find path from A to B)
- Field references that aren't explicit node links
