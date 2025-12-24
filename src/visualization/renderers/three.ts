/**
 * 3D Renderer (Three.js)
 *
 * Renders VisualizationData as a self-contained interactive 3D HTML file.
 * Uses 3d-force-graph (built on Three.js) for graph visualization.
 * Features: rotate, pan, zoom, click-to-highlight, tooltips.
 */

import type {
  VisualizationData,
  VisualizationNode,
  ThreeRenderOptions,
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
 * Escape string for JSON embedding (handles special chars in strings)
 */
function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

/**
 * Generate CSS for the 3D visualization
 */
function generateCSS(theme: "light" | "dark"): string {
  const colors =
    theme === "dark"
      ? {
          bg: "#1a1a2e",
          panelBg: "#16213e",
          panelBorder: "#0f3460",
          text: "#e0e0e0",
          textMuted: "#888",
          highlight: "#4a9eff",
          tooltipBg: "rgba(22, 33, 62, 0.95)",
        }
      : {
          bg: "#f5f5f5",
          panelBg: "#ffffff",
          panelBorder: "#ddd",
          text: "#333",
          textMuted: "#666",
          highlight: "#0066cc",
          tooltipBg: "rgba(255, 255, 255, 0.95)",
        };

  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${colors.bg};
      overflow: hidden;
      color: ${colors.text};
    }
    #graph-container {
      width: 100vw;
      height: 100vh;
    }
    #info-panel {
      position: fixed;
      bottom: 16px;
      left: 16px;
      background: ${colors.panelBg};
      border: 1px solid ${colors.panelBorder};
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 12px;
      color: ${colors.textMuted};
      z-index: 100;
    }
    #info-panel strong { color: ${colors.text}; }
    #tooltip {
      position: fixed;
      background: ${colors.tooltipBg};
      border: 1px solid ${colors.panelBorder};
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 12px;
      pointer-events: none;
      z-index: 200;
      display: none;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    #tooltip h4 {
      margin: 0 0 6px 0;
      font-size: 14px;
      color: ${colors.text};
    }
    #tooltip .stats {
      color: ${colors.textMuted};
      margin-bottom: 6px;
    }
    #tooltip .fields {
      font-size: 11px;
      color: ${colors.textMuted};
    }
    #tooltip .field {
      margin: 2px 0;
    }
    #tooltip .field.inherited {
      font-style: italic;
    }
    #controls-hint {
      position: fixed;
      top: 16px;
      right: 16px;
      background: ${colors.panelBg};
      border: 1px solid ${colors.panelBorder};
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 11px;
      color: ${colors.textMuted};
      z-index: 100;
    }
    #controls-hint kbd {
      background: ${colors.bg};
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }
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
 * Process nodes for JSON serialization
 */
function processNodes(
  nodes: VisualizationNode[],
  options: ThreeRenderOptions
): string {
  const { showFields = false, showInheritedFields = false } = options;

  const processed = nodes.map((node) => {
    let fields = node.fields || [];

    if (!showFields) {
      fields = [];
    } else if (!showInheritedFields) {
      fields = fields.filter((f) => !f.inherited);
    }

    return {
      id: node.id,
      name: escapeJsonString(node.name),
      fieldCount: node.fieldCount,
      usageCount: node.usageCount,
      color: node.color || null,
      isOrphan: node.isOrphan,
      isLeaf: node.isLeaf,
      fields: fields.map((f) => ({
        name: escapeJsonString(f.name),
        dataType: f.dataType ? escapeJsonString(f.dataType) : null,
        inherited: f.inherited,
        originTag: f.originTag ? escapeJsonString(f.originTag) : null,
      })),
    };
  });

  return JSON.stringify(processed);
}

/**
 * Generate the JavaScript code for 3D rendering
 */
