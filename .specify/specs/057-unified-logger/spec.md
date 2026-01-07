---
id: "057"
feature: "Unified Logger"
status: "completed"
created: "2025-12-30"
completed: "2026-01-01"
priority: "low"
---

# Specification: Unified Logger

**Priority**: Low (~60 LOC saved, improved consistency)

## Overview

This specification defines a unified logging interface that respects output mode settings (json vs pretty vs unix) and provides consistent verbose/debug output across all commands and services.

## Problem Statement

### Current State: Inconsistent Logging

Logging is handled differently across the codebase:

```typescript
// Pattern 1: Direct console.log (most common)
console.log('Processing workspace...');
console.error('Error: ' + error.message);

// Pattern 2: Conditional verbose output
if (options.verbose) {
  console.log('[verbose] Loading config from', path);
}

// Pattern 3: Debug with prefix
const DEBUG = process.env.DEBUG === 'true';
if (DEBUG) console.log('[debug]', data);

// Pattern 4: Emoji-prefixed output
console.log('✓ Sync complete');
console.error('✗ Failed to connect');
```

### Duplication Statistics

- **~60 lines** of duplicated logging patterns
- **~20+ files** with manual verbose checks
- **Inconsistent prefixes** (`[verbose]`, `[debug]`, `[INFO]`, etc.)
- **No JSON mode support** - Logs break JSON output

### Issues

1. **Breaks JSON output** - `console.log` in middle of JSON response
2. **Inconsistent verbose** - Different commands handle `--verbose` differently
3. **No log levels** - Can't filter by severity
4. **Hard to test** - No way to capture/mock logs

## Proposed Solution

### New Module: `src/utils/logger.ts`

A simple, mode-aware logger that:

1. Respects output mode (json mode suppresses logs to stderr)
2. Provides consistent log levels (debug, info, warn, error)
3. Handles verbose flag consistently
4. Supports structured logging for JSON mode

## Interface Design

### Core Types

```typescript
/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output (default: 'info') */
  level: LogLevel;

  /** Output mode affects formatting */
  mode: 'pretty' | 'unix' | 'json';

  /** Enable verbose output (sets level to 'debug') */
  verbose?: boolean;

  /** Output stream (default: stderr in json mode, stdout otherwise) */
  stream?: NodeJS.WriteStream;
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
```

### createLogger()

```typescript
/**
 * Create a logger instance
 *
 * @param config - Logger configuration
 * @returns Logger instance
 *
 * @example
 * // Basic usage
 * const log = createLogger({ mode: 'pretty', level: 'info' });
 * log.info('Processing started');
 * log.debug('Details', { count: 42 }); // Not shown (level is info)
 *
 * @example
 * // Verbose mode
 * const log = createLogger({ mode: 'pretty', verbose: true });
 * log.debug('This will show'); // Shown because verbose=true
 *
 * @example
 * // JSON mode (logs to stderr)
 * const log = createLogger({ mode: 'json', level: 'warn' });
 * log.info('This goes to stderr'); // Won't pollute JSON stdout
 */
export function createLogger(config: LoggerConfig): Logger;
```

### getGlobalLogger()

```typescript
/**
 * Get the global logger instance
 *
 * Must call configureGlobalLogger() first.
 *
 * @returns Global logger instance
 * @throws Error if not configured
 */
export function getGlobalLogger(): Logger;

/**
 * Configure the global logger
 *
 * @param config - Logger configuration
 */
export function configureGlobalLogger(config: LoggerConfig): void;
```

## Implementation Details

### Logger Implementation

