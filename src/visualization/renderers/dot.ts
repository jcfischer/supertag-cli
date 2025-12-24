/**
 * DOT Renderer
 *
 * Renders VisualizationData as Graphviz DOT syntax.
 * Output can be converted to SVG, PNG, PDF using the `dot` command.
 */

import type { VisualizationData, DOTRenderOptions } from "../types";

/**
 * Sanitize node ID for DOT (alphanumeric and underscores only)
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Escape special characters in DOT labels
 */
function escapeLabel(label: string): string {
  return label
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

/**
 * Render visualization data as Graphviz DOT.
 *
 * @param data - Visualization data to render
 * @param options - Rendering options
 * @returns DOT digraph string
 */
export function renderDOT(
  data: VisualizationData,
  options: DOTRenderOptions = {}
): string {
  const {
    rankdir = "BT",
    showFieldCount = false,
    useColors = false,
  } = options;

  const lines: string[] = [];

  // Header
  lines.push("digraph supertags {");
  lines.push(`    rankdir=${rankdir};`);
  lines.push('    node [shape=box, style="rounded,filled", fontname="Helvetica", fillcolor="#E8E8E8"];');
  lines.push('    edge [arrowhead=normal];');

  if (data.nodes.length === 0) {
    lines.push("");
    lines.push("    // Graph is empty - no supertags found");
    lines.push("}");
    return lines.join("\n");
  }

  // Node declarations
  lines.push("");
  lines.push("    // Nodes");
  for (const node of data.nodes) {
    const id = sanitizeId(node.id);
    let label = `#${escapeLabel(node.name)}`;

    if (showFieldCount) {
      label += `\\n(${node.fieldCount} fields)`;
    }

    const attrs: string[] = [`label="${label}"`];

    if (useColors && node.color) {
      attrs.push(`fillcolor="${node.color}"`);
    }

    lines.push(`    ${id} [${attrs.join(", ")}];`);
  }

  // Edges
  if (data.links.length > 0) {
    lines.push("");
    lines.push("    // Inheritance edges (child -> parent)");
    for (const link of data.links) {
      const sourceId = sanitizeId(link.source);
      const targetId = sanitizeId(link.target);
      lines.push(`    ${sourceId} -> ${targetId};`);
    }
  }

  lines.push("}");

  return lines.join("\n");
}
