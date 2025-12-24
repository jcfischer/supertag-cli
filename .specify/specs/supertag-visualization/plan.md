---
feature: "Supertag Inheritance Visualization"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Supertag Inheritance Visualization

## Architecture Overview

A modular visualization system with format-specific renderers that share a common data layer. The architecture follows a clean separation: data gathering → transformation → format-specific rendering.

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Command                              │
│              supertag tags visualize [options]                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VisualizationService                          │
│  • Gathers all inheritance data from DB                          │
│  • Applies filters (--root, --depth, --min-usage)               │
│  • Returns VisualizationData (nodes + links)                    │
└───────────────────────────────┬─────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ MermaidFormat │     │   DOTFormat   │     │  JSONFormat   │
│   Renderer    │     │   Renderer    │     │   Renderer    │
├───────────────┤     ├───────────────┤     ├───────────────┤
│ flowchart BT  │     │ digraph {...} │     │ {nodes,links} │
└───────────────┘     └───────────────┘     └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                      stdout / file
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Database | SQLite (existing) | Data already indexed |
| CLI | Commander.js | Existing CLI framework |
| Renderers | Pure TypeScript | No dependencies for Phase 1 |
| HTML (Phase 2) | D3.js via CDN | No bundling needed |

## Constitutional Compliance

- [x] **CLI-First:** New `supertag tags visualize` command with all options
- [x] **Library-First:** `VisualizationService` class is reusable, renderers are pure functions
- [x] **Test-First:** TDD for data gathering and each renderer
- [x] **Deterministic:** String output from same input always identical
- [x] **Code Before Prompts:** All logic in TypeScript, no LLM prompts

## Data Model

### Entities

```typescript
// src/visualization/types.ts

/**
 * Core visualization data structure shared by all renderers
 */
export interface VisualizationData {
  nodes: VisualizationNode[];
  links: VisualizationLink[];
  metadata: VisualizationMetadata;
}

/**
 * A single supertag in the graph
 */
export interface VisualizationNode {
  id: string;              // tagDef node ID
  name: string;            // Display name (e.g., "meeting")
  fieldCount: number;      // Own fields count
  usageCount: number;      // Tag applications count
  color?: string;          // From Tana (hex or name)
  isOrphan: boolean;       // Has no parents
  isLeaf: boolean;         // Has no children
}

/**
 * An inheritance relationship (child extends parent)
 */
export interface VisualizationLink {
  source: string;          // Child tag ID
  target: string;          // Parent tag ID
}

/**
 * Graph metadata for display
 */
export interface VisualizationMetadata {
  totalTags: number;
  totalLinks: number;
  maxDepth: number;
  rootTag?: string;        // If filtered by --root
  generatedAt: string;     // ISO timestamp
  workspace: string;
}

/**
 * Options for filtering visualization
 */
export interface VisualizationOptions {
  root?: string;           // Filter to subtree from this tag
  depth?: number;          // Max traversal depth
  minUsage?: number;       // Minimum tag applications
  includeOrphans?: boolean;// Include tags with no parents
  workspace?: string;
}
```

### Database Queries

No new tables needed. Uses existing:
- `supertag_parents` - inheritance relationships
- `supertag_metadata` - tag names, colors, descriptions
- `supertag_fields` - field counts
- `tag_applications` - usage counts

**Main query for all relationships:**
```sql
-- Get all tags with metadata
SELECT
  sm.tag_id,
  sm.tag_name,
  sm.color,
  (SELECT COUNT(*) FROM supertag_fields sf WHERE sf.tag_id = sm.tag_id) as field_count,
  (SELECT COUNT(*) FROM tag_applications ta WHERE ta.tag_id = sm.tag_id) as usage_count,
  (SELECT COUNT(*) FROM supertag_parents sp WHERE sp.child_tag_id = sm.tag_id) as parent_count,
  (SELECT COUNT(*) FROM supertag_parents sp WHERE sp.parent_tag_id = sm.tag_id) as child_count
FROM supertag_metadata sm

-- Get all links
SELECT child_tag_id, parent_tag_id
FROM supertag_parents
```

## API Contracts

### Internal APIs

```typescript
// src/visualization/service.ts

/**
 * Gather visualization data from database
 */
export class VisualizationService {
  constructor(db: Database);

  /**
   * Get full visualization data with optional filtering
   */
  getData(options?: VisualizationOptions): VisualizationData;

  /**
   * Get subtree starting from a specific tag
   */
  getSubtree(rootTagName: string, depth?: number): VisualizationData;

  /**
   * Calculate max depth in the inheritance graph
   */
  getMaxDepth(): number;
}
```

```typescript
// src/visualization/renderers/mermaid.ts

/**
 * Render visualization data as Mermaid flowchart
 */
export function renderMermaid(data: VisualizationData, options?: {
  direction?: 'TD' | 'BT' | 'LR' | 'RL';
  showFieldCount?: boolean;
  showUsageCount?: boolean;
}): string;
```

