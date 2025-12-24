---
id: "021"
feature: "3D Visualization"
status: "draft"
created: "2025-12-24"
---

# Specification: 3D Visualization

## Overview

Add interactive 3D visualization to the `tags visualize` command, enabling users to explore complex supertag inheritance hierarchies in three-dimensional space. This addresses the limitation of 2D graphs when dealing with large, deeply nested, or highly interconnected tag structures where flat representations become cluttered and hard to navigate.

## User Scenarios

### Scenario 1: Exploring Large Tag Hierarchies

**As a** Tana power user with 100+ supertags
**I want to** visualize my entire tag inheritance graph in 3D
**So that** I can understand the overall structure without nodes overlapping or edges crossing

**Acceptance Criteria:**
- [ ] Graph renders with all nodes visible and spatially separated
- [ ] Inheritance relationships are clearly visible as edges between nodes
- [ ] Can rotate the view to see the graph from any angle
- [ ] Can zoom in/out to focus on specific areas
- [ ] Can pan to navigate around the graph

### Scenario 2: Tracing Inheritance Chains

**As a** Tana user debugging field inheritance
**I want to** click on a tag and see its complete inheritance path highlighted
**So that** I can understand where inherited fields come from

**Acceptance Criteria:**
- [ ] Clicking a node highlights it and all ancestors (parents, grandparents, etc.)
- [ ] Clicking a node highlights all descendants (children, grandchildren, etc.)
- [ ] Highlighted path is visually distinct (color, glow, or thickness)
- [ ] Clicking elsewhere or pressing Escape clears the highlight

### Scenario 3: Inspecting Tag Details

**As a** Tana user
**I want to** hover over or click a tag node to see its details
**So that** I can inspect field counts, usage statistics, and relationships without leaving the 3D view

**Acceptance Criteria:**
- [ ] Hovering shows a tooltip with tag name and basic stats
- [ ] Clicking shows a detail panel with fields, usage count, and direct parents/children
- [ ] Detail panel doesn't obscure the graph significantly

### Scenario 4: Focusing on Subtrees

**As a** Tana user with a specific tag hierarchy to examine
**I want to** filter the 3D view to show only a subtree starting from a given tag
**So that** I can focus on relevant portions without distraction

**Acceptance Criteria:**
- [ ] `--root <tag>` option limits visualization to that tag's subtree
- [ ] `--depth <n>` option limits how many inheritance levels to show
- [ ] Filtered graph maintains 3D layout quality

### Scenario 5: Sharing Visualizations

**As a** Tana user documenting my workspace
**I want to** export the 3D visualization as a self-contained file
**So that** I can share it with others who don't have supertag-cli installed

**Acceptance Criteria:**
- [ ] Output is a single HTML file with no external dependencies
- [ ] File works offline in any modern browser
- [ ] File size is reasonable (< 5MB for typical graphs)

## Functional Requirements

### FR-1: 3D Graph Rendering

The system must render supertag nodes as 3D objects positioned in three-dimensional space, with edges connecting child tags to their parent tags.

**Validation:** Generate 3D visualization for a graph with 50+ nodes; verify all nodes render without visual glitches.

### FR-2: Force-Directed Layout

The system must automatically position nodes using a force-directed or hierarchical 3D layout algorithm that:
- Keeps connected nodes closer together
- Prevents node overlap
- Distributes nodes evenly in 3D space
- Positions parent nodes above/behind children (respecting direction option)

**Validation:** Generate visualization; verify no overlapping nodes and clear parent-child positioning.

### FR-3: Interactive Navigation

The system must support:
- Mouse drag to rotate the view (orbit camera)
- Scroll wheel to zoom in/out
- Right-drag or shift-drag to pan
- Touch gestures on mobile (pinch-zoom, drag-rotate)

**Validation:** Test all navigation methods; verify smooth, responsive interaction.

### FR-4: Node Selection and Highlighting

The system must allow users to click nodes to select them and highlight the complete inheritance path (ancestors and descendants).

**Validation:** Click a node with multiple ancestors and descendants; verify all are highlighted.

### FR-5: Information Display

The system must display:
- Tag name on each node (always visible or on hover)
- Field count and usage count (on hover or in detail panel)
- Parent and child tags (in detail panel)

**Validation:** Hover over nodes; verify information appears correctly.

### FR-6: Self-Contained Output

The system must generate a single HTML file containing all necessary code (JavaScript, CSS) with no external runtime dependencies.

**Validation:** Open generated file with network disabled; verify full functionality.

### FR-7: CLI Integration

The system must integrate with existing `tags visualize` command:
- `--format 3d` or `--format three` to select 3D output
- Support existing options: `--root`, `--depth`, `--output`, `--open`
- Support `--show-fields` to display field details on nodes

**Validation:** Run `supertag tags visualize --format 3d --output graph.html`; verify file generated.

### FR-8: Theme Support

The system must support light and dark themes via `--theme` option, consistent with HTML format.

**Validation:** Generate with `--theme dark`; verify appropriate color scheme.

## Non-Functional Requirements

- **Performance:** Render graphs up to 500 nodes with smooth 60fps interaction
- **Performance:** Initial render time < 3 seconds for 200-node graphs
- **File Size:** Generated HTML file < 2MB for library code, plus data
- **Compatibility:** Works in Chrome, Firefox, Safari, Edge (latest 2 versions)
- **Accessibility:** Keyboard navigation for basic functions (zoom, reset view)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| Node | A supertag in 3D space | id, name, position (x,y,z), color, fieldCount, usageCount |
| Edge | Parent-child relationship | sourceId, targetId, highlighted state |
| Camera | User's viewpoint | position, rotation, zoom level |
| Selection | Currently selected node(s) | nodeId, highlighted path set |

## Success Criteria

- [ ] 3D visualization renders correctly for graphs with 10-500 nodes
- [ ] All interactive features (rotate, zoom, pan, select) work smoothly
- [ ] Generated HTML file works offline with no console errors
- [ ] Performance meets targets (60fps, <3s initial load)
- [ ] Existing `--root`, `--depth`, `--show-fields` options work with 3D format
- [ ] All tests pass (unit tests for data preparation, integration tests for CLI)

## Assumptions

- Users have WebGL-capable browsers (standard for all modern browsers)
- Graphs typically have < 500 nodes (Tana workspaces rarely exceed this)
- Users understand basic 3D navigation (drag to rotate is intuitive)

## [NEEDS CLARIFICATION]

- **Layout algorithm preference**: Should we use force-directed (organic) or hierarchical (structured) 3D layout? Force-directed may look better but hierarchical shows inheritance clearer.
- **Node shape**: Spheres (simple), boxes (like HTML UML), or custom shapes based on tag type?
- **Label rendering**: Always visible labels (may clutter), on-hover only, or smart culling based on zoom level?
- **Mobile support priority**: Full touch support or desktop-first with basic mobile?

## Out of Scope

- VR/AR headset support
- Real-time collaboration / multiplayer viewing
- Animation of graph changes over time
- Export to 3D file formats (GLTF, OBJ)
- Integration with external 3D modeling tools
- Editing tags directly in the 3D view
