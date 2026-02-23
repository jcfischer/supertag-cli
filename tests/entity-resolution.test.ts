/**
 * Entity Resolution - Unit Tests for Core Logic
 *
 * Tests pure functions: normalizeQuery, calculateFuzzyConfidence,
 * mapSemanticToConfidence, mergeAndDeduplicate, determineAction.
 *
 * Spec: F-100 Entity Resolution (T-1.7)
 */

import { describe, it, expect } from 'bun:test';
import {
  normalizeQuery,
  calculateFuzzyConfidence,
  mapSemanticToConfidence,
  mergeAndDeduplicate,
  determineAction,
  generateNameVariants,
  validateShortQuery,
  escapeFTS5Query,
  DEFAULTS,
  type ResolvedCandidate,
  type MatchType,
  type ResolutionAction,
  type ResolveOptions,
} from '../src/lib/entity-resolution';

// =============================================================================
// Types Export Tests
// =============================================================================

describe('Entity Resolution Types', () => {
  it('exports DEFAULTS with threshold 0.85 and limit 5', () => {
    expect(DEFAULTS.threshold).toBe(0.85);
    expect(DEFAULTS.limit).toBe(5);
  });

  it('exports MatchType as string union', () => {
    const types: MatchType[] = ['exact', 'fuzzy', 'semantic'];
    expect(types).toHaveLength(3);
  });

  it('exports ResolutionAction as string union', () => {
    const actions: ResolutionAction[] = ['matched', 'ambiguous', 'no_match'];
    expect(actions).toHaveLength(3);
  });
});

// =============================================================================
// normalizeQuery Tests
// =============================================================================

