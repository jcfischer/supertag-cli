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
import { createBatchCommand, executeBatchGet, executeBatchCreate } from '../src/commands/batch';
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

// =============================================================================
// T-2.6: Main CLI wiring tests
// =============================================================================

describe('main CLI wiring', () => {
  it('should be wired into main CLI program', async () => {
    // Read index.ts and verify batch command is imported and added
    const indexContent = await Bun.file('./src/index.ts').text();

    expect(indexContent).toContain("import { createBatchCommand }");
    expect(indexContent).toContain("createBatchCommand()");
  });
});

// =============================================================================
// T-3.6: batch create CLI command tests
// =============================================================================

describe('batch create subcommand', () => {
  let createCmd: Command;

  beforeEach(() => {
    const cmd = createBatchCommand();
    createCmd = cmd.commands.find((c) => c.name() === 'create')!;
  });

  it('should exist as a subcommand of batch', () => {
    expect(createCmd).toBeDefined();
  });

  it('should have --stdin option for reading from stdin', () => {
    const options = createCmd.options.map((o) => o.long);
    expect(options).toContain('--stdin');
  });

  it('should have --file option for reading from file', () => {
    const options = createCmd.options.map((o) => o.long);
    expect(options).toContain('--file');
  });

  it('should have --dry-run option for validation', () => {
    const options = createCmd.options.map((o) => o.long);
    expect(options).toContain('--dry-run');
  });

  it('should have --target option', () => {
    const options = createCmd.options.map((o) => o.long);
    expect(options).toContain('--target');
  });

  it('should have standard options (--workspace, --json)', () => {
    const options = createCmd.options.map((o) => o.long);
    expect(options).toContain('--workspace');
    expect(options).toContain('--json');
  });
});

describe('executeBatchCreate', () => {
  it('should export executeBatchCreate function', async () => {
    const { executeBatchCreate } = await import('../src/commands/batch');
    expect(typeof executeBatchCreate).toBe('function');
  });

  it('should accept nodes array and return results', async () => {
    const { executeBatchCreate } = await import('../src/commands/batch');

    const result = await executeBatchCreate([
      { supertag: 'todo', name: 'Task 1' },
      { supertag: 'todo', name: 'Task 2' },
    ], { dryRun: true });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('dryRun', true);
  });

  it('should return errors for invalid nodes', async () => {
    const { executeBatchCreate } = await import('../src/commands/batch');

    const result = await executeBatchCreate([
      { supertag: 'todo', name: 'Valid' },
      { supertag: '', name: 'Invalid - no supertag' },
    ], { dryRun: true });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should read nodes from stdin content', async () => {
    const { executeBatchCreate } = await import('../src/commands/batch');

    const stdinContent = JSON.stringify([
      { supertag: 'todo', name: 'Task from stdin' },
    ]);

    const result = await executeBatchCreate([], {
      dryRun: true,
      stdin: true,
      _stdinContent: stdinContent,
    });

    expect(result.results.length).toBe(1);
  });
});

// =============================================================================
// T-4.1: End-to-end integration tests
// =============================================================================

