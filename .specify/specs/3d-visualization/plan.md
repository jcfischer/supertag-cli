---
feature: "3D Visualization"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: 3D Visualization

## Architecture Overview

Extend the existing visualization system with a 3D renderer that generates self-contained HTML files using Three.js and 3d-force-graph.

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLI: tags visualize                         │
│                       --format 3d                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              VisualizationService                               │
│   getData() / getDataWithFields() → VisualizationData           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              renderers/three.ts (NEW)                           │
│   render3D(data, options) → HTML string                         │
│   - Inlined Three.js + 3d-force-graph (~800KB)                  │
│   - Force-directed layout with hierarchical constraint option   │
│   - Pan/zoom/rotate via OrbitControls                           │
│   - Click-to-highlight inheritance path                         │
│   - Node labels (sprites or HTML overlay)                       │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard |
| 3D Engine | Three.js | Industry standard, WebGL-based, wide browser support |
| Graph Layout | 3d-force-graph | Purpose-built for 3D graph viz, includes Three.js |
| Output | Self-contained HTML | Matches existing HTML renderer pattern |

## Key Decisions

### Decision 1: Layout Algorithm

**Choice: Force-directed with optional hierarchical constraint**

- **Force-directed (default)**: Natural clustering of connected nodes, intuitive 3D exploration
- **Hierarchical mode (`--layout hierarchical`)**: Constrains Y-axis by inheritance depth, parents above children

Rationale: Pure hierarchical layouts lose benefit in 3D (hard to perceive layers). Force-directed better exploits 3D space while hierarchical option preserves familiar orientation.

### Decision 2: Node Rendering

**Choice: Spheres with sprite labels**

- Spheres colored by Tana tag color (or default gradient)
- Sprite labels always face camera (billboarding)
- Field details on hover (HTML overlay tooltip)

Rationale: Spheres render fast, scale well to 500 nodes. Sprite labels maintain readability at all angles.

### Decision 3: Bundle Strategy

**Choice: Inline minified libraries**

- Bundle 3d-force-graph + Three.js at build time (~800KB minified)
- Store in `src/visualization/renderers/three-bundle.ts` as template literal
- Template includes placeholders for data injection

Rationale: Matches HTML renderer's self-contained approach. Single HTML file works offline.

### Decision 4: Camera Controls

**Choice: OrbitControls (included with Three.js)**

- Left-drag: rotate around center
- Right-drag / shift+drag: pan
- Scroll wheel: zoom
- Touch: pinch-zoom, drag-rotate

### Decision 5: Label Rendering

**Choice: Smart visibility based on zoom level**

- Close zoom: All labels visible
- Medium zoom: Labels for selected node + direct neighbors
- Far zoom: Only selected node label

Rationale: Prevents label clutter at overview zoom levels.

## Constitutional Compliance

- [x] **CLI-First:** Extends existing `tags visualize --format 3d` command
- [x] **Library-First:** Core logic in `renderers/three.ts`, reusable module
- [x] **Test-First:** TDD approach with tests before implementation
- [x] **Deterministic:** Layout uses seeded random for reproducible results
- [x] **Code Before Prompts:** All rendering logic in TypeScript, no LLM calls

## Data Model

### Existing Types (No Changes Needed)

```typescript
// Already defined in types.ts - reused as-is
interface VisualizationNode {
  id: string;
  name: string;
  fieldCount: number;
  usageCount: number;
  color?: string;
  isOrphan: boolean;
  isLeaf: boolean;
  fields?: VisualizationField[];
}

interface VisualizationLink {
  source: string;
  target: string;
}

interface VisualizationData {
  nodes: VisualizationNode[];
  links: VisualizationLink[];
  metadata: VisualizationMetadata;
}
```

### New Types

```typescript
// src/visualization/types.ts - additions
export const ThreeRenderOptionsSchema = z.object({
  /** Layout algorithm */
  layout: z.enum(["force", "hierarchical"]).optional().default("force"),
  /** Color theme */
  theme: z.enum(["light", "dark"]).optional().default("light"),
  /** Show field details in node tooltips */
  showFields: z.boolean().optional().default(false),
  /** Include inherited fields in tooltips */
  showInheritedFields: z.boolean().optional().default(false),
  /** Node size based on usage count */
  sizeByUsage: z.boolean().optional().default(false),
  /** Initial camera distance multiplier */
  cameraDistance: z.number().optional().default(1.5),
});

export type ThreeRenderOptions = z.infer<typeof ThreeRenderOptionsSchema>;
```

## API Contracts

### Internal APIs

