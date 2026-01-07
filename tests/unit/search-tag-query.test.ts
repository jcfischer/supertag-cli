/**
 * Tests for Search Tag Query Filter (Spec 089)
 *
 * Verifies that search with --tag flag respects the query parameter
 * for name filtering.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { TanaQueryEngine } from '../../src/query/tana-query-engine';
import { unlinkSync } from 'fs';

describe('Search Tag Query Filter (Spec 089)', () => {
  const testDbPath = '/tmp/test-search-tag-query.db';
  let engine: TanaQueryEngine;

  beforeAll(() => {
    // Create test database with schema
    const db = new Database(testDbPath);

    // Create tables (match actual schema)
    db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        created INTEGER,
        updated INTEGER,
        parent_id TEXT,
        node_type TEXT,
        raw_data TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tag_applications (
        data_node_id TEXT,
        tag_id TEXT,
        tag_name TEXT
      )
    `);

    /*
     * Test data:
     * - 3 nodes with tag "topic": Velo, Bikepacking, Running
     * - 2 nodes with tag "person": Katja Mueller, Max Muster
     */
    const now = Date.now();
    const insertNode = db.prepare('INSERT INTO nodes (id, name, created, updated) VALUES (?, ?, ?, ?)');

    // Topics
    insertNode.run('topic1', 'Velo', now, now);
    insertNode.run('topic2', 'Bikepacking', now - 1000, now - 1000);
    insertNode.run('topic3', 'Running', now - 2000, now - 2000);

    // People
    insertNode.run('person1', 'Katja Mueller', now, now);
    insertNode.run('person2', 'Max Muster', now - 1000, now - 1000);

    // Tag applications
    const insertTag = db.prepare('INSERT INTO tag_applications (data_node_id, tag_id, tag_name) VALUES (?, ?, ?)');
    insertTag.run('topic1', 'tagTopic', 'topic');
    insertTag.run('topic2', 'tagTopic', 'topic');
    insertTag.run('topic3', 'tagTopic', 'topic');
    insertTag.run('person1', 'tagPerson', 'person');
    insertTag.run('person2', 'tagPerson', 'person');

    db.close();

    // Create engine
    engine = new TanaQueryEngine(testDbPath);
  });

  afterAll(() => {
    engine.close();
    try {
      unlinkSync(testDbPath);
    } catch {
      // Ignore
    }
  });

  describe('findNodesByTag with nameContains', () => {
    it('should filter by nameContains (case-insensitive)', async () => {
      // Search for "velo" (lowercase) should match "Velo" (capitalized)
      const results = await engine.findNodesByTag('topic', { nameContains: 'velo' });

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Velo');
    });

    it('should filter by nameContains with uppercase query', async () => {
      // Search for "VELO" (uppercase) should match "Velo"
      const results = await engine.findNodesByTag('topic', { nameContains: 'VELO' });

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Velo');
    });

    it('should filter by partial name match', async () => {
      // Search for "pack" should match "Bikepacking"
      const results = await engine.findNodesByTag('topic', { nameContains: 'pack' });

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Bikepacking');
    });

    it('should return empty array when no matches', async () => {
      const results = await engine.findNodesByTag('topic', { nameContains: 'nonexistent' });

      expect(results.length).toBe(0);
    });

    it('should filter person tag by partial name', async () => {
      // Search for "Katja" in person tag
      const results = await engine.findNodesByTag('person', { nameContains: 'Katja' });

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Katja Mueller');
    });

    it('should return all nodes when nameContains not provided', async () => {
      // No nameContains = return all
      const results = await engine.findNodesByTag('topic');

      expect(results.length).toBe(3);
    });

    it('should combine nameContains with limit', async () => {
      // All topics match "ing" (Running, Bikepacking) - but limit to 1
      const results = await engine.findNodesByTag('topic', {
        nameContains: 'ing',
        limit: 1
      });

      expect(results.length).toBe(1);
    });
  });
});
