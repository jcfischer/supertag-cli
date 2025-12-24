/**
 * JSON Renderer
 *
 * Renders VisualizationData as JSON format.
 * Useful for custom tooling, data analysis, and external integrations.
 */

import type { VisualizationData, JSONRenderOptions } from "../types";

/**
 * Render visualization data as JSON.
 *
 * @param data - Visualization data to render
 * @param options - Rendering options
 * @returns JSON string
 */
export function renderJSON(
  data: VisualizationData,
  options: JSONRenderOptions = {}
): string {
  const { pretty = true } = options;

  if (pretty) {
    return JSON.stringify(data, null, 2);
  }

  return JSON.stringify(data);
}
