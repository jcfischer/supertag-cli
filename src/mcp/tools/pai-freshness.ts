/**
 * MCP Tool: tana_pai_freshness
 * Spec: F-105 PAI Memory Integration
 * Task: T-6.4
 *
 * Check learning freshness using graph activity.
 */

import { assessFreshness } from '../../pai/freshness-service';
import type { PaiFreshnessInput } from '../schemas';
import type { FreshnessResult } from '../../types/pai';

export async function paiFreshness(input: PaiFreshnessInput): Promise<FreshnessResult[]> {
  return assessFreshness({
    threshold: input.threshold,
    type: input.type,
    workspace: input.workspace,
  });
}
