/**
 * Tests for MinimalFormatter (Spec 060 - T-2.3)
 *
 * JSON output with projection to only id, name, tags fields.
 * TDD: Write tests FIRST, then implement.
 */
import { describe, it, expect } from 'bun:test';
import { Writable } from 'stream';
import { MinimalFormatter } from '../../src/utils/output-formatter';

// Helper to capture output for testing
function captureOutput(): { stream: NodeJS.WriteStream; getOutput: () => string } {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  }) as unknown as NodeJS.WriteStream;
  return { stream, getOutput: () => output };
}

describe('MinimalFormatter (T-2.3)', () => {
  describe('table()', () => {
    it('should project only id, name, tags columns', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.table(['ID', 'Name', 'Tags', 'Created', 'Modified'], [
        ['abc', 'Node 1', 'tag1, tag2', '2025-01-01', '2025-01-02'],
        ['xyz', 'Node 2', 'tag3', '2025-01-03', '2025-01-04'],
      ]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([
        { id: 'abc', name: 'Node 1', tags: 'tag1, tag2' },
        { id: 'xyz', name: 'Node 2', tags: 'tag3' },
      ]);
    });

    it('should handle case-insensitive column matching', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.table(['id', 'NAME', 'Tags'], [
        ['abc', 'Node 1', 'tag1'],
      ]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      // Single row outputs single object (not array)
      expect(output).toEqual({ id: 'abc', name: 'Node 1', tags: 'tag1' });
    });

    it('should include null for missing projected fields', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.table(['ID', 'Name'], [
        ['abc', 'Node 1'],
      ]);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      // Single row outputs single object (not array)
      expect(output).toEqual({ id: 'abc', name: 'Node 1', tags: null });
    });

    it('should output empty array for empty rows', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.table(['ID', 'Name'], []);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([]);
    });
  });

  describe('record()', () => {
    it('should project only id, name, tags fields', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.record({
        id: 'abc',
        name: 'Test',
        tags: 'tag1',
        created: '2025-01-01',
        description: 'Long description...'
      });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({ id: 'abc', name: 'Test', tags: 'tag1' });
    });

    it('should include null for missing fields', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.record({ id: 'abc' });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({ id: 'abc', name: null, tags: null });
    });

    it('should handle multiple records as array', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.record({ id: 'abc', name: 'Test 1', tags: 'tag1' });
      formatter.record({ id: 'xyz', name: 'Test 2', tags: 'tag2' });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual([
        { id: 'abc', name: 'Test 1', tags: 'tag1' },
        { id: 'xyz', name: 'Test 2', tags: 'tag2' },
      ]);
    });
  });

  describe('list()', () => {
    it('should output items as JSON array', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.list(['item1', 'item2', 'item3']);
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual(['item1', 'item2', 'item3']);
    });
  });

  describe('value()', () => {
    it('should output object with projection', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.value({ id: 'abc', name: 'Test', extra: 'dropped' });
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toEqual({ id: 'abc', name: 'Test', tags: null });
    });

    it('should output primitive values as-is', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.value('simple string');
      formatter.finalize();

      const output = JSON.parse(getOutput());
      expect(output).toBe('simple string');
    });
  });

  describe('no-op methods', () => {
    it('header() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.header('Test Header', 'search');
      formatter.finalize();

      expect(getOutput()).toBe('[]\n');
    });

    it('divider() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.divider();
      formatter.finalize();

      expect(getOutput()).toBe('[]\n');
    });

    it('tip() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new MinimalFormatter({ format: 'minimal', stream });

      formatter.tip('Some tip');
      formatter.finalize();

      expect(getOutput()).toBe('[]\n');
    });
  });
});