```typescript
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_EMOJI: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️ ',
  warn: '⚠️ ',
  error: '❌',
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: '[DEBUG]',
  info: '[INFO]',
  warn: '[WARN]',
  error: '[ERROR]',
};

class LoggerImpl implements Logger {
  private config: LoggerConfig;
  private prefix: string;
  private minLevel: number;

  constructor(config: LoggerConfig, prefix = '') {
    this.config = config;
    this.prefix = prefix;
    this.minLevel = LEVEL_PRIORITY[config.verbose ? 'debug' : config.level];
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= this.minLevel;
  }

  private format(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const fullMessage = this.prefix ? `[${this.prefix}] ${message}` : message;

    switch (this.config.mode) {
      case 'json':
        return JSON.stringify({
          level,
          message: fullMessage,
          ...(data && { data }),
          timestamp: new Date().toISOString(),
        });

      case 'pretty':
        const emoji = LEVEL_EMOJI[level];
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        return `${emoji} ${fullMessage}${dataStr}`;

      case 'unix':
      default:
        const prefix = LEVEL_PREFIX[level];
        const dataStrUnix = data ? `\t${JSON.stringify(data)}` : '';
        return `${prefix} ${fullMessage}${dataStrUnix}`;
    }
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.format(level, message, data);

    // In JSON mode, all logs go to stderr to not pollute stdout
    // Errors always go to stderr
    const stream = this.config.mode === 'json' || level === 'error'
      ? process.stderr
      : (this.config.stream ?? process.stdout);

    stream.write(formatted + '\n');
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  isEnabled(level: LogLevel): boolean {
    return this.shouldLog(level);
  }

  child(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new LoggerImpl(this.config, childPrefix);
  }
}

export function createLogger(config: LoggerConfig): Logger {
  return new LoggerImpl(config);
}

// Global logger
let globalLogger: Logger | null = null;

export function configureGlobalLogger(config: LoggerConfig): void {
  globalLogger = createLogger(config);
}

export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    throw new Error('Global logger not configured. Call configureGlobalLogger() first.');
  }
  return globalLogger;
}
```

## Migration Targets

### Files to Update

| File | Current Pattern | New Pattern |
|------|-----------------|-------------|
| `src/commands/*.ts` | `if (verbose) console.log()` | `log.debug()` |
| `src/mcp/*.ts` | `console.error()` | `log.error()` |
| `src/services/*.ts` | Manual debug checks | `log.debug()` |
| CLI entry points | N/A | `configureGlobalLogger()` |

### Before/After Example

**Before**:
```typescript
export async function syncCommand(options: SyncOptions) {
  const DEBUG = options.verbose || process.env.DEBUG === 'true';

  if (DEBUG) {
    console.log('[verbose] Starting sync...');
  }

  console.log('Syncing workspace...');

  try {
    // ... sync logic
    if (DEBUG) {
      console.log('[verbose] Processed', count, 'nodes');
    }
    console.log('✓ Sync complete');
  } catch (error) {
    console.error('✗ Sync failed:', error.message);
    throw error;
  }
}
```

**After**:
```typescript
export async function syncCommand(options: SyncOptions) {
  const log = getGlobalLogger().child('sync');

  log.debug('Starting sync...');
  log.info('Syncing workspace...');

  try {
    // ... sync logic
    log.debug('Processed nodes', { count });
    log.info('Sync complete');
  } catch (error) {
    log.error('Sync failed', { error: error.message });
    throw error;
  }
}
```

### CLI Entry Point Setup

```typescript
// src/index.ts
import { configureGlobalLogger } from './utils/logger';
import { resolveOutputMode } from './utils/output-formatter';

// Configure logger based on CLI options
const mode = resolveOutputMode(globalOptions);
configureGlobalLogger({
  mode,
  level: 'info',
  verbose: globalOptions.verbose,
});
```

## Output Examples

### Pretty Mode (Default)

```
ℹ️  Syncing workspace...
🔍 Loading 1,234 nodes
🔍 Processed nodes {"count": 1234}
ℹ️  Sync complete
```

### Unix Mode

```
[INFO] Syncing workspace...
[DEBUG] Loading 1,234 nodes
[DEBUG] Processed nodes	{"count":1234}
[INFO] Sync complete
```

### JSON Mode (to stderr)

