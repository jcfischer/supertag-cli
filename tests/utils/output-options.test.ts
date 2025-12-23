/**
 * Tests for output options resolution
 * TDD: Write tests FIRST, then implement
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  resolveOutputOptions,
  getOutputConfig,
  setOutputConfig,
  type OutputConfig,
} from '../../src/utils/output-options';

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
