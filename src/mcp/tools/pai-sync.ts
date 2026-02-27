/**
 * MCP Tool: tana_pai_sync
 * Spec: F-105 PAI Memory Integration
 * Task: T-6.2
 *
 * Sync confirmed learnings from seed.json to Tana.
 */

import { syncLearnings } from '../../pai/sync-service';
import { handleMcpError } from '../error-handler';
import type { PaiSyncInput } from '../schemas';

export async function paiSync(input: PaiSyncInput) {
  try {
    const result = await syncLearnings({
      seedPath: input.seedPath,
      workspace: input.workspace,
      dryRun: input.dryRun,
      force: input.force,
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return handleMcpError(error);
  }
}
