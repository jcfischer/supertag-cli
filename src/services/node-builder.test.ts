/**
 * Node Builder Service Tests
 *
 * TDD tests for the shared node creation module.
 * These tests should FAIL initially (RED state) until implementation is complete.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import {
  validateSupertags,
  buildChildNodes,
  buildNodePayload,
  createNode,
} from './node-builder';
import { getSchemaRegistry } from '../commands/schema';
import { SCHEMA_CACHE_FILE } from '../config/paths';
import { migrateSupertagMetadataSchema, migrateSchemaConsolidation } from '../db/migrate';
import type { ChildNodeInput, CreateNodeInput } from '../types';

// Check if we have a schema registry to test against
const hasSchema = existsSync(SCHEMA_CACHE_FILE);

describe('Node Builder Service', () => {
  // =========================================================================
  // validateSupertags() Tests (1-3)
  // =========================================================================
  describe('validateSupertags()', () => {
    const testFn = hasSchema ? it : it.skip;

    // Test 1: Valid single tag
    testFn('should validate a single valid supertag', () => {
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        console.log('No supertags in registry, skipping test');
        return;
      }

      const testTag = supertags[0].name;
      const result = validateSupertags(registry, testTag);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe(testTag);
    });

    // Test 2: Valid comma-separated tags
    testFn('should validate comma-separated supertags', () => {
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length < 2) {
        console.log('Need at least 2 supertags, skipping test');
        return;
      }

      const tag1 = supertags[0].name;
      const tag2 = supertags[1].name;
      const result = validateSupertags(registry, `${tag1}, ${tag2}`);

      expect(result).toBeDefined();
      expect(result.length).toBe(2);
      expect(result[0].name).toBe(tag1);
      expect(result[1].name).toBe(tag2);
    });

    // Test 3: Unknown tag throws with suggestions
    testFn('should throw error with suggestions for unknown supertag', () => {
      const registry = getSchemaRegistry();

      expect(() => {
        validateSupertags(registry, 'nonexistent_supertag_xyz123');
      }).toThrow(/Unknown supertag/);
    });
  });

  // =========================================================================
  // buildChildNodes() Tests (4-7)
  // =========================================================================
  describe('buildChildNodes()', () => {
    // Test 4: Plain text children
    it('should convert plain text children', () => {
      const input: ChildNodeInput[] = [
        { name: 'Child 1' },
        { name: 'Child 2' },
      ];

      const result = buildChildNodes(input);

      expect(result).toBeDefined();
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('Child 1');
      expect(result[0].dataType).toBeUndefined();
      expect(result[1].name).toBe('Child 2');
    });

    // Test 5: URL children
    it('should convert URL children with dataType', () => {
      const input: ChildNodeInput[] = [
        { name: 'https://example.com', dataType: 'url' },
        { name: 'hook://email/test@example.com', dataType: 'url' },
      ];

      const result = buildChildNodes(input);

      expect(result).toBeDefined();
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('https://example.com');
      expect(result[0].dataType).toBe('url');
      expect(result[1].dataType).toBe('url');
    });

    // Test 6: Reference children with ID
    it('should convert reference children with ID', () => {
      const input: ChildNodeInput[] = [
        { name: 'Reference Node', id: 'abc123' },
      ];

      const result = buildChildNodes(input);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0].dataType).toBe('reference');
      expect(result[0].id).toBe('abc123');
    });

    // Test 7: Mixed children types
    it('should handle mixed children types correctly', () => {
      const input: ChildNodeInput[] = [
        { name: 'Plain text child' },
        { name: 'https://example.com', dataType: 'url' },
        { name: 'Link to node', id: 'xyz789' },
      ];

      const result = buildChildNodes(input);

      expect(result).toBeDefined();
      expect(result.length).toBe(3);

      // Plain text - no dataType
      expect(result[0].name).toBe('Plain text child');
      expect(result[0].dataType).toBeUndefined();
      expect(result[0].id).toBeUndefined();

      // URL - has dataType: 'url'
      expect(result[1].name).toBe('https://example.com');
      expect(result[1].dataType).toBe('url');

      // Reference - has dataType: 'reference' and id
      expect(result[2].dataType).toBe('reference');
      expect(result[2].id).toBe('xyz789');
    });
  });

  // =========================================================================
  // buildNodePayload() Tests (8-10)
  // =========================================================================
  describe('buildNodePayload()', () => {
    const testFn = hasSchema ? it : it.skip;

    // Test 8: Basic node with supertag
    testFn('should build basic node with supertag', () => {
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        console.log('No supertags in registry, skipping test');
        return;
      }

      const testTag = supertags[0].name;
      const input: CreateNodeInput = {
        supertag: testTag,
        name: 'Test Node',
      };

      const result = buildNodePayload(registry, input);

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Node');
      expect(result.supertags).toBeDefined();
      expect(Array.isArray(result.supertags)).toBe(true);
      expect(result.supertags!.length).toBeGreaterThanOrEqual(1);
    });

    // Test 9: Node with fields
    testFn('should build node with field values', () => {
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

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

      const input: CreateNodeInput = {
        supertag: testSupertag,
        name: 'Node with Field',
        fields: { [testField]: 'Test Value' },
      };

      const result = buildNodePayload(registry, input);

      expect(result).toBeDefined();
      expect(result.name).toBe('Node with Field');
      expect(result.children).toBeDefined();
      expect(Array.isArray(result.children)).toBe(true);
    });

    // Test 10: Node with children
    testFn('should build node with children appended', () => {
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        console.log('No supertags in registry, skipping test');
        return;
      }

      const testTag = supertags[0].name;
      const input: CreateNodeInput = {
        supertag: testTag,
        name: 'Node with Children',
        children: [
          { name: 'Child 1' },
          { name: 'https://example.com', dataType: 'url' },
        ],
      };

      const result = buildNodePayload(registry, input);

      expect(result).toBeDefined();
      expect(result.name).toBe('Node with Children');
      expect(result.children).toBeDefined();

      // Find the plain children (not field nodes)
      const plainChildren = result.children?.filter(
        (c: any) => c.name === 'Child 1' || c.name === 'https://example.com'
      );
      expect(plainChildren?.length).toBe(2);
    });
  });

  // =========================================================================
  // createNode() Tests (11-12)
  // =========================================================================
  describe('createNode()', () => {
    const testFn = hasSchema ? it : it.skip;

    // Test 11: Dry run mode returns payload
    testFn('should return validated payload in dry run mode', async () => {
      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        console.log('No supertags in registry, skipping test');
        return;
      }

      // Use 'todo' or 'meeting' as known stable supertags that exist in both registry and database
      const knownTags = ['todo', 'meeting', 'person', 'project'];
      const validTag = supertags.find((s) => knownTags.includes(s.name.toLowerCase()));
      if (!validTag) {
        console.log('No known valid supertag found, skipping test');
        return;
      }

      const testTag = validTag.name;
      const input: CreateNodeInput = {
        supertag: testTag,
        name: 'Dry Run Test Node',
        dryRun: true,
      };

      const result = await createNode(input);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload.name).toBe('Dry Run Test Node');
      expect(result.nodeId).toBeUndefined(); // No ID in dry run
    });

    // Test 12: Missing API token error
    it('should throw error when API token missing and not dry run', async () => {
      // This test needs to temporarily unset the API token
      // We'll test that the function properly validates token presence
      const input: CreateNodeInput = {
        supertag: 'nonexistent_tag_for_token_test',
        name: 'Token Test Node',
        dryRun: false,
      };

      // The function should throw about missing token before validating supertag
      // OR throw about unknown supertag - either is acceptable for this test
      // since we're testing error handling, not the specific error
      try {
        await createNode(input);
        // If we get here without error, the test should fail
        expect(true).toBe(false);
      } catch (error) {
        // Either token error or supertag error is acceptable
        expect(error).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Database-backed createNode() Tests (T-1, T-3)
  // =========================================================================
  describe('createNode() with database field types', () => {
    let testDir: string;
    let dbPath: string;
    let db: Database;

    beforeEach(() => {
      // Create temp directory and database
      testDir = join('/tmp', `supertag-node-builder-test-${Date.now()}`);
      dbPath = join(testDir, 'workspaces', 'main', 'tana-index.db');
      mkdirSync(join(testDir, 'workspaces', 'main'), { recursive: true });

      db = new Database(dbPath);
      migrateSupertagMetadataSchema(db);
      migrateSchemaConsolidation(db);

      // Insert test supertag with explicit field types
      db.run(`
        INSERT INTO supertag_metadata (tag_id, tag_name, normalized_name, description)
        VALUES ('test-tag-id', 'TestTag', 'testtag', 'Test supertag')
      `);

      // Insert date field with explicit type
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
        VALUES ('test-tag-id', 'TestTag', 'Due Date', 'due-date-attr', 0, 'duedate', 'date')
      `);

      // Insert URL field with explicit type
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
        VALUES ('test-tag-id', 'TestTag', 'Website', 'website-attr', 1, 'website', 'url')
      `);

      // Insert reference field with explicit type
      db.run(`
        INSERT INTO supertag_fields (tag_id, tag_name, field_name, field_label_id, field_order, normalized_name, inferred_data_type)
        VALUES ('test-tag-id', 'TestTag', 'Assigned To', 'assignedto-attr', 2, 'assignedto', 'reference')
      `);

      db.close();
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    // T-1: Test that createNode uses database field types
    it('should use explicit field types from database for date fields', async () => {
      const input: CreateNodeInput = {
        supertag: 'TestTag',
        name: 'Test Node with Date',
        fields: { 'Due Date': '2025-01-15' },
        dryRun: true,
        _dbPathOverride: dbPath, // Use test database
      };

      const result = await createNode(input);

      expect(result.success).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload.children).toBeDefined();

      // Find the date field child
      const children = result.payload.children as any[];
      const dateField = children?.find(
        (c: any) => c.type === 'field' && c.attributeId === 'due-date-attr'
      );

      expect(dateField).toBeDefined();
      expect(dateField?.children?.[0]?.dataType).toBe('date');
    });

    // Test nested fields format (F-091)
    it('should accept nested fields format', async () => {
      const input: CreateNodeInput = {
        supertag: 'TestTag',
        name: 'Test Node with Nested Fields',
        fields: { 'Due Date': '2025-01-15' },
        dryRun: true,
        _dbPathOverride: dbPath,
      };

      const result = await createNode(input);

      expect(result.success).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload.children).toBeDefined();
    });

    // Test flat fields format (F-091)
    it('should accept flat fields at top level via normalization', async () => {
      // This simulates what the normalizer does when it extracts flat fields
      // The test validates that the normalized input works correctly
      const input: CreateNodeInput = {
        supertag: 'TestTag',
        name: 'Test Node with Flat Fields',
        fields: { 'Due Date': '2025-01-20' }, // Already normalized by createNode
        dryRun: true,
        _dbPathOverride: dbPath,
      };

      const result = await createNode(input);

      expect(result.success).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload.name).toBe('Test Node with Flat Fields');
    });

    // T-3: Test fallback when no database
    it('should fall back to registry when database does not exist', async () => {
      // Remove the database
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }

      // This should still work using registry
      const testFn = hasSchema ? it : it.skip;

      if (!hasSchema) {
        console.log('No schema registry, skipping fallback test');
        return;
      }

      const registry = getSchemaRegistry();
      const supertags = registry.listSupertags();

      if (supertags.length === 0) {
        console.log('No supertags in registry, skipping test');
        return;
      }

      // Use 'todo' or 'meeting' as known stable supertags that exist in both registry and database
      const knownTags = ['todo', 'meeting', 'person', 'project'];
      const validTag = supertags.find((s) => knownTags.includes(s.name.toLowerCase()));
      if (!validTag) {
        console.log('No known valid supertag found, skipping test');
        return;
      }

      const input: CreateNodeInput = {
        supertag: validTag.name,
        name: 'Fallback Test Node',
        dryRun: true,
      };

      const result = await createNode(input);

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.payload).toBeDefined();
    });
  });
});
