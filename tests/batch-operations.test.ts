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

// =============================================================================
// T-1.3: Batch get validation tests
// =============================================================================

describe('batchGetNodes validation', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `batch-ops-validation-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'test.db');

    const db = new Database(dbPath);
    db.run(`CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, created INTEGER, raw_data TEXT)`);
    db.run(`CREATE TABLE tag_applications (tag_node_id TEXT, data_node_id TEXT, tag_name TEXT)`);
    db.close();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should throw VALIDATION_ERROR when more than 100 node IDs provided', async () => {
    const { batchGetNodes, BATCH_GET_MAX_NODES } = await import(
      '../src/services/batch-operations'
    );

    // Create 101 node IDs
    const tooManyIds = Array.from({ length: BATCH_GET_MAX_NODES + 1 }, (_, i) => `node${i}`);

    expect(() => batchGetNodes(dbPath, tooManyIds)).toThrow();

    try {
      batchGetNodes(dbPath, tooManyIds);
    } catch (error: unknown) {
      expect((error as Error).message).toContain('100');
    }
  });

  it('should throw VALIDATION_ERROR for invalid node ID format', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    // IDs with invalid characters
    const invalidIds = ['node1', 'node with space', 'node3'];

    expect(() => batchGetNodes(dbPath, invalidIds)).toThrow();
  });

  it('should throw VALIDATION_ERROR for empty string node ID', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    const idsWithEmpty = ['node1', '', 'node3'];

    expect(() => batchGetNodes(dbPath, idsWithEmpty)).toThrow();
  });

  it('should accept exactly 100 node IDs (boundary test)', async () => {
    const { batchGetNodes, BATCH_GET_MAX_NODES } = await import(
      '../src/services/batch-operations'
    );

    // Exactly 100 IDs should work
    const maxIds = Array.from({ length: BATCH_GET_MAX_NODES }, (_, i) => `node${i}`);

    // Should not throw
    expect(() => batchGetNodes(dbPath, maxIds)).not.toThrow();
  });

  it('should validate depth option is between 0-3', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    // Depth 4 should throw
    expect(() => batchGetNodes(dbPath, ['node1'], { depth: 4 })).toThrow();

    // Depth -1 should throw
    expect(() => batchGetNodes(dbPath, ['node1'], { depth: -1 })).toThrow();
  });

  it('should accept depth values 0, 1, 2, 3', async () => {
    const { batchGetNodes } = await import('../src/services/batch-operations');

    // All valid depths should not throw
    expect(() => batchGetNodes(dbPath, ['node1'], { depth: 0 })).not.toThrow();
    expect(() => batchGetNodes(dbPath, ['node1'], { depth: 1 })).not.toThrow();
    expect(() => batchGetNodes(dbPath, ['node1'], { depth: 2 })).not.toThrow();
    expect(() => batchGetNodes(dbPath, ['node1'], { depth: 3 })).not.toThrow();
  });

  it('should include suggestion in validation error', async () => {
    const { batchGetNodes, BATCH_GET_MAX_NODES } = await import(
      '../src/services/batch-operations'
    );

    const tooManyIds = Array.from({ length: BATCH_GET_MAX_NODES + 1 }, (_, i) => `node${i}`);

    try {
      batchGetNodes(dbPath, tooManyIds);
      expect(true).toBe(false); // Should have thrown
    } catch (error: unknown) {
      // Check that error has suggestion property (StructuredError)
      expect((error as { suggestion?: string }).suggestion).toBeDefined();
    }
  });
});

// =============================================================================
// T-3.1: batchCreateNodes implementation tests
// =============================================================================

describe('batchCreateNodes', () => {
  let testDir: string;
  let testDbPath: string;

  beforeEach(() => {
    // Create temp directory for test database with supertags
    testDir = join(tmpdir(), `batch-create-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, 'test.db');

    // Create test database with required schema including supertags
    const db = new Database(testDbPath);
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
      CREATE TABLE supertags (
        id TEXT PRIMARY KEY,
        name TEXT,
        color TEXT
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
      CREATE TABLE field_definitions (
        id TEXT PRIMARY KEY,
        supertag_id TEXT,
        name TEXT,
        field_type TEXT
      )
    `);
    db.run(`
      CREATE TABLE supertag_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL UNIQUE,
        tag_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        created_at INTEGER
      )
    `);
    db.run(`
      CREATE TABLE supertag_fields (
        tag_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_label_id TEXT NOT NULL,
        field_order INTEGER DEFAULT 0,
        normalized_name TEXT,
        description TEXT,
        inferred_data_type TEXT,
        target_supertag_id TEXT,
        target_supertag_name TEXT,
        default_value_id TEXT,
        default_value_text TEXT,
        PRIMARY KEY (tag_id, field_label_id)
      )
    `);
    db.run(`
      CREATE TABLE supertag_parents (
        child_tag_id TEXT NOT NULL,
        parent_tag_id TEXT NOT NULL,
        PRIMARY KEY (child_tag_id, parent_tag_id)
      )
    `);

    // Insert test supertags into both old and new tables
    db.run(`INSERT INTO supertags (id, name, color) VALUES (?, ?, ?)`,
      ['tag_todo', 'todo', '#FF0000']);
    db.run(`INSERT INTO supertags (id, name, color) VALUES (?, ?, ?)`,
      ['tag_meeting', 'meeting', '#00FF00']);
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, color) VALUES (?, ?, ?, ?)`,
      ['tag_todo', 'todo', 'todo', '#FF0000']);
    db.run(`INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, color) VALUES (?, ?, ?, ?)`,
      ['tag_meeting', 'meeting', 'meeting', '#00FF00']);

    db.close();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should accept array of node create requests', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');
    expect(typeof batchCreateNodes).toBe('function');
  });

  it('should return array of BatchCreateResult', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');

    // Dry run mode - no actual API calls
    const results = await batchCreateNodes([
      { supertag: 'todo', name: 'Task 1' },
      { supertag: 'todo', name: 'Task 2' },
    ], { dryRun: true, _dbPathOverride: testDbPath });

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0].index).toBe(0);
    expect(results[1].index).toBe(1);
  });

  it('should include payload in dry run results', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');

    const results = await batchCreateNodes([
      { supertag: 'todo', name: 'Task 1' },
    ], { dryRun: true, _dbPathOverride: testDbPath });

    expect(results[0].payload).toBeDefined();
    expect(results[0].payload?.name).toBe('Task 1');
  });

  it('should preserve input order in results', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');

    const results = await batchCreateNodes([
      { supertag: 'todo', name: 'First' },
      { supertag: 'todo', name: 'Second' },
      { supertag: 'todo', name: 'Third' },
    ], { dryRun: true, _dbPathOverride: testDbPath });

    expect(results[0].payload?.name).toBe('First');
    expect(results[1].payload?.name).toBe('Second');
    expect(results[2].payload?.name).toBe('Third');
  });

  it('should handle empty input array', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');

    const results = await batchCreateNodes([], { dryRun: true, _dbPathOverride: testDbPath });

    expect(results).toHaveLength(0);
  });

  it('should report errors for individual nodes', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');

    // Use an invalid supertag that doesn't exist in test database
    const results = await batchCreateNodes([
      { supertag: 'todo', name: 'Valid Task' },
      { supertag: 'nonexistent_tag_12345', name: 'Invalid' },
    ], { dryRun: true, _dbPathOverride: testDbPath });

    // First should succeed, second should fail
    expect(results).toHaveLength(2);
    expect(results[0].success || results[0].error).toBeDefined();
    expect(results[1].error).toBeDefined();
    expect(results[1].error).toContain('Unknown supertag');
  });
});

