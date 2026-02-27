/**
 * MCP Tool: tana_pai_sync
 * Spec: F-105 PAI Memory Integration
 * Task: T-6.2
 *
 * Sync confirmed learnings from seed.json to Tana.
 */

import { syncLearnings } from '../../pai/sync-service';
import type { PaiSyncInput } from '../schemas';
import type { PaiSyncResult } from '../../types/pai';

export async function paiSync(input: PaiSyncInput): Promise<PaiSyncResult> {
  return syncLearnings({
    seedPath: input.seedPath,
    workspace: input.workspace,
    dryRun: input.dryRun,
    force: input.force,
  });
}
