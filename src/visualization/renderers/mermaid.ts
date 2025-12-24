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
 * Format field for display in Mermaid node
 */
function formatField(field: { name: string; dataType?: string; inherited: boolean; originTag?: string }, showInherited: boolean): string | null {
  if (field.inherited && !showInherited) {
    return null;
  }

  let text = escapeLabel(field.name);
  if (field.dataType) {
    text += `: ${escapeLabel(field.dataType)}`;
  }
  if (field.inherited && field.originTag) {
    text += ` (${escapeLabel(field.originTag)})`;
  }
  return text;
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
    showFields = false,
    showInheritedFields = false,
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

    // Add field details if available and requested
    if (showFields && node.fields && node.fields.length > 0) {
      const fieldLines = node.fields
        .map(f => formatField(f, showInheritedFields))
        .filter((f): f is string => f !== null);

      if (fieldLines.length > 0) {
        label += `<br/>---<br/>${fieldLines.join("<br/>")}`;
      }
    } else if (showFields) {
      // Fallback to field count if no field details available
      label += `<br/>(${node.fieldCount} fields)`;
    }

    // Add usage count if requested
    if (showUsageCount && node.usageCount > 0) {
      label += `<br/>${node.usageCount} uses`;
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
