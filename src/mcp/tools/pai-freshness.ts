/**
 * MCP Tool: tana_pai_freshness
 * Spec: F-105 PAI Memory Integration
 * Task: T-6.4
 *
 * Check learning freshness using graph activity.
 */

import { assessFreshness } from '../../pai/freshness-service';
import { handleMcpError } from '../error-handler';
import type { PaiFreshnessInput } from '../schemas';

export async function paiFreshness(input: PaiFreshnessInput) {
  try {
    const results = await assessFreshness({
      threshold: input.threshold,
      type: input.type,
      workspace: input.workspace,
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  } catch (error) {
    return handleMcpError(error);
  }
}
