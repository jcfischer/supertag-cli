/**
 * Tests: MCP PAI Schemas
 * Task: T-6.1
 */

import { describe, it, expect } from 'bun:test';
import {
  paiSyncSchema,
  paiContextSchema,
  paiFreshnessSchema,
} from '../../src/mcp/schemas';

describe('MCP PAI Schemas', () => {
  describe('paiSyncSchema', () => {
    it('validates minimal input', () => {
      const result = paiSyncSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dryRun).toBe(false);
        expect(result.data.force).toBe(false);
      }
    });

    it('validates full input', () => {
      const result = paiSyncSchema.safeParse({
        seedPath: '/path/to/seed.json',
        workspace: 'main',
        dryRun: true,
        force: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.seedPath).toBe('/path/to/seed.json');
        expect(result.data.dryRun).toBe(true);
        expect(result.data.force).toBe(true);
      }
    });

    it('handles null workspace', () => {
      const result = paiSyncSchema.safeParse({ workspace: null });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workspace).toBeUndefined();
      }
    });
  });

  describe('paiContextSchema', () => {
    it('validates valid input', () => {
      const result = paiContextSchema.safeParse({
        topic: 'deployment',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.topic).toBe('deployment');
        expect(result.data.maxTokens).toBe(2000);
      }
    });

    it('rejects empty topic', () => {
      const result = paiContextSchema.safeParse({ topic: '' });
      expect(result.success).toBe(false);
    });

    it('accepts type filter', () => {
      const result = paiContextSchema.safeParse({
        topic: 'test',
        type: 'pattern',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('pattern');
      }
    });

    it('rejects invalid type', () => {
      const result = paiContextSchema.safeParse({
        topic: 'test',
        type: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('paiFreshnessSchema', () => {
    it('validates minimal input with defaults', () => {
      const result = paiFreshnessSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.threshold).toBe(30);
      }
    });

    it('accepts custom threshold', () => {
      const result = paiFreshnessSchema.safeParse({
        threshold: 7,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.threshold).toBe(7);
      }
    });

    it('accepts type filter', () => {
      const result = paiFreshnessSchema.safeParse({
        type: 'insight',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('insight');
      }
    });
  });
});
