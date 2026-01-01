/**
 * Tests for batch command group
 *
 * The batch command group provides:
 * - batch get <ids...>   - Fetch multiple nodes by ID
 * - batch create         - Create multiple nodes (future)
 *
 * Spec: 062-batch-operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createBatchCommand, executeBatchGet } from '../src/commands/batch';
import { Command } from 'commander';
import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('createBatchCommand', () => {
  it('should create a command named "batch"', () => {
    const cmd = createBatchCommand();
    expect(cmd.name()).toBe('batch');
  });

  it('should have description mentioning batch operations', () => {
    const cmd = createBatchCommand();
    expect(cmd.description().toLowerCase()).toContain('batch');
  });
});

describe('batch subcommands', () => {
  let cmd: Command;

  beforeEach(() => {
    cmd = createBatchCommand();
  });

  it('should have "get" subcommand', () => {
    const subcommands = cmd.commands.map((c) => c.name());
    expect(subcommands).toContain('get');
  });
});

describe('batch get subcommand', () => {
  let getCmd: Command;

  beforeEach(() => {
    const cmd = createBatchCommand();
    getCmd = cmd.commands.find((c) => c.name() === 'get')!;
  });

  it('should accept variadic ids argument', () => {
    const args = getCmd._args;
    expect(args.length).toBe(1);
    expect(args[0].variadic).toBe(true);
  });

  it('should have --stdin option for reading from stdin', () => {
    const options = getCmd.options.map((o) => o.long);
    expect(options).toContain('--stdin');
  });

  it('should have --select option for field projection', () => {
    const options = getCmd.options.map((o) => o.long);
    expect(options).toContain('--select');
  });

  it('should have --depth option with default 0', () => {
    const depthOption = getCmd.options.find((o) => o.long === '--depth');
    expect(depthOption).toBeDefined();
    expect(depthOption?.defaultValue).toBe('0');
  });

  it('should have -d short alias for --depth', () => {
    const depthOption = getCmd.options.find((o) => o.long === '--depth');
    expect(depthOption?.short).toBe('-d');
  });

  it('should have --format option', () => {
    const options = getCmd.options.map((o) => o.long);
    expect(options).toContain('--format');
  });

  it('should have standard options (--workspace, --json)', () => {
    const options = getCmd.options.map((o) => o.long);
    expect(options).toContain('--workspace');
    expect(options).toContain('--json');
  });
});

// =============================================================================
// T-2.5: executeBatchGet implementation tests
// =============================================================================

describe('executeBatchGet', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `batch-cli-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'test.db');

    // Create test database
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

  it('should fetch nodes by positional IDs', async () => {
    const result = await executeBatchGet(['node1', 'node2'], { _dbPath: dbPath });

    expect(result.found).toBe(2);
    expect(result.missing).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].id).toBe('node1');
    expect(result.results[1].id).toBe('node2');
  });

  it('should return null for missing nodes', async () => {
    const result = await executeBatchGet(['node1', 'nonexistent'], { _dbPath: dbPath });

    expect(result.found).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.results[0].node).not.toBeNull();
    expect(result.results[1].node).toBeNull();
  });

  it('should preserve input order', async () => {
    const result = await executeBatchGet(['node3', 'node1', 'node2'], { _dbPath: dbPath });

    expect(result.results[0].id).toBe('node3');
    expect(result.results[1].id).toBe('node1');
    expect(result.results[2].id).toBe('node2');
  });

  it('should apply depth option', async () => {
    const result = await executeBatchGet(['node1'], { _dbPath: dbPath, depth: '2' });

    // Should succeed without error
    expect(result.found).toBe(1);
  });

  it('should apply select projection', async () => {
    const result = await executeBatchGet(['node1'], { _dbPath: dbPath, select: 'id,name' });

    expect(result.results[0].node).toBeDefined();
    // Projected fields only
    expect(Object.keys(result.results[0].node || {})).toContain('id');
    expect(Object.keys(result.results[0].node || {})).toContain('name');
  });

  it('should read IDs from stdin when --stdin flag is set', async () => {
    // Mock stdin with test IDs
    const stdinContent = 'node1\nnode2\nnode3\n';
    const result = await executeBatchGet([], {
      _dbPath: dbPath,
      stdin: true,
      _stdinContent: stdinContent,
    });

    expect(result.found).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  it('should filter out empty lines from stdin', async () => {
    const stdinContent = 'node1\n\nnode2\n\n';
    const result = await executeBatchGet([], {
      _dbPath: dbPath,
      stdin: true,
      _stdinContent: stdinContent,
    });

    expect(result.results).toHaveLength(2);
  });

  it('should combine positional IDs with stdin IDs', async () => {
    const stdinContent = 'node2\nnode3\n';
    const result = await executeBatchGet(['node1'], {
      _dbPath: dbPath,
      stdin: true,
      _stdinContent: stdinContent,
    });

    expect(result.results).toHaveLength(3);
    expect(result.results[0].id).toBe('node1');
    expect(result.results[1].id).toBe('node2');
    expect(result.results[2].id).toBe('node3');
  });
});