```typescript
// src/visualization/renderers/three.ts

/**
 * Render visualization data as 3D interactive HTML.
 *
 * @param data - Visualization data
 * @param options - 3D renderer options
 * @returns Complete HTML document string with inlined Three.js
 */
export function render3D(
  data: VisualizationData,
  options?: ThreeRenderOptions
): string;

/**
 * Get the bundled Three.js + 3d-force-graph code.
 * Used internally, exported for testing.
 */
export function getThreeBundle(): string;
```

### CLI Integration

```bash
# Basic 3D output
supertag tags visualize --format 3d --output graph.html

# With options
supertag tags visualize --format 3d \
  --layout hierarchical \
  --theme dark \
  --show-fields \
  --output graph.html --open

# Subtree filtering (existing options work)
supertag tags visualize --format 3d --root meeting --depth 3
```

## Implementation Strategy

### Phase 1: Foundation

1. Add ThreeRenderOptions to types.ts
2. Create three-bundle.ts with minified Three.js + 3d-force-graph
3. Scaffold render3D() function with basic HTML template

### Phase 2: Core 3D Rendering

1. Implement force-directed graph initialization
2. Add node rendering (spheres with colors)
3. Add edge rendering (lines/curves)
4. Add label rendering (sprites)
5. Implement camera controls (OrbitControls)

### Phase 3: Interactivity

1. Click-to-select node
2. Highlight inheritance path (ancestors + descendants)
3. Hover tooltip with node details
4. Keyboard shortcuts (Escape to deselect, R to reset view)

### Phase 4: Advanced Features

1. Hierarchical layout mode
2. Smart label visibility based on zoom
3. Node sizing by usage count
4. Theme support (light/dark)

### Phase 5: CLI Integration

1. Register renderer in index.ts
2. Add --layout option to CLI
3. Update help text
4. Documentation

## File Structure

```
src/visualization/
├── types.ts                      # [Modified] Add ThreeRenderOptions
├── service.ts                    # [No changes]
└── renderers/
    ├── index.ts                  # [Modified] Register render3D
    ├── three.ts                  # [New] 3D renderer
    └── three-bundle.ts           # [New] Bundled Three.js code

tests/visualization/renderers/
└── three.test.ts                 # [New] 3D renderer tests

docs/
└── visualization.md              # [Modified] Document 3D format
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Bundle size too large (>2MB) | Medium | Medium | Use minified builds, consider CDN fallback option |
| Performance with 500 nodes | High | Low | 3d-force-graph designed for this scale; add node count warning |
| WebGL not available | Medium | Low | Detect WebGL support, show fallback message |
| Mobile touch issues | Low | Medium | Test on iOS Safari; OrbitControls has touch support |

## Dependencies

### External

- **three** - 3D rendering engine (bundled, ~500KB min)
- **3d-force-graph** - Graph visualization (bundled, ~300KB min)

Note: Dependencies are bundled at build time into `three-bundle.ts`, not runtime npm dependencies.

### Internal

- `src/visualization/types.ts` - Existing type definitions
- `src/visualization/service.ts` - Data preparation
- `src/commands/tags.ts` - CLI integration

## Build Process

1. Install dev dependencies: `bun add -D three 3d-force-graph`
2. Create bundle script: `scripts/bundle-three.ts`
3. Bundle generates `src/visualization/renderers/three-bundle.ts`
4. Bundle is committed to repo (no runtime fetch needed)

```typescript
// scripts/bundle-three.ts
import { build } from "bun";

const result = await build({
  entrypoints: ["./bundle-entry.ts"],
  minify: true,
  target: "browser",
});

// Write as template literal export
const code = await result.outputs[0].text();
await Bun.write(
  "src/visualization/renderers/three-bundle.ts",
  `export const THREE_BUNDLE = \`${code.replace(/`/g, "\\`")}\`;`
);
```

## Testing Strategy

### Unit Tests

1. **render3D returns valid HTML** - Check structure, script tags
2. **Options are applied correctly** - Theme, layout, showFields
3. **Data is correctly serialized** - Nodes and links in output
4. **Empty graph handling** - Graceful message

### Integration Tests

1. **CLI produces output file** - `--format 3d --output graph.html`
2. **Options passed through CLI** - `--layout hierarchical`
3. **Existing options work** - `--root`, `--depth`, `--show-fields`

### Manual Testing

1. Open generated HTML in Chrome, Firefox, Safari
2. Test rotation, zoom, pan
3. Test node selection and highlighting
4. Test with 10, 100, 500 node graphs
5. Test offline (no network)

## Migration/Deployment

- [ ] No database migrations needed
- [ ] No environment variables needed
- [ ] No breaking changes to existing functionality
- [ ] Build script added to npm scripts

## Estimated Complexity

- **New files:** 3 (three.ts, three-bundle.ts, three.test.ts)
- **Modified files:** 3 (types.ts, index.ts, tags.ts)
- **Documentation:** 1 (visualization.md)
- **Estimated tasks:** ~15 atomic tasks
