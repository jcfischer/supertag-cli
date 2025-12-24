/**
 * Visualization Renderers
 *
 * Export all renderers and provide a unified interface for format selection.
 */

export { renderMermaid } from "./mermaid";
export { renderDOT } from "./dot";
export { renderJSON } from "./json";
export { renderHTML } from "./html";
export { render3D } from "./three";

import { renderMermaid } from "./mermaid";
import { renderDOT } from "./dot";
import { renderJSON } from "./json";
import { renderHTML } from "./html";
import { render3D } from "./three";
import type {
  VisualizationData,
  VisualizationFormat,
  MermaidRenderOptions,
  DOTRenderOptions,
  JSONRenderOptions,
  HTMLRenderOptions,
  ThreeRenderOptions,
} from "../types";

/**
 * Renderer function type
 */
export type RenderFunction = (data: VisualizationData, options?: unknown) => string;

/**
 * Renderer lookup map
 */
export const renderers: Record<VisualizationFormat, RenderFunction | null> = {
  mermaid: renderMermaid as RenderFunction,
  dot: renderDOT as RenderFunction,
  json: renderJSON as RenderFunction,
  html: renderHTML as RenderFunction,
  "3d": render3D as RenderFunction,
  svg: null,   // Via DOT + graphviz
  pdf: null,   // Via DOT + graphviz
};

/**
 * Supported formats (those with implemented renderers)
 */
export const supportedFormats: VisualizationFormat[] = ["mermaid", "dot", "json", "html", "3d"];

/**
 * Get renderer for a format.
 * Returns null for unimplemented formats.
 */
export function getRenderer(format: VisualizationFormat): RenderFunction | null {
  return renderers[format] ?? null;
}

/**
 * Check if a format is supported.
 */
export function isFormatSupported(format: string): format is VisualizationFormat {
  return supportedFormats.includes(format as VisualizationFormat);
}

/**
 * Render visualization data to specified format.
 *
 * @param format - Output format
 * @param data - Visualization data
 * @param options - Format-specific options
 * @returns Rendered output string
 * @throws Error if format not supported
 */
export function render(
  format: VisualizationFormat,
  data: VisualizationData,
  options?: MermaidRenderOptions | DOTRenderOptions | JSONRenderOptions | HTMLRenderOptions | ThreeRenderOptions
): string {
  const renderer = getRenderer(format);

  if (!renderer) {
    throw new Error(`Format '${format}' is not yet implemented. Supported formats: ${supportedFormats.join(", ")}`);
  }

  return renderer(data, options);
}
