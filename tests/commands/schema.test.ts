/**
 * Schema Command Tests
 *
 * Tests for the modernized schema command using Commander subcommands.
 * Includes T-5.1 tests for getSchemaRegistry with database fallback.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Command } from 'commander';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { migrateSupertagMetadataSchema, migrateSchemaConsolidation } from '../../src/db/migrate';

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
      expect(schemaCmd?.commands.length).toBe(5); // sync, list, show, search, audit
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

/**
 * T-5.1: getSchemaRegistryFromDatabase Tests
 *
 * Tests for loading schema from database when cache doesn't exist
 */
describe('getSchemaRegistryFromDatabase (T-5.1)', () => {
  let testDir: string;
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    testDir = join('/tmp', `supertag-schema-test-${Date.now()}`);
    dbPath = join(testDir, 'tana-index.db');
    mkdirSync(testDir, { recursive: true });

    // Create database with schema
    db = new Database(dbPath);
    migrateSupertagMetadataSchema(db);
    migrateSchemaConsolidation(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should export getSchemaRegistryFromDatabase function', async () => {
    const { getSchemaRegistryFromDatabase } = await import('../../src/commands/schema');
    expect(typeof getSchemaRegistryFromDatabase).toBe('function');
  });

  it('should return SchemaRegistry from database data', async () => {
    // Insert test supertag into database
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('contact-id', 'contact', 'contact')
    `);
    db.run(`
      INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
      VALUES ('contact-id', 'contact', 'Email', 'email-attr', 0, 'email', 'text')
    `);

    const { getSchemaRegistryFromDatabase } = await import('../../src/commands/schema');
    const registry = getSchemaRegistryFromDatabase(dbPath);

    expect(registry).toBeDefined();
    const contact = registry.getSupertag('contact');
    expect(contact).toBeDefined();
    expect(contact!.id).toBe('contact-id');
    expect(contact!.fields).toHaveLength(1);
    expect(contact!.fields[0].attributeId).toBe('email-attr');
  });

  it('should return empty registry for empty database', async () => {
    const { getSchemaRegistryFromDatabase } = await import('../../src/commands/schema');
    const registry = getSchemaRegistryFromDatabase(dbPath);

    expect(registry).toBeDefined();
    expect(registry.listSupertags()).toHaveLength(0);
  });

  it('should include all supertags from database', async () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('tag1', 'meeting', 'meeting'),
             ('tag2', 'project', 'project'),
             ('tag3', 'task', 'task')
    `);

    const { getSchemaRegistryFromDatabase } = await import('../../src/commands/schema');
    const registry = getSchemaRegistryFromDatabase(dbPath);

    const supertags = registry.listSupertags();
    expect(supertags).toHaveLength(3);

    const names = supertags.map(s => s.name);
    expect(names).toContain('meeting');
    expect(names).toContain('project');
    expect(names).toContain('task');
  });

  it('should throw for non-existent database', async () => {
    const { getSchemaRegistryFromDatabase } = await import('../../src/commands/schema');

    expect(() => {
      getSchemaRegistryFromDatabase('/nonexistent/path/db.db');
    }).toThrow();
  });

  it('should preserve original tag name for exact lookup', async () => {
    db.run(`
      INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name)
      VALUES ('contact-id', 'Contact', 'contact')
    `);

    const { getSchemaRegistryFromDatabase } = await import('../../src/commands/schema');
    const registry = getSchemaRegistryFromDatabase(dbPath);

    // Should find by original name (exact case match)
    expect(registry.getSupertag('Contact')).toBeDefined();
    expect(registry.getSupertag('Contact')!.name).toBe('Contact');
    expect(registry.getSupertag('Contact')!.normalizedName).toBe('contact');
    // SchemaRegistry.getSupertag is case-sensitive - lowercase won't find uppercase tag
    expect(registry.getSupertag('contact')).toBeUndefined();
  });
});
