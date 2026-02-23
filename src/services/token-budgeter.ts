/**
 * Token Budgeter Service (Spec F-098)
 *
 * Enforces token budget by pruning lowest-relevance nodes.
 * Nodes that exceed the budget are summarized (name + type only).
 */

import type { ContextNode, OverflowSummary, TokenBudget, TokenUsage } from '../types/context';
import { countTokens } from './token-counter';

/** Default token budget settings */
export const DEFAULT_BUDGET: TokenBudget = {
  maxTokens: 4000,
  headerReserve: 200,
  minPerNode: 50,
};

export interface BudgetResult {
  included: ContextNode[];
  overflow: OverflowSummary[];
  usage: TokenUsage;
}

/**
 * Prune scored nodes to fit within token budget.
 *
 * Nodes must be pre-sorted by relevance (highest first).
 * Includes nodes until budget is exhausted, then summarizes the rest.
 *
 * @param nodes - Scored nodes sorted by relevance descending
 * @param budget - Token budget configuration
 * @returns Included nodes, overflow summaries, and usage statistics
 */
export async function pruneToFitBudget(
  nodes: ContextNode[],
  budget: TokenBudget = DEFAULT_BUDGET,
): Promise<BudgetResult> {
  const availableTokens = budget.maxTokens - budget.headerReserve;
  let tokensUsed = 0;
  const included: ContextNode[] = [];
  const overflow: OverflowSummary[] = [];

  for (const node of nodes) {
    // Estimate tokens for this node
    const nodeText = buildNodeText(node);
    const nodeTokens = await countTokens(nodeText);

    if (tokensUsed + nodeTokens <= availableTokens) {
      included.push(node);
      tokensUsed += nodeTokens;
    } else if (tokensUsed < availableTokens && nodeTokens > budget.minPerNode) {
      // Partial: check if a summary would fit
      const summaryTokens = await countTokens(`${node.name} [${node.tags.join(', ')}]`);
      if (tokensUsed + summaryTokens <= availableTokens) {
        overflow.push({
          id: node.id,
          name: node.name,
          tags: node.tags,
          score: node.score,
        });
        tokensUsed += summaryTokens;
      } else {
        overflow.push({
          id: node.id,
          name: node.name,
          tags: node.tags,
          score: node.score,
        });
      }
    } else {
      overflow.push({
        id: node.id,
        name: node.name,
        tags: node.tags,
        score: node.score,
      });
    }
  }

  return {
    included,
    overflow,
    usage: {
      budget: budget.maxTokens,
      used: tokensUsed + budget.headerReserve,
      utilization: (tokensUsed + budget.headerReserve) / budget.maxTokens,
      nodesIncluded: included.length,
      nodesSummarized: overflow.length,
    },
  };
}

/**
 * Build the text representation of a node for token counting.
 */
function buildNodeText(node: ContextNode): string {
  let text = `## ${node.name}`;

  if (node.tags.length > 0) {
    text += ` [${node.tags.join(', ')}]`;
  }

  text += '\n';

  if (node.content) {
    text += node.content + '\n';
  }

  if (node.fields) {
    for (const [key, value] of Object.entries(node.fields)) {
      const val = Array.isArray(value) ? value.join(', ') : value;
      text += `- **${key}**: ${val}\n`;
    }
  }

  return text;
}
