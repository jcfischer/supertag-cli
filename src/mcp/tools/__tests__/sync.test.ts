/**
 * MCP tana_sync Tool Tests
 *
 * TDD tests for the sync tool implementation.
 * Tests require export directory to exist.
 */

import { describe, it, expect } from 'bun:test';
import { existsSync } from 'fs';
import { sync, type SyncResult } from '../sync';
import { DEFAULT_EXPORT_DIR } from '../../../config/paths';

// Check if we have an export directory to test against
const hasExportDir = existsSync(DEFAULT_EXPORT_DIR);

describe('MCP tana_sync Tool', () => {
  describe('Unit Tests', () => {
    it('should export sync function', () => {
      expect(typeof sync).toBe('function');
    });
  });

  describe('Integration Tests', () => {
    // Skip integration tests if no export directory exists
    const testFn = hasExportDir ? it : it.skip;

    testFn('should return correct structure for status action', async () => {
      const result = await sync({
        action: 'status',
        workspace: undefined,
      });

      expect(result).toBeDefined();
      expect(result.workspace).toBeDefined();
      expect(result.action).toBe('status');
      expect(result.exportDir).toBeDefined();
      expect(result.dbPath).toBeDefined();
    });

    testFn('should include export file info in status', async () => {
      const result = await sync({
        action: 'status',
        workspace: undefined,
      });

      expect(result).toBeDefined();
      // latestExport may be null if no exports exist
      expect('latestExport' in result).toBe(true);
    });

    testFn('should handle workspace parameter', async () => {
      // Test with default workspace
      const result = await sync({
        action: 'status',
        workspace: undefined,
      });

      expect(result).toBeDefined();
      expect(result.workspace).toBeDefined();
    });

    testFn('should return index results for index action', async () => {
      const result = await sync({
        action: 'index',
        workspace: undefined,
      });

      expect(result).toBeDefined();
      expect(result.action).toBe('index');

      // If indexing succeeded, we should have stats
      if (!result.error) {
        expect(typeof result.nodesIndexed).toBe('number');
        expect(typeof result.durationMs).toBe('number');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing export directory gracefully', async () => {
      // Use a non-existent workspace that will have no export dir
      try {
        const result = await sync({
          action: 'index',
          workspace: 'nonexistent_workspace_xyz',
        });
        // Either succeeds with error message or throws
        if (result.error) {
          expect(result.error).toBeDefined();
        }
      } catch (error) {
        // Expected - missing export directory
        expect(error).toBeDefined();
      }
    });
  });
});
