/**
 * PAI Context Service
 * Spec: F-105 PAI Memory Integration
 * Task: T-4.1
 *
 * Graph-aware learning retrieval for pai-seed session hooks.
 * Searches #pai_learning nodes and enriches with graph context.
 */

import { resolveReadBackend } from '../api/read-backend-resolver';
import type { ReadSearchResult } from '../api/read-backend';
import { readSeedFile, getConfirmedLearnings, getDefaultSeedPath } from './seed-reader';
import { loadMapping } from './mapping';
import type {
  PaiContextOptions,
  PaiContextResponse,
  PaiLearningEntry,
} from '../types/pai';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_TOKENS = 2000;
const APPROX_CHARS_PER_TOKEN = 4;

// =============================================================================
// Public API
// =============================================================================

/**
 * Get PAI context for a topic, enriched with graph data.
 * Falls back to seed.json-only if Tana is unavailable.
 */
export async function getPaiContext(
  topic: string,
  options: PaiContextOptions = {},
): Promise<PaiContextResponse> {
  const { maxTokens = DEFAULT_MAX_TOKENS, type, workspace } = options;

  // Try graph-enriched path first
  try {
    return await getGraphEnrichedContext(topic, { maxTokens, type, workspace });
  } catch {
    // Fall back to seed.json-only
    return getSeedOnlyContext(topic, { maxTokens, type });
  }
}

// =============================================================================
// Graph-Enriched Context
// =============================================================================

async function getGraphEnrichedContext(
  topic: string,
  options: { maxTokens: number; type?: string; workspace?: string },
): Promise<PaiContextResponse> {
  const backend = await resolveReadBackend({ workspace: options.workspace });

  // Search for #pai_learning nodes matching the topic
  const searchResults = await backend.search(topic, { limit: 20 });

  const learnings: PaiContextResponse['learnings'] = [];
  const relatedNodes: PaiContextResponse['relatedNodes'] = [];
  const seenNodes = new Set<string>();
  let charBudget = options.maxTokens * APPROX_CHARS_PER_TOKEN;

  for (const result of searchResults) {
    if (charBudget <= 0) break;

    // Filter by type if specified
    if (options.type && result.tags) {
      // Check if this is a pai_learning node
      const isPaiLearning = result.tags.some(
        (t: string) => t.toLowerCase() === 'pai_learning',
      );
      if (!isPaiLearning) continue;
    }

    const content = result.name || '';
    const learning = {
      content,
      type: extractFieldValue(result, 'Type') || 'unknown',
      confirmedAt: extractFieldValue(result, 'Confirmed At') || '',
      freshness: 'fresh' as const,
      linkedTo: extractLinkedEntities(result),
    };

    charBudget -= content.length;
    learnings.push(learning);

    // Collect related nodes
    for (const linked of learning.linkedTo) {
      if (!seenNodes.has(linked)) {
        seenNodes.add(linked);
        relatedNodes.push({
          name: linked,
          type: 'node',
        });
      }
    }
  }

  // Also include seed.json learnings that match
  try {
    const seedContext = getSeedOnlyContext(topic, { maxTokens: Math.floor(charBudget / APPROX_CHARS_PER_TOKEN), type: options.type });
    // Merge seed learnings that aren't already included
    const existingContents = new Set(learnings.map((l) => l.content));
    for (const learning of seedContext.learnings) {
      if (!existingContents.has(learning.content) && charBudget > 0) {
        learnings.push(learning);
        charBudget -= learning.content.length;
      }
    }
  } catch {
    // Seed file not available, that's fine
  }

  const totalChars = learnings.reduce((sum, l) => sum + l.content.length, 0);
  return {
    learnings,
    relatedNodes,
    tokenCount: Math.ceil(totalChars / APPROX_CHARS_PER_TOKEN),
  };
}

// =============================================================================
// Seed-Only Fallback
// =============================================================================

function getSeedOnlyContext(
  topic: string,
  options: { maxTokens: number; type?: string },
): PaiContextResponse {
  let seed;
  try {
    seed = readSeedFile();
  } catch {
    return { learnings: [], relatedNodes: [], tokenCount: 0 };
  }

  const allLearnings = getConfirmedLearnings(seed);
  const topicLower = topic.toLowerCase();

  // Filter by topic and optionally by type
  let filtered = allLearnings.filter((entry) =>
    entry.content.toLowerCase().includes(topicLower),
  );

  if (options.type) {
    filtered = filtered.filter((entry) => entry.type === options.type);
  }

  // Apply token budget
  let charBudget = options.maxTokens * APPROX_CHARS_PER_TOKEN;
  const learnings: PaiContextResponse['learnings'] = [];

  for (const entry of filtered) {
    if (charBudget <= 0) break;
    charBudget -= entry.content.length;
    learnings.push({
      content: entry.content,
      type: entry.type,
      confirmedAt: entry.confirmedAt,
      freshness: 'stale', // No graph data in fallback mode
      linkedTo: [],
    });
  }

  const totalChars = learnings.reduce((sum, l) => sum + l.content.length, 0);
  return {
    learnings,
    relatedNodes: [],
    tokenCount: Math.ceil(totalChars / APPROX_CHARS_PER_TOKEN),
  };
}

// =============================================================================
// Helpers
// =============================================================================

function extractFieldValue(result: ReadSearchResult, fieldName: string): string | undefined {
  // Check in fields object if present (may exist on extended results)
  const fields = (result as unknown as Record<string, unknown>).fields as Record<string, unknown> | undefined;
  if (fields && typeof fields[fieldName] === 'string') {
    return fields[fieldName] as string;
  }
  return undefined;
}

function extractLinkedEntities(result: ReadSearchResult): string[] {
  const linked: string[] = [];
  const fields = (result as unknown as Record<string, unknown>).fields as Record<string, unknown> | undefined;
  if (!fields) return linked;

  for (const key of ['Related People', 'Related Projects']) {
    const value = fields[key];
    if (typeof value === 'string' && value) {
      linked.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
    }
    if (Array.isArray(value)) {
      linked.push(...value.filter((v): v is string => typeof v === 'string'));
    }
  }

  return linked;
}
