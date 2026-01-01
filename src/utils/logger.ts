/**
 * Unified Logger
 *
 * A lightweight logging utility that respects output modes (json/pretty/unix)
 * and provides consistent log levels across all commands.
 *
 * Spec: 057-unified-logger
 */

/**
 * Log level severity
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output (default: 'info') */
  level: LogLevel;

  /** Output mode affects formatting */
  mode: "pretty" | "unix" | "json";

  /** Enable verbose output (sets level to 'debug') */
  verbose?: boolean;

  /** Output stream (default: stderr in json mode, stdout otherwise) */
  stream?: NodeJS.WritableStream;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;

  /** Check if level is enabled */
  isEnabled(level: LogLevel): boolean;

  /** Create child logger with prefix */
  child(prefix: string): Logger;
}

// Level priority for filtering (higher = more severe)
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Emoji icons for pretty mode
const PRETTY_ICONS: Record<LogLevel, string> = {
  debug: "\u{1F50D}", // magnifying glass
  info: "\u2139\uFE0F", // info symbol
  warn: "\u26A0\uFE0F", // warning sign
  error: "\u274C", // red X
};

/**
 * Logger implementation
 */
class LoggerImpl implements Logger {
  private readonly minLevel: LogLevel;
  private readonly mode: "pretty" | "unix" | "json";
  private readonly stream: NodeJS.WritableStream;
  private readonly prefix: string;

  constructor(config: LoggerConfig, prefix: string = "") {
    // Verbose flag overrides level to debug
    this.minLevel = config.verbose ? "debug" : config.level;
    this.mode = config.mode;
    this.prefix = prefix;

    // Default stream: stderr for json mode (keeps stdout clean for data),
    // stdout otherwise
    this.stream = config.stream ?? (config.mode === "json" ? process.stderr : process.stdout);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  isEnabled(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  child(prefix: string): Logger {
    const newPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new LoggerImpl(
      {
        level: this.minLevel,
        mode: this.mode,
        stream: this.stream,
      },
      newPrefix
    );
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.isEnabled(level)) {
      return;
    }

    const formatted = this.format(level, message, data);
    this.stream.write(formatted + "\n");
  }

  private format(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    switch (this.mode) {
      case "pretty":
        return this.formatPretty(level, message, data);
      case "unix":
        return this.formatUnix(level, message, data);
      case "json":
        return this.formatJson(level, message, data);
    }
  }

  private formatPretty(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const icon = PRETTY_ICONS[level];
    const prefixPart = this.prefix ? `[${this.prefix}] ` : "";
    const dataPart = data ? ` ${JSON.stringify(data)}` : "";
    return `${icon} ${prefixPart}${message}${dataPart}`;
  }

  private formatUnix(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const levelTag = `[${level.toUpperCase()}]`;
    const prefixPart = this.prefix ? `[${this.prefix}]\t` : "";
    const dataPart = data
      ? "\t" + Object.entries(data).map(([k, v]) => `${k}=${v}`).join("\t")
      : "";
    return `${levelTag}\t${prefixPart}${message}${dataPart}`;
  }

  private formatJson(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (this.prefix) {
      entry.prefix = this.prefix;
    }

    if (data) {
      entry.data = data;
    }

    return JSON.stringify(entry);
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

/**
 * Create a logger instance
 */
export function createLogger(config: LoggerConfig): Logger {
  return new LoggerImpl(config);
}

/**
 * Configure the global logger (called at CLI entry)
 */
export function configureGlobalLogger(config: LoggerConfig): void {
  globalLogger = new LoggerImpl(config);
}

/**
 * Get the global logger instance
 * @throws Error if not configured
 */
export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    throw new Error("Global logger not configured. Call configureGlobalLogger() first.");
  }
  return globalLogger;
}

/**
 * Check if global logger is configured (for optional logging)
 */
export function hasGlobalLogger(): boolean {
  return globalLogger !== null;
}

/**
 * Reset global logger (for testing)
 */
export function resetGlobalLogger(): void {
  globalLogger = null;
}
