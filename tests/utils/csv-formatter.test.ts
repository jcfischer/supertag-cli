/**
 * Tests for CsvFormatter (Spec 060 - T-2.1)
 *
 * RFC 4180 compliant CSV output formatter.
 * TDD: Write tests FIRST, then implement.
 */
import { describe, it, expect } from 'bun:test';
import { Writable } from 'stream';
import { CsvFormatter } from '../../src/utils/output-formatter';

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

describe('CsvFormatter (T-2.1)', () => {
  describe('table()', () => {
    it('should output CSV with header row by default', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.table(['ID', 'Name', 'Tags'], [
        ['abc', 'Node 1', 'tag1'],
        ['xyz', 'Node 2', 'tag2'],
      ]);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('ID,Name,Tags\nabc,Node 1,tag1\nxyz,Node 2,tag2\n');
    });

    it('should skip header row when noHeader is true', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream, noHeader: true });

      formatter.table(['ID', 'Name'], [
        ['abc', 'Node 1'],
      ]);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('abc,Node 1\n');
    });

    it('should quote fields containing commas', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.table(['Name', 'Description'], [
        ['Test', 'Hello, World'],
      ]);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('Name,Description\nTest,"Hello, World"\n');
    });

    it('should escape quotes by doubling them', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.table(['Name', 'Quote'], [
        ['Test', 'He said "Hello"'],
      ]);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('Name,Quote\nTest,"He said ""Hello"""\n');
    });

    it('should quote fields containing newlines', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.table(['Name', 'Content'], [
        ['Test', 'Line 1\nLine 2'],
      ]);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('Name,Content\nTest,"Line 1\nLine 2"\n');
    });

    it('should handle undefined values as empty string', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.table(['ID', 'Name', 'Tags'], [
        ['abc', 'Node 1', undefined],
      ]);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('ID,Name,Tags\nabc,Node 1,\n');
    });

    it('should handle numeric values', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.table(['ID', 'Count'], [
        ['abc', 42],
      ]);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('ID,Count\nabc,42\n');
    });

    it('should output header only for empty rows', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.table(['ID', 'Name'], []);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('ID,Name\n');
    });

    it('should output nothing for empty rows when noHeader is true', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream, noHeader: true });

      formatter.table(['ID', 'Name'], []);
      formatter.finalize();

      expect(getOutput()).toBe('');
    });
  });

  describe('record()', () => {
    it('should output record as single CSV row', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.record({ id: 'abc', name: 'Test' });
      formatter.finalize();

      const output = getOutput();
      // Headers derived from keys, then values
      expect(output).toBe('id,name\nabc,Test\n');
    });

    it('should handle multiple records', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.record({ id: 'abc', name: 'Test 1' });
      formatter.record({ id: 'xyz', name: 'Test 2' });
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('id,name\nabc,Test 1\nxyz,Test 2\n');
    });
  });

  describe('list()', () => {
    it('should output list items one per line', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.list(['item1', 'item2', 'item3']);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('item1\nitem2\nitem3\n');
    });

    it('should quote items containing special characters', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.list(['normal', 'with,comma', 'with"quote']);
      formatter.finalize();

      const output = getOutput();
      expect(output).toBe('normal\n"with,comma"\n"with""quote"\n');
    });
  });

  describe('value()', () => {
    it('should output single value', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.value('hello');
      formatter.finalize();

      expect(getOutput()).toBe('hello\n');
    });
  });

  describe('no-op methods', () => {
    it('header() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.header('Test Header', 'search');
      formatter.finalize();

      expect(getOutput()).toBe('');
    });

    it('divider() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.divider();
      formatter.finalize();

      expect(getOutput()).toBe('');
    });

    it('tip() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new CsvFormatter({ format: 'csv', stream });

      formatter.tip('Some tip');
      formatter.finalize();

      expect(getOutput()).toBe('');
    });
  });
});
