/**
 * MCP Tools Integration Tests
 *
 * TDD tests for MCP tool implementations.
 * These tests require a real database to be present.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync } from 'fs';
import { Database } from 'bun:sqlite';
import { stats } from '../stats';
import { supertags } from '../supertags';
import { search } from '../search';
import { tagged } from '../tagged';
import { showNode } from '../node';
import { create } from '../create';
import { sync } from '../sync';
import { getDatabasePath } from '../../../config/paths';

// Check if we have a database to test against
const dbPath = getDatabasePath();
const hasDatabase = existsSync(dbPath);

describe('MCP Tools Integration', () => {
  // Skip all tests if no database exists
  const testFn = hasDatabase ? it : it.skip;

  describe('stats tool', () => {
    testFn('should return database statistics', async () => {
      const result = await stats({ workspace: undefined });

      expect(result).toBeDefined();
      expect(result.workspace).toBeDefined();
      expect(typeof result.totalNodes).toBe('number');
      expect(typeof result.totalSupertags).toBe('number');
      expect(typeof result.totalFields).toBe('number');
      expect(typeof result.totalReferences).toBe('number');
      expect(result.totalNodes).toBeGreaterThan(0);
    });

    testFn('should accept workspace parameter', async () => {
      // This tests that the function doesn't crash with workspace param
      // Actual workspace resolution depends on config
      const result = await stats({ workspace: undefined });
      expect(result).toBeDefined();
    });
  });

  describe('supertags tool', () => {
    testFn('should return list of supertags', async () => {
      const result = await supertags({ workspace: undefined, limit: 20 });

      expect(result).toBeDefined();
      expect(result.workspace).toBeDefined();
      expect(Array.isArray(result.supertags)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    testFn('should respect limit parameter', async () => {
      const result = await supertags({ workspace: undefined, limit: 5 });

      expect(result.supertags.length).toBeLessThanOrEqual(5);
    });

    testFn('should return supertag with correct structure', async () => {
      const result = await supertags({ workspace: undefined, limit: 1 });

      if (result.supertags.length > 0) {
        const tag = result.supertags[0];
        expect(tag).toHaveProperty('tagName');
        expect(tag).toHaveProperty('tagId');
        expect(tag).toHaveProperty('count');
        expect(typeof tag.tagName).toBe('string');
        expect(typeof tag.count).toBe('number');
      }
    });
  });

  describe('search tool', () => {
    testFn('should search nodes by query', async () => {
      const result = await search({ query: 'test', workspace: undefined, limit: 20, raw: false, includeAncestor: true });

      expect(result).toBeDefined();
      expect(result.workspace).toBeDefined();
      expect(result.query).toBe('test');
      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.count).toBe('number');
    });

    testFn('should respect limit parameter', async () => {
      const result = await search({ query: 'a', workspace: undefined, limit: 3, raw: false, includeAncestor: true });

      expect(result.results.length).toBeLessThanOrEqual(3);
    });

    testFn('should return search result with correct structure', async () => {
      const result = await search({ query: 'a', workspace: undefined, limit: 1, raw: false, includeAncestor: true });

      if (result.results.length > 0) {
        const item = result.results[0];
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('rank');
        expect(typeof item.id).toBe('string');
        expect(typeof item.rank).toBe('number');
      }
    });

    testFn('should include tags when raw is false', async () => {
      const result = await search({ query: 'a', workspace: undefined, limit: 1, raw: false, includeAncestor: true });

      if (result.results.length > 0) {
        const item = result.results[0];
        expect(item).toHaveProperty('tags');
        expect(Array.isArray(item.tags)).toBe(true);
      }
    });

    testFn('should exclude tags when raw is true', async () => {
      const result = await search({ query: 'a', workspace: undefined, limit: 1, raw: true, includeAncestor: true });

      if (result.results.length > 0) {
        const item = result.results[0];
        expect(item.tags).toBeUndefined();
      }
    });
  });

  describe('tagged tool', () => {
    testFn('should find nodes by tag', async () => {
      // First get a tag that exists
      const tagsResult = await supertags({ workspace: undefined, limit: 1 });

      if (tagsResult.supertags.length > 0) {
        const tagName = tagsResult.supertags[0].tagName;
        const result = await tagged({ tagname: tagName, workspace: undefined, limit: 20, orderBy: 'created', caseInsensitive: false });

        expect(result).toBeDefined();
        expect(result.workspace).toBeDefined();
        expect(result.tagname).toBe(tagName);
        expect(Array.isArray(result.nodes)).toBe(true);
        expect(typeof result.count).toBe('number');
      }
    });

    testFn('should respect limit parameter', async () => {
      const tagsResult = await supertags({ workspace: undefined, limit: 1 });

      if (tagsResult.supertags.length > 0) {
        const tagName = tagsResult.supertags[0].tagName;
        const result = await tagged({ tagname: tagName, workspace: undefined, limit: 2, orderBy: 'created', caseInsensitive: false });

        expect(result.nodes.length).toBeLessThanOrEqual(2);
      }
    });

    testFn('should return node with correct structure', async () => {
      const tagsResult = await supertags({ workspace: undefined, limit: 1 });

      if (tagsResult.supertags.length > 0) {
        const tagName = tagsResult.supertags[0].tagName;
        const result = await tagged({ tagname: tagName, workspace: undefined, limit: 1, orderBy: 'created', caseInsensitive: false });

        if (result.nodes.length > 0) {
          const node = result.nodes[0];
          expect(node).toHaveProperty('id');
          expect(node).toHaveProperty('name');
          expect(node).toHaveProperty('created');
          expect(node).toHaveProperty('updated');
          expect(typeof node.id).toBe('string');
        }
      }
    });

    testFn('should handle case-insensitive search', async () => {
      const tagsResult = await supertags({ workspace: undefined, limit: 1 });

      if (tagsResult.supertags.length > 0) {
        const tagName = tagsResult.supertags[0].tagName;
        const upperTag = tagName.toUpperCase();

        const result = await tagged({
          tagname: upperTag,
          workspace: undefined,
          limit: 20,
          orderBy: 'created',
          caseInsensitive: true,
        });

        // Should find results if original tag had results
        expect(result).toBeDefined();
      }
    });
  });

  describe('showNode tool', () => {
    testFn('should show node by ID', async () => {
      // First search for a node to get a valid ID
      const searchResult = await search({ query: 'a', workspace: undefined, limit: 1, raw: false, includeAncestor: true });

      if (searchResult.results.length > 0) {
        const nodeId = searchResult.results[0].id as string;
        const result = await showNode({ nodeId, workspace: undefined, depth: 0 });

        expect(result).toBeDefined();
        expect(result!.id).toBe(nodeId);
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('tags');
        expect(result).toHaveProperty('fields');
        expect(result).toHaveProperty('children');
      }
    });

    testFn('should return null for non-existent node', async () => {
      const result = await showNode({ nodeId: 'nonexistent_node_id_12345', workspace: undefined, depth: 0 });
      expect(result).toBeNull();
    });

    testFn('should respect depth parameter', async () => {
      const searchResult = await search({ query: 'a', workspace: undefined, limit: 1, raw: false, includeAncestor: true });

      if (searchResult.results.length > 0) {
        const nodeId = searchResult.results[0].id as string;

        // Depth 0 - no children content
        const result0 = await showNode({ nodeId, workspace: undefined, depth: 0 });
        expect(result0).toBeDefined();

        // Depth 1 - include direct children
        const result1 = await showNode({ nodeId, workspace: undefined, depth: 1 });
        expect(result1).toBeDefined();

        // Children should be arrays
        if (result0) {
          expect(Array.isArray(result0.children)).toBe(true);
        }
      }
    });

    testFn('should return node with correct structure', async () => {
      const searchResult = await search({ query: 'a', workspace: undefined, limit: 1, raw: false, includeAncestor: true });

      if (searchResult.results.length > 0) {
        const nodeId = searchResult.results[0].id as string;
        const result = await showNode({ nodeId, workspace: undefined, depth: 0 });

        if (result) {
          expect(result).toHaveProperty('id');
          expect(result).toHaveProperty('name');
          expect(result).toHaveProperty('created');
          expect(result).toHaveProperty('tags');
          expect(result).toHaveProperty('fields');
          expect(result).toHaveProperty('children');
          expect(Array.isArray(result.tags)).toBe(true);
          expect(Array.isArray(result.fields)).toBe(true);
          expect(Array.isArray(result.children)).toBe(true);
        }
      }
    });
  });
});

// Unit tests that don't require database
describe('MCP Tools Unit Tests', () => {
  describe('stats tool', () => {
    it('should export stats function', () => {
      expect(typeof stats).toBe('function');
    });
  });

  describe('supertags tool', () => {
    it('should export supertags function', () => {
      expect(typeof supertags).toBe('function');
    });
  });

  describe('search tool', () => {
    it('should export search function', () => {
      expect(typeof search).toBe('function');
    });
  });

  describe('tagged tool', () => {
    it('should export tagged function', () => {
      expect(typeof tagged).toBe('function');
    });
  });

  describe('showNode tool', () => {
    it('should export showNode function', () => {
      expect(typeof showNode).toBe('function');
    });
  });

  describe('create tool', () => {
    it('should export create function', () => {
      expect(typeof create).toBe('function');
    });
  });

  describe('sync tool', () => {
    it('should export sync function', () => {
      expect(typeof sync).toBe('function');
    });
  });
});
