/**
 * Entity Matching - Database Integration Tests
 *
 * Tests findExactMatches, findFuzzyMatches, and resolveEntity
 * using an in-memory SQLite database with test fixtures.
 *
 * Spec: F-100 Entity Resolution (T-2.6)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  findExactMatches,
  findFuzzyMatches,
  resolveEntity,
} from '../src/db/entity-match';

// =============================================================================
// Test Fixtures
// =============================================================================

let db: Database;

function setupTestDb(): Database {
  const db = new Database(':memory:');

  // Create nodes table
  db.run(`
    CREATE TABLE nodes (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      name TEXT,
      created TEXT,
      raw_data TEXT DEFAULT '{}'
    )
  `);

  // Create FTS5 virtual table
  db.run(`
    CREATE VIRTUAL TABLE nodes_fts USING fts5(
      name,
      content='nodes',
      content_rowid='rowid'
    )
  `);

  // Create tag_applications table
  db.run(`
    CREATE TABLE tag_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tuple_node_id TEXT NOT NULL,
      data_node_id TEXT NOT NULL,
      tag_name TEXT NOT NULL
    )
  `);

  // Insert test data
  const nodes = [
    { id: 'node-1', name: 'Daniel Miessler', raw_data: '{"props":{"_flags":1}}' },
    { id: 'node-2', name: 'Daniel Fischer', raw_data: '{"props":{"_flags":1}}' },
    { id: 'node-3', name: 'Project Alpha', raw_data: '{"props":{"_flags":1}}' },
    { id: 'node-4', name: 'Daniel Miessler', raw_data: '{"props":{"_flags":1}}' }, // Duplicate name, different type
    { id: 'node-5', name: 'Meeting Notes', raw_data: '{"props":{}}' },
    { id: 'node-6', name: 'AB', raw_data: '{"props":{"_flags":1}}' }, // Short name
  ];

  const insertNode = db.prepare(
    'INSERT INTO nodes (id, name, raw_data) VALUES (?, ?, ?)'
  );
  const insertFts = db.prepare(
    'INSERT INTO nodes_fts (rowid, name) VALUES (?, ?)'
  );
  const insertTag = db.prepare(
    'INSERT INTO tag_applications (tuple_node_id, data_node_id, tag_name) VALUES (?, ?, ?)'
  );

  for (const [i, node] of nodes.entries()) {
    insertNode.run(node.id, node.name, node.raw_data);
    insertFts.run(i + 1, node.name);
  }

  // Tag applications
  insertTag.run('tag-1', 'node-1', 'person');
  insertTag.run('tag-2', 'node-2', 'person');
  insertTag.run('tag-3', 'node-3', 'project');
  insertTag.run('tag-4', 'node-4', 'project'); // Same name "Daniel Miessler" but as project
  insertTag.run('tag-5', 'node-5', 'meeting');

  return db;
}

beforeAll(() => {
  db = setupTestDb();
});

afterAll(() => {
  db.close();
});

// =============================================================================
// findExactMatches Tests
// =============================================================================

describe('findExactMatches', () => {
  it('finds exact case-insensitive match', () => {
    const results = findExactMatches(db, 'Daniel Miessler');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].confidence).toBe(1.0);
    expect(results[0].matchType).toBe('exact');
  });

  it('finds match with different case', () => {
    const results = findExactMatches(db, 'daniel miessler');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Daniel Miessler');
  });

  it('returns empty for non-existent name', () => {
    const results = findExactMatches(db, 'Nonexistent Person');
    expect(results).toHaveLength(0);
  });

  it('filters by tag when specified', () => {
    const personResults = findExactMatches(db, 'Daniel Miessler', { tag: 'person' });
    const projectResults = findExactMatches(db, 'Daniel Miessler', { tag: 'project' });

    // node-1 is person, node-4 is project, both named "Daniel Miessler"
    expect(personResults.length).toBe(1);
    expect(personResults[0].id).toBe('node-1');

    expect(projectResults.length).toBe(1);
    expect(projectResults[0].id).toBe('node-4');
  });

  it('returns all matches without tag filter', () => {
    const results = findExactMatches(db, 'Daniel Miessler');
    // Both node-1 and node-4 have name "Daniel Miessler"
    expect(results.length).toBe(2);
  });

  it('includes tags in results', () => {
    const results = findExactMatches(db, 'Daniel Miessler', { tag: 'person' });
    expect(results[0].tags).toContain('person');
  });
});

// =============================================================================
// findFuzzyMatches Tests
// =============================================================================

describe('findFuzzyMatches', () => {
  it('finds fuzzy match for typo', () => {
    const results = findFuzzyMatches(db, 'Daniel Miesler'); // Missing 's'
    // Should find "Daniel Miessler" via FTS
    const danielMatch = results.find((r) => r.name === 'Daniel Miessler');
    expect(danielMatch).toBeDefined();
    expect(danielMatch!.matchType).toBe('fuzzy');
    expect(danielMatch!.confidence).toBeGreaterThan(0.5);
    expect(danielMatch!.confidence).toBeLessThanOrEqual(0.95);
  });

  it('returns results sorted by confidence', () => {
    const results = findFuzzyMatches(db, 'Daniel');
    // Should find both Daniels
    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].confidence).toBeGreaterThanOrEqual(
          results[i].confidence
        );
      }
    }
  });

  it('filters by tag', () => {
    const results = findFuzzyMatches(db, 'Daniel', { tag: 'person' });
    for (const r of results) {
      expect(r.tags.map((t) => t.toLowerCase())).toContain('person');
    }
  });

  it('includes levenshtein distance in match details', () => {
    const results = findFuzzyMatches(db, 'Daniel Miessler');
    if (results.length > 0) {
      expect(results[0].matchDetails.levenshteinDistance).toBeDefined();
    }
  });

  it('returns empty for completely unrelated query', () => {
    const results = findFuzzyMatches(db, 'zzzzzzzzzzz');
    expect(results).toHaveLength(0);
  });
});

// =============================================================================
// resolveEntity Tests
// =============================================================================

describe('resolveEntity', () => {
  it('returns matched for exact name', async () => {
    const result = await resolveEntity(db, 'Daniel Miessler', { tag: 'person' });
    expect(result.action).toBe('matched');
    expect(result.bestMatch).not.toBeNull();
    expect(result.bestMatch!.confidence).toBe(1.0);
  });

  it('returns no_match for nonexistent name', async () => {
    const result = await resolveEntity(db, 'Completely Unknown Person');
    expect(result.action).toBe('no_match');
    expect(result.bestMatch).toBeNull();
  });

  it('returns ambiguous for same name different types', async () => {
    // "Daniel Miessler" exists as both person and project
    const result = await resolveEntity(db, 'Daniel Miessler');
    // Both have confidence 1.0, gap < 0.1, so ambiguous
    expect(result.action).toBe('ambiguous');
  });

  it('resolves unambiguously with tag filter', async () => {
    const result = await resolveEntity(db, 'Daniel Miessler', { tag: 'person' });
    expect(result.action).toBe('matched');
    expect(result.bestMatch!.id).toBe('node-1');
  });

  it('respects exact flag (no fuzzy matching)', async () => {
    const result = await resolveEntity(db, 'Daniel Miesler', { exact: true });
    // Typo won't match in exact mode
    expect(result.action).toBe('no_match');
  });

  it('respects threshold', async () => {
    const result = await resolveEntity(db, 'Daniel', {
      threshold: 0.99,
      tag: 'person',
    });
    // "Daniel" vs "Daniel Miessler" — not exact, fuzzy confidence < 0.99
    expect(result.action).toBe('no_match');
  });

  it('respects limit', async () => {
    const result = await resolveEntity(db, 'Daniel', { limit: 1 });
    expect(result.candidates.length).toBeLessThanOrEqual(1);
  });

  it('includes normalized query in result', async () => {
    const result = await resolveEntity(db, '  Daniel MIESSLER  ');
    expect(result.normalizedQuery).toBe('daniel miessler');
  });

  it('handles short query protection', async () => {
    // Short query without --exact or --tag should return no_match
    const result = await resolveEntity(db, 'AB');
    expect(result.action).toBe('no_match');
    expect(result.candidates).toHaveLength(0);
  });

  it('allows short query with tag filter', async () => {
    // Short query WITH --tag should work
    const result = await resolveEntity(db, 'AB', { tag: 'person' });
    // May or may not find results, but shouldn't be blocked
    expect(result.query).toBe('AB');
  });
});
