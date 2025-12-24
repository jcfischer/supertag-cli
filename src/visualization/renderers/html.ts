/**
 * HTML Renderer
 *
 * Renders VisualizationData as a self-contained interactive HTML file.
 * Uses Dagre for hierarchical graph layout and SVG for rendering.
 * Features: pan, zoom, click-to-highlight, UML-style class diagram nodes.
 */

import type {
  VisualizationData,
  VisualizationNode,
  HTMLRenderOptions,
} from "../types";

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate CSS for UML-style nodes with theme support
 */
function generateCSS(theme: "light" | "dark"): string {
  const colors =
    theme === "dark"
      ? {
          bg: "#1e1e1e",
          nodeBg: "#2d2d2d",
          nodeBorder: "#555",
          headerBg: "#3d3d3d",
          text: "#e0e0e0",
          textMuted: "#888",
          link: "#666",
          linkHover: "#888",
          highlight: "#4a9eff",
          divider: "#444",
        }
      : {
          bg: "#ffffff",
          nodeBg: "#ffffff",
          nodeBorder: "#ccc",
          headerBg: "#f5f5f5",
          text: "#333",
          textMuted: "#666",
          link: "#999",
          linkHover: "#666",
          highlight: "#0066cc",
          divider: "#ddd",
        };

  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${colors.bg};
      overflow: hidden;
      user-select: none;
    }
    #container {
      width: 100vw;
      height: 100vh;
      cursor: grab;
    }
    #container.dragging { cursor: grabbing; }
    svg {
      width: 100%;
      height: 100%;
    }
    .node {
      cursor: pointer;
    }
    .node-box {
      fill: ${colors.nodeBg};
      stroke: ${colors.nodeBorder};
      stroke-width: 1;
      rx: 4;
    }
    .node.highlighted .node-box {
      stroke: ${colors.highlight};
      stroke-width: 2;
    }
    .node-header {
      fill: ${colors.headerBg};
      rx: 4;
    }
    .node-title {
      font-size: 12px;
      font-weight: 600;
      fill: ${colors.text};
    }
    .node-field {
      font-size: 10px;
      fill: ${colors.text};
    }
    .node-field.inherited {
      font-style: italic;
      fill: ${colors.textMuted};
    }
    .node-field-type {
      fill: ${colors.textMuted};
    }
    .node-origin {
      font-size: 9px;
      fill: ${colors.textMuted};
    }
    .node-footer {
      font-size: 9px;
      fill: ${colors.textMuted};
    }
    .node-divider {
      stroke: ${colors.divider};
      stroke-width: 1;
    }
    .edge {
      stroke: ${colors.link};
      stroke-width: 1.5;
      fill: none;
    }
    .edge.highlighted {
      stroke: ${colors.highlight};
      stroke-width: 2;
    }
    .edge-arrow {
      fill: ${colors.link};
    }
    .edge.highlighted .edge-arrow {
      fill: ${colors.highlight};
    }
    #info-panel {
      position: fixed;
      bottom: 16px;
      left: 16px;
      background: ${colors.nodeBg};
      border: 1px solid ${colors.nodeBorder};
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 12px;
      color: ${colors.textMuted};
      z-index: 100;
    }
    #info-panel strong { color: ${colors.text}; }
    .empty-message {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 16px;
      color: ${colors.textMuted};
    }
  `;
}

/**
 * Generate JSON data for client-side rendering
 */
function generateNodeData(
  nodes: VisualizationNode[],
  options: HTMLRenderOptions
): string {
  const { showFields = false, showInheritedFields = false } = options;

  const processedNodes = nodes.map((node) => {
    let fields = node.fields || [];

    if (!showFields) {
      fields = [];
    } else if (!showInheritedFields) {
      fields = fields.filter((f) => !f.inherited);
    }

    return {
      id: node.id,
      name: escapeHtml(node.name),
      fieldCount: node.fieldCount,
      usageCount: node.usageCount,
      color: node.color,
      isOrphan: node.isOrphan,
      isLeaf: node.isLeaf,
      fields: fields.map((f) => ({
        name: escapeHtml(f.name),
        dataType: f.dataType ? escapeHtml(f.dataType) : undefined,
        inherited: f.inherited,
        originTag: f.originTag ? escapeHtml(f.originTag) : undefined,
      })),
    };
  });

  return JSON.stringify(processedNodes);
}

/**
 * Generate the embedded JavaScript for layout and interaction
 */
function generateJavaScript(
  data: VisualizationData,
  options: HTMLRenderOptions
): string {
  const direction = options.direction || "BT";
  const nodeData = generateNodeData(data.nodes, options);
  const linkData = JSON.stringify(data.links);

  return `
