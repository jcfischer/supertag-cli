---
id: "065"
feature: "Graph Traversal"
status: "draft"
created: "2026-01-01"
---

# Specification: Graph Traversal (Related Nodes)

## Overview

Add tools and commands to traverse the Tana node graph, finding nodes related to a given node through parent/child relationships, references, and field links. Enables answering "what's connected to this?" without multiple node lookups.

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

### Scenario 2: Show Node References

**As a** user understanding how a concept is used
**I want to** see all nodes that reference a specific node
**So that** I can understand its context and importance

**Acceptance Criteria:**
- [ ] `supertag related <nodeId> --direction in` shows incoming references
- [ ] Shows which nodes link to this node via inline refs or field values
- [ ] Includes the context (parent node) of each reference

### Scenario 3: Explore Outgoing Links

**As a** user following a trail of thoughts
**I want to** see what a node links to
**So that** I can follow the connection graph

**Acceptance Criteria:**
- [ ] `supertag related <nodeId> --direction out` shows outgoing links
- [ ] Includes references in node content
- [ ] Includes field values that are node references

### Scenario 4: Relationship Depth Traversal

**As a** user exploring a knowledge graph
**I want to** traverse multiple levels of relationships
**So that** I can see indirect connections

**Acceptance Criteria:**
- [ ] `--depth 2` finds nodes 2 hops away
- [ ] Each result includes its distance from the source
- [ ] Cycles are detected and handled (don't infinite loop)
- [ ] Results are deduplicated

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

### FR-2: Relationship Types

Support different relationship types:

| Type | Direction | Description |
|------|-----------|-------------|
| `child` | out | Direct children of the node |
| `parent` | in | Direct parent of the node |
| `reference` | both | Inline references (`[[node]]`) |
| `field` | both | Field values that are node references |

**Validation:** Can filter by one or more relationship types.

### FR-3: Direction Parameter

Control traversal direction:

| Direction | Meaning |
|-----------|---------|
| `in` | Nodes that reference/contain this node |
| `out` | Nodes that this node references/contains |
| `both` | Both directions |

**Validation:** Direction correctly filters relationship direction.

### FR-4: Depth Traversal

Multi-hop traversal with depth tracking:

**Validation:**
- `depth: 0` returns only directly connected nodes
- `depth: 1` returns direct + one hop away
- Each result includes `distance` field
- Circular references don't cause infinite loops
- Default max depth is 3

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

## Assumptions

- References are indexed in the database (tag_applications or similar)
- Node graph is not too dense (avg < 20 connections per node)
- Users understand graph traversal concepts

## [NEEDS CLARIFICATION]

- Should we include "weak" relationships (same parent = sibling)?
- Should we support path queries (find path from A to B)?
- How to handle field references that aren't explicit node links?

## Out of Scope

- Shortest path algorithms
- Graph visualization
- Community detection / clustering
- Weighted relationships
- Cross-workspace relationships
