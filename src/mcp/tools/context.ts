/**
 * tana_context MCP Tool (Spec F-098)
 *
 * Assemble structured AI context from the Tana knowledge graph.
 */

import { assembleContext } from '../../services/context-assembler';
import { formatContext } from '../../services/context-formatter';
import type { ContextInput } from '../schemas';

/**
 * Handle tana_context tool invocation.
 */
export async function contextTool(input: ContextInput): Promise<string> {
  const doc = await assembleContext(input.query, {
    workspace: input.workspace,
    depth: input.depth,
    maxTokens: input.maxTokens,
    includeFields: input.includeFields,
    lens: input.lens,
    offline: false,
  });

  return formatContext(doc, input.format ?? 'markdown');
}
