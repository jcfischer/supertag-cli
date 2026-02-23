/**
 * Context Formatter (Spec F-098)
 *
 * Renders a ContextDocument as markdown or JSON.
 */

import type { ContextDocument, ContextNode, OverflowSummary } from '../types/context';

/**
 * Format a context document for output.
 */
export function formatContext(doc: ContextDocument, format: 'markdown' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(doc, null, 2);
  }

  return formatMarkdown(doc);
}

/**
 * Render context document as hierarchical markdown.
 */
function formatMarkdown(doc: ContextDocument): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Context: ${doc.meta.query}`);
  lines.push('');
  lines.push(`> Assembled ${doc.meta.assembledAt} | Lens: ${doc.meta.lens} | Backend: ${doc.meta.backend}`);
  lines.push(`> Tokens: ${doc.meta.tokens.used}/${doc.meta.tokens.budget} (${Math.round(doc.meta.tokens.utilization * 100)}%) | Nodes: ${doc.meta.tokens.nodesIncluded} included, ${doc.meta.tokens.nodesSummarized} summarized`);
  if (!doc.meta.embeddingsAvailable) {
    lines.push('> Note: Embeddings not available — using distance + recency scoring only');
  }
  lines.push('');

  // Nodes
  for (const node of doc.nodes) {
    lines.push(formatNode(node));
    lines.push('');
  }

  // Overflow
  if (doc.overflow.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Also Related');
    lines.push('');
    for (const item of doc.overflow) {
      lines.push(formatOverflow(item));
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Format a single context node as markdown.
 */
function formatNode(node: ContextNode): string {
  const lines: string[] = [];

  // Node header with tags
  const tagStr = node.tags.length > 0 ? ` [${node.tags.join(', ')}]` : '';
  lines.push(`## ${node.name}${tagStr}`);

  // Score/distance metadata (compact)
  lines.push(`*Score: ${node.score.toFixed(2)} | Distance: ${node.distance}*`);
  lines.push('');

  // Content
  if (node.content) {
    lines.push(node.content);
    lines.push('');
  }

  // Fields
  if (node.fields && Object.keys(node.fields).length > 0) {
    lines.push('**Fields:**');
    for (const [key, value] of Object.entries(node.fields)) {
      const val = Array.isArray(value) ? value.join(', ') : value;
      lines.push(`- **${key}**: ${val}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format an overflow summary as a compact markdown line.
 */
function formatOverflow(item: OverflowSummary): string {
  const tagStr = item.tags.length > 0 ? ` [${item.tags.join(', ')}]` : '';
  return `- ${item.name}${tagStr} *(score: ${item.score.toFixed(2)})*`;
}