function generateJavaScript(
  data: VisualizationData,
  options: ThreeRenderOptions
): string {
  const layout = options.layout || "force";
  const sizeByUsage = options.sizeByUsage || false;
  const cameraDistance = options.cameraDistance || 1.5;
  const showFields = options.showFields || false;

  const nodeData = processNodes(data.nodes, options);
  const linkData = JSON.stringify(data.links);

  // Load Three.js and 3d-force-graph from CDN
  const libraryScript = `
    // Load Three.js first, then 3d-force-graph
    const threeScript = document.createElement('script');
    threeScript.src = 'https://unpkg.com/three@0.160.0/build/three.min.js';
    threeScript.onload = function() {
      const fgScript = document.createElement('script');
      fgScript.src = 'https://unpkg.com/3d-force-graph@1.73.4/dist/3d-force-graph.min.js';
      fgScript.onload = initGraph;
      document.head.appendChild(fgScript);
    };
    document.head.appendChild(threeScript);
  `;

  return `
(function() {
  // Configuration
  const config = {
    layout: "${layout}",
    sizeByUsage: ${sizeByUsage},
    cameraDistance: ${cameraDistance},
    showFields: ${showFields}
  };

  // Data
  const nodes = ${nodeData};
  const links = ${linkData};

  // Build adjacency maps for highlighting
  const childrenMap = new Map();
  const parentsMap = new Map();
  nodes.forEach(n => {
    childrenMap.set(n.id, []);
    parentsMap.set(n.id, []);
  });
  links.forEach(l => {
    childrenMap.get(l.target)?.push(l.source);
    parentsMap.get(l.source)?.push(l.target);
  });

  // State
  let highlightedNodes = new Set();
  let highlightedLinks = new Set();
  let selectedNode = null;
  let Graph = null;
  let lastMouseEvent = { clientX: 0, clientY: 0 };

  // Default colors for nodes without Tana color
  const defaultColors = [
    '#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#f39c12',
    '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b'
  ];

  function getNodeColor(node, index) {
    if (highlightedNodes.has(node.id)) return '#ffcc00';
    return node.color || defaultColors[index % defaultColors.length];
  }

  function getNodeSize(node) {
    const base = 5;
    if (!config.sizeByUsage) return base;
    // Scale by log of usage count
    return base + Math.log10(node.usageCount + 1) * 2;
  }

  // Find all ancestors and descendants
  function getPathNodes(nodeId) {
    const result = new Set([nodeId]);

    // Ancestors (parents, grandparents, etc.)
    const ancestorQueue = [nodeId];
    while (ancestorQueue.length > 0) {
      const id = ancestorQueue.shift();
      const parents = parentsMap.get(id) || [];
      parents.forEach(p => {
        if (!result.has(p)) {
          result.add(p);
          ancestorQueue.push(p);
        }
      });
    }

    // Descendants (children, grandchildren, etc.)
    const descendantQueue = [nodeId];
    while (descendantQueue.length > 0) {
      const id = descendantQueue.shift();
      const children = childrenMap.get(id) || [];
      children.forEach(c => {
        if (!result.has(c)) {
          result.add(c);
          descendantQueue.push(c);
        }
      });
    }

    return result;
  }

  function getPathLinks(nodeIds) {
    const result = new Set();
    links.forEach((link, i) => {
      if (nodeIds.has(link.source) && nodeIds.has(link.target)) {
        result.add(i);
      }
    });
    return result;
  }

  function updateHighlights(nodeId) {
    if (nodeId === selectedNode) {
      // Deselect
      selectedNode = null;
      highlightedNodes.clear();
      highlightedLinks.clear();
    } else {
      selectedNode = nodeId;
      highlightedNodes = getPathNodes(nodeId);
      highlightedLinks = getPathLinks(highlightedNodes);
    }

    if (Graph) {
      // Update node colors by refreshing the THREE objects
      Graph.nodeThreeObject(Graph.nodeThreeObject())
        .linkWidth(link => highlightedLinks.has(links.indexOf(link)) ? 2 : 1)
        .linkColor(link => highlightedLinks.has(links.indexOf(link)) ? '#ffcc00' : '#888');
    }
  }

  function showTooltip(node, event) {
    const tooltip = document.getElementById('tooltip');
    if (!node) {
      tooltip.style.display = 'none';
      return;
    }

    let html = '<h4>#' + node.name + '</h4>';
    html += '<div class="stats">' + node.fieldCount + ' fields | ' + node.usageCount.toLocaleString() + ' uses</div>';

    if (config.showFields && node.fields && node.fields.length > 0) {
      html += '<div class="fields">';
      node.fields.forEach(f => {
        const cls = f.inherited ? 'field inherited' : 'field';
        let text = f.name;
        if (f.dataType) text += ': ' + f.dataType;
        if (f.inherited && f.originTag) text += ' (from ' + f.originTag + ')';
        html += '<div class="' + cls + '">' + text + '</div>';
      });
      html += '</div>';
    }

    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY + 15) + 'px';
  }

  // Theme colors for text labels
  const labelColor = '${options.theme === "dark" ? "#e0e0e0" : "#222222"}';

  // Create a text sprite for node labels
  function createTextSprite(text, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 48;
    ctx.font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';

    // Measure text to size canvas appropriately
    const metrics = ctx.measureText('#' + text);
    const textWidth = metrics.width;
    canvas.width = textWidth + 20;
    canvas.height = fontSize + 16;

    // Re-apply font after canvas resize
    ctx.font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('#' + text, canvas.width / 2, canvas.height / 2);

    // Create sprite from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(canvas.width / 8, canvas.height / 8, 1);

    return sprite;
  }

  function initGraph() {
    const container = document.getElementById('graph-container');

    if (nodes.length === 0) {
      container.innerHTML = '<div class="empty-message">Graph is empty - no supertags found</div>';
      return;
    }

    // Create the 3D force graph
    Graph = ForceGraph3D()(container)
      .graphData({ nodes, links })
      .nodeId('id')
      .nodeThreeObject(node => {
        // Create a group to hold sphere + label
        const group = new THREE.Group();

        // Sphere for the node
        const nodeIdx = nodes.findIndex(n => n.id === node.id);
        const color = getNodeColor(node, nodeIdx);
        const size = getNodeSize(node);
        const geometry = new THREE.SphereGeometry(size, 16, 12);
        const material = new THREE.MeshLambertMaterial({
          color: color,
          transparent: true,
          opacity: 0.9
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.name = 'nodeSphere';
        group.add(sphere);

        // Text label above the node
        const label = createTextSprite(node.name, labelColor);
        label.position.set(0, size + 6, 0);
        label.name = 'nodeLabel';
        group.add(label);

        return group;
      })
      .nodeThreeObjectExtend(false)
      .linkSource('source')
      .linkTarget('target')
      .linkColor(() => '#888')
      .linkWidth(1)
      .linkOpacity(0.6)
      .backgroundColor('${options.theme === "dark" ? "#1a1a2e" : "#f5f5f5"}')
      .onNodeClick(node => {
        updateHighlights(node.id);
      })
      .onNodeHover((node, prevNode) => {
        container.style.cursor = node ? 'pointer' : 'default';
      });

    // Apply layout mode
    if (config.layout === 'hierarchical') {
      Graph
        .dagMode('td')
        .dagLevelDistance(50);
    }

    // Adjust camera distance
    Graph.cameraPosition({ z: 300 * config.cameraDistance });

    // Track mouse position for tooltip
    container.addEventListener('mousemove', (e) => {
      lastMouseEvent = { clientX: e.clientX, clientY: e.clientY };
      // Update tooltip position if visible
      const tooltip = document.getElementById('tooltip');
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY + 15) + 'px';
      }
    });

    Graph.onNodeHover((node) => {
      if (node) {
        showTooltip(node, lastMouseEvent);
      } else {
        showTooltip(null);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        selectedNode = null;
        highlightedNodes.clear();
        highlightedLinks.clear();
        Graph.nodeColor(Graph.nodeColor());
      }
      if (e.key === 'r' || e.key === 'R') {
        Graph.cameraPosition({ x: 0, y: 0, z: 300 * config.cameraDistance }, { x: 0, y: 0, z: 0 }, 1000);
      }
    });
  }

  // Load library and initialize
  ${libraryScript}
})();
`;
}

/**
 * Render visualization data as interactive 3D HTML.
 *
 * @param data - Visualization data to render
 * @param options - 3D rendering options
 * @returns Complete HTML document string
 */
export function render3D(
  data: VisualizationData,
  options: ThreeRenderOptions = {}
): string {
  const theme = options.theme || "light";

  const html = `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Supertag 3D - ${escapeHtml(data.metadata.workspace)}</title>
  <style>${generateCSS(theme)}</style>
</head>
<body>
  <div id="graph-container"></div>
  <div id="tooltip"></div>
  <div id="info-panel">
    <strong>${escapeHtml(data.metadata.workspace)}</strong> |
    ${data.metadata.totalTags} tags |
    ${data.metadata.totalLinks} links |
    Generated: ${data.metadata.generatedAt.split("T")[0]}
  </div>
  <div id="controls-hint">
    <strong>Controls:</strong><br>
    Drag to rotate | Scroll to zoom<br>
    Right-drag to pan | Click node to highlight<br>
    <kbd>R</kbd> Reset view | <kbd>Esc</kbd> Deselect
  </div>
  <script>${generateJavaScript(data, options)}</script>
</body>
</html>`;

  return html;
}
