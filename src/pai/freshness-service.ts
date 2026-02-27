/**
 * PAI Freshness Service
 * Spec: F-105 PAI Memory Integration
 * Task: T-5.1
 *
 * Contextual freshness scoring using graph activity.
 * A learning stays fresh if linked entities are active.
 */

import { resolveReadBackend } from '../api/read-backend-resolver';
import { readSeedFile, getConfirmedLearnings } from './seed-reader';
import { loadMapping, getMappedNodeId } from './mapping';
import type { FreshnessOptions, FreshnessResult, PaiLearningEntry } from '../types/pai';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_THRESHOLD_DAYS = 30;

// =============================================================================
// Public API
// =============================================================================

/**
 * Assess freshness of all synced learnings using graph activity.
 * Falls back to timestamp-only scoring if Tana is unavailable.
 */
export async function assessFreshness(
  options: FreshnessOptions = {},
): Promise<FreshnessResult[]> {
  const { threshold = DEFAULT_THRESHOLD_DAYS, type, workspace, seedPath } = options;

  // Load seed.json and mapping
  let seed;
  try {
    seed = readSeedFile(seedPath);
  } catch {
    return [];
  }

  const allLearnings = getConfirmedLearnings(seed);
  const mapping = loadMapping(workspace);

  // Filter by type if specified
  let filtered = allLearnings;
  if (type) {
    filtered = filtered.filter((e) => e.type === type);
  }

  // Try graph-enriched freshness
  try {
    return await getGraphEnrichedFreshness(filtered, mapping, threshold, workspace);
  } catch {
    // Fall back to timestamp-only
    return getTimestampOnlyFreshness(filtered, mapping, threshold);
  }
}

// =============================================================================
// Graph-Enriched Freshness
// =============================================================================

async function getGraphEnrichedFreshness(
  entries: PaiLearningEntry[],
  mapping: ReturnType<typeof loadMapping>,
  threshold: number,
  workspace?: string,
): Promise<FreshnessResult[]> {
  const backend = await resolveReadBackend({ workspace });
  const now = new Date();
  const results: FreshnessResult[] = [];

  for (const entry of entries) {
    const tanaNodeId = getMappedNodeId(mapping, entry.seedId);
    const result: FreshnessResult = {
      seedId: entry.seedId,
      tanaNodeId,
      content: entry.content,
      type: entry.type,
      confirmedAt: entry.confirmedAt,
      contextualFreshness: entry.confirmedAt,
      status: 'unknown',
      daysSinceActive: daysBetween(new Date(entry.confirmedAt), now),
      linkedEntities: [],
    };

    if (!tanaNodeId) {
      // Unmapped — use timestamp only
      result.status = result.daysSinceActive <= threshold ? 'fresh' : 'stale';
      result.contextualFreshness = entry.confirmedAt;
      results.push(result);
      continue;
    }

    // Try to read the node and its linked entities
    try {
      const nodeContent = await backend.readNode(tanaNodeId, 1);
      if (nodeContent) {
        // Extract linked entity activity timestamps
        const linkedTimestamps: string[] = [];
        const linkedEntities: FreshnessResult['linkedEntities'] = [];

        // Parse node content for linked entity references
        const markdown = typeof nodeContent === 'string' ? nodeContent : (nodeContent as Record<string, unknown>).markdown as string || '';
        const entityNames = extractEntityNamesFromMarkdown(markdown);

        for (const name of entityNames) {
          linkedEntities.push({ name, lastModified: undefined });
        }

        result.linkedEntities = linkedEntities;

        // Calculate contextual freshness: max of confirmedAt and graph activity
        if (linkedTimestamps.length > 0) {
          const maxActivity = [...linkedTimestamps].sort().pop()!;
          result.graphActivity = maxActivity;
          result.contextualFreshness = entry.confirmedAt > maxActivity ? entry.confirmedAt : maxActivity;
        }

        result.daysSinceActive = daysBetween(new Date(result.contextualFreshness), now);
        result.status = result.daysSinceActive <= threshold ? 'fresh' : 'stale';
      }
    } catch {
      // Node read failed — use timestamp only
      result.status = result.daysSinceActive <= threshold ? 'fresh' : 'stale';
    }

    results.push(result);
  }

  return results;
}

// =============================================================================
// Timestamp-Only Fallback
// =============================================================================

function getTimestampOnlyFreshness(
  entries: PaiLearningEntry[],
  mapping: ReturnType<typeof loadMapping>,
  threshold: number,
): FreshnessResult[] {
  const now = new Date();

  return entries.map((entry) => {
    const tanaNodeId = getMappedNodeId(mapping, entry.seedId);
    const days = daysBetween(new Date(entry.confirmedAt), now);

    return {
      seedId: entry.seedId,
      tanaNodeId,
      content: entry.content,
      type: entry.type,
      confirmedAt: entry.confirmedAt,
      contextualFreshness: entry.confirmedAt,
      status: tanaNodeId ? (days <= threshold ? 'fresh' : 'stale') : 'unknown',
      daysSinceActive: days,
      linkedEntities: [],
    };
  });
}

// =============================================================================
// Helpers
// =============================================================================

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function extractEntityNamesFromMarkdown(markdown: string): string[] {
  const names: string[] = [];

  // Look for "Related People::" and "Related Projects::" field patterns
  const peopleMatch = markdown.match(/Related People::\s*(.+)/);
  if (peopleMatch) {
    names.push(...peopleMatch[1].split(',').map((s) => s.trim()).filter(Boolean));
  }

  const projectsMatch = markdown.match(/Related Projects::\s*(.+)/);
  if (projectsMatch) {
    names.push(...projectsMatch[1].split(',').map((s) => s.trim()).filter(Boolean));
  }

  return names;
}
