/**
 * PAI Sync Service
 * Spec: F-105 PAI Memory Integration
 * Task: T-3.2
 *
 * Core sync orchestrator: seed.json → Tana #pai_learning nodes.
 * Sequential processing with entity linking and mapping management.
 */

import { resolveBackend } from '../api/backend-resolver';
import { StructuredError } from '../utils/structured-errors';
import { readSeedFile, getConfirmedLearnings, getNewLearningsSince } from './seed-reader';
import { loadMapping, saveMapping, getMappedNodeId, setMappedNodeId, getUnmappedEntries } from './mapping';
import { extractEntityMentions, resolveEntityLinks } from './entity-linker';
import { initPaiSchema } from './schema-init';
import type {
  PaiSyncOptions,
  PaiSyncResult,
  SyncEntryResult,
  PaiLearningEntry,
  EntityLink,
} from '../types/pai';

// =============================================================================
// Constants
// =============================================================================

const BATCH_SIZE = 20;
const MAX_NAME_LENGTH = 100;

// =============================================================================
// Public API
// =============================================================================

/**
 * Sync confirmed learnings from seed.json to Tana as #pai_learning nodes.
 */
export async function syncLearnings(options: PaiSyncOptions = {}): Promise<PaiSyncResult> {
  const { seedPath, workspace, dryRun = false, force = false } = options;

  // 1. Read seed.json
  const seed = readSeedFile(seedPath);
  const allLearnings = getConfirmedLearnings(seed);

  // 2. Load mapping
  const mapping = loadMapping(workspace);

  // 3. Determine entries to sync
  let entriesToSync: PaiLearningEntry[];
  if (force) {
    entriesToSync = allLearnings;
  } else if (mapping.lastSync) {
    entriesToSync = getNewLearningsSince(seed, mapping.lastSync);
    // Also include unmapped entries from older syncs (may have failed)
    const unmapped = getUnmappedEntries(allLearnings, mapping);
    const newIds = new Set(entriesToSync.map((e) => e.seedId));
    for (const entry of unmapped) {
      if (!newIds.has(entry.seedId)) {
        entriesToSync.push(entry);
      }
    }
  } else {
    entriesToSync = allLearnings;
  }

  // 4. Auto-init schema if needed
  if (!mapping.schema?.paiLearningTagId && !dryRun) {
    try {
      await initPaiSchema({ workspace });
    } catch {
      // Schema init failed — continue without it (nodes will be created but less structured)
    }
  }

  // 5. Get write backend
  let backend;
  if (!dryRun) {
    try {
      backend = await resolveBackend();
    } catch (err) {
      throw new StructuredError('LOCAL_API_UNAVAILABLE',
        'Cannot sync PAI learnings: Tana backend unavailable', {
          suggestion: 'Ensure Tana Desktop is running or configure Input API: supertag config --token <token>',
          cause: err instanceof Error ? err : undefined,
        });
    }
  }

  // 6. Process entries
  const result: PaiSyncResult = {
    total: entriesToSync.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    entries: [],
    lastSync: new Date().toISOString(),
  };

  // Process in batches
  for (let i = 0; i < entriesToSync.length; i += BATCH_SIZE) {
    const batch = entriesToSync.slice(i, i + BATCH_SIZE);

    for (const entry of batch) {
      const entryResult = await processEntry(entry, mapping, backend, dryRun, workspace);
      result.entries.push(entryResult);

      switch (entryResult.action) {
        case 'created':
          result.created++;
          break;
        case 'updated':
          result.updated++;
          break;
        case 'skipped':
          result.skipped++;
          break;
        case 'failed':
          result.failed++;
          break;
      }
    }
  }

  // 7. Save updated mapping
  if (!dryRun) {
    mapping.lastSync = result.lastSync;
    saveMapping(mapping);
  }

  return result;
}

// =============================================================================
// Internal Helpers
// =============================================================================

