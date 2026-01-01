/**
 * tana_batch_get MCP Tool Tests
 *
 * TDD tests for src/mcp/tools/batch-get.ts
 * Spec: 062-batch-operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// We'll mock the workspace resolver for these tests
describe('batchGet MCP tool', () => {
  let testDir: string;
  let dbPath: string;
  let configPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `batch-get-mcp-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'tana-index.db');

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

    // Create config for workspace resolution
    const configDir = join(testDir, 'config');
    mkdirSync(configDir, { recursive: true });
    configPath = join(configDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      defaultWorkspace: 'test',
      workspaces: {
        test: {
          dbPath: dbPath,
          exportDir: testDir,
          nodeid: 'test-node-id',
          rootFileId: 'test-root-file-id',
        },
      },
    }));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should export batchGet function', async () => {
    const { batchGet } = await import('../batch-get');
    expect(typeof batchGet).toBe('function');
  });

  it('should return array of batch results', async () => {
    // Test the batchGetNodes service directly since MCP tool depends on config
    const { batchGetNodes } = await import('../../../services/batch-operations');

    const results = batchGetNodes(dbPath, ['node1', 'node2']);

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('node1');
    expect(results[0].node).not.toBeNull();
    expect(results[1].id).toBe('node2');
    expect(results[1].node).not.toBeNull();
  });

  it('should return null for missing nodes', async () => {
    const { batchGetNodes } = await import('../../../services/batch-operations');

    const results = batchGetNodes(dbPath, ['node1', 'nonexistent']);

    expect(results).toHaveLength(2);
    expect(results[0].node).not.toBeNull();
    expect(results[1].id).toBe('nonexistent');
    expect(results[1].node).toBeNull();
  });

  it('should preserve input order', async () => {
    const { batchGetNodes } = await import('../../../services/batch-operations');

    const results = batchGetNodes(dbPath, ['node3', 'node1', 'node2']);

    expect(results[0].id).toBe('node3');
    expect(results[1].id).toBe('node1');
    expect(results[2].id).toBe('node2');
  });

  it('should include tags in node contents', async () => {
    const { batchGetNodes } = await import('../../../services/batch-operations');

    const results = batchGetNodes(dbPath, ['node1', 'node2']);

    expect(results[0].node?.tags).toContain('meeting');
    expect(results[1].node?.tags).toContain('todo');
  });
});
