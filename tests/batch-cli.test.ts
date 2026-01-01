/**
 * Tests for batch command group
 *
 * The batch command group provides:
 * - batch get <ids...>   - Fetch multiple nodes by ID
 * - batch create         - Create multiple nodes (future)
 *
 * Spec: 062-batch-operations
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { createBatchCommand } from '../src/commands/batch';
import { Command } from 'commander';

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
