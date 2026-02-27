/**
 * MCP Tool: tana_pai_context
 * Spec: F-105 PAI Memory Integration
 * Task: T-6.3
 *
 * Retrieve graph-aware learning context for a topic.
 */

import { getPaiContext } from '../../pai/context-service';
import type { PaiContextInput } from '../schemas';
import type { PaiContextResponse } from '../../types/pai';

export async function paiContext(input: PaiContextInput): Promise<PaiContextResponse> {
  return getPaiContext(input.topic, {
    maxTokens: input.maxTokens,
    type: input.type,
    workspace: input.workspace,
  });
}
