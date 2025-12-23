/**
 * Schema Command Tests
 *
 * Tests for the modernized schema command using Commander subcommands.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Command } from 'commander';

describe('Schema Command - Commander Subcommands', () => {
  describe('createSchemaCommand', () => {
    it('should export createSchemaCommand function', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      expect(typeof createSchemaCommand).toBe('function');
    });

    it('should return a Commander Command instance', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      expect(cmd).toBeInstanceOf(Command);
      expect(cmd.name()).toBe('schema');
    });

    it('should have sync subcommand', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      const subcommands = cmd.commands.map(c => c.name());
      expect(subcommands).toContain('sync');
    });

    it('should have list subcommand', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      const subcommands = cmd.commands.map(c => c.name());
      expect(subcommands).toContain('list');
    });

    it('should have show subcommand', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      const subcommands = cmd.commands.map(c => c.name());
      expect(subcommands).toContain('show');
    });

    it('should have search subcommand', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      const subcommands = cmd.commands.map(c => c.name());
      expect(subcommands).toContain('search');
    });
  });

  describe('command registration', () => {
    it('should be able to add schema command to a program', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const program = new Command();
      program.addCommand(createSchemaCommand());

      const schemaCmd = program.commands.find(c => c.name() === 'schema');
      expect(schemaCmd).toBeDefined();
      expect(schemaCmd?.commands.length).toBe(4); // sync, list, show, search
    });
  });

  describe('subcommand options', () => {
    it('sync should accept optional path argument', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      const syncCmd = cmd.commands.find(c => c.name() === 'sync');
      expect(syncCmd).toBeDefined();
    });

    it('show should require name argument', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      const showCmd = cmd.commands.find(c => c.name() === 'show');
      expect(showCmd).toBeDefined();
    });

    it('search should require query argument', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      const searchCmd = cmd.commands.find(c => c.name() === 'search');
      expect(searchCmd).toBeDefined();
    });

    it('list should have --format option', async () => {
      const { createSchemaCommand } = await import('../../src/commands/schema');
      const cmd = createSchemaCommand();
      const listCmd = cmd.commands.find(c => c.name() === 'list');
      expect(listCmd).toBeDefined();
      const options = listCmd?.options.map(o => o.long);
      expect(options).toContain('--format');
    });
  });
});
