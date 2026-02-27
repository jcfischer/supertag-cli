/**
 * PAI ID Mapping CRUD
 * Spec: F-105 PAI Memory Integration
 * Task: T-1.3
 *
 * Manages the mapping between seed.json entry IDs and Tana node IDs.
 * Persisted at ~/.config/supertag/pai-mapping.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { PaiMappingSchema, type PaiMapping, type PaiLearningEntry } from '../types/pai';

// =============================================================================
// Constants
// =============================================================================

const CONFIG_DIR = join(homedir(), '.config', 'supertag');
const MAPPING_FILENAME = 'pai-mapping.json';

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the path to the mapping file.
 */
export function getMappingPath(): string {
  return join(CONFIG_DIR, MAPPING_FILENAME);
}

/**
 * Load the PAI mapping from disk, or return an empty mapping if not found.
 */
export function loadMapping(workspace?: string): PaiMapping {
  const mappingPath = getMappingPath();

  if (!existsSync(mappingPath)) {
    return createEmptyMapping(workspace ?? 'main');
  }

  try {
    const raw = readFileSync(mappingPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = PaiMappingSchema.safeParse(parsed);

    if (!result.success) {
      // If the file is corrupted, return empty mapping rather than crashing
      return createEmptyMapping(workspace ?? 'main');
    }

    return result.data;
  } catch {
    return createEmptyMapping(workspace ?? 'main');
  }
}

/**
 * Save the PAI mapping to disk. Creates parent directories if needed.
 */
export function saveMapping(mapping: PaiMapping): void {
  const mappingPath = getMappingPath();
  const dir = dirname(mappingPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf-8');
}

/**
 * Get the Tana node ID for a seed entry, if mapped.
 */
export function getMappedNodeId(mapping: PaiMapping, seedId: string): string | undefined {
  return mapping.mappings[seedId];
}

/**
 * Set the Tana node ID for a seed entry (mutates mapping in-place).
 */
export function setMappedNodeId(mapping: PaiMapping, seedId: string, tanaNodeId: string): void {
  mapping.mappings[seedId] = tanaNodeId;
}

/**
 * Filter entries to those not yet mapped to Tana nodes.
 */
export function getUnmappedEntries(
  entries: PaiLearningEntry[],
  mapping: PaiMapping,
): PaiLearningEntry[] {
  return entries.filter((entry) => !mapping.mappings[entry.seedId]);
}

// =============================================================================
// Internal Helpers
// =============================================================================

function createEmptyMapping(workspace: string): PaiMapping {
  return {
    version: 1,
    workspace,
    lastSync: '',
    mappings: {},
  };
}
