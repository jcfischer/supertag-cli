/**
 * Tests for output options resolution
 * TDD: Write tests FIRST, then implement
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  resolveOutputOptions,
  resolveOutputFormat,
  getOutputConfig,
  setOutputConfig,
  clearOutputConfigOverride,
  type OutputConfig,
} from '../../src/utils/output-options';
import type { OutputFormat } from '../../src/utils/output-formatter';

describe('resolveOutputOptions', () => {
  // Store original config to restore after tests
  let originalConfig: OutputConfig | undefined;

  beforeEach(() => {
    // Get current config before each test
    originalConfig = getOutputConfig();
  });

  afterEach(() => {
    // Restore original config after each test
    if (originalConfig) {
      setOutputConfig(originalConfig);
    }
  });

  describe('with no config and no CLI flags', () => {
    it('should return Unix defaults (no pretty, no humanDates)', () => {
      setOutputConfig({});
      const options = resolveOutputOptions({});
      expect(options.pretty).toBe(false);
      expect(options.humanDates).toBe(false);
      expect(options.verbose).toBe(false);
    });
  });

  describe('with config set, no CLI flags', () => {
    it('should use config values for pretty', () => {
      setOutputConfig({ pretty: true });
      const options = resolveOutputOptions({});
      expect(options.pretty).toBe(true);
    });

    it('should use config values for humanDates', () => {
      setOutputConfig({ humanDates: true });
      const options = resolveOutputOptions({});
      expect(options.humanDates).toBe(true);
    });

    it('should use combined config values', () => {
      setOutputConfig({ pretty: true, humanDates: true });
      const options = resolveOutputOptions({});
      expect(options.pretty).toBe(true);
      expect(options.humanDates).toBe(true);
    });
  });

  describe('CLI flags override config', () => {
    it('should allow --pretty to enable when config is false', () => {
      setOutputConfig({ pretty: false });
      const options = resolveOutputOptions({ pretty: true });
      expect(options.pretty).toBe(true);
    });

    it('should allow --no-pretty to disable when config is true', () => {
      setOutputConfig({ pretty: true });
      const options = resolveOutputOptions({ pretty: false });
      expect(options.pretty).toBe(false);
    });

    it('should allow --human-dates to enable when config is false', () => {
      setOutputConfig({ humanDates: false });
      const options = resolveOutputOptions({ humanDates: true });
      expect(options.humanDates).toBe(true);
    });

    it('should allow --iso-dates to disable when config has humanDates', () => {
      setOutputConfig({ humanDates: true });
      const options = resolveOutputOptions({ humanDates: false });
      expect(options.humanDates).toBe(false);
    });

    it('should handle verbose flag', () => {
      const options = resolveOutputOptions({ verbose: true });
      expect(options.verbose).toBe(true);
    });

    it('should handle json flag', () => {
      const options = resolveOutputOptions({ json: true });
      expect(options.json).toBe(true);
    });
  });

  describe('precedence: CLI > Config > Default', () => {
    it('should follow correct precedence chain', () => {
      // Config says pretty, CLI says no-pretty → CLI wins
      setOutputConfig({ pretty: true, humanDates: false });
      const options = resolveOutputOptions({ pretty: false, verbose: true });

      expect(options.pretty).toBe(false); // CLI wins
      expect(options.humanDates).toBe(false); // Config value (CLI undefined)
      expect(options.verbose).toBe(true); // CLI value
    });
  });
});

describe('OutputConfig persistence', () => {
  it('should get and set config correctly', () => {
    const config: OutputConfig = { pretty: true, humanDates: true };
    setOutputConfig(config);
    const retrieved = getOutputConfig();
    expect(retrieved.pretty).toBe(true);
    expect(retrieved.humanDates).toBe(true);
  });

  it('should handle partial config updates', () => {
    setOutputConfig({ pretty: true });
    const config = getOutputConfig();
    expect(config.pretty).toBe(true);
    expect(config.humanDates).toBeUndefined();
  });
});

// ============================================================================
// T-1.2: resolveOutputFormat Tests (Spec 060)
// ============================================================================

describe('resolveOutputFormat (Spec 060)', () => {
  afterEach(() => {
    clearOutputConfigOverride();
  });

  describe('--format flag takes highest priority', () => {
    it('should return explicit format when provided', () => {
      const format = resolveOutputFormat({ format: 'csv' });
      expect(format).toBe('csv');
    });

    it('should return json format', () => {
      const format = resolveOutputFormat({ format: 'json' });
      expect(format).toBe('json');
    });

    it('should return table format', () => {
      const format = resolveOutputFormat({ format: 'table' });
      expect(format).toBe('table');
    });

    it('should return ids format', () => {
      const format = resolveOutputFormat({ format: 'ids' });
      expect(format).toBe('ids');
    });

    it('should return minimal format', () => {
      const format = resolveOutputFormat({ format: 'minimal' });
      expect(format).toBe('minimal');
    });

    it('should return jsonl format', () => {
      const format = resolveOutputFormat({ format: 'jsonl' });
      expect(format).toBe('jsonl');
    });

    it('should prefer --format over legacy --json', () => {
      const format = resolveOutputFormat({ format: 'csv', json: true });
      expect(format).toBe('csv');
    });

    it('should prefer --format over legacy --pretty', () => {
      const format = resolveOutputFormat({ format: 'ids', pretty: true });
      expect(format).toBe('ids');
    });
  });

  describe('legacy --json/--pretty flags (backward compatibility)', () => {
    it('should return json when --json flag is set', () => {
      const format = resolveOutputFormat({ json: true });
      expect(format).toBe('json');
    });

    it('should return table when --pretty flag is set', () => {
      const format = resolveOutputFormat({ pretty: true });
      expect(format).toBe('table');
    });

    it('should prefer --json over --pretty when both set', () => {
      const format = resolveOutputFormat({ json: true, pretty: true });
      expect(format).toBe('json');
    });

    it('should return json when --no-pretty is set (pipe mode)', () => {
      const format = resolveOutputFormat({ pretty: false });
      expect(format).toBe('json');
    });
  });

  describe('SUPERTAG_FORMAT environment variable', () => {
    const originalEnv = process.env.SUPERTAG_FORMAT;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.SUPERTAG_FORMAT;
      } else {
        process.env.SUPERTAG_FORMAT = originalEnv;
      }
    });

    it('should use env var when no CLI flags provided', () => {
      process.env.SUPERTAG_FORMAT = 'csv';
      const format = resolveOutputFormat({});
      expect(format).toBe('csv');
    });

    it('should prefer CLI --format over env var', () => {
      process.env.SUPERTAG_FORMAT = 'csv';
      const format = resolveOutputFormat({ format: 'jsonl' });
      expect(format).toBe('jsonl');
    });

    it('should prefer legacy --json over env var', () => {
      process.env.SUPERTAG_FORMAT = 'csv';
      const format = resolveOutputFormat({ json: true });
      expect(format).toBe('json');
    });

    it('should ignore invalid env var values', () => {
      process.env.SUPERTAG_FORMAT = 'invalid-format';
      const format = resolveOutputFormat({});
      // Should fall through to default, not crash
      expect(['json', 'table']).toContain(format);
    });
  });

  describe('config file format setting', () => {
    it('should use config.format when no CLI flags or env var', () => {
      setOutputConfig({ format: 'minimal' });
      const format = resolveOutputFormat({});
      expect(format).toBe('minimal');
    });

    it('should prefer env var over config file', () => {
      const originalEnv = process.env.SUPERTAG_FORMAT;
      process.env.SUPERTAG_FORMAT = 'jsonl';
      setOutputConfig({ format: 'minimal' });

      const format = resolveOutputFormat({});
      expect(format).toBe('jsonl');

      if (originalEnv === undefined) {
        delete process.env.SUPERTAG_FORMAT;
      } else {
        process.env.SUPERTAG_FORMAT = originalEnv;
      }
    });
  });

  describe('TTY detection for smart defaults', () => {
    it('should return table when stdout is TTY (interactive)', () => {
      // When no options and stdout is a TTY, default to table
      const format = resolveOutputFormat({}, { isTTY: true });
      expect(format).toBe('table');
    });

    it('should return json when stdout is not TTY (piped)', () => {
      // When no options and stdout is piped, default to json
      const format = resolveOutputFormat({}, { isTTY: false });
      expect(format).toBe('json');
    });

    it('should prefer explicit format over TTY detection', () => {
      const format = resolveOutputFormat({ format: 'csv' }, { isTTY: true });
      expect(format).toBe('csv');
    });
  });

  describe('undefined/null handling', () => {
    it('should handle undefined options', () => {
      const format = resolveOutputFormat(undefined as unknown as {});
      // Should return a valid format, not crash
      expect(['json', 'table']).toContain(format);
    });

    it('should handle empty options object', () => {
      const format = resolveOutputFormat({});
      // Should return a valid format based on TTY detection
      expect(['json', 'table']).toContain(format);
    });
  });
});
