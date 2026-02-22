/**
 * Token Counter Service (Spec F-098)
 *
 * Accurate token counting using js-tiktoken (GPT-compatible).
 * Falls back to character-based estimation if tiktoken fails to initialize.
 */

import type { ContextNode } from '../types/context';

let encoder: { encode: (text: string) => number[] } | null = null;
let initAttempted = false;

/**
 * Initialize the tiktoken encoder (lazy, one-time).
 */
async function getEncoder(): Promise<typeof encoder> {
  if (initAttempted) return encoder;
  initAttempted = true;

  try {
    const { encodingForModel } = await import('js-tiktoken');
    encoder = encodingForModel('gpt-4');
  } catch {
    // Fall back to character-based estimation
    encoder = null;
  }
  return encoder;
}

/**
 * Count tokens in a text string.
 * Uses tiktoken for accuracy; falls back to ~4 chars per token.
 */
export async function countTokens(text: string): Promise<number> {
  if (!text) return 0;

  const enc = await getEncoder();
  if (enc) {
    return enc.encode(text).length;
  }

  // Fallback: ~4 characters per token (reasonable approximation)
  return Math.ceil(text.length / 4);
}

/**
 * Synchronous token counting using character-based estimation.
 * Use when async is not available.
 */
export function countTokensSync(text: string): number {
  if (!text) return 0;

  if (encoder) {
    return encoder.encode(text).length;
  }

  return Math.ceil(text.length / 4);
}

/**
 * Estimate token count for a context node (name + content + fields).
 */
export async function estimateNodeTokens(node: ContextNode): Promise<number> {
  let text = node.name;

  if (node.content) {
    text += '\n' + node.content;
  }

  if (node.tags.length > 0) {
    text += '\n' + node.tags.join(', ');
  }

  if (node.fields) {
    for (const [key, value] of Object.entries(node.fields)) {
      const val = Array.isArray(value) ? value.join(', ') : value;
      text += `\n${key}: ${val}`;
    }
  }

  return countTokens(text);
}

/**
 * Initialize the encoder eagerly (for pre-warming).
 */
export async function initTokenCounter(): Promise<void> {
  await getEncoder();
}
