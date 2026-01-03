---
id: "070"
feature: "Path Finding"
status: "draft"
created: "2026-01-01"
---

# Specification: Path Finding

## Overview

Add graph path finding capabilities to discover how two nodes are connected through parent/child relationships, references, and field links. Enables answering "how is A connected to B?" and understanding the relationship topology.

## User Scenarios

### Scenario 1: Find Connection Between Nodes

**As an** AI agent understanding context
**I want to** find how two nodes are related
**So that** I can explain their connection to the user

**Acceptance Criteria:**
- [ ] `tana_path` returns path(s) between two nodes
- [ ] Shows each hop with relationship type
- [ ] Finds shortest path by default
- [ ] Can request all paths up to max depth

### Scenario 2: Discover Relationship Type

**As a** user exploring knowledge graph
**I want to** understand how concepts connect
**So that** I can see the relationship structure

**Acceptance Criteria:**
- [ ] `supertag path <nodeA> <nodeB>` shows connection
- [ ] Path includes relationship types (parent, child, reference, field)
- [ ] Shows intermediate nodes with names
- [ ] Indicates if no path exists

### Scenario 3: Find Multiple Paths

**As a** user analyzing connections
**I want to** see all possible paths between nodes
**So that** I understand the full relationship network

**Acceptance Criteria:**
- [ ] `--all-paths` returns all paths up to max depth
- [ ] Paths are ranked by length (shortest first)
- [ ] Can limit number of paths returned
- [ ] Cycles are handled (don't infinite loop)

### Scenario 4: Constrained Path Finding

**As a** user looking for specific connections
**I want to** constrain path search by relationship type
**So that** I find only relevant connections

**Acceptance Criteria:**
- [ ] `--via reference` only follows references
- [ ] `--via parent,child` only follows hierarchy
- [ ] `--exclude <nodeId>` avoids specific nodes
- [ ] `--through <tag>` requires path through nodes with tag

## Functional Requirements

### FR-1: Path Tool/Command

MCP tool and CLI command for path finding:

```typescript
// MCP
tana_path({
  from: "nodeA-id",
  to: "nodeB-id",
  maxDepth: 5,                          // Maximum path length
  allPaths: false,                      // Return all paths vs shortest
  via: ["reference", "child"],          // Relationship types to traverse
  exclude: ["nodeX-id"],                // Nodes to avoid
  limit: 10                             // Max paths to return
})

// CLI
supertag path <fromNodeId> <toNodeId>
supertag path <fromNodeId> <toNodeId> --max-depth 3
supertag path <fromNodeId> <toNodeId> --all-paths --via reference
```

**Validation:** Returns path(s) between nodes or indicates no path exists.

### FR-2: Path Response Structure

Path results include full traversal details:

```typescript
{
  from: { id: "nodeA", name: "Project Alpha" },
  to: { id: "nodeB", name: "John Doe" },
  pathExists: true,
  shortestDistance: 3,
  paths: [
    {
      distance: 3,
      hops: [
        { node: { id: "nodeA", name: "Project Alpha" }, relation: null },
        { node: { id: "nodeC", name: "Meeting Notes" }, relation: { type: "child", direction: "out" } },
        { node: { id: "nodeD", name: "Attendees" }, relation: { type: "child", direction: "out" } },
        { node: { id: "nodeB", name: "John Doe" }, relation: { type: "reference", direction: "out" } }
      ]
    }
  ],
  searchStats: {
    nodesVisited: 45,
    pathsFound: 3,
    timeMs: 125
  }
}
```

**Validation:** Response includes all path details and search statistics.

### FR-3: Relationship Types for Traversal

Support these traversable relationship types:

| Type | Direction | Description |
|------|-----------|-------------|
| `parent` | up | From node to its parent |
| `child` | down | From node to its children |
| `reference` | both | Inline references (`[[node]]`) |
| `field` | both | Field values that are node references |
| `sibling` | lateral | Nodes sharing same parent |

**Validation:** Can filter path search by relationship type.

### FR-4: Path Finding Algorithm

Implement efficient path search:

**Validation:**
- BFS for shortest path (default)
- DFS with backtracking for all paths
- Visited set to prevent cycles
- Early termination when target found (shortest path mode)
- Respect maxDepth limit

### FR-5: Bidirectional Search

Optimize long-distance path finding:

**Validation:**
- Search from both ends simultaneously
- Meet in the middle
- Significantly faster for deep graphs
- Falls back to single-direction for shallow searches

### FR-6: No Path Response

Handle case when no path exists:

```typescript
{
  from: { id: "nodeA", name: "Project Alpha" },
  to: { id: "nodeB", name: "Unrelated Node" },
  pathExists: false,
  shortestDistance: null,
  paths: [],
  searchStats: {
    nodesVisited: 1000,
    maxDepthReached: true,
    timeMs: 450
  },
  suggestion: "Nodes appear to be in separate subgraphs. Try increasing --max-depth or removing --via constraints."
}
```

**Validation:** Provides helpful feedback when no path found.

## Non-Functional Requirements

- **Performance:** Find shortest path in < 500ms for depth 5
- **Memory:** Limit visited set size to prevent OOM
- **Depth Limit:** Default max depth 5, hard limit 10

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| PathQuery | Path search request | `from`, `to`, `maxDepth`, `via` |
| PathHop | Single step in path | `node`, `relation` |
| PathResult | Complete path | `distance`, `hops[]` |
| SearchStats | Algorithm metrics | `nodesVisited`, `timeMs` |

## Success Criteria

- [ ] "How are these connected?" answered in one call
- [ ] Shortest path found efficiently (BFS)
- [ ] All paths enumerated correctly (with limit)
- [ ] No infinite loops on cyclic graphs

## Assumptions

- Graph is not too dense (reasonable path count)
- Nodes have indexed relationships for efficient lookup
- Users understand graph traversal concepts

## [NEEDS CLARIFICATION]

- Should we support weighted paths (prefer certain relationship types)?
- Should we cache common path queries?
- How to handle very long paths (> 10 hops)?

## Out of Scope

- Weighted shortest path (Dijkstra)
- Path visualization
- Subgraph extraction
- Similarity-based path finding
- Cross-workspace paths
