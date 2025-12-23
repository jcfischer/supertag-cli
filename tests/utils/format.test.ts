/**
 * Tests for format utility module
 * TDD: Write tests FIRST, then implement
 */
import { describe, it, expect } from 'bun:test';
import {
  tsv,
  record,
  formatDateISO,
  formatDateHuman,
  formatDateRelative,
  formatNumber,
  formatPercentage,
  // Pretty-mode utilities (T-1.3)
  EMOJI,
  padLeft,
  padRight,
  divider,
  header,
  table,
  field,
  tip,
  type OutputOptions,
} from '../../src/utils/format';

describe('tsv', () => {
  it('should join fields with tabs', () => {
    expect(tsv('a', 'b', 'c')).toBe('a\tb\tc');
  });

  it('should convert numbers to strings', () => {
    expect(tsv('name', 123, 'tag')).toBe('name\t123\ttag');
  });

  it('should handle undefined as empty string', () => {
    expect(tsv('a', undefined, 'c')).toBe('a\t\tc');
  });

  it('should handle single field', () => {
    expect(tsv('only')).toBe('only');
  });

  it('should handle empty call', () => {
    expect(tsv()).toBe('');
  });

  it('should handle null as empty string', () => {
    expect(tsv('a', null as unknown as string, 'c')).toBe('a\t\tc');
  });
});

describe('record', () => {
  it('should format key-value pairs as YAML-like records', () => {
    const result = record({ id: 'abc123', name: 'Test Node' });
    expect(result).toBe('id: abc123\nname: Test Node');
  });

  it('should filter out undefined values', () => {
    const result = record({ id: 'abc', name: undefined, tag: 'todo' });
    expect(result).toBe('id: abc\ntag: todo');
  });

  it('should handle empty object', () => {
    expect(record({})).toBe('');
  });

  it('should preserve field order', () => {
    const result = record({ z: '1', a: '2', m: '3' });
    expect(result).toBe('z: 1\na: 2\nm: 3');
  });
});

describe('formatDateISO', () => {
  it('should format Date object as ISO date', () => {
    const date = new Date('2025-12-17T10:30:00Z');
    expect(formatDateISO(date)).toBe('2025-12-17');
  });

  it('should format ISO string as ISO date', () => {
    expect(formatDateISO('2025-12-17T10:30:00Z')).toBe('2025-12-17');
  });

  it('should format timestamp number as ISO date', () => {
    const timestamp = new Date('2025-12-17T00:00:00Z').getTime();
    expect(formatDateISO(timestamp)).toBe('2025-12-17');
  });

  it('should handle date-only string', () => {
    expect(formatDateISO('2025-01-15')).toBe('2025-01-15');
  });
});

describe('formatDateHuman', () => {
  it('should format Date as human-readable', () => {
    const date = new Date('2025-12-17T10:30:00Z');
    // Note: output may vary by locale, check for key components
    const result = formatDateHuman(date);
    expect(result).toContain('Dec');
    expect(result).toContain('17');
    expect(result).toContain('2025');
  });

  it('should format ISO string as human-readable', () => {
    const result = formatDateHuman('2025-06-01T00:00:00Z');
    expect(result).toContain('Jun');
    expect(result).toContain('1');
    expect(result).toContain('2025');
  });
});

describe('formatDateRelative', () => {
  it('should return "just now" for very recent dates', () => {
    const now = new Date();
    expect(formatDateRelative(now)).toBe('just now');
  });

  it('should return "X minutes ago" for recent past', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatDateRelative(fiveMinutesAgo)).toBe('5 minutes ago');
  });

  it('should return "1 minute ago" for singular', () => {
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);
    expect(formatDateRelative(oneMinuteAgo)).toBe('1 minute ago');
  });

  it('should return "X hours ago"', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatDateRelative(threeHoursAgo)).toBe('3 hours ago');
  });

  it('should return "1 hour ago" for singular', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    expect(formatDateRelative(oneHourAgo)).toBe('1 hour ago');
  });

  it('should return "X days ago"', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatDateRelative(twoDaysAgo)).toBe('2 days ago');
  });

  it('should return "yesterday" for 1 day ago', () => {
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    expect(formatDateRelative(yesterday)).toBe('yesterday');
  });

  it('should return ISO date for dates older than 7 days', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const result = formatDateRelative(twoWeeksAgo);
    // Should be ISO format like 2025-12-09
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatNumber', () => {
  it('should return raw number as string by default', () => {
    expect(formatNumber(1234567)).toBe('1234567');
  });

  it('should format with separators when pretty=true', () => {
    expect(formatNumber(1234567, true)).toBe('1,234,567');
  });

  it('should handle zero', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(0, true)).toBe('0');
  });

  it('should handle negative numbers', () => {
    expect(formatNumber(-1234)).toBe('-1234');
    expect(formatNumber(-1234, true)).toBe('-1,234');
  });

  it('should handle decimals', () => {
    expect(formatNumber(1234.56)).toBe('1234.56');
    expect(formatNumber(1234.56, true)).toBe('1,234.56');
  });
});