```typescript
// src/visualization/renderers/dot.ts

/**
 * Render visualization data as Graphviz DOT
 */
export function renderDOT(data: VisualizationData, options?: {
  rankdir?: 'TB' | 'BT' | 'LR' | 'RL';
  showFieldCount?: boolean;
  useColors?: boolean;
}): string;
```

```typescript
// src/visualization/renderers/json.ts

/**
 * Render visualization data as JSON (essentially identity with formatting)
 */
export function renderJSON(data: VisualizationData, options?: {
  pretty?: boolean;
}): string;
```

## Implementation Strategy

### Phase 1: Foundation (Data Layer)

Build the data gathering infrastructure that all renderers will use.

- [x] Create `src/visualization/types.ts` with TypeScript interfaces
- [ ] Create `src/visualization/service.ts` with `VisualizationService`
- [ ] Write tests for data gathering (TDD)
- [ ] Verify with real database queries

### Phase 2: Core Renderers (Mermaid, DOT, JSON)

Implement the three Phase 1 formats from spec.

- [ ] Create `src/visualization/renderers/mermaid.ts`
- [ ] Create `src/visualization/renderers/dot.ts`
- [ ] Create `src/visualization/renderers/json.ts`
- [ ] Write tests for each renderer (TDD)

### Phase 3: CLI Integration

Wire the visualization into the existing `tags` command group.

- [ ] Add `visualize` subcommand to `src/commands/tags.ts`
- [ ] Implement all CLI options (--format, --root, --depth, etc.)
- [ ] Add --output and --open options
- [ ] E2E tests for CLI command

### Phase 4: Documentation & Polish

- [ ] Add usage examples to README
- [ ] Update SKILL.md with visualization commands
- [ ] Add --help examples

## File Structure

```
src/
├── visualization/
│   ├── types.ts                    # [New] TypeScript interfaces
│   ├── service.ts                  # [New] VisualizationService
│   └── renderers/
│       ├── index.ts                # [New] Renderer exports
│       ├── mermaid.ts              # [New] Mermaid renderer
│       ├── dot.ts                  # [New] DOT renderer
│       └── json.ts                 # [New] JSON renderer
├── commands/
│   └── tags.ts                     # [Modified] Add visualize subcommand
└── index.ts                        # [No change]

tests/
├── visualization/
│   ├── service.test.ts             # [New] Data gathering tests
│   └── renderers/
│       ├── mermaid.test.ts         # [New] Mermaid output tests
│       ├── dot.test.ts             # [New] DOT output tests
│       └── json.test.ts            # [New] JSON output tests
└── commands/
    └── tags-visualize.test.ts      # [New] CLI integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Large graphs crash Mermaid renderers | Medium | Low | Document limit, suggest DOT for 50+ tags |
| Cycles in inheritance cause infinite loops | High | Low | Already handled by depth limit in recursive CTE |
| Tags without names appear as IDs | Low | Medium | Fallback to ID, document behavior |
| DOT syntax escaping issues | Low | Medium | Proper string escaping, test with special chars |
| Empty workspace (no tags) | Low | Low | Return empty graph gracefully |

## Dependencies

### External

None for Phase 1. Renderers output pure text.

Optional (user-installed):
- `graphviz` - For DOT → SVG/PDF conversion

### Internal

- `SupertagMetadataService` - Tag name resolution, inheritance queries
- `supertag_parents` table - Direct relationships
- `supertag_metadata` table - Tag metadata
- `tag_applications` table - Usage counts
- Commander.js - CLI framework

## Migration/Deployment

- [ ] **Database migrations needed?** No - uses existing tables
- [ ] **Environment variables?** No
- [ ] **Breaking changes?** No - new command only
- [ ] **Binary rebuild?** Yes - after implementation

## Estimated Complexity

- **New files:** 8
- **Modified files:** 1 (`src/commands/tags.ts`)
- **Test files:** 5
- **Estimated tasks:** 12-15

## Design Decisions

1. **No clustering by default**: Mermaid/DOT clustering requires knowing tag categories. Defer to future enhancement.

2. **Direction defaults**:
   - Mermaid: `BT` (bottom-to-top) - children at bottom, parents above
   - DOT: `BT` - same convention

3. **Orphan handling**: By default exclude orphan tags (no parents). Use `--orphans` to include.

4. **ID escaping**: Replace special characters in tag names for DOT/Mermaid node IDs. Use sanitized version as ID, original as label.

5. **Color handling**: Use Tana colors if available, otherwise default gray. DOT supports fill colors, Mermaid supports via styling.

## Future Enhancements (Not in Scope)

- Phase 2: Interactive HTML with D3.js
- Phase 3: 3D visualization with Three.js
- Phase 4: Live server mode
- Auto-clustering by tag category
- Field-level visualization
- Cross-workspace comparison
