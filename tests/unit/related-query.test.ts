/**
 * Tests for TanaQueryEngine.getRelatedNodes (Spec 065)
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { TanaQueryEngine } from '../../src/query/tana-query-engine';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../../src/db/schema';
import type { RelationshipType } from '../../src/types/graph';

describe('TanaQueryEngine.getRelatedNodes', () => {
  let db: Database;
  let engine: TanaQueryEngine;
  const testDbPath = '/tmp/test-related-query.db';

  beforeAll(() => {
    // Create test database with schema
    db = new Database(testDbPath);
    const drizzleDb = drizzle(db, { schema });

    // Create tables
    db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        created INTEGER,
        updated INTEGER,
        parent_id TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS "references" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        reference_type TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tag_applications (
        data_node_id TEXT,
        tag_id TEXT,
        tag_name TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS field_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        value_node_id TEXT,
        value_text TEXT
      )
    `);

    // Insert test nodes
    // A -> B (child), A -> C (inline_ref), D -> A (inline_ref)
    const insertNode = db.prepare('INSERT INTO nodes (id, name, created, updated) VALUES (?, ?, ?, ?)');
    insertNode.run('nodeA', 'Node A', Date.now(), Date.now());
    insertNode.run('nodeB', 'Node B', Date.now(), Date.now());
    insertNode.run('nodeC', 'Node C', Date.now(), Date.now());
    insertNode.run('nodeD', 'Node D', Date.now(), Date.now());
    insertNode.run('nodeE', 'Node E', Date.now(), Date.now());

    // Insert references
    const insertRef = db.prepare('INSERT INTO "references" (from_node, to_node, reference_type) VALUES (?, ?, ?)');
    // A -> B (child relationship)
    insertRef.run('nodeA', 'nodeB', 'child');
    // B -> A (parent relationship - reverse of child)
    insertRef.run('nodeB', 'nodeA', 'parent');
    // A -> C (inline reference)
    insertRef.run('nodeA', 'nodeC', 'inline_ref');
    // D -> A (inline reference - D references A)
    insertRef.run('nodeD', 'nodeA', 'inline_ref');
    // B -> E (child of B)
    insertRef.run('nodeB', 'nodeE', 'child');
    // E -> B (parent of E)
    insertRef.run('nodeE', 'nodeB', 'parent');

    // Insert tags
    const insertTag = db.prepare('INSERT INTO tag_applications (data_node_id, tag_id, tag_name) VALUES (?, ?, ?)');
    insertTag.run('nodeB', 'tag1', 'todo');
    insertTag.run('nodeC', 'tag2', 'project');

    db.close();

    // Create engine
    engine = new TanaQueryEngine(testDbPath);
  });

  afterAll(() => {
    engine.close();
    // Clean up test database
    try {
      require('fs').unlinkSync(testDbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('direction filtering', () => {
    it('should get outbound references only (direction: out)', async () => {
      const result = await engine.getRelatedNodes('nodeA', 'out', ['child', 'parent', 'reference', 'field'], 50);

      // A has outbound: B (child), C (inline_ref)
      expect(result.length).toBe(2);
      const nodeIds = result.map((r) => r.nodeId);
      expect(nodeIds).toContain('nodeB');
      expect(nodeIds).toContain('nodeC');
    });

    it('should get inbound references only (direction: in)', async () => {
      const result = await engine.getRelatedNodes('nodeA', 'in', ['child', 'parent', 'reference', 'field'], 50);

      // A has inbound: B (parent), D (inline_ref)
      expect(result.length).toBe(2);
      const nodeIds = result.map((r) => r.nodeId);
      expect(nodeIds).toContain('nodeB');
      expect(nodeIds).toContain('nodeD');
    });
  });

  describe('type filtering', () => {
    it('should filter by relationship type (child only)', async () => {
      const result = await engine.getRelatedNodes('nodeA', 'out', ['child'], 50);

      expect(result.length).toBe(1);
      expect(result[0].nodeId).toBe('nodeB');
      expect(result[0].type).toBe('child');
    });

    it('should filter by relationship type (reference only)', async () => {
      const result = await engine.getRelatedNodes('nodeA', 'out', ['reference'], 50);

      expect(result.length).toBe(1);
      expect(result[0].nodeId).toBe('nodeC');
      expect(result[0].type).toBe('reference');
    });

    it('should filter by multiple types', async () => {
      const result = await engine.getRelatedNodes('nodeA', 'out', ['child', 'reference'], 50);

      expect(result.length).toBe(2);
    });

    it('should return empty for non-matching types', async () => {
      const result = await engine.getRelatedNodes('nodeA', 'out', ['field'], 50);

      expect(result.length).toBe(0);
    });
  });

  describe('limit', () => {
    it('should respect limit parameter', async () => {
      const result = await engine.getRelatedNodes('nodeA', 'out', ['child', 'reference'], 1);

      expect(result.length).toBe(1);
    });
  });

  describe('type mapping', () => {
    it('should map inline_ref to reference type', async () => {
      const result = await engine.getRelatedNodes('nodeA', 'out', ['reference'], 50);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('reference');
    });
  });

  describe('edge cases', () => {
    it('should return empty array for non-existent node', async () => {
      const result = await engine.getRelatedNodes('nonexistent', 'out', ['child', 'parent', 'reference', 'field'], 50);

      expect(result).toEqual([]);
    });

    it('should return empty array for node with no references', async () => {
      // nodeE only has parent relationship (no outbound child/reference)
      const result = await engine.getRelatedNodes('nodeE', 'out', ['child', 'reference'], 50);

      expect(result).toEqual([]);
    });
  });
});
