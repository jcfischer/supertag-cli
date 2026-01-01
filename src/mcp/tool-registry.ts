/**
 * Tool Registry for Progressive Disclosure
 *
 * Centralizes MCP tool metadata for the progressive disclosure pattern.
 * Provides lightweight capabilities inventory and on-demand schema loading.
 *
 * Spec: 061-progressive-disclosure
 */

// =============================================================================
// Types
// =============================================================================

/** Valid category names for tool grouping */
export type CategoryName = 'query' | 'explore' | 'transcript' | 'mutate' | 'system';

/** Lightweight tool info for capabilities response */
export interface ToolSummary {
  name: string;
  description: string;
  example?: string;
}

/** Tool category grouping */
export interface ToolCategory {
  name: CategoryName;
  description: string;
  tools: ToolSummary[];
}

/** Full tool metadata including category assignment */
export interface ToolMetadata {
  name: string;
  description: string;
  category: CategoryName;
  example?: string;
}

/** Capabilities response structure */
export interface CapabilitiesResponse {
  version: string;
  categories: ToolCategory[];
  quickActions: string[];
}