```json
{"level":"info","message":"Syncing workspace...","timestamp":"2025-12-30T10:00:00.000Z"}
{"level":"debug","message":"Loading 1,234 nodes","timestamp":"2025-12-30T10:00:00.100Z"}
{"level":"info","message":"Sync complete","timestamp":"2025-12-30T10:00:01.000Z"}
```

## Testing Strategy

### Unit Tests

```typescript
import { describe, it, expect } from 'bun:test';
import { createLogger } from './logger';
import { Writable } from 'stream';

function captureStream(): { stream: Writable; getOutput: () => string } {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    }
  });
  return { stream: stream as any, getOutput: () => output };
}

describe('Logger', () => {
  describe('log levels', () => {
    it('should respect log level', () => {
      const { stream, getOutput } = captureStream();
      const log = createLogger({ mode: 'unix', level: 'warn', stream });

      log.debug('debug');
      log.info('info');
      log.warn('warn');
      log.error('error');

      const output = getOutput();
      expect(output).not.toContain('debug');
      expect(output).not.toContain('info');
      expect(output).toContain('warn');
      expect(output).toContain('error');
    });

    it('should enable debug with verbose', () => {
      const { stream, getOutput } = captureStream();
      const log = createLogger({ mode: 'unix', level: 'info', verbose: true, stream });

      log.debug('debug message');

      expect(getOutput()).toContain('debug message');
    });
  });

  describe('output modes', () => {
    it('should format pretty with emojis', () => {
      const { stream, getOutput } = captureStream();
      const log = createLogger({ mode: 'pretty', level: 'info', stream });

      log.info('test message');

      expect(getOutput()).toContain('ℹ️');
      expect(getOutput()).toContain('test message');
    });

    it('should format unix with brackets', () => {
      const { stream, getOutput } = captureStream();
      const log = createLogger({ mode: 'unix', level: 'info', stream });

      log.info('test message');

      expect(getOutput()).toContain('[INFO]');
      expect(getOutput()).toContain('test message');
    });

    it('should format json as structured', () => {
      const { stream, getOutput } = captureStream();
      const log = createLogger({ mode: 'json', level: 'info', stream });

      log.info('test message', { count: 42 });

      const parsed = JSON.parse(getOutput().trim());
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('test message');
      expect(parsed.data.count).toBe(42);
    });
  });

  describe('child loggers', () => {
    it('should prefix child messages', () => {
      const { stream, getOutput } = captureStream();
      const log = createLogger({ mode: 'unix', level: 'info', stream });
      const child = log.child('sync');

      child.info('message');

      expect(getOutput()).toContain('[sync]');
    });

    it('should nest child prefixes', () => {
      const { stream, getOutput } = captureStream();
      const log = createLogger({ mode: 'unix', level: 'info', stream });
      const child = log.child('sync').child('db');

      child.info('message');

      expect(getOutput()).toContain('[sync:db]');
    });
  });

  describe('isEnabled', () => {
    it('should return true for enabled levels', () => {
      const log = createLogger({ mode: 'unix', level: 'warn' });

      expect(log.isEnabled('debug')).toBe(false);
      expect(log.isEnabled('info')).toBe(false);
      expect(log.isEnabled('warn')).toBe(true);
      expect(log.isEnabled('error')).toBe(true);
    });
  });
});
```

## Success Criteria

1. **Mode-aware output** - JSON mode logs to stderr
2. **Consistent verbose** - Same behavior across all commands
3. **Structured logging** - Data attached to log messages
4. **Child loggers** - Prefixed loggers for subsystems
5. **Testable** - Stream injection for testing
6. **~60 lines saved** - Eliminated manual verbose checks

## Out of Scope

- Log file output (can be added via stream config)
- Log rotation
- Remote logging services
- Performance metrics

## Dependencies

- **Output Formatter Consolidation** - For `resolveOutputMode()`

## Related Specs

- **Output Formatter Consolidation** - Logger respects same output modes
