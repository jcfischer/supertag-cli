/**
 * MCP Tool: tana_pai_context
 * Spec: F-105 PAI Memory Integration
 * Task: T-6.3
 *
 * Retrieve graph-aware learning context for a topic.
 */

import { getPaiContext } from '../../pai/context-service';
import { handleMcpError } from '../error-handler';
import type { PaiContextInput } from '../schemas';

export async function paiContext(input: PaiContextInput) {
  try {
    const result = await getPaiContext(input.topic, {
      maxTokens: input.maxTokens,
      type: input.type,
      workspace: input.workspace,
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return handleMcpError(error);
  }
}