describe('batch get E2E integration', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `batch-e2e-test-${Date.now()}`);
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
      ['id1', 'Node One', now, JSON.stringify({ children: [] })]);
    db.run(`INSERT INTO nodes (id, name, created, raw_data) VALUES (?, ?, ?, ?)`,
      ['id2', 'Node Two', now, JSON.stringify({ children: [] })]);
    db.run(`INSERT INTO nodes (id, name, created, raw_data) VALUES (?, ?, ?, ?)`,
      ['id3', 'Node Three', now, JSON.stringify({ children: [] })]);

    // Add tags
    db.run(`INSERT INTO tag_applications (tag_node_id, data_node_id, tag_name) VALUES (?, ?, ?)`,
      ['tag1', 'id1', 'meeting']);
    db.run(`INSERT INTO tag_applications (tag_node_id, data_node_id, tag_name) VALUES (?, ?, ?)`,
      ['tag2', 'id2', 'todo']);

    db.close();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should fetch multiple nodes via executeBatchGet', async () => {
    const result = await executeBatchGet(['id1', 'id2', 'id3'], { _dbPath: dbPath });

    expect(result.found).toBe(3);
    expect(result.missing).toBe(0);
    expect(result.results.map(r => r.id)).toEqual(['id1', 'id2', 'id3']);
  });

  it('should support stdin piping for IDs', async () => {
    // Simulate: echo "id1\nid2" | supertag batch get --stdin
    const stdinContent = 'id1\nid2\nid3\n';
    const result = await executeBatchGet([], {
      _dbPath: dbPath,
      stdin: true,
      _stdinContent: stdinContent,
    });

    expect(result.found).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  it('should support combined positional and stdin IDs', async () => {
    // Simulate: echo "id2\nid3" | supertag batch get id1 --stdin
    const result = await executeBatchGet(['id1'], {
      _dbPath: dbPath,
      stdin: true,
      _stdinContent: 'id2\nid3\n',
    });

    expect(result.found).toBe(3);
    expect(result.results[0].id).toBe('id1'); // positional first
    expect(result.results[1].id).toBe('id2'); // stdin second
    expect(result.results[2].id).toBe('id3');
  });

  it('should handle mixed found/missing nodes gracefully', async () => {
    const result = await executeBatchGet(['id1', 'nonexistent', 'id3'], { _dbPath: dbPath });

    expect(result.found).toBe(2);
    expect(result.missing).toBe(1);
    expect(result.results[0].node).not.toBeNull();
    expect(result.results[1].node).toBeNull();
    expect(result.results[1].id).toBe('nonexistent');
    expect(result.results[2].node).not.toBeNull();
  });
});

describe('batch create E2E integration', () => {
  let testDir: string;
  let testDbPath: string;

  beforeEach(() => {
    // Create temp directory for test database with supertags
    testDir = join(tmpdir(), `batch-create-e2e-test-${Date.now()}`);
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

  it('should create multiple nodes via executeBatchCreate', async () => {
    const result = await executeBatchCreate([
      { supertag: 'todo', name: 'Task 1' },
      { supertag: 'todo', name: 'Task 2' },
      { supertag: 'todo', name: 'Task 3' },
    ], { dryRun: true, _dbPath: testDbPath });

    expect(result.results).toHaveLength(3);
    expect(result.dryRun).toBe(true);
  });

  it('should support stdin JSON array input', async () => {
    // Simulate: echo '[{"supertag":"todo","name":"Task 1"}]' | supertag batch create --stdin
    const stdinContent = JSON.stringify([
      { supertag: 'todo', name: 'Task A' },
      { supertag: 'todo', name: 'Task B' },
    ]);

    const result = await executeBatchCreate([], {
      dryRun: true,
      stdin: true,
      _stdinContent: stdinContent,
      _dbPath: testDbPath,
    });

    expect(result.results).toHaveLength(2);
  });

  it('should report per-node errors without failing entire batch', async () => {
    const result = await executeBatchCreate([
      { supertag: 'todo', name: 'Valid Task' },
      { supertag: '', name: 'Invalid - no supertag' },
      { supertag: 'todo', name: 'Another Valid' },
    ], { dryRun: true, _dbPath: testDbPath });

    expect(result.results).toHaveLength(3);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].index).toBe(1); // The invalid one
  });

  it('should support complex nodes with fields and children', async () => {
    const result = await executeBatchCreate([
      {
        supertag: 'todo',
        name: 'Task with details',
        fields: { Status: 'In Progress', Priority: 'High' },
        children: [
          { name: 'Subtask 1' },
          { name: 'Subtask 2' },
        ],
      },
    ], { dryRun: true, _dbPath: testDbPath });

    expect(result.results).toHaveLength(1);
    // The payload should include the children
    expect(result.results[0].payload).toBeDefined();
  });
});