describe('formatPercentage', () => {
  it('should return decimal value by default', () => {
    expect(formatPercentage(0.568)).toBe('0.568');
  });

  it('should format as percentage when pretty=true', () => {
    expect(formatPercentage(0.568, true)).toBe('56.8%');
  });

  it('should handle zero', () => {
    expect(formatPercentage(0)).toBe('0.000');
    expect(formatPercentage(0, true)).toBe('0.0%');
  });

  it('should handle 1 (100%)', () => {
    expect(formatPercentage(1)).toBe('1.000');
    expect(formatPercentage(1, true)).toBe('100.0%');
  });

  it('should handle small values', () => {
    expect(formatPercentage(0.001)).toBe('0.001');
    expect(formatPercentage(0.001, true)).toBe('0.1%');
  });
});

describe('OutputOptions interface', () => {
  it('should accept valid options object', () => {
    const options: OutputOptions = {
      pretty: true,
      json: false,
      humanDates: true,
      verbose: false,
    };
    expect(options.pretty).toBe(true);
  });

  it('should allow partial options', () => {
    const options: OutputOptions = { pretty: true };
    expect(options.json).toBeUndefined();
  });

  it('should allow empty options', () => {
    const options: OutputOptions = {};
    expect(Object.keys(options).length).toBe(0);
  });
});

// ============================================================================
// Pretty-mode utilities (T-1.3)
// ============================================================================

describe('EMOJI constants', () => {
  it('should have search emoji', () => {
    expect(EMOJI.search).toBe('🔍');
  });

  it('should have tags emoji', () => {
    expect(EMOJI.tags).toBe('🏷️');
  });

  it('should have stats emoji', () => {
    expect(EMOJI.stats).toBe('📊');
  });

  it('should have success emoji', () => {
    expect(EMOJI.success).toBe('✅');
  });

  it('should have error emoji', () => {
    expect(EMOJI.error).toBe('❌');
  });

  it('should have warning emoji', () => {
    expect(EMOJI.warning).toBe('⚠️');
  });

  it('should have tip emoji', () => {
    expect(EMOJI.tip).toBe('💡');
  });
});

describe('padRight', () => {
  it('should pad string to specified width', () => {
    expect(padRight('hello', 10)).toBe('hello     ');
  });

  it('should not truncate if string is longer', () => {
    expect(padRight('hello world', 5)).toBe('hello world');
  });

  it('should handle empty string', () => {
    expect(padRight('', 5)).toBe('     ');
  });

  it('should handle exact width', () => {
    expect(padRight('hello', 5)).toBe('hello');
  });
});

describe('padLeft', () => {
  it('should pad string to specified width on left', () => {
    expect(padLeft('42', 5)).toBe('   42');
  });

  it('should not truncate if string is longer', () => {
    expect(padLeft('12345', 3)).toBe('12345');
  });

  it('should handle empty string', () => {
    expect(padLeft('', 5)).toBe('     ');
  });
});

describe('divider', () => {
  it('should create line of specified width', () => {
    expect(divider(10)).toBe('──────────');
  });

  it('should use default width of 60', () => {
    expect(divider()).toHaveLength(60);
  });

  it('should use custom character', () => {
    expect(divider(5, '=')).toBe('=====');
  });
});

describe('header', () => {
  it('should format header with emoji', () => {
    expect(header('🔍', 'Search Results')).toBe('🔍 Search Results');
  });

  it('should handle empty title', () => {
    expect(header('📊', '')).toBe('📊 ');
  });
});

describe('table', () => {
  it('should format simple table', () => {
    const headers = ['Name', 'Count'];
    const rows = [
      ['meeting', '42'],
      ['todo', '17'],
    ];
    const result = table(headers, rows);
    expect(result).toContain('Name');
    expect(result).toContain('Count');
    expect(result).toContain('meeting');
    expect(result).toContain('42');
  });

  it('should align columns correctly', () => {
    const headers = ['Tag', 'Count'];
    const rows = [
      ['a', '1'],
      ['abc', '100'],
    ];
    const result = table(headers, rows);
    // Each row should have same visual width
    const lines = result.split('\n');
    expect(lines.length).toBe(4); // header + divider + 2 rows
  });

  it('should support right alignment', () => {
    const headers = ['Name', 'Count'];
    const rows = [['test', '42']];
    const result = table(headers, rows, { align: ['left', 'right'] });
    expect(result).toContain('42'); // Should be right-aligned
  });

  it('should support custom indent', () => {
    const headers = ['A'];
    const rows = [['x']];
    const result = table(headers, rows, { indent: 4 });
    expect(result.startsWith('    ')).toBe(true);
  });

  it('should handle empty rows', () => {
    const headers = ['Name'];
    const rows: string[][] = [];
    const result = table(headers, rows);
    expect(result).toContain('Name');
  });
});

describe('field', () => {
  it('should format field with label and value', () => {
    expect(field('Status', 'running')).toBe('  Status: running');
  });

  it('should support custom indent', () => {
    expect(field('Port', '3100', 4)).toBe('    Port: 3100');
  });

  it('should handle empty value', () => {
    expect(field('Value', '')).toBe('  Value: ');
  });
});

describe('tip', () => {
  it('should format tip with emoji', () => {
    expect(tip('Use --show for details')).toBe('\n💡 Tip: Use --show for details');
  });

  it('should include newline prefix', () => {
    const result = tip('Test tip');
    expect(result.startsWith('\n')).toBe(true);
  });
});
