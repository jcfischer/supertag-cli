/**
 * Schema Registry Tests
 * TDD: Test First, Implementation Second
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { SchemaRegistry, type SupertagSchema, type FieldSchema } from './registry';

describe('SchemaRegistry', () => {
  let registry: SchemaRegistry;

  // Sample Tana export structure (minimal)
  const sampleExport = {
    formatVersion: 1,
    docs: [
      // Supertag: todo
      {
        id: 'fbAkgDqs3k',
        props: {
          name: 'todo',
          _docType: 'tagDef',
          description: 'A task to be done',
        },
        children: ['tuple1', 'tuple2'],
      },
      // Tuple linking to field
      {
        id: 'tuple1',
        props: {
          _docType: 'tuple',
          _ownerId: 'fbAkgDqs3k',
        },
        children: ['field1', 'config1'],
      },
      {
        id: 'tuple2',
        props: {
          _docType: 'tuple',
          _ownerId: 'fbAkgDqs3k',
        },
        children: ['field2', 'config2'],
      },
      // Field definitions
      {
        id: 'field1',
        props: {
          name: 'Status',
          _docType: 'attrDef',
          description: 'Task status',
        },
      },
      {
        id: 'field2',
        props: {
          name: 'Due Date',
          description: 'When task is due',
        },
      },
      // Another supertag: video
      {
        id: '-iZ7Rsg93Q',
        props: {
          name: 'video',
          _docType: 'tagDef',
        },
        children: ['tuple3'],
      },
      {
        id: 'tuple3',
        props: {
          _docType: 'tuple',
          _ownerId: '-iZ7Rsg93Q',
        },
        children: ['field3'],
      },
      {
        id: 'field3',
        props: {
          name: 'URL',
          _docType: 'attrDef',
        },
      },
    ],
  };

  beforeAll(() => {
    registry = new SchemaRegistry();
    registry.loadFromExport(sampleExport);
  });

  describe('loadFromExport', () => {
    it('should load supertags from Tana export', () => {
      const supertags = registry.listSupertags();
      expect(supertags.length).toBeGreaterThanOrEqual(2);
    });

    it('should exclude system supertags (SYS_*)', () => {
      const supertags = registry.listSupertags();
      const systemTags = supertags.filter(s => s.id.startsWith('SYS_'));
      expect(systemTags.length).toBe(0);
    });
  });

  describe('getSupertag', () => {
    it('should find supertag by exact name', () => {
      const todo = registry.getSupertag('todo');
      expect(todo).toBeDefined();
      expect(todo?.name).toBe('todo');
      expect(todo?.id).toBe('fbAkgDqs3k');
    });

    it('should NOT find supertag with wrong case (case-sensitive)', () => {
      const todo = registry.getSupertag('Todo'); // 'todo' exists, but 'Todo' does not
      expect(todo).toBeUndefined();
    });

    it('should find supertag with exact case match', () => {
      const todo = registry.getSupertag('todo');
      expect(todo).toBeDefined();
      expect(todo?.name).toBe('todo');
    });

    it('should return undefined for non-existent supertag', () => {
      const notFound = registry.getSupertag('nonexistent');
      expect(notFound).toBeUndefined();
    });
  });

  describe('getFields', () => {
    it('should return fields for a supertag', () => {
      const fields = registry.getFields('todo');
      expect(fields.length).toBeGreaterThanOrEqual(2);
    });

    it('should include field names and IDs', () => {
      const fields = registry.getFields('todo');
      const statusField = fields.find(f => f.name === 'Status');
      expect(statusField).toBeDefined();
      expect(statusField?.attributeId).toBe('field1');
    });

    it('should return empty array for supertag with no fields', () => {
      // Create a minimal registry with a fieldless supertag
      const minRegistry = new SchemaRegistry();
      minRegistry.loadFromExport({
        formatVersion: 1,
        docs: [
          {
            id: 'test1',
            props: { name: 'fieldless', _docType: 'tagDef' },
            children: null,
          },
        ],
      });
      const fields = minRegistry.getFields('fieldless');
      expect(fields).toEqual([]);
    });
  });

  describe('searchSupertags', () => {
    it('should find supertags by partial name match', () => {
      const matches = registry.searchSupertags('vid');
      expect(matches.some(s => s.name === 'video')).toBe(true);
    });

    it('should return empty array for no matches', () => {
      const matches = registry.searchSupertags('xyz123');
      expect(matches).toEqual([]);
    });
  });

  describe('buildNodePayload', () => {
    it('should create a valid Tana API node structure', () => {
      const payload = registry.buildNodePayload('todo', 'Buy groceries', {
        Status: 'active',
        'Due Date': '2025-12-31',
      });

      expect(payload.name).toBe('Buy groceries');
      expect(payload.supertags).toEqual([{ id: 'fbAkgDqs3k' }]);
      expect(payload.children).toBeDefined();
      expect(payload.children?.length).toBe(2);
    });

    it('should handle field name normalization (kebab-case, camelCase)', () => {
      const payload = registry.buildNodePayload('todo', 'Task', {
        'due-date': '2025-12-31', // kebab-case
      });

      expect(payload.children?.some(c =>
        'attributeId' in c && c.attributeId === 'field2'
      )).toBe(true);
    });

    it('should throw error for unknown supertag', () => {
      expect(() => {
        registry.buildNodePayload('unknown', 'Name', {});
      }).toThrow();
    });

    it('should skip unknown fields gracefully', () => {
      const payload = registry.buildNodePayload('todo', 'Task', {
        UnknownField: 'value',
      });
      // Should not throw, just ignore unknown field
      expect(payload.name).toBe('Task');
    });
  });

  describe('toJSON / fromJSON', () => {
    it('should serialize and deserialize registry', () => {
      const json = registry.toJSON();
      const restored = SchemaRegistry.fromJSON(json);

      const originalTodo = registry.getSupertag('todo');
      const restoredTodo = restored.getSupertag('todo');

      expect(restoredTodo?.id).toBe(originalTodo?.id);
      expect(restoredTodo?.name).toBe(originalTodo?.name);
    });
  });

  describe('buildNodePayload with multiple supertags', () => {
    it('should accept array of supertag names', () => {
      const payload = registry.buildNodePayload(['todo', 'video'], 'Watch tutorial', {
        Status: 'active',
        URL: 'https://example.com/video',
      });

      expect(payload.name).toBe('Watch tutorial');
      expect(payload.supertags).toBeDefined();
      expect(payload.supertags?.length).toBe(2);
    });

    it('should include all supertag IDs in payload', () => {
      const payload = registry.buildNodePayload(['todo', 'video'], 'Watch tutorial', {});

      const todoSchema = registry.getSupertag('todo');
      const videoSchema = registry.getSupertag('video');

      expect(todoSchema).toBeDefined();
      expect(videoSchema).toBeDefined();

      const supertagIds = payload.supertags?.map(s => s.id) ?? [];
      expect(supertagIds).toContain(todoSchema!.id);
      expect(supertagIds).toContain(videoSchema!.id);
    });

    it('should combine fields from all supertags', () => {
      const payload = registry.buildNodePayload(['todo', 'video'], 'Watch tutorial', {
        Status: 'active',      // from todo
        URL: 'https://x.com',  // from video
      });

      // Should have both fields
      expect(payload.children?.length).toBe(2);
    });

    it('should throw if any supertag is unknown', () => {
      expect(() => {
        registry.buildNodePayload(['todo', 'unknown'], 'Name', {});
      }).toThrow(/unknown/i);
    });

    it('should handle single supertag as string (backwards compatible)', () => {
      const payload = registry.buildNodePayload('todo', 'Task', {});
      expect(payload.supertags?.length).toBe(1);
    });

    it('should handle comma-separated string like array', () => {
      const payload = registry.buildNodePayload('todo,video', 'Watch tutorial', {});
      expect(payload.supertags?.length).toBe(2);
    });

    it('should deduplicate supertags if same tag specified twice', () => {
      const payload = registry.buildNodePayload(['todo', 'todo'], 'Task', {});
      expect(payload.supertags?.length).toBe(1);
    });
  });

  describe('getFieldsForMultipleSupertags', () => {
    it('should return combined fields from multiple supertags', () => {
      const fields = registry.getFieldsForMultipleSupertags(['todo', 'video']);

      const fieldNames = fields.map(f => f.name);
      expect(fieldNames).toContain('Status');   // from todo
      expect(fieldNames).toContain('Due Date'); // from todo
      expect(fieldNames).toContain('URL');      // from video
    });

    it('should deduplicate fields if same field in multiple supertags', () => {
      // Both todo and video might have a shared field via inheritance
      const fields = registry.getFieldsForMultipleSupertags(['todo', 'video']);

      // Check uniqueness by attributeId
      const attributeIds = fields.map(f => f.attributeId);
      const uniqueIds = [...new Set(attributeIds)];
      expect(attributeIds.length).toBe(uniqueIds.length);
    });
  });

  describe('system field markers', () => {
    // System field markers like SYS_A61 (Due Date), SYS_A90 (Date) are raw string
    // identifiers in tagDef tuple children that indicate system-defined fields.
    // They should be extracted as regular fields for consistency with the indexer.
    const systemFieldExport = {
      formatVersion: 1,
      docs: [
        // Supertag with system field marker
        {
          id: 'tagWithSystemField',
          props: {
            name: 'Status Pro',
            _docType: 'tagDef',
          },
          children: ['statusTuple', 'dueDateTuple'],
        },
        // Regular field tuple
        {
          id: 'statusTuple',
          props: {
            _docType: 'tuple',
            _ownerId: 'tagWithSystemField',
          },
          children: ['statusFieldDef', 'statusValue'],
        },
        {
          id: 'statusFieldDef',
          props: {
            name: '⚙️ Status',
            _docType: 'attrDef',
          },
        },
        // System field marker tuple (first child is SYS_A61, not a node ID)
        {
          id: 'dueDateTuple',
          props: {
            _docType: 'tuple',
            _ownerId: 'tagWithSystemField',
          },
          children: ['SYS_A61', 'somePlaceholder'],
        },
        // Note: SYS_A61 is NOT a node, it's a raw string marker
      ],
    };

    it('should extract system field markers as fields', () => {
      const sysRegistry = new SchemaRegistry();
      sysRegistry.loadFromExport(systemFieldExport);

      const tag = sysRegistry.getSupertag('Status Pro');
      expect(tag).toBeDefined();
      expect(tag?.fields.length).toBe(2); // Status + Due Date

      const fieldNames = tag?.fields.map(f => f.name) ?? [];
      expect(fieldNames).toContain('⚙️ Status');
      expect(fieldNames).toContain('Due Date'); // From SYS_A61 marker
    });

    it('should use system marker as attributeId for system fields', () => {
      const sysRegistry = new SchemaRegistry();
      sysRegistry.loadFromExport(systemFieldExport);

      const tag = sysRegistry.getSupertag('Status Pro');
      const dueDateField = tag?.fields.find(f => f.name === 'Due Date');

      expect(dueDateField).toBeDefined();
      expect(dueDateField?.attributeId).toBe('SYS_A61');
    });

    it('should infer correct data type for system fields', () => {
      const sysRegistry = new SchemaRegistry();
      sysRegistry.loadFromExport(systemFieldExport);

      const tag = sysRegistry.getSupertag('Status Pro');
      const dueDateField = tag?.fields.find(f => f.name === 'Due Date');

      expect(dueDateField?.dataType).toBe('date');
    });
  });
});