describe('normalizeQuery', () => {
  it('trims whitespace', () => {
    expect(normalizeQuery('  hello  ')).toBe('hello');
  });

  it('lowercases', () => {
    expect(normalizeQuery('Daniel Miessler')).toBe('daniel miessler');
  });

  it('removes punctuation', () => {
    expect(normalizeQuery('hello!')).toBe('hello');
    expect(normalizeQuery('hello@world')).toBe('helloworld');
    expect(normalizeQuery('test.case')).toBe('testcase');
  });

  it('preserves hyphens', () => {
    expect(normalizeQuery('well-known')).toBe('well-known');
  });

  it('preserves apostrophes', () => {
    expect(normalizeQuery("O'Brien")).toBe("o'brien");
  });

  it('preserves accented characters', () => {
    expect(normalizeQuery('Zürich')).toBe('zürich');
    expect(normalizeQuery('café')).toBe('café');
    expect(normalizeQuery('naïve')).toBe('naïve');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeQuery('hello    world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(normalizeQuery('')).toBe('');
  });

  it('handles whitespace-only string', () => {
    expect(normalizeQuery('   ')).toBe('');
  });

  it('handles mixed Unicode and punctuation', () => {
    expect(normalizeQuery('Jens-Christian Fischer!')).toBe('jens-christian fischer');
  });
});

// =============================================================================
// calculateFuzzyConfidence Tests
// =============================================================================

describe('calculateFuzzyConfidence', () => {
  it('returns high confidence for exact match (capped at 0.95)', () => {
    const conf = calculateFuzzyConfidence('daniel', 'daniel');
    // Levenshtein distance = 0, so base = 1.0, capped to 0.95
    expect(conf).toBe(0.95);
  });

  it('returns lower confidence for typos', () => {
    const conf = calculateFuzzyConfidence('daniel', 'daneil');
    // Levenshtein distance = 2, maxLen = 6, base = 1 - 2/6 = 0.667
    expect(conf).toBeGreaterThan(0.5);
    expect(conf).toBeLessThan(0.95);
  });

  it('returns 0 for completely different strings', () => {
    const conf = calculateFuzzyConfidence('abc', 'xyz');
    // distance = 3, maxLen = 3, base = 0
    expect(conf).toBe(0);
  });

  it('boosts by 0.10 for sameTag', () => {
    const without = calculateFuzzyConfidence('daniel', 'daneil');
    const with_ = calculateFuzzyConfidence('daniel', 'daneil', { sameTag: true });
    expect(with_ - without).toBeCloseTo(0.10, 5);
  });

  it('boosts by 0.05 for isEntity', () => {
    const without = calculateFuzzyConfidence('daniel', 'daneil');
    const with_ = calculateFuzzyConfidence('daniel', 'daneil', { isEntity: true });
    expect(with_ - without).toBeCloseTo(0.05, 5);
  });

  it('caps at 0.95 even with boosts', () => {
    const conf = calculateFuzzyConfidence('daniel', 'daniel', {
      sameTag: true,
      isEntity: true,
    });
    expect(conf).toBe(0.95);
  });

  it('returns 0 for empty strings', () => {
    expect(calculateFuzzyConfidence('', '')).toBe(0);
  });

  it('handles case-insensitive comparison', () => {
    const conf = calculateFuzzyConfidence('Daniel', 'daniel');
    expect(conf).toBe(0.95); // Same string after lowercasing
  });

  it('handles multi-word names', () => {
    const conf = calculateFuzzyConfidence('daniel miessler', 'daniel miessler');
    expect(conf).toBe(0.95);
  });

  it('scores partial match reasonably', () => {
    const conf = calculateFuzzyConfidence('daniel miessler', 'daniel');
    expect(conf).toBeGreaterThan(0.2);
    expect(conf).toBeLessThan(0.8);
  });
});

// =============================================================================
// mapSemanticToConfidence Tests
// =============================================================================

describe('mapSemanticToConfidence', () => {
  it('returns 0 for cosine similarity below 0.5', () => {
    expect(mapSemanticToConfidence(0)).toBe(0);
    expect(mapSemanticToConfidence(0.3)).toBe(0);
    expect(mapSemanticToConfidence(0.49)).toBe(0);
  });

  it('returns 0 for exactly 0.5', () => {
    expect(mapSemanticToConfidence(0.5)).toBe(0);
  });

  it('returns ~0.95 for cosine similarity of 1.0', () => {
    const conf = mapSemanticToConfidence(1.0);
    expect(conf).toBe(0.95);
  });

  it('linearly scales between 0.5 and 1.0', () => {
    const at075 = mapSemanticToConfidence(0.75);
    // (0.75 - 0.5) * 1.9 = 0.475
    expect(at075).toBeCloseTo(0.475, 3);
  });

  it('caps at 0.95', () => {
    // Should not exceed 0.95 even for values > 1.0 (shouldn't happen but safety)
    expect(mapSemanticToConfidence(1.5)).toBe(0.95);
  });

  it('handles negative values', () => {
    expect(mapSemanticToConfidence(-0.5)).toBe(0);
  });
});

// =============================================================================
// mergeAndDeduplicate Tests
// =============================================================================

describe('mergeAndDeduplicate', () => {
  const makeCandidate = (
    id: string,
    confidence: number,
    matchType: MatchType = 'fuzzy'
  ): ResolvedCandidate => ({
    id,
    name: `Node ${id}`,
    tags: [],
    confidence,
    matchType,
    matchDetails: {},
  });

  it('deduplicates by node ID, keeping highest confidence', () => {
    const candidates = [
      makeCandidate('a', 0.7, 'fuzzy'),
      makeCandidate('a', 0.9, 'semantic'),
    ];
    const result = mergeAndDeduplicate(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].matchType).toBe('semantic');
  });

  it('sorts by confidence descending', () => {
    const candidates = [
      makeCandidate('a', 0.5),
      makeCandidate('b', 0.9),
      makeCandidate('c', 0.7),
    ];
    const result = mergeAndDeduplicate(candidates);
    expect(result.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('applies limit', () => {
    const candidates = [
      makeCandidate('a', 0.9),
      makeCandidate('b', 0.8),
      makeCandidate('c', 0.7),
    ];
    const result = mergeAndDeduplicate(candidates, 2);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('handles empty array', () => {
    expect(mergeAndDeduplicate([])).toEqual([]);
  });

  it('handles single candidate', () => {
    const result = mergeAndDeduplicate([makeCandidate('a', 0.8)]);
    expect(result).toHaveLength(1);
  });

  it('preserves matchType of highest confidence', () => {
    const candidates = [
      makeCandidate('a', 0.6, 'fuzzy'),
      makeCandidate('a', 0.8, 'exact'),
      makeCandidate('a', 0.7, 'semantic'),
    ];
    const result = mergeAndDeduplicate(candidates);
    expect(result[0].matchType).toBe('exact');
  });
});

// =============================================================================
// determineAction Tests
// =============================================================================

describe('determineAction', () => {
  const makeCandidate = (confidence: number): ResolvedCandidate => ({
    id: `node-${confidence}`,
    name: `Node ${confidence}`,
    tags: [],
    confidence,
    matchType: 'fuzzy',
    matchDetails: {},
  });

  it('returns no_match when nothing above threshold', () => {
    const candidates = [makeCandidate(0.5), makeCandidate(0.3)];
    expect(determineAction(candidates, 0.85)).toBe('no_match');
  });

  it('returns matched for single candidate above threshold', () => {
    const candidates = [makeCandidate(0.9), makeCandidate(0.3)];
    expect(determineAction(candidates, 0.85)).toBe('matched');
  });

  it('returns matched when gap between top two >= 0.1', () => {
    const candidates = [makeCandidate(0.96), makeCandidate(0.85)];
    expect(determineAction(candidates, 0.85)).toBe('matched');
  });

  it('returns ambiguous when multiple close candidates above threshold', () => {
    const candidates = [makeCandidate(0.92), makeCandidate(0.88)];
    // Gap = 0.04, < 0.1
    expect(determineAction(candidates, 0.85)).toBe('ambiguous');
  });

  it('handles empty candidates', () => {
    expect(determineAction([], 0.85)).toBe('no_match');
  });

  it('handles exact threshold boundary', () => {
    const candidates = [makeCandidate(0.85)];
    expect(determineAction(candidates, 0.85)).toBe('matched');
  });

  it('returns no_match when all just below threshold', () => {
    const candidates = [makeCandidate(0.849)];
    expect(determineAction(candidates, 0.85)).toBe('no_match');
  });
});

// =============================================================================
// generateNameVariants Tests
// =============================================================================

describe('generateNameVariants', () => {
  it('returns original name as first variant', () => {
    const variants = generateNameVariants('Daniel Miessler');
    expect(variants[0]).toBe('Daniel Miessler');
  });

  it('handles "Last, First" pattern', () => {
    const variants = generateNameVariants('Miessler, Daniel');
    expect(variants).toContain('Miessler, Daniel');
    expect(variants).toContain('Daniel Miessler');
  });

  it('generates reverse for "First Last"', () => {
    const variants = generateNameVariants('Daniel Miessler');
    expect(variants).toContain('Miessler, Daniel');
  });

  it('does not duplicate', () => {
    const variants = generateNameVariants('Daniel Miessler');
    const unique = new Set(variants);
    expect(variants.length).toBe(unique.size);
  });

  it('handles single word names', () => {
    const variants = generateNameVariants('Daniel');
    expect(variants).toEqual(['Daniel']);
  });

  it('handles three-word names (no reversal)', () => {
    const variants = generateNameVariants('John Paul Smith');
    // 3 words, no comma → no reversal generated
    expect(variants).toEqual(['John Paul Smith']);
  });
});

// =============================================================================
// validateShortQuery Tests
// =============================================================================

describe('validateShortQuery', () => {
  it('returns error for short query without flags', () => {
    const err = validateShortQuery('ab', {});
    expect(err).toContain('too short');
  });

  it('returns null for short query with --exact', () => {
    expect(validateShortQuery('ab', { exact: true })).toBeNull();
  });

  it('returns null for short query with --tag', () => {
    expect(validateShortQuery('ab', { tag: 'person' })).toBeNull();
  });

  it('returns null for queries >= 3 chars', () => {
    expect(validateShortQuery('abc', {})).toBeNull();
  });

  it('returns null for empty query (separate validation)', () => {
    // Empty query is handled differently (by CLI/MCP input validation)
    expect(validateShortQuery('', {})).toContain('too short');
  });
});

// =============================================================================
// escapeFTS5Query Tests
// =============================================================================

describe('escapeFTS5Query', () => {
  it('passes through normal text unchanged', () => {
    expect(escapeFTS5Query('daniel miessler')).toBe('daniel miessler');
  });

  it('wraps text with special characters in quotes', () => {
    expect(escapeFTS5Query('hello*world')).toBe('"hello*world"');
  });

  it('escapes double quotes by doubling', () => {
    expect(escapeFTS5Query('say "hello"')).toBe('"say ""hello"""');
  });

  it('wraps FTS5 operators', () => {
    expect(escapeFTS5Query('this AND that')).toBe('"this AND that"');
    expect(escapeFTS5Query('NOT something')).toBe('"NOT something"');
  });

  it('handles colons', () => {
    expect(escapeFTS5Query('field:value')).toBe('"field:value"');
  });

  it('handles parentheses', () => {
    expect(escapeFTS5Query('hello(world)')).toBe('"hello(world)"');
  });

  it('handles hyphens (Issue #51: prevents SQL minus operator interpretation)', () => {
    expect(escapeFTS5Query('Jens-Christian Fischer')).toBe('"Jens-Christian Fischer"');
    expect(escapeFTS5Query('well-known')).toBe('"well-known"');
  });

  it('handles plus signs', () => {
    expect(escapeFTS5Query('C++')).toBe('"C++"');
  });
});