async function processEntry(
  entry: PaiLearningEntry,
  mapping: ReturnType<typeof loadMapping>,
  backend: Awaited<ReturnType<typeof resolveBackend>> | undefined,
  dryRun: boolean,
  workspace?: string,
): Promise<SyncEntryResult> {
  const entryResult: SyncEntryResult = {
    seedId: entry.seedId,
    action: 'created',
    entityLinks: [],
  };

  try {
    // Check if already mapped
    const existingNodeId = getMappedNodeId(mapping, entry.seedId);
    if (existingNodeId && !dryRun) {
      entryResult.action = 'skipped';
      entryResult.tanaNodeId = existingNodeId;
      return entryResult;
    }

    // Extract entity mentions
    const mentions = extractEntityMentions(entry.content);
    let entityLinks: EntityLink[] = [];

    if (dryRun) {
      // In dry-run, report extracted mentions but skip DB resolution
      entryResult.entityLinks = mentions.map((m) => ({
        entityName: m,
        tanaNodeId: '',
        tagType: 'unresolved',
        confidence: 0,
      }));
      entryResult.action = existingNodeId ? 'skipped' : 'created';
      return entryResult;
    }

    // Resolve entity mentions against DB (only in live mode)
    if (mentions.length > 0) {
      entityLinks = await resolveEntityLinks(mentions, { workspace, threshold: 0.7 });
      entryResult.entityLinks = entityLinks;
    }

    // Build node payload
    const nodeName = truncateContent(entry.content, MAX_NAME_LENGTH);

    // Build children for fields
    const children: Array<{ name: string }> = [];

    // Type field
    children.push({ name: `Type:: ${entry.type}` });

    // Content field (full text)
    children.push({ name: `Content:: ${entry.content}` });

    // Confidence (default 5)
    children.push({ name: `Confidence:: 5` });

    // Source
    children.push({ name: `Source:: ${entry.source}` });

    // Confirmed At
    children.push({ name: `Confirmed At:: ${entry.confirmedAt}` });

    // Seed Entry ID (for bidirectional mapping)
    children.push({ name: `Seed Entry ID:: ${entry.seedId}` });

    // Entity links as related people/projects
    const people = entityLinks.filter((l) => l.tagType === 'person');
    const projects = entityLinks.filter((l) => l.tagType === 'project');
    const others = entityLinks.filter((l) => l.tagType !== 'person' && l.tagType !== 'project');

    if (people.length > 0) {
      children.push({ name: `Related People:: ${people.map((p) => p.entityName).join(', ')}` });
    }
    if (projects.length > 0 || others.length > 0) {
      const allProjects = [...projects, ...others];
      children.push({ name: `Related Projects:: ${allProjects.map((p) => p.entityName).join(', ')}` });
    }

    // Create node via backend
    const payload = {
      targetNodeId: undefined,
      nodes: [{
        name: nodeName,
        supertags: [{ id: 'pai_learning' }],
        children: children.map((c) => ({ name: c.name })),
      }],
    };

    const response = await backend!.createNodes(payload);

    // Extract created node ID
    const nodeId = extractNodeId(response);
    if (nodeId) {
      entryResult.tanaNodeId = nodeId;
      setMappedNodeId(mapping, entry.seedId, nodeId);
    }

    entryResult.action = 'created';
  } catch (err) {
    entryResult.action = 'failed';
    entryResult.error = err instanceof Error ? err.message : String(err);
  }

  return entryResult;
}

function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength - 3) + '...';
}

function extractNodeId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;

  // Input API returns { children: [{ id: '...' }] }
  const r = response as Record<string, unknown>;
  if (Array.isArray(r.children)) {
    const first = r.children[0] as Record<string, unknown> | undefined;
    if (first?.id && typeof first.id === 'string') return first.id;
  }

  // Local API may return nodeId directly
  if (typeof r.nodeId === 'string') return r.nodeId;

  return undefined;
}
