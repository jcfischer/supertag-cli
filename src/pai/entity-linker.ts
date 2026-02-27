/**
 * Entity Linker
 * Spec: F-105 PAI Memory Integration
 * Task: T-3.1
 *
 * Extracts entity mentions from learning content and resolves them
 * to existing Tana nodes using entity resolution (F-100).
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import { resolveEntity } from '../db/entity-match';
import { resolveWorkspaceContext } from '../config/workspace-resolver';
import type { EntityLink } from '../types/pai';

// =============================================================================
// Entity Extraction (NLP-lite)
// =============================================================================

/**
 * Extract entity mentions from learning content using simple heuristics.
 * Returns deduplicated list of potential entity names.
 */
export function extractEntityMentions(content: string): string[] {
  const mentions = new Set<string>();

  // 1. Quoted strings: "Project Alpha", 'CTF Platform'
  const quotedPattern = /["']([A-Z][^"']{2,50})["']/g;
  for (const match of content.matchAll(quotedPattern)) {
    mentions.add(match[1].trim());
  }

  // 2. Capitalized multi-word phrases (2-4 words starting with capitals)
  // Matches: "Jens-Christian Fischer", "CTF Platform", "Simon Weber"
  // Excludes common sentence starters by requiring at least 2 capitalized words
  const capitalizedPattern = /(?<![.!?]\s)(?:^|\s)((?:[A-Z][a-zA-Z-]+(?:\s+|$)){2,4})/gm;
  for (const match of content.matchAll(capitalizedPattern)) {
    const phrase = match[1].trim();
    // Skip if it's just 2 very common words or too short
    if (phrase.length >= 4 && !isCommonPhrase(phrase)) {
      mentions.add(phrase);
    }
  }

  // 3. @-mentions: @simon, @jens
  const atPattern = /@([a-zA-Z][a-zA-Z0-9_-]{1,30})/g;
  for (const match of content.matchAll(atPattern)) {
    mentions.add(match[1]);
  }

  // 4. #-hashtags: #CTFPlatform, #projectX
  const hashPattern = /#([a-zA-Z][a-zA-Z0-9_-]{2,30})/g;
  for (const match of content.matchAll(hashPattern)) {
    mentions.add(match[1]);
  }

  return [...mentions];
}

/**
 * Resolve extracted entity mentions to Tana nodes using entity resolution.
 * Best-effort: unresolved mentions are silently skipped.
 */
export async function resolveEntityLinks(
  mentions: string[],
  options: { workspace?: string; threshold?: number } = {},
): Promise<EntityLink[]> {
  const { threshold = 0.7 } = options;

  if (mentions.length === 0) {
    return [];
  }

  let wsContext;
  try {
    wsContext = resolveWorkspaceContext({ workspace: options.workspace });
  } catch {
    return []; // No workspace available, skip linking
  }

  if (!existsSync(wsContext.dbPath)) {
    return [];
  }

  const db = new Database(wsContext.dbPath, { readonly: true });
  const links: EntityLink[] = [];

  try {
    for (const mention of mentions) {
      try {
        const result = await resolveEntity(db, mention, {
          threshold,
          limit: 1,
        });

        if (result.candidates.length > 0) {
          const best = result.candidates[0];
          if (best.confidence >= threshold) {
            const tagType = best.tags?.[0] ?? 'node';
            links.push({
              entityName: mention,
              tanaNodeId: best.id,
              tagType,
              confidence: best.confidence,
            });
          }
        }
      } catch {
        // Skip individual resolution failures
      }
    }
  } finally {
    db.close();
  }

  return links;
}

// =============================================================================
// Internal Helpers
// =============================================================================

const COMMON_PHRASES = new Set([
  'The', 'This', 'That', 'These', 'Those',
  'When', 'Where', 'Which', 'While', 'What',
  'Should', 'Could', 'Would', 'About',
  'Always', 'Never', 'Often', 'Sometimes',
]);

function isCommonPhrase(phrase: string): boolean {
  const firstWord = phrase.split(/\s+/)[0];
  return COMMON_PHRASES.has(firstWord);
}
