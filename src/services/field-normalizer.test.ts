/**
 * Unit tests for Field Input Normalizer
 *
 * Tests the normalizeFieldInput() function that unifies
 * nested {"fields": {...}} and flat {...} field formats.
 *
 * Spec: F-091 unified-field-format
 */

import { describe, expect, it } from 'bun:test';
import {
  normalizeFieldInput,
  isReservedKey,
  RESERVED_KEYS,
} from './field-normalizer';

describe('field-normalizer', () => {
  // ===========================================================================
  // Format Detection Tests
  // ===========================================================================
  describe('format detection', () => {
    it('should detect nested format', () => {
      const result = normalizeFieldInput({
        fields: { Status: 'Done' },
      });

      expect(result.inputFormat).toBe('nested');
      expect(result.fields).toEqual({ Status: 'Done' });
    });

    it('should detect flat format', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
      });

      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({ Status: 'Done' });
    });

    it('should detect mixed format', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        fields: { Priority: 'High' },
      });

      expect(result.inputFormat).toBe('mixed');
      expect(result.fields).toEqual({ Status: 'Done', Priority: 'High' });
    });

    it('should return flat format for empty input', () => {
      const result = normalizeFieldInput({});

      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({});
    });

    it('should handle input with only reserved keys as flat format', () => {
      const result = normalizeFieldInput({
        name: 'Task Name',
        supertag: 'todo',
      });

      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({});
    });
  });

  // ===========================================================================
  // Reserved Keys Tests
  // ===========================================================================
  describe('reserved keys', () => {
    it('should not treat reserved keys as fields', () => {
      const result = normalizeFieldInput({
        name: 'My Task',
        supertag: 'todo',
        Status: 'Done',
      });

      expect(result.fields).toEqual({ Status: 'Done' });
      expect(result.fields).not.toHaveProperty('name');
      expect(result.fields).not.toHaveProperty('supertag');
    });

    it('should exclude all 12 reserved keys individually', () => {
      for (const reservedKey of RESERVED_KEYS) {
        const input: Record<string, unknown> = {
          [reservedKey]: 'some value',
          CustomField: 'test',
        };

        const result = normalizeFieldInput(input);
        expect(result.fields).not.toHaveProperty(reservedKey);
        expect(result.fields).toHaveProperty('CustomField');
      }
    });

    it('should extract "name" inside nested fields as a field', () => {
      // Inside nested fields, reserved keys become regular field names
      const result = normalizeFieldInput({
        fields: { name: 'should-be-field' },
      });

      expect(result.fields).toEqual({ name: 'should-be-field' });
      expect(result.inputFormat).toBe('nested');
    });

    it('should extract all reserved key names from nested fields', () => {
      const result = normalizeFieldInput({
        fields: {
          name: 'nested name',
          supertag: 'nested supertag',
          children: 'nested children string', // As a field value, not the children array
        },
      });

      expect(result.fields).toEqual({
        name: 'nested name',
        supertag: 'nested supertag',
        children: 'nested children string',
      });
    });
  });

  // ===========================================================================
  // Precedence Tests
  // ===========================================================================
  describe('precedence', () => {
    it('should prefer nested fields over flat when same key exists', () => {
      const result = normalizeFieldInput({
        Status: 'Flat',
        fields: { Status: 'Nested' },
      });

      expect(result.fields.Status).toBe('Nested');
      expect(result.inputFormat).toBe('mixed');
    });

    it('should merge flat and nested fields correctly', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        Owner: 'Alice',
        fields: {
          Priority: 'High',
          Status: 'In Progress', // Overrides flat Status
        },
      });

      expect(result.fields).toEqual({
        Status: 'In Progress',
        Owner: 'Alice',
        Priority: 'High',
      });
    });

    it('should keep flat field when nested does not override it', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        fields: { Priority: 'High' },
      });

      expect(result.fields.Status).toBe('Done');
      expect(result.fields.Priority).toBe('High');
    });
  });

  // ===========================================================================
  // Value Types Tests
  // ===========================================================================
  describe('value types', () => {
    it('should preserve string values', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        Description: 'A long description with special chars: <>&"',
      });

      expect(result.fields.Status).toBe('Done');
      expect(result.fields.Description).toBe('A long description with special chars: <>&"');
    });

    it('should preserve array values (multi-select fields)', () => {
      const result = normalizeFieldInput({
        Tags: ['urgent', 'bug', 'frontend'],
        Status: 'Done',
      });

      expect(result.fields.Tags).toEqual(['urgent', 'bug', 'frontend']);
      expect(result.fields.Status).toBe('Done');
    });

    it('should preserve empty array values', () => {
      const result = normalizeFieldInput({
        Tags: [],
      });

      expect(result.fields.Tags).toEqual([]);
    });

    it('should preserve empty string values', () => {
      const result = normalizeFieldInput({
        Status: '',
      });

      expect(result.fields.Status).toBe('');
    });

    it('should skip null values', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        Priority: null,
      });

      expect(result.fields).toEqual({ Status: 'Done' });
      expect(result.fields).not.toHaveProperty('Priority');
    });

    it('should skip undefined values', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        Priority: undefined,
      });

      expect(result.fields).toEqual({ Status: 'Done' });
      expect(result.fields).not.toHaveProperty('Priority');
    });

    it('should skip object values (not valid field values)', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        Metadata: { key: 'value' },
      });

      expect(result.fields).toEqual({ Status: 'Done' });
      expect(result.fields).not.toHaveProperty('Metadata');
    });

    it('should skip number values (only strings allowed)', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        Count: 42,
      });

      expect(result.fields).toEqual({ Status: 'Done' });
      expect(result.fields).not.toHaveProperty('Count');
    });

    it('should skip boolean values', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        IsActive: true,
      });

      expect(result.fields).toEqual({ Status: 'Done' });
      expect(result.fields).not.toHaveProperty('IsActive');
    });

    it('should skip arrays with non-string elements', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        MixedArray: ['string', 42, true],
      });

      expect(result.fields).toEqual({ Status: 'Done' });
      expect(result.fields).not.toHaveProperty('MixedArray');
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================
  describe('edge cases', () => {
    it('should treat { fields: null } as flat format', () => {
      const result = normalizeFieldInput({
        fields: null,
        Status: 'Done',
      });

      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({ Status: 'Done' });
    });

    it('should treat { fields: "string" } as flat format', () => {
      const result = normalizeFieldInput({
        fields: 'not an object',
        Status: 'Done',
      });

      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({ Status: 'Done' });
    });

    it('should treat { fields: [] } as flat format', () => {
      const result = normalizeFieldInput({
        fields: [],
        Status: 'Done',
      });

      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({ Status: 'Done' });
    });

    it('should treat { fields: 123 } as flat format', () => {
      const result = normalizeFieldInput({
        fields: 123,
        Status: 'Done',
      });

      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({ Status: 'Done' });
    });

    it('should not recurse into deeply nested objects', () => {
      const result = normalizeFieldInput({
        fields: {
          Level1: {
            Level2: 'deep value',
          },
        },
      });

      // Level1 is an object, not a valid field value, so it's skipped
      expect(result.fields).toEqual({});
      expect(result.inputFormat).toBe('nested');
    });

    it('should handle empty fields object', () => {
      const result = normalizeFieldInput({
        fields: {},
      });

      expect(result.fields).toEqual({});
      expect(result.inputFormat).toBe('nested');
    });

    it('should handle fields with only invalid values', () => {
      const result = normalizeFieldInput({
        fields: {
          Obj: { nested: true },
          Num: 42,
          Bool: false,
        },
      });

      expect(result.fields).toEqual({});
      expect(result.inputFormat).toBe('nested');
    });
  });

  // ===========================================================================
  // isReservedKey Helper
  // ===========================================================================
  describe('isReservedKey', () => {
    it('should return true for all reserved keys', () => {
      for (const key of RESERVED_KEYS) {
        expect(isReservedKey(key)).toBe(true);
      }
    });

    it('should return false for non-reserved keys', () => {
      expect(isReservedKey('Status')).toBe(false);
      expect(isReservedKey('Priority')).toBe(false);
      expect(isReservedKey('CustomField')).toBe(false);
      expect(isReservedKey('Name')).toBe(false); // Case sensitive - 'name' is reserved, not 'Name'
    });

    it('should be case sensitive', () => {
      expect(isReservedKey('name')).toBe(true);
      expect(isReservedKey('Name')).toBe(false);
      expect(isReservedKey('NAME')).toBe(false);
    });
  });

  // ===========================================================================
  // Real-World Scenarios
  // ===========================================================================
  describe('real-world scenarios', () => {
    it('should handle MCP-style nested input', () => {
      const mcpInput = {
        supertag: 'todo',
        name: 'Complete quarterly report',
        fields: {
          Status: 'In Progress',
          '⚙️ Vault': 'Work',
          'Due Date': '2024-03-15',
        },
        dryRun: true,
      };

      const result = normalizeFieldInput(mcpInput);

      expect(result.inputFormat).toBe('nested');
      expect(result.fields).toEqual({
        Status: 'In Progress',
        '⚙️ Vault': 'Work',
        'Due Date': '2024-03-15',
      });
    });

    it('should handle CLI-style flat input', () => {
      const cliInput = {
        name: 'Bug fix',
        supertag: 'task',
        Status: 'Done',
        Priority: 'High',
        Tags: ['bugfix', 'urgent'],
      };

      const result = normalizeFieldInput(cliInput);

      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({
        Status: 'Done',
        Priority: 'High',
        Tags: ['bugfix', 'urgent'],
      });
    });

    it('should handle mixed input from confused user', () => {
      // User provides both formats - we merge gracefully
      const confusedInput = {
        name: 'Meeting notes',
        supertag: 'note',
        Topic: 'Q1 Planning',
        fields: {
          'Meeting Date': '2024-01-15',
          Topic: 'Q1 Planning Updated', // Overrides flat Topic
        },
      };

      const result = normalizeFieldInput(confusedInput);

      expect(result.inputFormat).toBe('mixed');
      expect(result.fields).toEqual({
        Topic: 'Q1 Planning Updated', // Nested wins
        'Meeting Date': '2024-01-15',
      });
    });
  });
});