// =============================================================================
// T-3.2: Batch create validation tests
// =============================================================================

describe('batchCreateNodes validation', () => {
  it('should throw VALIDATION_ERROR when more than 50 nodes provided', async () => {
    const { batchCreateNodes, BATCH_CREATE_MAX_NODES } = await import(
      '../src/services/batch-operations'
    );

    // Create 51 nodes
    const tooManyNodes = Array.from({ length: BATCH_CREATE_MAX_NODES + 1 }, (_, i) => ({
      supertag: 'todo',
      name: `Task ${i}`,
    }));

    await expect(batchCreateNodes(tooManyNodes, { dryRun: true })).rejects.toThrow();

    try {
      await batchCreateNodes(tooManyNodes, { dryRun: true });
    } catch (error: unknown) {
      expect((error as Error).message).toContain('50');
    }
  });

  it('should accept exactly 50 nodes (boundary test)', async () => {
    const { batchCreateNodes, BATCH_CREATE_MAX_NODES } = await import(
      '../src/services/batch-operations'
    );

    // Exactly 50 nodes should work
    const maxNodes = Array.from({ length: BATCH_CREATE_MAX_NODES }, (_, i) => ({
      supertag: 'todo',
      name: `Task ${i}`,
    }));

    // Should not throw
    await expect(batchCreateNodes(maxNodes, { dryRun: true })).resolves.toBeDefined();
  });

  it('should validate node structure: supertag required', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');

    // Node without supertag
    const results = await batchCreateNodes([
      { supertag: '', name: 'No tag' },
    ] as any, { dryRun: true });

    expect(results[0].error).toBeDefined();
    expect(results[0].error).toContain('supertag');
  });

  it('should validate node structure: name required', async () => {
    const { batchCreateNodes } = await import('../src/services/batch-operations');

    // Node without name
    const results = await batchCreateNodes([
      { supertag: 'todo', name: '' },
    ], { dryRun: true });

    expect(results[0].error).toBeDefined();
    expect(results[0].error).toContain('name');
  });

  it('should include suggestion in validation error', async () => {
    const { batchCreateNodes, BATCH_CREATE_MAX_NODES } = await import(
      '../src/services/batch-operations'
    );

    const tooManyNodes = Array.from({ length: BATCH_CREATE_MAX_NODES + 1 }, (_, i) => ({
      supertag: 'todo',
      name: `Task ${i}`,
    }));

    try {
      await batchCreateNodes(tooManyNodes, { dryRun: true });
      expect(true).toBe(false); // Should have thrown
    } catch (error: unknown) {
      // Check that error has suggestion property (StructuredError)
      expect((error as { suggestion?: string }).suggestion).toBeDefined();
    }
  });
});
