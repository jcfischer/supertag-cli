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

    // Add field_values table for field reference tests (Spec 065 fix)
    db.run(`
      CREATE TABLE IF NOT EXISTS field_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tuple_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        field_def_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        value_node_id TEXT NOT NULL,
        value_text TEXT NOT NULL,
        value_order INTEGER DEFAULT 0,
        created INTEGER
      )
    `);

    /*
     * Test graph structure:
     *
     *     D --ref--> A --child--> B --child--> E
     *                |
     *                +---ref---> C
     *                |
     *                +--field--> F (A uses F as "Topic" field value)
     *                            |
     *                G --field--> F (G also uses F as "Focus" field value)
     *
     * A is the central node with:
     *   - outbound: B (child), C (inline_ref), F (field)
     *   - inbound: D (inline_ref)
     * B has:
     *   - outbound: E (child)
     *   - inbound: A (parent)
     * F (Topic node) has:
     *   - inbound: A (field "Topic"), G (field "Focus")
     */
    const now = Date.now();
    const insertNode = db.prepare('INSERT INTO nodes (id, name, created, updated) VALUES (?, ?, ?, ?)');
    insertNode.run('nodeA', 'Node A', now, now);
    insertNode.run('nodeB', 'Node B', now, now);
    insertNode.run('nodeC', 'Node C', now, now);
    insertNode.run('nodeD', 'Node D', now, now);
    insertNode.run('nodeE', 'Node E', now, now);
    insertNode.run('nodeF', 'Topic F', now, now);  // Used as field value
    insertNode.run('nodeG', 'Node G', now, now);   // Has field pointing to F

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
    insertTag.run('nodeF', 'tag3', 'topic');  // F is a #topic

    // Field values - nodes used as field values (Spec 065 fix)
    const insertField = db.prepare(
      'INSERT INTO field_values (tuple_id, parent_id, field_def_id, field_name, value_node_id, value_text, created) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    // A uses F as "Topic" field value
    insertField.run('tuple1', 'nodeA', 'fieldDef1', 'Topic', 'nodeF', 'Topic F', now);
    // G uses F as "Focus" field value
    insertField.run('tuple2', 'nodeG', 'fieldDef2', 'Focus', 'nodeF', 'Topic F', now);

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

      // A's outbound: B (child), C (ref), F (field)
      expect(result.related.length).toBe(3);
      const ids = result.related.map((r) => r.id);
      expect(ids).toContain('nodeB');
      expect(ids).toContain('nodeC');
      expect(ids).toContain('nodeF'); // F is field reference
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

  describe('traverse - multi-hop (depth > 1)', () => {
    it('should find nodes at depth 2', async () => {
      // A -> B -> E (via child relationships)
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child'],
        depth: 2,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // Should find B (depth 1) and E (depth 2)
      expect(result.related.length).toBe(2);
      const ids = result.related.map((r) => r.id);
      expect(ids).toContain('nodeB');
      expect(ids).toContain('nodeE');
    });

    it('should track correct distance for each node', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child'],
        depth: 2,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      const nodeB = result.related.find((r) => r.id === 'nodeB');
      const nodeE = result.related.find((r) => r.id === 'nodeE');

      expect(nodeB?.relationship.distance).toBe(1);
      expect(nodeE?.relationship.distance).toBe(2);
    });

    it('should track correct path for each node', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child'],
        depth: 2,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      const nodeB = result.related.find((r) => r.id === 'nodeB');
      const nodeE = result.related.find((r) => r.id === 'nodeE');

      expect(nodeB?.relationship.path).toEqual(['nodeA', 'nodeB']);
      expect(nodeE?.relationship.path).toEqual(['nodeA', 'nodeB', 'nodeE']);
    });

    it('should not traverse beyond specified depth', async () => {
      // With depth 1, should only find B, not E
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
    });
  });

  describe('cycle detection', () => {
    it('should not visit same node twice', async () => {
      // With bidirectional traversal, A -> B and B -> A (parent)
      // Should not loop infinitely
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'both',
        types: ['child', 'parent', 'reference', 'field'],
        depth: 3,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // Count occurrences of each node
      const counts = new Map<string, number>();
      for (const r of result.related) {
        counts.set(r.id, (counts.get(r.id) || 0) + 1);
      }

      // Each node should appear at most once
      for (const [, count] of counts) {
        expect(count).toBe(1);
      }
    });

    it('should handle circular references gracefully', async () => {
      // Traverse from A with both directions - should handle A -> B -> A cycle
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'both',
        types: ['child', 'parent'],
        depth: 5,
        limit: 50,
      };

      // Should complete without infinite loop
      const result = await service.traverse(query, 'main');

      expect(result.related.length).toBeGreaterThan(0);
    });
  });

  describe('limits and truncation', () => {
    it('should truncate results when limit is reached', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'both',
        types: ['child', 'parent', 'reference', 'field'],
        depth: 3,
        limit: 2, // Only allow 2 results
      };

      const result = await service.traverse(query, 'main');

      expect(result.related.length).toBe(2);
      expect(result.truncated).toBe(true);
    });

    it('should not truncate when under limit', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      expect(result.truncated).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return empty related array for isolated node', async () => {
      // Node C has no outbound child/parent relationships
      const query: RelatedQuery = {
        nodeId: 'nodeC',
        direction: 'out',
        types: ['child'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      expect(result.related).toEqual([]);
      expect(result.count).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('should handle depth 0 (no traversal)', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'both',
        types: ['child', 'parent', 'reference', 'field'],
        depth: 0,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // Depth 0 means no traversal - return empty
      expect(result.related).toEqual([]);
    });

    it('should return empty for empty type filter', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'both',
        types: [], // No types
        depth: 2,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      expect(result.related).toEqual([]);
    });
  });

  describe('field references (via field_values table)', () => {
    it('should find outbound field references (nodes used as field values)', async () => {
      // A uses F as "Topic" field value, so A --field--> F
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['field'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // Should find F (field value)
      expect(result.related.length).toBe(1);
      expect(result.related[0].id).toBe('nodeF');
      expect(result.related[0].relationship.type).toBe('field');
      expect(result.related[0].relationship.direction).toBe('out');
    });

    it('should find inbound field references (nodes that use this as field value)', async () => {
      // F is used as field value by A (Topic) and G (Focus)
      const query: RelatedQuery = {
        nodeId: 'nodeF',
        direction: 'in',
        types: ['field'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // Should find A and G (both use F as field value)
      expect(result.related.length).toBe(2);
      const ids = result.related.map((r) => r.id);
      expect(ids).toContain('nodeA');
      expect(ids).toContain('nodeG');

      // All should be field type with 'in' direction
      for (const node of result.related) {
        expect(node.relationship.type).toBe('field');
        expect(node.relationship.direction).toBe('in');
      }
    });

    it('should include field references with other types when types includes field', async () => {
      // A has outbound: B (child), C (ref), F (field)
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child', 'reference', 'field'],
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // Should find B (child), C (ref), F (field)
      expect(result.related.length).toBe(3);
      const ids = result.related.map((r) => r.id);
      expect(ids).toContain('nodeB');
      expect(ids).toContain('nodeC');
      expect(ids).toContain('nodeF');
    });

    it('should exclude field references when types does not include field', async () => {
      const query: RelatedQuery = {
        nodeId: 'nodeA',
        direction: 'out',
        types: ['child', 'reference'], // No 'field'
        depth: 1,
        limit: 50,
      };

      const result = await service.traverse(query, 'main');

      // Should only find B (child), C (ref) - NOT F (field)
      expect(result.related.length).toBe(2);
      const ids = result.related.map((r) => r.id);
      expect(ids).toContain('nodeB');
      expect(ids).toContain('nodeC');
      expect(ids).not.toContain('nodeF');
    });
  });
});
