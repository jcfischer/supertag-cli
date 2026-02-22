/**
 * Context Assembler Types (Spec F-098)
 *
 * Type definitions and Zod schemas for the context assembly pipeline.
 * Used by context-assembler service, CLI command, and MCP tool.
 */

import { z } from 'zod';
import type { ReadBackendType } from '../api/read-backend';
import type { RelationshipType, RelationshipMetadata } from './graph';

// =============================================================================
// Graph Lenses
// =============================================================================

/** Available lens types for traversal pattern customization */
export const LENS_TYPES = ['general', 'writing', 'coding', 'planning', 'meeting-prep'] as const;
export type LensType = (typeof LENS_TYPES)[number];

export const LensTypeSchema = z.enum(LENS_TYPES);

/** Configuration for a graph lens */
export interface LensConfig {
  name: LensType;
  priorityTypes: RelationshipType[];
  boostTags?: string[];
  includeFields?: string[];
  maxDepth: number;
}

// =============================================================================
// Token Budgeting
// =============================================================================

export interface TokenBudget {
  /** Total token budget (default: 4000) */
  maxTokens: number;
  /** Reserved for metadata header (default: 200) */
  headerReserve: number;
  /** Minimum tokens per node to include (default: 50) */
  minPerNode: number;
}

export interface TokenUsage {
  budget: number;
  used: number;
  utilization: number;
  nodesIncluded: number;
  nodesSummarized: number;
}

// =============================================================================
// Relevance Scoring
// =============================================================================

export interface RelevanceScore {
  total: number;
  components: {
    graphDistance: number;
    semanticSim?: number;
    recency: number;
  };
}

export interface ScoringOptions {
  sourceNodeId: string;
  queryText?: string;
  embeddingsAvailable: boolean;
}

// =============================================================================
// Context Document
// =============================================================================

export interface RelationshipPath {
  nodeId: string;
  type: RelationshipType;
  direction: 'in' | 'out';
}

export interface ContextNode {
  id: string;
  name: string;
  content: string;
  tags: string[];
  fields?: Record<string, string | string[]>;
  score: number;
  distance: number;
  path: RelationshipPath[];
  created?: string;
}

export interface OverflowSummary {
  id: string;
  name: string;
  tags: string[];
  score: number;
}

export interface ContextMeta {
  query: string;
  workspace: string;
  lens: LensType;
  tokens: TokenUsage;
  assembledAt: string;
  backend: ReadBackendType;
  embeddingsAvailable: boolean;
}

export interface ContextDocument {
  meta: ContextMeta;
  nodes: ContextNode[];
  overflow: OverflowSummary[];
}

// =============================================================================
// Options Schema
// =============================================================================

export const ContextOptionsSchema = z.object({
  workspace: z.string().optional(),
  depth: z.number().min(1).max(5).default(2),
  maxTokens: z.number().min(100).default(4000),
  includeFields: z.boolean().default(true),
  lens: LensTypeSchema.default('general'),
  format: z.enum(['markdown', 'json']).default('markdown'),
  offline: z.boolean().optional(),
});

export type ContextOptions = z.infer<typeof ContextOptionsSchema>;