(function() {
  // Data
  const nodes = ${nodeData};
  const links = ${linkData};
  const direction = "${direction}";

  // Layout constants - generous spacing to avoid overlap
  const NODE_WIDTH = 200;
  const FIELD_HEIGHT = 18;
  const HEADER_HEIGHT = 28;
  const FOOTER_HEIGHT = 22;
  const PADDING = 8;
  const NODE_SPACING_H = 80;   // Horizontal gap between nodes in same layer
  const LAYER_SPACING = 120;   // Vertical gap between layers

  // State
  let transform = { x: 0, y: 0, scale: 1 };
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let highlightedPath = new Set();

  // Calculate node height based on fields
  function calcNodeHeight(node) {
    const fieldsHeight = node.fields.length * FIELD_HEIGHT;
    return HEADER_HEIGHT + fieldsHeight + FOOTER_HEIGHT + (node.fields.length > 0 ? PADDING : 0);
  }

  // Improved hierarchical layout with proper spacing
  function layoutGraph() {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const childrenMap = new Map();
    const parentsMap = new Map();

    // Build adjacency
    nodes.forEach(n => {
      childrenMap.set(n.id, []);
      parentsMap.set(n.id, []);
    });
    links.forEach(l => {
      childrenMap.get(l.target)?.push(l.source);
      parentsMap.get(l.source)?.push(l.target);
    });

    // Find roots (no parents) - these go at layer 0
    const roots = nodes.filter(n => parentsMap.get(n.id)?.length === 0);

    // Use longest-path layering (ensures children are always below parents)
    const layers = new Map();

    // Initialize all nodes as unassigned
    nodes.forEach(n => layers.set(n.id, -1));

    // Assign roots to layer 0
    roots.forEach(r => layers.set(r.id, 0));

    // Process nodes in topological order - each child is at max(parent layers) + 1
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 100) {
      changed = false;
      iterations++;
      nodes.forEach(n => {
        const parents = parentsMap.get(n.id) || [];
        if (parents.length > 0) {
          const maxParentLayer = Math.max(...parents.map(p => layers.get(p) ?? -1));
          if (maxParentLayer >= 0) {
            const newLayer = maxParentLayer + 1;
            if (layers.get(n.id) < newLayer) {
              layers.set(n.id, newLayer);
              changed = true;
            }
          }
        }
      });
    }

    // Handle disconnected nodes - put them at layer 0
    nodes.forEach(n => {
      if (layers.get(n.id) < 0) {
        layers.set(n.id, 0);
      }
    });

    // Group by layer
    const layerGroups = new Map();
    let maxLayer = 0;
    layers.forEach((layer, id) => {
      maxLayer = Math.max(maxLayer, layer);
      if (!layerGroups.has(layer)) layerGroups.set(layer, []);
      layerGroups.get(layer).push(id);
    });

    // Sort nodes within each layer using barycenter method
    // (order by average position of connected nodes in adjacent layers)
    for (let iter = 0; iter < 4; iter++) {
      // Down pass: order by parent positions
      for (let layer = 1; layer <= maxLayer; layer++) {
        const layerNodes = layerGroups.get(layer) || [];
        const prevLayer = layerGroups.get(layer - 1) || [];
        const prevPositions = new Map(prevLayer.map((id, i) => [id, i]));

        layerNodes.sort((a, b) => {
          const aParents = parentsMap.get(a) || [];
          const bParents = parentsMap.get(b) || [];
          const aCenter = aParents.length > 0
            ? aParents.reduce((sum, p) => sum + (prevPositions.get(p) ?? 0), 0) / aParents.length
            : 0;
          const bCenter = bParents.length > 0
            ? bParents.reduce((sum, p) => sum + (prevPositions.get(p) ?? 0), 0) / bParents.length
            : 0;
          return aCenter - bCenter;
        });
        layerGroups.set(layer, layerNodes);
      }

      // Up pass: order by children positions
      for (let layer = maxLayer - 1; layer >= 0; layer--) {
        const layerNodes = layerGroups.get(layer) || [];
        const nextLayer = layerGroups.get(layer + 1) || [];
        const nextPositions = new Map(nextLayer.map((id, i) => [id, i]));

        layerNodes.sort((a, b) => {
          const aChildren = childrenMap.get(a) || [];
          const bChildren = childrenMap.get(b) || [];
          const aCenter = aChildren.length > 0
            ? aChildren.reduce((sum, c) => sum + (nextPositions.get(c) ?? 0), 0) / aChildren.length
            : 0;
          const bCenter = bChildren.length > 0
            ? bChildren.reduce((sum, c) => sum + (nextPositions.get(c) ?? 0), 0) / bChildren.length
            : 0;
          return aCenter - bCenter;
        });
        layerGroups.set(layer, layerNodes);
      }
    }

    // Calculate node heights
    const heights = new Map();
    nodes.forEach(n => heights.set(n.id, calcNodeHeight(n)));

    // Find max height per layer (for horizontal layouts) and max width of each layer
    const layerMaxHeight = new Map();
    layerGroups.forEach((ids, layer) => {
      const maxH = Math.max(...ids.map(id => heights.get(id) || 50));
      layerMaxHeight.set(layer, maxH);
    });

    // Position nodes with proper centering
    const positions = new Map();
    const isHorizontal = direction === 'LR' || direction === 'RL';

    // Calculate layer widths/heights for centering
    const layerSizes = new Map();
    layerGroups.forEach((ids, layer) => {
      if (isHorizontal) {
        // Vertical stacking - sum heights plus spacing
        const totalHeight = ids.reduce((sum, id) => sum + (heights.get(id) || 50), 0);
        layerSizes.set(layer, totalHeight + (ids.length - 1) * NODE_SPACING_H);
      } else {
        // Horizontal stacking - sum widths plus spacing
        const totalWidth = ids.length * NODE_WIDTH + (ids.length - 1) * NODE_SPACING_H;
        layerSizes.set(layer, totalWidth);
      }
    });

    // Find the widest layer for centering
    const maxLayerSize = Math.max(...Array.from(layerSizes.values()));

    // Position each layer
    layerGroups.forEach((ids, layer) => {
      const layerSize = layerSizes.get(layer) || 0;
      const offset = (maxLayerSize - layerSize) / 2; // Center this layer

      let currentPos = offset;

      ids.forEach((id) => {
        const node = nodeMap.get(id);
        const h = heights.get(id) || 50;
        const layerOffset = layer * (isHorizontal ? (NODE_WIDTH + LAYER_SPACING) : (layerMaxHeight.get(layer) + LAYER_SPACING));

        let x, y;
        if (isHorizontal) {
          // LR or RL
          if (direction === 'LR') {
            x = layerOffset;
            y = currentPos;
          } else { // RL
            x = -layerOffset - NODE_WIDTH;
            y = currentPos;
          }
          currentPos += h + NODE_SPACING_H;
        } else {
          // TB or BT
          if (direction === 'TB') {
            x = currentPos;
            y = layerOffset;
          } else { // BT
            x = currentPos;
            y = -layerOffset - h;
          }
          currentPos += NODE_WIDTH + NODE_SPACING_H;
        }

        positions.set(id, { x, y, width: NODE_WIDTH, height: h });
      });
    });

    return { positions, nodeMap, childrenMap, parentsMap };
  }

  // Create SVG element
  function createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  // Render the graph
  function render() {
    const container = document.getElementById('container');
    const svg = container.querySelector('svg');
    const mainGroup = svg.querySelector('#main-group');
    mainGroup.innerHTML = '';

    if (nodes.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'empty-message';
      msg.textContent = 'Graph is empty - no supertags found';
      document.body.appendChild(msg);
      return;
    }

    const { positions, nodeMap, childrenMap, parentsMap } = layoutGraph();

    // Render edges first (behind nodes)
    const edgesGroup = createSvgElement('g', { class: 'edges' });
    links.forEach(link => {
      const sourcePos = positions.get(link.source);
      const targetPos = positions.get(link.target);
      if (!sourcePos || !targetPos) return;

      const isHorizontal = direction === 'LR' || direction === 'RL';

      // Calculate connection points (child -> parent)
      // Source is child, target is parent
      let x1, y1, x2, y2;
      if (isHorizontal) {
        // Horizontal: child connects from left/right to parent
        if (direction === 'LR') {
          x1 = sourcePos.x;  // Child's left edge
          y1 = sourcePos.y + sourcePos.height / 2;
          x2 = targetPos.x + targetPos.width;  // Parent's right edge
          y2 = targetPos.y + targetPos.height / 2;
        } else { // RL
          x1 = sourcePos.x + sourcePos.width;  // Child's right edge
          y1 = sourcePos.y + sourcePos.height / 2;
          x2 = targetPos.x;  // Parent's left edge
          y2 = targetPos.y + targetPos.height / 2;
        }
      } else {
        // Vertical: child connects from top/bottom to parent
        if (direction === 'TB') {
          x1 = sourcePos.x + sourcePos.width / 2;
          y1 = sourcePos.y;  // Child's top edge
          x2 = targetPos.x + targetPos.width / 2;
          y2 = targetPos.y + targetPos.height;  // Parent's bottom edge
        } else { // BT
          x1 = sourcePos.x + sourcePos.width / 2;
          y1 = sourcePos.y + sourcePos.height;  // Child's bottom edge (now at top visually)
          x2 = targetPos.x + targetPos.width / 2;
          y2 = targetPos.y;  // Parent's top edge (now at bottom visually)
        }
      }

      // Create smooth bezier curve
      let pathD;
      if (isHorizontal) {
        const midX = (x1 + x2) / 2;
        pathD = \`M \${x1} \${y1} C \${midX} \${y1}, \${midX} \${y2}, \${x2} \${y2}\`;
      } else {
        const midY = (y1 + y2) / 2;
        pathD = \`M \${x1} \${y1} C \${x1} \${midY}, \${x2} \${midY}, \${x2} \${y2}\`;
      }

      const path = createSvgElement('path', {
        class: 'edge',
        d: pathD,
        'data-source': link.source,
        'data-target': link.target
      });

      // Arrow marker pointing toward parent
      const arrowSize = 6;
      let arrowPoints;
      if (isHorizontal) {
        if (direction === 'LR') {
          arrowPoints = \`\${x2},\${y2} \${x2 + arrowSize},\${y2 - arrowSize} \${x2 + arrowSize},\${y2 + arrowSize}\`;
        } else { // RL
          arrowPoints = \`\${x2},\${y2} \${x2 - arrowSize},\${y2 - arrowSize} \${x2 - arrowSize},\${y2 + arrowSize}\`;
        }
      } else {
        if (direction === 'TB') {
          arrowPoints = \`\${x2},\${y2} \${x2 - arrowSize},\${y2 + arrowSize} \${x2 + arrowSize},\${y2 + arrowSize}\`;
        } else { // BT
          arrowPoints = \`\${x2},\${y2} \${x2 - arrowSize},\${y2 - arrowSize} \${x2 + arrowSize},\${y2 - arrowSize}\`;
        }
      }

      const arrow = createSvgElement('polygon', {
        class: 'edge-arrow',
        points: arrowPoints
      });

      const edgeGroup = createSvgElement('g', { 'data-source': link.source, 'data-target': link.target });
      edgeGroup.appendChild(path);
      edgeGroup.appendChild(arrow);
      edgesGroup.appendChild(edgeGroup);
    });
    mainGroup.appendChild(edgesGroup);

    // Render nodes
    const nodesGroup = createSvgElement('g', { class: 'nodes' });
    positions.forEach((pos, id) => {
      const node = nodeMap.get(id);
      if (!node) return;

      const g = createSvgElement('g', {
        class: 'node',
        transform: \`translate(\${pos.x}, \${pos.y})\`,
        'data-id': id
      });

      // Background
      g.appendChild(createSvgElement('rect', {
        class: 'node-box',
        width: pos.width,
        height: pos.height
      }));

      // Header background (with tag color if available)
      const headerRect = createSvgElement('rect', {
        class: 'node-header',
        width: pos.width,
        height: HEADER_HEIGHT
      });
      if (node.color) {
        headerRect.style.fill = node.color;
      }
      g.appendChild(headerRect);

      // Title
      const title = createSvgElement('text', {
        class: 'node-title',
        x: PADDING,
        y: HEADER_HEIGHT / 2 + 4
      });
      title.textContent = '#' + node.name;
      g.appendChild(title);

      // Divider after header if has fields
      if (node.fields.length > 0) {
        g.appendChild(createSvgElement('line', {
          class: 'node-divider',
          x1: 0, y1: HEADER_HEIGHT,
          x2: pos.width, y2: HEADER_HEIGHT
        }));
      }

      // Fields
      let fieldY = HEADER_HEIGHT + PADDING;
      node.fields.forEach(field => {
        const fieldGroup = createSvgElement('g', {
          transform: \`translate(0, \${fieldY})\`
        });

        const fieldText = createSvgElement('text', {
          class: 'node-field' + (field.inherited ? ' inherited' : ''),
          x: PADDING,
          y: 12
        });
        fieldText.textContent = field.name;
        fieldGroup.appendChild(fieldText);

        if (field.dataType) {
          const typeText = createSvgElement('text', {
            class: 'node-field-type',
            x: pos.width - PADDING,
            y: 12,
            'text-anchor': 'end'
          });
          typeText.textContent = ': ' + field.dataType;
          fieldGroup.appendChild(typeText);
        }

        if (field.inherited && field.originTag) {
          const originText = createSvgElement('text', {
            class: 'node-origin',
            x: PADDING + 8,
            y: 11
          });
          originText.textContent = '(from ' + field.originTag + ')';
          // Position below field name if there's a type
          if (field.dataType) {
            originText.setAttribute('y', '22');
          }
        }

        g.appendChild(fieldGroup);
        fieldY += FIELD_HEIGHT;
      });

      // Footer divider
      const footerY = pos.height - FOOTER_HEIGHT;
      if (node.fields.length > 0) {
        g.appendChild(createSvgElement('line', {
          class: 'node-divider',
          x1: 0, y1: footerY,
          x2: pos.width, y2: footerY
        }));
      }

      // Footer
      const footer = createSvgElement('text', {
        class: 'node-footer',
        x: pos.width / 2,
        y: pos.height - 6,
        'text-anchor': 'middle'
      });
      footer.textContent = node.usageCount.toLocaleString() + ' uses';
      g.appendChild(footer);

      // Click handler
      g.addEventListener('click', () => toggleHighlight(id, childrenMap, parentsMap));

      nodesGroup.appendChild(g);
    });
    mainGroup.appendChild(nodesGroup);

    // Center the graph
    const bounds = mainGroup.getBBox();
    const svgRect = svg.getBoundingClientRect();
    transform.x = (svgRect.width - bounds.width) / 2 - bounds.x;
    transform.y = (svgRect.height - bounds.height) / 2 - bounds.y;
    updateTransform();
  }

  // Toggle highlight for inheritance path
  function toggleHighlight(nodeId, childrenMap, parentsMap) {
    if (highlightedPath.has(nodeId)) {
      // Clear highlight
      highlightedPath.clear();
    } else {
      // Highlight ancestors and descendants
      highlightedPath.clear();
      highlightedPath.add(nodeId);

      // Find all ancestors
      const ancestorQueue = [nodeId];
      while (ancestorQueue.length > 0) {
        const id = ancestorQueue.shift();
        const parents = parentsMap.get(id) || [];
        parents.forEach(p => {
          if (!highlightedPath.has(p)) {
            highlightedPath.add(p);
            ancestorQueue.push(p);
          }
        });
      }

      // Find all descendants
      const descendantQueue = [nodeId];
      while (descendantQueue.length > 0) {
        const id = descendantQueue.shift();
        const children = childrenMap.get(id) || [];
        children.forEach(c => {
          if (!highlightedPath.has(c)) {
            highlightedPath.add(c);
            descendantQueue.push(c);
          }
        });
      }
    }

    updateHighlights();
  }

  function updateHighlights() {
    document.querySelectorAll('.node').forEach(node => {
      const id = node.getAttribute('data-id');
      node.classList.toggle('highlighted', highlightedPath.has(id));
    });

    document.querySelectorAll('.edges g').forEach(edge => {
      const source = edge.getAttribute('data-source');
      const target = edge.getAttribute('data-target');
      const isHighlighted = highlightedPath.has(source) && highlightedPath.has(target);
      edge.querySelector('path')?.classList.toggle('highlighted', isHighlighted);
      edge.querySelector('polygon')?.classList.toggle('highlighted', isHighlighted);
    });
  }

  function updateTransform() {
    const mainGroup = document.getElementById('main-group');
    mainGroup.setAttribute('transform',
      \`translate(\${transform.x}, \${transform.y}) scale(\${transform.scale})\`
    );
  }

  // Pan and zoom
  function setupInteraction() {
    const container = document.getElementById('container');

    // Pan
    container.addEventListener('mousedown', e => {
      if (e.target.closest('.node')) return;
      isDragging = true;
      dragStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
      container.classList.add('dragging');
    });

    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      transform.x = e.clientX - dragStart.x;
      transform.y = e.clientY - dragStart.y;
      updateTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      container.classList.remove('dragging');
    });

    // Zoom
    container.addEventListener('wheel', e => {
      e.preventDefault();
      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(Math.max(transform.scale * scaleFactor, 0.1), 5);

      // Zoom toward mouse position
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      transform.x = mouseX - (mouseX - transform.x) * (newScale / transform.scale);
      transform.y = mouseY - (mouseY - transform.y) * (newScale / transform.scale);
      transform.scale = newScale;

      updateTransform();
    });
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    render();
    setupInteraction();
  });
})();
`;
}

/**
 * Render visualization data as interactive HTML.
 *
 * @param data - Visualization data to render
 * @param options - Rendering options
 * @returns Complete HTML document string
 */
export function renderHTML(
  data: VisualizationData,
  options: HTMLRenderOptions = {}
): string {
  const theme = options.theme || "light";

  const html = `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Supertag Inheritance - ${escapeHtml(data.metadata.workspace)}</title>
  <style>${generateCSS(theme)}</style>
</head>
<body>
  <div id="container">
    <svg>
      <g id="main-group"></g>
    </svg>
  </div>
  <div id="info-panel">
    <strong>${escapeHtml(data.metadata.workspace)}</strong> |
    ${data.metadata.totalTags} tags |
    ${data.metadata.totalLinks} links |
    Generated: ${data.metadata.generatedAt.split("T")[0]}
  </div>
  <script>${generateJavaScript(data, options)}</script>
</body>
</html>`;

  return html;
}
