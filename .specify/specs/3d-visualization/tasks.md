---
feature: "3D Visualization"
plan: "./plan.md"
status: "draft"
---

# Tasks: 3D Visualization

## T-1: Type Definitions

### T-1.1: Add ThreeRenderOptions Schema
**File:** `src/visualization/types.ts`
**Action:** Add ThreeRenderOptions Zod schema and type

```typescript
export const ThreeRenderOptionsSchema = z.object({
  layout: z.enum(["force", "hierarchical"]).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  showFields: z.boolean().optional(),
  showInheritedFields: z.boolean().optional(),
  sizeByUsage: z.boolean().optional(),
  cameraDistance: z.number().optional(),
});
```

**Test:** Validate schema accepts valid options, rejects invalid

---

## T-2: Three.js Bundle

### T-2.1: Create Bundle Script
**File:** `scripts/bundle-three.ts`
**Action:** Create Bun build script to bundle Three.js + 3d-force-graph

**Test:** Script runs without errors, produces valid JS

### T-2.2: Generate Three Bundle
**File:** `src/visualization/renderers/three-bundle.ts`
**Action:** Run bundle script, commit generated bundle

**Test:** Bundle exports THREE_BUNDLE string, < 2MB

---

## T-3: Core Renderer

### T-3.1: Create Renderer Scaffold
**File:** `src/visualization/renderers/three.ts`
**Action:** Create render3D() function with HTML template structure

```typescript
export function render3D(
  data: VisualizationData,
  options?: ThreeRenderOptions
): string {
  // HTML template with:
  // - Meta tags
  // - Style block
  // - Canvas container
  // - THREE_BUNDLE script
  // - Initialization script with data
}
```

**Test:** Returns valid HTML string with required elements

### T-3.2: Implement Data Serialization
**Action:** Serialize VisualizationData into inline JavaScript

**Test:** Nodes and links correctly embedded in output

### T-3.3: Implement Graph Initialization
**Action:** Initialize 3d-force-graph with nodes/links

**Test:** Graph renders without console errors (manual)

---

## T-4: Node Rendering

### T-4.1: Implement Sphere Nodes
**Action:** Render nodes as colored spheres

```javascript
.nodeThreeObject(node => {
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(5),
    new THREE.MeshLambertMaterial({ color: node.color || 0x1f77b4 })
  );
  return sphere;
})
```

**Test:** Nodes render with correct colors

### T-4.2: Implement Size by Usage
**Action:** Scale sphere radius by usage count when `sizeByUsage: true`

**Test:** Higher usage nodes are larger

### T-4.3: Implement Sprite Labels
**Action:** Add text labels using THREE.Sprite or CSS2DRenderer

**Test:** Labels visible and face camera

---

## T-5: Edge Rendering

### T-5.1: Implement Edge Lines
**Action:** Render links as curved lines

**Test:** Edges connect correct nodes

### T-5.2: Implement Edge Highlighting
**Action:** Change edge color/width when highlighted

**Test:** Selected path edges change appearance

---

## T-6: Camera Controls

### T-6.1: Implement OrbitControls
**Action:** Add rotate, pan, zoom via OrbitControls

**Test:** Mouse drag rotates, scroll zooms

### T-6.2: Implement Auto-Fit on Load
**Action:** Position camera to fit all nodes initially

**Test:** Graph centered and visible on load

### T-6.3: Implement Keyboard Shortcuts
**Action:** R = reset view, Escape = deselect

**Test:** Shortcuts work (manual)

---

## T-7: Selection & Highlighting

### T-7.1: Implement Node Click Selection
**Action:** Click node to select, click again to deselect

**Test:** Click handler fires, selection state updates

### T-7.2: Implement Path Highlighting
**Action:** Highlight ancestors and descendants of selected node

**Test:** Clicking node highlights all ancestors/descendants

### T-7.3: Implement Highlight Visuals
**Action:** Change node/edge appearance for highlighted items

**Test:** Highlighted nodes glow/brighten

---

## T-8: Information Display

### T-8.1: Implement Hover Tooltip
**Action:** Show tooltip with tag name, field count, usage on hover

