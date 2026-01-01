/**
 * Schema Tests
 *
 * TDD tests for MCP tool Zod schemas
 */

import { describe, it, expect } from 'bun:test';
import {
  searchSchema,
  taggedSchema,
  statsSchema,
  supertagsSchema,
  nodeSchema,
  createSchema,
  zodToJsonSchema,
  capabilitiesSchema,
  toolSchemaSchema,
} from '../../schemas';

describe('searchSchema', () => {
  it('should validate minimal input', () => {
    const result = searchSchema.parse({ query: 'test' });
    expect(result.query).toBe('test');
    expect(result.limit).toBe(20); // default
    expect(result.raw).toBe(false); // default
  });

  it('should validate full input', () => {
    const result = searchSchema.parse({
      query: 'meeting notes',
      workspace: 'personal',
      limit: 50,
      raw: true,
      includeAncestor: false,
    });
    expect(result.query).toBe('meeting notes');
    expect(result.workspace).toBe('personal');
    expect(result.limit).toBe(50);
    expect(result.raw).toBe(true);
    expect(result.includeAncestor).toBe(false);
  });

  it('should reject empty query', () => {
    expect(() => searchSchema.parse({ query: '' })).toThrow();
  });

  it('should reject limit out of range', () => {
    expect(() => searchSchema.parse({ query: 'test', limit: 0 })).toThrow();
    expect(() => searchSchema.parse({ query: 'test', limit: 1001 })).toThrow();
  });
});

describe('taggedSchema', () => {
  it('should validate minimal input', () => {
    const result = taggedSchema.parse({ tagname: 'todo' });
    expect(result.tagname).toBe('todo');
    expect(result.limit).toBe(20); // default
    expect(result.orderBy).toBe('created'); // default
    expect(result.caseInsensitive).toBe(false); // default
  });

  it('should validate full input', () => {
    const result = taggedSchema.parse({
      tagname: 'Meeting',
      workspace: 'work',
      limit: 100,
      orderBy: 'updated',
      caseInsensitive: true,
    });
    expect(result.tagname).toBe('Meeting');
    expect(result.workspace).toBe('work');
    expect(result.limit).toBe(100);
    expect(result.orderBy).toBe('updated');
    expect(result.caseInsensitive).toBe(true);
  });

  it('should reject empty tagname', () => {
    expect(() => taggedSchema.parse({ tagname: '' })).toThrow();
  });

  it('should reject invalid orderBy', () => {
    expect(() => taggedSchema.parse({ tagname: 'todo', orderBy: 'invalid' })).toThrow();
  });
});

describe('statsSchema', () => {
  it('should validate empty input', () => {
    const result = statsSchema.parse({});
    expect(result.workspace).toBeUndefined();
  });

  it('should validate with workspace', () => {
    const result = statsSchema.parse({ workspace: 'personal' });
    expect(result.workspace).toBe('personal');
  });
});

describe('supertagsSchema', () => {
  it('should validate minimal input', () => {
    const result = supertagsSchema.parse({});
    expect(result.limit).toBe(20); // default
  });

  it('should validate full input', () => {
    const result = supertagsSchema.parse({
      workspace: 'work',
      limit: 50,
    });
    expect(result.workspace).toBe('work');
    expect(result.limit).toBe(50);
  });
});

describe('nodeSchema', () => {
  it('should validate minimal input', () => {
    const result = nodeSchema.parse({ nodeId: 'abc123xyz' });
    expect(result.nodeId).toBe('abc123xyz');
    expect(result.depth).toBe(0); // default
  });

  it('should validate full input', () => {
    const result = nodeSchema.parse({
      nodeId: 'abc123xyz',
      workspace: 'personal',
      depth: 3,
    });
    expect(result.nodeId).toBe('abc123xyz');
    expect(result.workspace).toBe('personal');
    expect(result.depth).toBe(3);
  });

  it('should reject empty nodeId', () => {
    expect(() => nodeSchema.parse({ nodeId: '' })).toThrow();
  });

  it('should reject depth out of range', () => {
    expect(() => nodeSchema.parse({ nodeId: 'abc', depth: -1 })).toThrow();
    expect(() => nodeSchema.parse({ nodeId: 'abc', depth: 11 })).toThrow();
  });
});

describe('createSchema', () => {
  it('should validate minimal input', () => {
    const result = createSchema.parse({
      supertag: 'todo',
      name: 'Buy groceries',
    });
    expect(result.supertag).toBe('todo');
    expect(result.name).toBe('Buy groceries');
    expect(result.dryRun).toBe(false); // default
  });

  it('should validate full input', () => {
    const result = createSchema.parse({
      supertag: 'todo',
      name: 'Buy groceries',
      fields: { Status: 'Pending', Tags: ['urgent', 'home'] },
      workspace: 'personal',
      target: 'INBOX',
      dryRun: true,
    });
    expect(result.supertag).toBe('todo');
    expect(result.name).toBe('Buy groceries');
    expect(result.fields).toEqual({ Status: 'Pending', Tags: ['urgent', 'home'] });
    expect(result.workspace).toBe('personal');
    expect(result.target).toBe('INBOX');
    expect(result.dryRun).toBe(true);
  });

  it('should reject empty supertag', () => {
    expect(() => createSchema.parse({ supertag: '', name: 'Test' })).toThrow();
  });

  it('should reject empty name', () => {
    expect(() => createSchema.parse({ supertag: 'todo', name: '' })).toThrow();
  });
});

describe('zodToJsonSchema', () => {
  it('should convert searchSchema to JSON Schema', () => {
    const jsonSchema = zodToJsonSchema(searchSchema);
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties).toBeDefined();
    expect((jsonSchema.properties as Record<string, unknown>).query).toBeDefined();
    expect(jsonSchema.required).toContain('query');
  });

  it('should include descriptions in JSON Schema', () => {
    const jsonSchema = zodToJsonSchema(searchSchema);
    const props = jsonSchema.properties as Record<string, { description?: string }>;
    expect(props.query.description).toBeDefined();
    expect(props.query.description).toContain('search');
  });

  it('should not include optional fields in required', () => {
    const jsonSchema = zodToJsonSchema(statsSchema);
    // statsSchema only has optional workspace field
    expect(jsonSchema.required).toBeUndefined();
  });
});

describe('capabilitiesSchema', () => {
  it('should validate empty input', () => {
    const result = capabilitiesSchema.parse({});
    expect(result.category).toBeUndefined();
  });

  it('should validate with valid category', () => {
    const result = capabilitiesSchema.parse({ category: 'query' });
    expect(result.category).toBe('query');
  });

  it('should accept all valid categories', () => {
    const categories = ['query', 'explore', 'transcript', 'mutate', 'system'] as const;
    for (const category of categories) {
      const result = capabilitiesSchema.parse({ category });
      expect(result.category).toBe(category);
    }
  });

  it('should reject invalid category', () => {
    expect(() => capabilitiesSchema.parse({ category: 'invalid' })).toThrow();
  });
});

describe('toolSchemaSchema', () => {
  it('should validate with tool name', () => {
    const result = toolSchemaSchema.parse({ tool: 'tana_search' });
    expect(result.tool).toBe('tana_search');
  });

  it('should reject empty tool name', () => {
    expect(() => toolSchemaSchema.parse({ tool: '' })).toThrow();
  });

  it('should reject missing tool name', () => {
    expect(() => toolSchemaSchema.parse({})).toThrow();
  });
});
