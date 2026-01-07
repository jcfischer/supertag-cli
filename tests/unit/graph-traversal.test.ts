/**
 * Tests for GraphTraversalService (Spec 065)
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { GraphTraversalService } from '../../src/services/graph-traversal';
import type { RelatedQuery } from '../../src/types/graph';
import { unlinkSync } from 'fs';

describe('GraphTraversalService', () => {
  const testDbPath = '/tmp/test-graph-traversal.db';
  let service: GraphTraversalService;

  beforeAll(() => {
    // Create test database with schema
    const db = new Database(testDbPath);

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

    /*
     * Test graph structure:
     *
     *     D --ref--> A --child--> B --child--> E
     *                |
     *                +---ref---> C
     *
     * A is the central node with:
     *   - outbound: B (child), C (inline_ref)
     *   - inbound: D (inline_ref)
     * B has:
     *   - outbound: E (child)
     *   - inbound: A (parent)
     */
    const now = Date.now();
    const insertNode = db.prepare('INSERT INTO nodes (id, name, created, updated) VALUES (?, ?, ?, ?)');
    insertNode.run('nodeA', 'Node A', now, now);
    insertNode.run('nodeB', 'Node B', now, now);
    insertNode.run('nodeC', 'Node C', now, now);
    insertNode.run('nodeD', 'Node D', now, now);
    insertNode.run('nodeE', 'Node E', now, now);

    const insertRef = db.prepare('INSERT INTO "references" (from_node, to_node, reference_type) VALUES (?, ?, ?)');
    // A -> B (child)
    insertRef.run('nodeA', 'nodeB', 'child');
    insertRef.run('nodeB', 'nodeA', 'parent');
    // A -> C (inline_ref)
    insertRef.run('nodeA', 'nodeC', 'inline_ref');
    // D -> A (inline_ref)
    insertRef.run('nodeD', 'nodeA', 'inline_ref');
    // B -> E (child)
    insertRef.run('nodeB', 'nodeE', 'child');
    insertRef.run('nodeE', 'nodeB', 'parent');

    // Tags
    const insertTag = db.prepare('INSERT INTO tag_applications (data_node_id, tag_id, tag_name) VALUES (?, ?, ?)');
    insertTag.run('nodeB', 'tag1', 'todo');
    insertTag.run('nodeC', 'tag2', 'project');

    db.close();
  });

  beforeEach(() => {
    service = new GraphTraversalService(testDbPath);
  });

  afterAll(() => {
    try {
      unlinkSync(testDbPath);
    } catch {
      // Ignore
    }
  });

  describe('constructor and close', () => {
    it('should create service with valid database path', () => {
      expect(service).toBeDefined();
    });

    it('should close without error', () => {
      expect(() => service.close()).not.toThrow();
    });
  });

  describe('traverse - single hop', () => {
    it('should find directly connected nodes (depth 1)', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'both',
        types: ['child', 'parent', 'reference', 'field'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      expect(result.sourceNode.id).toBe('nodeA');
      expect(result.sourceNode.name).toBe('Node A');
      expect(result.workspace).toBe('main');

      // Should find B (child out), C (ref out), D (ref in), B (parent in from B's perspective)
      // Actually: out = B (child), C (ref); in = D (ref), B (parent)
      // Deduplicated: B, C, D
      const ids = result.related.map((r) => r.id);
      expect(ids).toContain('nodeB');
      expect(ids).toContain('nodeC');
      expect(ids).toContain('nodeD');
    });

    it('should return empty for non-existent node', async () => {
      const query: RelatedQuery = {
        nodeId: 'nonexistent',
        direction: 'both',
        types: ['child', 'parent', 'reference', 'field'],
        depth: 1,
        limit: 50,
      };

      // Should throw structured error for node not found
      await expect(service.traverse(query, 'main')).rejects.toThrow();
    });
  });

  describe('traverse - outbound only', () => {
    it('should find only outbound connections', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child', 'parent', 'reference', 'field'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // A's outbound: B (child), C (ref)
      expect(result.related.length).toBe(2);
      const ids = result.related.map((r) => r.id);
      expect(ids).toContain('nodeB');
      expect(ids).toContain('nodeC');
      expect(ids).not.toContain('nodeD'); // D is inbound
    });
  });

  describe('traverse - inbound only', () => {
    it('should find only inbound connections', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'in',
        types: ['child', 'parent', 'reference', 'field'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // A's inbound: D (ref), B (parent)
      const ids = result.related.map((r) => r.id);
      expect(ids).toContain('nodeD');
      expect(ids).toContain('nodeB'); // B has parent ref to A
      expect(ids).not.toContain('nodeC'); // C is outbound
    });
  });

  describe('traverse - type filtering', () => {
    it('should filter by relationship type (child only)', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      expect(result.related.length).toBe(1);
      expect(result.related[0].id).toBe('nodeB');
      expect(result.related[0].relationship.type).toBe('child');
    });

    it('should filter by relationship type (reference only)', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['reference'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      expect(result.related.length).toBe(1);
      expect(result.related[0].id).toBe('nodeC');
      expect(result.related[0].relationship.type).toBe('reference');
    });
  });

  describe('relationship metadata', () => {
    it('should include correct relationship metadata', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      expect(result.related.length).toBe(1);
      const nodeB = result.related[0];
      expect(nodeB.relationship.type).toBe('child');
      expect(nodeB.relationship.direction).toBe('out');
      expect(nodeB.relationship.distance).toBe(1);
      expect(nodeB.relationship.path).toEqual(['nodeA', 'nodeB']);
    });
  });

  describe('result structure', () => {
    it('should include node names', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child', 'reference'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      const nodeB = result.related.find((r) => r.id === 'nodeB');
      const nodeC = result.related.find((r) => r.id === 'nodeC');

      expect(nodeB?.name).toBe('Node B');
      expect(nodeC?.name).toBe('Node C');
    });

    it('should include tags when present', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child', 'reference'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      const nodeB = result.related.find((r) => r.id === 'nodeB');
      const nodeC = result.related.find((r) => r.id === 'nodeC');

      expect(nodeB?.tags).toContain('todo');
      expect(nodeC?.tags).toContain('project');
    });

    it('should include truncated flag when false', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child', 'reference'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      expect(result.truncated).toBe(false);
      expect(result.count).toBe(2);
    });
  });
});