**Test:** Tooltip appears on hover (manual)

### T-8.2: Implement Field Details in Tooltip
**Action:** Show field names/types when `showFields: true`

**Test:** Fields displayed in tooltip when option set

---

## T-9: Layout Modes

### T-9.1: Implement Force-Directed Layout
**Action:** Default layout using 3d-force-graph forces

**Test:** Nodes spread out, connected nodes cluster

### T-9.2: Implement Hierarchical Layout
**Action:** Constrain Y-axis by inheritance depth when `layout: "hierarchical"`

```javascript
.dagMode(options.layout === 'hierarchical' ? 'td' : null)
.dagLevelDistance(50)
```

**Test:** Parents above children in hierarchical mode

---

## T-10: Theme Support

### T-10.1: Implement Light Theme
**Action:** Light background, dark labels

**Test:** Correct colors in light theme

### T-10.2: Implement Dark Theme
**Action:** Dark background, light labels

**Test:** Correct colors in dark theme

---

## T-11: Smart Label Visibility

### T-11.1: Implement Zoom-Based Label Visibility
**Action:** Show/hide labels based on camera distance

**Test:** Labels hidden when zoomed out (manual)

### T-11.2: Implement Selection-Based Visibility
**Action:** Always show label for selected node and neighbors

**Test:** Selected node label visible at all zoom levels

---

## T-12: CLI Integration

### T-12.1: Register Renderer
**File:** `src/visualization/renderers/index.ts`
**Action:** Import and register render3D

```typescript
import { render3D } from "./three";
export { render3D };

export const renderers = {
  // ...existing
  "3d": render3D as RenderFunction,
};

export const supportedFormats = ["mermaid", "dot", "json", "html", "3d"];
```

**Test:** getRenderer("3d") returns function

### T-12.2: Add Layout Option to CLI
**File:** `src/commands/tags.ts`
**Action:** Add `--layout <force|hierarchical>` option

**Test:** Option parsed correctly

### T-12.3: Update Help Text
**Action:** Document 3d format and --layout option in help

**Test:** Help shows new options

---

## T-13: Testing

### T-13.1: Create Unit Tests
**File:** `tests/visualization/renderers/three.test.ts`
**Action:** Test render3D() function

Tests:
- Returns valid HTML
- Contains THREE_BUNDLE
- Serializes nodes/links correctly
- Applies theme option
- Applies layout option
- Handles empty data

### T-13.2: Create Integration Tests
**Action:** Test CLI with --format 3d

Tests:
- Produces output file
- Options passed through

---

## T-14: Documentation

### T-14.1: Update visualization.md
**File:** `docs/visualization.md`
**Action:** Document 3D format, options, examples

### T-14.2: Update CHANGELOG.md
**Action:** Add entry for 3D visualization feature

---

## T-15: Final Validation

### T-15.1: Browser Testing
**Action:** Test in Chrome, Firefox, Safari, Edge

Checklist:
- [ ] Graph renders
- [ ] Controls work (rotate, zoom, pan)
- [ ] Selection works
- [ ] Highlighting works
- [ ] Performance acceptable (500 nodes)
- [ ] Works offline

### T-15.2: Performance Testing
**Action:** Generate graphs with 100, 300, 500 nodes

Checklist:
- [ ] Initial render < 3s
- [ ] 60fps interaction
- [ ] No memory leaks

---

## Summary

| Phase | Tasks | Count |
|-------|-------|-------|
| Types | T-1 | 1 |
| Bundle | T-2 | 2 |
| Core Renderer | T-3 | 3 |
| Node Rendering | T-4 | 3 |
| Edge Rendering | T-5 | 2 |
| Camera Controls | T-6 | 3 |
| Selection | T-7 | 3 |
| Info Display | T-8 | 2 |
| Layout Modes | T-9 | 2 |
| Themes | T-10 | 2 |
| Smart Labels | T-11 | 2 |
| CLI | T-12 | 3 |
| Testing | T-13 | 2 |
| Documentation | T-14 | 2 |
| Validation | T-15 | 2 |
| **Total** | | **34 tasks** |
