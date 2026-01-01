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
import type { OutputFormat } from './output-formatter';

/**
 * Valid output formats for validation
 */
const VALID_FORMATS: OutputFormat[] = ['json', 'table', 'csv', 'ids', 'minimal', 'jsonl'];

/**
 * Output configuration stored in config file
 */
export interface OutputConfig {
  /** Enable pretty output by default */
  pretty?: boolean;
  /** Enable human-readable dates by default */
  humanDates?: boolean;
  /** Default output format (Spec 060) */
  format?: OutputFormat;
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

// ============================================================================
// Output Format Resolution (Spec 060)
// ============================================================================

/**
 * Options for resolving output format
 */
export interface ResolveFormatOptions {
  /** Explicit --format flag value */
  format?: OutputFormat | string;
  /** Legacy --json flag */
  json?: boolean;
  /** Legacy --pretty flag */
  pretty?: boolean;
}

/**
 * Context for output format resolution
 */
export interface ResolveFormatContext {
  /** Whether stdout is a TTY (interactive terminal) */
  isTTY?: boolean;
}

/**
 * Resolve output format from CLI flags, env var, config, and TTY detection
 *
 * Precedence (highest to lowest):
 * 1. Explicit --format flag
 * 2. Legacy --json/--pretty flags (backward compatibility)
 * 3. SUPERTAG_FORMAT environment variable
 * 4. Config file format setting
 * 5. TTY detection (table for interactive, json for pipes)
 *
 * @param options - CLI options including format, json, pretty
 * @param context - Context including TTY detection
 * @returns Resolved output format
 *
 * @example
 * resolveOutputFormat({ format: 'csv' })  // => 'csv'
 * resolveOutputFormat({ json: true })     // => 'json' (legacy)
 * resolveOutputFormat({}, { isTTY: true }) // => 'table' (default for terminal)
 * resolveOutputFormat({}, { isTTY: false }) // => 'json' (default for pipes)
 */
export function resolveOutputFormat(
  options?: ResolveFormatOptions,
  context?: ResolveFormatContext
): OutputFormat {
  // Handle undefined/null options
  if (!options) {
    options = {};
  }

  // 1. Explicit --format flag (highest priority)
  if (options.format !== undefined) {
    const format = options.format as OutputFormat;
    if (VALID_FORMATS.includes(format)) {
      return format;
    }
    // Invalid format falls through to other resolution methods
  }

  // 2. Legacy --json flag (backward compatibility)
  if (options.json === true) {
    return 'json';
  }

  // 3. Legacy --pretty flag (backward compatibility)
  // --pretty => table, --no-pretty (pretty: false) => json (pipe mode)
  if (options.pretty === true) {
    return 'table';
  }
  if (options.pretty === false) {
    return 'json';
  }

  // 4. SUPERTAG_FORMAT environment variable
  const envFormat = process.env.SUPERTAG_FORMAT;
  if (envFormat && VALID_FORMATS.includes(envFormat as OutputFormat)) {
    return envFormat as OutputFormat;
  }

  // 5. Config file format setting
  const config = getOutputConfig();
  if (config.format && VALID_FORMATS.includes(config.format)) {
    return config.format;
  }

  // 6. TTY detection (smart defaults)
  // Default: table for interactive terminal, json for pipes
  const isTTY = context?.isTTY ?? process.stdout.isTTY ?? false;
  return isTTY ? 'table' : 'json';
}
