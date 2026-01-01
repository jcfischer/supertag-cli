/**
 * Tests for IdsFormatter (Spec 060 - T-2.2)
 *
 * Outputs only node IDs, one per line, no decoration.
 * Perfect for xargs piping.
 * TDD: Write tests FIRST, then implement.
 */
import { describe, it, expect } from 'bun:test';
import { Writable } from 'stream';
import { IdsFormatter } from '../../src/utils/output-formatter';

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

describe('IdsFormatter (T-2.2)', () => {
  describe('table()', () => {
    it('should output only ID column values', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.table(['ID', 'Name', 'Tags'], [
        ['abc123', 'Node 1', 'tag1'],
        ['xyz789', 'Node 2', 'tag2'],
      ]);
      formatter.finalize();

      expect(getOutput()).toBe('abc123\nxyz789\n');
    });

    it('should find ID column case-insensitively', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.table(['id', 'Name'], [
        ['lower1', 'Node 1'],
        ['lower2', 'Node 2'],
      ]);
      formatter.finalize();

      expect(getOutput()).toBe('lower1\nlower2\n');
    });

    it('should use first column if no ID column found', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.table(['NodeId', 'Name'], [
        ['node1', 'Node 1'],
        ['node2', 'Node 2'],
      ]);
      formatter.finalize();

      expect(getOutput()).toBe('node1\nnode2\n');
    });

    it('should handle empty rows', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.table(['ID', 'Name'], []);
      formatter.finalize();

      expect(getOutput()).toBe('');
    });

    it('should skip undefined/null values', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.table(['ID', 'Name'], [
        ['abc', 'Node 1'],
        [undefined, 'Node 2'],
        ['xyz', 'Node 3'],
      ]);
      formatter.finalize();

      expect(getOutput()).toBe('abc\nxyz\n');
    });
  });

  describe('record()', () => {
    it('should extract id field from record', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.record({ id: 'record-id', name: 'Test' });
      formatter.finalize();

      expect(getOutput()).toBe('record-id\n');
    });

    it('should handle multiple records', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.record({ id: 'id1', name: 'Test 1' });
      formatter.record({ id: 'id2', name: 'Test 2' });
      formatter.finalize();

      expect(getOutput()).toBe('id1\nid2\n');
    });

    it('should skip record without id field', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.record({ name: 'No ID' });
      formatter.finalize();

      expect(getOutput()).toBe('');
    });
  });

  describe('list()', () => {
    it('should output items as-is (assuming they are IDs)', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.list(['id1', 'id2', 'id3']);
      formatter.finalize();

      expect(getOutput()).toBe('id1\nid2\nid3\n');
    });
  });

  describe('value()', () => {
    it('should output single value as ID', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.value('single-id');
      formatter.finalize();

      expect(getOutput()).toBe('single-id\n');
    });

    it('should extract id from object value', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.value({ id: 'object-id', name: 'Test' });
      formatter.finalize();

      expect(getOutput()).toBe('object-id\n');
    });
  });

  describe('no-op methods', () => {
    it('header() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.header('Test Header', 'search');
      formatter.finalize();

      expect(getOutput()).toBe('');
    });

    it('divider() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.divider();
      formatter.finalize();

      expect(getOutput()).toBe('');
    });

    it('tip() should be a no-op', () => {
      const { stream, getOutput } = captureOutput();
      const formatter = new IdsFormatter({ format: 'ids', stream });

      formatter.tip('Some tip');
      formatter.finalize();

      expect(getOutput()).toBe('');
    });
  });
});
