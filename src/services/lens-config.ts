/**
 * Lens Configurations (Spec F-098)
 *
 * Predefined traversal patterns for common task types.
 * Each lens prioritizes different relationship types and tags.
 */

import type { LensType, LensConfig, ContextNode } from '../types/context';

/** Predefined lens configurations */
export const LENS_CONFIGS: Record<LensType, LensConfig> = {
  general: {
    name: 'general',
    priorityTypes: ['child', 'parent', 'reference', 'field'],
    maxDepth: 3,
  },
  writing: {
    name: 'writing',
    priorityTypes: ['child', 'reference'],
    boostTags: ['note', 'draft', 'writing', 'article'],
    maxDepth: 2,
  },
  coding: {
    name: 'coding',
    priorityTypes: ['reference', 'field'],
    boostTags: ['spec', 'architecture', 'code', 'decision'],
    includeFields: ['status', 'priority', 'assignee'],
    maxDepth: 3,
  },
  planning: {
    name: 'planning',
    priorityTypes: ['child', 'field'],
    boostTags: ['goal', 'milestone', 'task', 'project'],
    includeFields: ['due', 'status', 'blocked-by'],
    maxDepth: 4,
  },
  'meeting-prep': {
    name: 'meeting-prep',
    priorityTypes: ['reference', 'child'],
    boostTags: ['person', 'meeting', 'action', 'agenda'],
    includeFields: ['attendees', 'date', 'status'],
    maxDepth: 2,
  },
};

/**
 * Get configuration for a named lens
 */
export function getLensConfig(lens: LensType): LensConfig {
  return LENS_CONFIGS[lens];
}

/**
 * Apply lens-specific tag boosts to scored nodes.
 * Nodes with matching tags get a score boost of 0.1.
 */
export function applyLensBoosts(nodes: ContextNode[], lens: LensType): ContextNode[] {
  const config = LENS_CONFIGS[lens];
  if (!config.boostTags || config.boostTags.length === 0) {
    return nodes;
  }

  const boostSet = new Set(config.boostTags.map((t) => t.toLowerCase()));

  return nodes.map((node) => {
    const hasBoostTag = node.tags.some((t) => boostSet.has(t.toLowerCase()));
    if (hasBoostTag) {
      return {
        ...node,
        score: Math.min(1, node.score + 0.1),
      };
    }
    return node;
  });
}
