/**
 * MCP tana_create Tool Tests
 *
 * TDD tests for the create tool implementation.
 * Tests require schema registry to be populated.
 */

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { existsSync } from 'fs';
import { create, type CreateResult } from '../create';
import { SCHEMA_CACHE_FILE } from '../../../config/paths';

// Check if we have a schema registry to test against
const hasSchema = existsSync(SCHEMA_CACHE_FILE);

describe('MCP tana_create Tool', () => {
  describe('Unit Tests', () => {
    it('should export create function', () => {
      expect(typeof create).toBe('function');
    });
  });

  describe('Integration Tests', () => {
    // Skip integration tests if no schema exists
    const testFn = hasSchema ? it : it.skip;

    testFn('should validate required fields', async () => {
      // Test that missing supertag throws error
      try {
        await create({
          supertag: '',
          name: 'Test Node',
          workspace: undefined,
          dryRun: true,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    testFn('should validate supertag exists in schema', async () => {
      // Test that unknown supertag throws error
      try {
        await create({
          supertag: 'nonexistent_supertag_xyz123',
          name: 'Test Node',
          workspace: undefined,
          dryRun: true,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
        expect(String(error)).toContain('Unknown supertag');
      }
    });

    testFn('should return correct structure in dry run mode', async () => {
      // This test uses a real supertag from the schema
      // First we need to find one that exists
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        console.log('No supertags in registry, skipping test');
        return;
      }

      const testSupertag = supertags[0].name;

      const result = await create({
        supertag: testSupertag,
        name: 'Test Node from MCP',
        workspace: undefined,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.dryRun).toBe(true);
      expect(result.validated).toBe(true);
      expect(result.supertag).toBe(testSupertag);
      expect(result.name).toBe('Test Node from MCP');
      expect(result.payload).toBeDefined();
      expect(result.payload.name).toBe('Test Node from MCP');
      expect(Array.isArray(result.payload.supertags)).toBe(true);
    });

    testFn('should include fields in payload when provided', async () => {
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        return;
      }

      // Find a supertag with fields
      let testSupertag: string | null = null;
      let testField: string | null = null;

      for (const st of supertags) {
        const fields = registry.getFields(st.name);
        if (fields.length > 0) {
          testSupertag = st.name;
          testField = fields[0].name;
          break;
        }
      }

      if (!testSupertag || !testField) {
        console.log('No supertag with fields found, skipping test');
        return;
      }

      const result = await create({
        supertag: testSupertag,
        name: 'Test Node with Field',
        fields: { [testField]: 'Test Value' },
        workspace: undefined,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.validated).toBe(true);
      expect(result.payload.children).toBeDefined();
      expect(Array.isArray(result.payload.children)).toBe(true);
    });

    testFn('should handle comma-separated supertags', async () => {
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length < 2) {
        console.log('Need at least 2 supertags, skipping test');
        return;
      }

      const tag1 = supertags[0].name;
      const tag2 = supertags[1].name;

      const result = await create({
        supertag: `${tag1},${tag2}`,
        name: 'Multi-tag Node',
        workspace: undefined,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.validated).toBe(true);
      expect(result.payload.supertags?.length).toBeGreaterThanOrEqual(2);
    });

    testFn('should include workspace in result', async () => {
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        return;
      }

      const result = await create({
        supertag: supertags[0].name,
        name: 'Workspace Test Node',
        workspace: undefined,
        dryRun: true,
      });

      expect(result.workspace).toBeDefined();
      expect(typeof result.workspace).toBe('string');
    });

    testFn('should handle target parameter', async () => {
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        return;
      }

      const result = await create({
        supertag: supertags[0].name,
        name: 'Target Test Node',
        target: 'INBOX',
        workspace: undefined,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.target).toBe('INBOX');
    });

    testFn('should add plain children without dataType', async () => {
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        return;
      }

      const result = await create({
        supertag: supertags[0].name,
        name: 'Node with plain children',
        children: [
          { name: 'Plain child 1' },
          { name: 'Plain child 2' },
        ],
        workspace: undefined,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.payload.children).toBeDefined();

      // Find the plain children (not field nodes)
      const plainChildren = result.payload.children?.filter(
        (c: any) => c.name === 'Plain child 1' || c.name === 'Plain child 2'
      );
      expect(plainChildren?.length).toBe(2);
    });

    testFn('should preserve dataType url in children', async () => {
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        return;
      }

      const result = await create({
        supertag: supertags[0].name,
        name: 'Node with URL child',
        children: [
          { name: 'hook://email/test%40example.com', dataType: 'url' },
        ],
        workspace: undefined,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.payload.children).toBeDefined();

      // Find the URL child
      const urlChild = result.payload.children?.find(
        (c: any) => c.name === 'hook://email/test%40example.com'
      ) as any;
      expect(urlChild).toBeDefined();
      expect(urlChild?.dataType).toBe('url');
    });

    testFn('should handle reference children with id', async () => {
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        return;
      }

      const result = await create({
        supertag: supertags[0].name,
        name: 'Node with reference child',
        children: [
          { name: 'Reference', id: 'abc123' },
        ],
        workspace: undefined,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.payload.children).toBeDefined();

      // Find the reference child
      const refChild = result.payload.children?.find(
        (c: any) => c.dataType === 'reference' && c.id === 'abc123'
      );
      expect(refChild).toBeDefined();
    });

    testFn('should handle mixed children types', async () => {
      const { getSchemaRegistry } = await import('../../../commands/schema');
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        return;
      }

      const result = await create({
        supertag: supertags[0].name,
        name: 'Node with mixed children',
        children: [
          { name: 'Plain text child' },
          { name: 'https://example.com', dataType: 'url' },
          { name: 'Reference node', id: 'xyz789' },
        ],
        workspace: undefined,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.payload.children).toBeDefined();

      const children = result.payload.children || [];

      // Check plain child
      const plainChild = children.find((c: any) => c.name === 'Plain text child') as any;
      expect(plainChild).toBeDefined();
      expect(plainChild?.dataType).toBeUndefined();

      // Check URL child
      const urlChild = children.find((c: any) => c.name === 'https://example.com') as any;
      expect(urlChild).toBeDefined();
      expect(urlChild?.dataType).toBe('url');

      // Check reference child
      const refChild = children.find((c: any) => c.id === 'xyz789') as any;
      expect(refChild).toBeDefined();
      expect(refChild?.dataType).toBe('reference');
    });
  });
});
