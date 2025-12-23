/**
 * Output options resolution and configuration
 *
 * Handles merging of output preferences from:
 * 1. CLI flags (highest priority)
 * 2. Config file (output.pretty, output.humanDates)
 * 3. Built-in defaults (lowest priority)
 */

import { getConfig } from '../config/manager';
import type { OutputOptions } from './format';

/**
 * Output configuration stored in config file
 */
export interface OutputConfig {
  /** Enable pretty output by default */
  pretty?: boolean;
  /** Enable human-readable dates by default */
  humanDates?: boolean;
}

// In-memory override for testing
let testConfigOverride: OutputConfig | undefined;

/**
 * Get output configuration from config file
 */
export function getOutputConfig(): OutputConfig {
  // Use test override if set
  if (testConfigOverride !== undefined) {
    return { ...testConfigOverride };
  }

  try {
    const config = getConfig().getConfig();
    // Output config is stored under 'output' key in config file
    const outputConfig = (config as unknown as Record<string, unknown>).output as OutputConfig | undefined;
    return outputConfig || {};
  } catch {
    // Config not available, return empty
    return {};
  }
}

/**
 * Set output configuration (primarily for testing)
 */
export function setOutputConfig(config: OutputConfig): void {
  testConfigOverride = config;
}

/**
 * Clear test override (for cleanup)
 */
export function clearOutputConfigOverride(): void {
  testConfigOverride = undefined;
}

/**
 * Resolve output options from CLI flags and config
 *
 * Precedence: CLI flags > Config file > Built-in defaults
 *
 * @param cliFlags - Options from command line
 * @returns Resolved output options
 *
 * @example
 * // Config has pretty: true, CLI has --no-pretty
 * resolveOutputOptions({ pretty: false }) // => { pretty: false, ... }
 *
 * @example
 * // Config has nothing, CLI has nothing
 * resolveOutputOptions({}) // => { pretty: false, humanDates: false, ... }
 */
export function resolveOutputOptions(cliFlags: Partial<OutputOptions>): OutputOptions {
  const config = getOutputConfig();

  return {
    // CLI flag overrides config, config overrides default (false)
    pretty: cliFlags.pretty ?? config.pretty ?? false,
    humanDates: cliFlags.humanDates ?? config.humanDates ?? false,
    verbose: cliFlags.verbose ?? false,
    json: cliFlags.json ?? false,
  };
}
