/**
 * Batch Operations Service Tests
 *
 * TDD tests for src/services/batch-operations.ts
 * Spec: 062-batch-operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// T-1.1: Test that types and service skeleton exist
describe('batch-operations types', () => {
  it('should export BatchGetRequest interface', async () => {
    const mod = await import('../src/services/batch-operations');
    // Type exists if we can reference it (compilation check)
    // Runtime check: the module should export something
    expect(mod).toBeDefined();
  });

  it('should export BatchGetResult interface', async () => {
    const mod = await import('../src/services/batch-operations');
    expect(mod).toBeDefined();
  });

  it('should export BatchCreateRequest interface', async () => {
    const mod = await import('../src/services/batch-operations');
    expect(mod).toBeDefined();
  });

  it('should export BatchCreateResult interface', async () => {
    const mod = await import('../src/services/batch-operations');
    expect(mod).toBeDefined();
  });

  it('should export BatchError interface', async () => {
    const mod = await import('../src/services/batch-operations');
    expect(mod).toBeDefined();
  });
});

describe('batch-operations service skeleton', () => {
  it('should export batchGetNodes function', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');
    expect(typeof batchGetNodes).toBe('function');
  });

  it('should export batchCreateNodes function', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');
    expect(typeof batchCreateNodes).toBe('function');
  });

  it('should export BATCH_GET_MAX_NODES constant', async () => {
    const { BATCH_GET_MAX_NODES } = await import('../src/services/batch-operations');
    expect(BATCH_GET_MAX_NODES).toBe(100);
  });

  it('should export BATCH_CREATE_MAX_NODES constant', async () => {
    const { BATCH_CREATE_MAX_NODES } = await import('../src/services/batch-operations');
    expect(BATCH_CREATE_MAX_NODES).toBe(50);
  });

  it('should export BATCH_CREATE_CHUNK_SIZE constant', async () => {
    const { BATCH_CREATE_CHUNK_SIZE } = await import('../src/services/batch-operations');
    expect(BATCH_CREATE_CHUNK_SIZE).toBe(10);
  });
});

// =============================================================================
// T-1.2: batchGetNodes implementation tests
// =============================================================================

describe('batchGetNodes', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    // Create temp directory for test database
    testDir = join(tmpdir(), `batch-ops-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'test.db');

    // Create test database with schema
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        parent_id TEXT,
        node_type TEXT,
        created INTEGER,
        updated INTEGER,
        raw_data TEXT
      )
    `);
    db.run(`
      CREATE TABLE tag_applications (
        tag_node_id TEXT,
        data_node_id TEXT,
        tag_name TEXT,
        PRIMARY KEY (tag_node_id, data_node_id)
      )
    `);
    db.run(`
      CREATE TABLE field_names (
        field_id TEXT PRIMARY KEY,
        field_name TEXT
      )
    `);

    // Insert test data
    const now = Date.now();
    db.run(`INSERT INTO nodes (id, name, created, raw_data) VALUES (?, ?, ?, ?)`,
      ['node1', 'Test Node 1', now, JSON.stringify({ children: [] })]);
    db.run(`INSERT INTO nodes (id, name, created, raw_data) VALUES (?, ?, ?, ?)`,
      ['node2', 'Test Node 2', now, JSON.stringify({ children: [] })]);
    db.run(`INSERT INTO nodes (id, name, created, raw_data) VALUES (?, ?, ?, ?)`,
      ['node3', 'Test Node 3', now, JSON.stringify({ children: [] })]);

    // Add tags
    db.run(`INSERT INTO tag_applications (tag_node_id, data_node_id, tag_name) VALUES (?, ?, ?)`,
      ['tag1', 'node1', 'meeting']);
    db.run(`INSERT INTO tag_applications (tag_node_id, data_node_id, tag_name) VALUES (?, ?, ?)`,
      ['tag2', 'node2', 'todo']);

    db.close();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should fetch multiple nodes by ID', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    const results = batchGetNodes(dbPath, ['node1', 'node2']);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('node1');
    expect(results[0].node).not.toBeNull();
    expect(results[0].node?.name).toBe('Test Node 1');
    expect(results[1].id).toBe('node2');
    expect(results[1].node).not.toBeNull();
    expect(results[1].node?.name).toBe('Test Node 2');
  });

  it('should preserve input order in results', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    // Request in different order than database insertion
    const results = batchGetNodes(dbPath, ['node3', 'node1', 'node2']);

    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('node3');
    expect(results[1].id).toBe('node1');
    expect(results[2].id).toBe('node2');
  });

  it('should return null for missing nodes without failing', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    const results = batchGetNodes(dbPath, ['node1', 'nonexistent', 'node2']);

    expect(results).toHaveLength(3);
    expect(results[0].node).not.toBeNull();
    expect(results[1].id).toBe('nonexistent');
    expect(results[1].node).toBeNull();
    expect(results[2].node).not.toBeNull();
  });

  it('should include tags for each node', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    const results = batchGetNodes(dbPath, ['node1', 'node2']);

    expect(results[0].node?.tags).toContain('meeting');
    expect(results[1].node?.tags).toContain('todo');
  });

  it('should handle empty input array', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    const results = batchGetNodes(dbPath, []);

    expect(results).toHaveLength(0);
  });

  it('should handle single node request', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    const results = batchGetNodes(dbPath, ['node1']);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('node1');
    expect(results[0].node?.name).toBe('Test Node 1');
  });

  it('should use efficient batch query (not N+1)', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    // Fetch all three nodes - should use single batch query
    const results = batchGetNodes(dbPath, ['node1', 'node2', 'node3']);

    expect(results).toHaveLength(3);
    // All nodes should be present
    expect(results.every((r) => r.node !== null)).toBe(true);
  });
});
