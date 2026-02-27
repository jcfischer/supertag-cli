/**
 * Seed.json Reader
 * Spec: F-105 PAI Memory Integration
 * Task: T-1.2
 *
 * Reads and parses ~/.pai/seed.json with Zod validation.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { StructuredError } from '../utils/structured-errors';
import { SeedFileSchema, type SeedFile, type PaiLearningEntry, type LearningType } from '../types/pai';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SEED_PATH = join(homedir(), '.pai', 'seed.json');

// =============================================================================
// Public API
// =============================================================================

/**
 * Read and parse seed.json with Zod validation.
 * @param path Path to seed.json (default: ~/.pai/seed.json)
 * @returns Parsed SeedFile
 * @throws StructuredError if file not found or invalid
 */
export function readSeedFile(path?: string): SeedFile {
  const seedPath = path ?? DEFAULT_SEED_PATH;

  if (!existsSync(seedPath)) {
    throw new StructuredError('CONFIG_NOT_FOUND', `seed.json not found at ${seedPath}`, {
      suggestion: 'Ensure pai-seed is installed and has created seed.json',
      details: { path: seedPath },
    });
  }

  let raw: string;
  try {
    raw = readFileSync(seedPath, 'utf-8');
  } catch (err) {
    throw new StructuredError('CONFIG_NOT_FOUND', `Failed to read seed.json at ${seedPath}`, {
      details: { path: seedPath, error: String(err) },
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StructuredError('INVALID_FORMAT', `seed.json contains invalid JSON at ${seedPath}`, {
      details: { path: seedPath, error: String(err) },
    });
  }

  const result = SeedFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new StructuredError('INVALID_FORMAT', `seed.json validation failed: ${result.error.message}`, {
      details: { path: seedPath, errors: result.error.issues },
    });
  }

  return result.data;
}

/**
 * Extract all confirmed learnings from seed.json across all categories.
 */
export function getConfirmedLearnings(seed: SeedFile): PaiLearningEntry[] {
  const entries: PaiLearningEntry[] = [];

  const categories: Array<{ items: typeof seed.learned.patterns; type: LearningType }> = [
    { items: seed.learned.patterns ?? [], type: 'pattern' },
    { items: seed.learned.insights ?? [], type: 'insight' },
    { items: seed.learned.selfKnowledge ?? [], type: 'self_knowledge' },
  ];

  for (const { items, type } of categories) {
    for (const entry of items) {
      if (entry.confirmed) {
        entries.push({
          seedId: entry.id,
          type,
          content: entry.content,
          source: entry.source,
          confirmedAt: entry.confirmedAt,
          tags: entry.tags ?? [],
        });
      }
    }
  }

  return entries;
}

/**
 * Get learnings confirmed after a specific timestamp (incremental sync).
 */
export function getNewLearningsSince(seed: SeedFile, lastSync: string): PaiLearningEntry[] {
  const all = getConfirmedLearnings(seed);
  return all.filter((entry) => entry.confirmedAt > lastSync);
}

/**
 * Get the default seed.json path.
 */
export function getDefaultSeedPath(): string {
  return DEFAULT_SEED_PATH;
}
