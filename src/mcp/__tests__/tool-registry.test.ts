/**
 * Tool Registry Tests
 *
 * TDD tests for the progressive disclosure tool registry.
 * Tests types, metadata, getCapabilities(), and getToolSchema().
 */

import { describe, it, expect } from 'bun:test';
import type {
  ToolCategory,
  ToolSummary,
  ToolMetadata,
  CapabilitiesResponse,
} from '../tool-registry';

describe('Tool Registry Types', () => {
  describe('ToolSummary', () => {
    it('should have required name and description', () => {
      const summary: ToolSummary = {
        name: 'tana_search',
        description: 'Full-text search',
      };
      expect(summary.name).toBe('tana_search');
      expect(summary.description).toBe('Full-text search');
    });

    it('should allow optional example field', () => {
      const summary: ToolSummary = {
        name: 'tana_search',
        description: 'Full-text search',
        example: 'Find all notes about TypeScript',
      };
      expect(summary.example).toBe('Find all notes about TypeScript');
    });
  });

  describe('ToolCategory', () => {
    it('should have name, description, and tools array', () => {
      const category: ToolCategory = {
        name: 'query',
        description: 'Find and search nodes',
        tools: [{ name: 'tana_search', description: 'Full-text search' }],
      };
      expect(category.name).toBe('query');
      expect(category.tools).toHaveLength(1);
    });

    it('should only allow valid category names', () => {
      const validNames: ToolCategory['name'][] = [
        'query',
        'explore',
        'transcript',
        'mutate',
        'system',
      ];
      expect(validNames).toHaveLength(5);
    });
  });

  describe('ToolMetadata', () => {
    it('should include category assignment', () => {
      const metadata: ToolMetadata = {
        name: 'tana_search',
        description: 'Full-text search',
        category: 'query',
        example: 'Find notes about TypeScript',
      };
      expect(metadata.category).toBe('query');
    });
  });

  describe('CapabilitiesResponse', () => {
    it('should have version, categories, and quickActions', () => {
      const response: CapabilitiesResponse = {
        version: '0.7.0',
        categories: [],
        quickActions: ['search', 'create'],
      };
      expect(response.version).toBeDefined();
      expect(response.categories).toBeArray();
      expect(response.quickActions).toBeArray();
    });
  });
});
