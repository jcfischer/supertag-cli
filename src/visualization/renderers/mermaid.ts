/**
 * Mermaid Renderer
 *
 * Renders VisualizationData as Mermaid flowchart syntax.
 * Output can be used in GitHub, Obsidian, VS Code, and other Mermaid-compatible tools.
 */

import type { VisualizationData, MermaidRenderOptions } from "../types";

/**
 * Sanitize node ID for Mermaid (alphanumeric and underscores only)
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Escape special characters in labels for Mermaid
 */
function escapeLabel(label: string): string {
  return label
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render visualization data as Mermaid flowchart.
 *
 * @param data - Visualization data to render
 * @param options - Rendering options
 * @returns Mermaid flowchart string
 */
export function renderMermaid(
  data: VisualizationData,
  options: MermaidRenderOptions = {}
): string {
  const {
    direction = "BT",
    showFieldCount = false,
    showUsageCount = false,
  } = options;

  const lines: string[] = [];

  // Header
  lines.push(`flowchart ${direction}`);

  if (data.nodes.length === 0) {
    lines.push("    %% Graph is empty - no supertags found");
    return lines.join("\n");
  }

  // Node declarations
  lines.push("    %% Nodes");
  for (const node of data.nodes) {
    const id = sanitizeId(node.id);
    let label = `#${escapeLabel(node.name)}`;

    // Add optional info
    const extras: string[] = [];
    if (showFieldCount) {
      extras.push(`${node.fieldCount} fields`);
    }
    if (showUsageCount && node.usageCount > 0) {
      extras.push(`${node.usageCount} uses`);
    }

    if (extras.length > 0) {
      label += `<br/>${extras.join(", ")}`;
    }

    lines.push(`    ${id}["${label}"]`);
  }

  // Links
  if (data.links.length > 0) {
    lines.push("");
    lines.push("    %% Inheritance links (child --> parent)");
    for (const link of data.links) {
      const sourceId = sanitizeId(link.source);
      const targetId = sanitizeId(link.target);
      lines.push(`    ${sourceId} --> ${targetId}`);
    }
  }

  return lines.join("\n");
}
