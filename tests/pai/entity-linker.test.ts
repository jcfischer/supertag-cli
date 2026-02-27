/**
 * Tests: Entity Linker
 * Task: T-3.1
 */

import { describe, it, expect } from 'bun:test';
import { extractEntityMentions } from '../../src/pai/entity-linker';

describe('Entity Linker', () => {
  describe('extractEntityMentions', () => {
    it('extracts capitalized multi-word phrases', () => {
      const mentions = extractEntityMentions(
        'Jens-Christian Fischer prefers German for internal communications',
      );
      expect(mentions).toContainEqual(expect.stringContaining('Jens-Christian Fischer'));
    });

    it('extracts quoted strings', () => {
      const mentions = extractEntityMentions(
        'The "CTF Platform" project uses a deploy.yml playbook',
      );
      expect(mentions).toContain('CTF Platform');
    });

    it('extracts single-quoted strings', () => {
      const mentions = extractEntityMentions(
        "Working on 'Project Alpha' with the team",
      );
      expect(mentions).toContain('Project Alpha');
    });

    it('extracts @-mentions', () => {
      const mentions = extractEntityMentions('talked to @simon about the project');
      expect(mentions).toContain('simon');
    });

    it('extracts #-hashtags', () => {
      const mentions = extractEntityMentions('related to #CTFPlatform deployment');
      expect(mentions).toContain('CTFPlatform');
    });

    it('deduplicates mentions', () => {
      const mentions = extractEntityMentions(
        '"Project Alpha" is great. "Project Alpha" is amazing.',
      );
      const count = mentions.filter((m) => m === 'Project Alpha').length;
      expect(count).toBe(1);
    });

    it('returns empty array for content with no entities', () => {
      const mentions = extractEntityMentions(
        'always run typecheck before pushing to avoid ci failures',
      );
      // No capitalized multi-word phrases, no quotes, no @/# mentions
      expect(mentions).toEqual([]);
    });

    it('handles mixed entity types', () => {
      const mentions = extractEntityMentions(
        'Simon Weber\'s "Project Alpha" uses @german for #SwissMarket strategy',
      );
      expect(mentions.length).toBeGreaterThanOrEqual(2);
      expect(mentions).toContain('Project Alpha');
    });

    it('handles content with no text gracefully', () => {
      expect(extractEntityMentions('')).toEqual([]);
    });

    it('does not extract very short quoted strings', () => {
      const mentions = extractEntityMentions('He said "hi" to the team');
      // "hi" is too short (lowercase, less than 3 chars) — shouldn't match
      expect(mentions).not.toContain('hi');
    });
  });
});
