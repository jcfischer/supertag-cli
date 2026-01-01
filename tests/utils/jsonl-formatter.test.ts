/**
 * Tests for JsonlFormatter (Spec 060 - T-2.4)
 *
 * JSON Lines format - one complete JSON object per line.
 * Stream-friendly for large results.
 * TDD: Write tests FIRST, then implement.
 */
import { describe, it, expect } from 'bun:test';
import { Writable } from 'stream';
import { JsonlFormatter } from '../../src/utils/output-formatter';

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

describe('JsonlFormatter (T-2.4)', () => {
  describe('table()', () => {
    it('should output one JSON object per line', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.table(['ID', 'Name'], [
        ['abc', 'Node 1'],
        ['xyz', 'Node 2'],
      ]);
      formatter.finalize();

      const lines = getOutput().trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({ ID: 'abc', Name: 'Node 1' });
      expect(JSON.parse(lines[1])).toEqual({ ID: 'xyz', Name: 'Node 2' });
    });

    it('should handle undefined values as null', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.table(['ID', 'Name', 'Tags'], [
        ['abc', 'Node 1', undefined],
      ]);
      formatter.finalize();

      const output = JSON.parse(getOutput().trim());
      expect(output).toEqual({ ID: 'abc', Name: 'Node 1', Tags: null });
    });

    it('should output nothing for empty rows', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.table(['ID', 'Name'], []);
      formatter.finalize();

      expect(getOutput()).toBe('');
    });
  });

  describe('record()', () => {
    it('should output record as single JSON line', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.record({ id: 'abc', name: 'Test' });
      formatter.finalize();

      const output = JSON.parse(getOutput().trim());
      expect(output).toEqual({ id: 'abc', name: 'Test' });
    });

    it('should output multiple records as separate lines', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.record({ id: 'abc', name: 'Test 1' });
      formatter.record({ id: 'xyz', name: 'Test 2' });
      formatter.finalize();

      const lines = getOutput().trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({ id: 'abc', name: 'Test 1' });
      expect(JSON.parse(lines[1])).toEqual({ id: 'xyz', name: 'Test 2' });
    });

    it('should handle undefined values as null', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.record({ id: 'abc', name: undefined });
      formatter.finalize();

      const output = JSON.parse(getOutput().trim());
      expect(output).toEqual({ id: 'abc', name: null });
    });
  });

  describe('list()', () => {
    it('should output each item as separate JSON line', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.list(['item1', 'item2', 'item3']);
      formatter.finalize();

      const lines = getOutput().trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0])).toBe('item1');
      expect(JSON.parse(lines[1])).toBe('item2');
      expect(JSON.parse(lines[2])).toBe('item3');
    });
  });

  describe('value()', () => {
    it('should output single value as JSON line', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.value({ id: 'abc', name: 'Test' });
      formatter.finalize();

      const output = JSON.parse(getOutput().trim());
      expect(output).toEqual({ id: 'abc', name: 'Test' });
    });

    it('should output multiple values as separate lines', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.value('one');
      formatter.value('two');
      formatter.finalize();

      const lines = getOutput().trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toBe('one');
      expect(JSON.parse(lines[1])).toBe('two');
    });

    it('should handle numeric values', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.value(42);
      formatter.finalize();

      expect(getOutput().trim()).toBe('42');
    });
  });

  describe('no-op methods', () => {
    it('header() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.header('Test Header', 'search');
      formatter.finalize();

      expect(getOutput()).toBe('');
    });

    it('divider() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.divider();
      formatter.finalize();

      expect(getOutput()).toBe('');
    });

    it('tip() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.tip('Some tip');
      formatter.finalize();

      expect(getOutput()).toBe('');
    });
  });

  describe('streaming behavior', () => {
    it('should write output immediately (not buffer until finalize)', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new JsonlFormatter({ format: 'jsonl', stream });

      formatter.table(['ID'], [['row1']]);
      expect(getOutput()).toBe('{"ID":"row1"}\n'); // Written immediately

      formatter.table(['ID'], [['row2']]);
      expect(getOutput()).toBe('{"ID":"row1"}\n{"ID":"row2"}\n'); // Added immediately
    });
  });
});
