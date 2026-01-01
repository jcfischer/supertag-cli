---
feature: "Unified Logger"
spec: "./spec.md"
status: "completed"
---

# Technical Plan: Unified Logger

## Architecture Overview

A lightweight logging utility that respects output modes (json/pretty/unix) and provides consistent log levels across all commands. Integrates with the existing `output-formatter.ts` infrastructure.

```
                    ┌─────────────────────────────────────┐
                    │         CLI Entry Point             │
                    │  (src/index.ts, src/cli/*.ts)       │
                    └──────────────┬──────────────────────┘
                                   │
                         configureGlobalLogger()
                                   │
                    ┌──────────────▼──────────────────────┐
                    │         LoggerConfig                │
                    │  { mode, level, verbose, stream }   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │           Logger                    │
                    │                                     │
                    │  ┌─────────────────────────────┐   │
                    │  │ debug() info() warn() error()│   │
                    │  └─────────────────────────────┘   │
                    │                │                   │
                    │       ┌────────┴────────┐          │
                    │       │   shouldLog()   │          │
                    │       └────────┬────────┘          │
                    │                │                   │
                    │       ┌────────▼────────┐          │
                    │       │    format()     │          │
                    │       └────────┬────────┘          │
                    │                │                   │
                    │    ┌───────────┼───────────┐       │
                    │    │           │           │       │
                    │ pretty       unix        json      │
                    │ (emoji)    ([LEVEL])  (struct)     │
                    │                                    │
                    └──────────────┬─────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │         Output Streams              │
                    │  stdout (default) / stderr (errors) │
                    │  stderr (always in json mode)       │
                    └─────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Output Modes | Unix/Pretty/JSON | Matches existing output-formatter.ts |
| Streams | Native Node streams | Stream injection for testing |

## Constitutional Compliance

- [x] **CLI-First:** Logger integrates with CLI via `--verbose` flag support
- [x] **Library-First:** `createLogger()` is reusable, `getGlobalLogger()` for convenience
- [x] **Test-First:** Stream injection enables capturing output in tests
- [x] **Deterministic:** Log levels and formatting are predictable
- [x] **Code Before Prompts:** Pure TypeScript, no AI/prompts

## Data Model

### Entities

```typescript
/**
 * Log level severity
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

### Database Schema

No database changes required.

## API Contracts

### Internal APIs

```typescript
/**
 * Create a logger instance
 */
export function createLogger(config: LoggerConfig): Logger;

/**
 * Configure the global logger (called at CLI entry)
 */
export function configureGlobalLogger(config: LoggerConfig): void;

/**
 * Get the global logger instance
 * @throws Error if not configured
 */
export function getGlobalLogger(): Logger;

/**
 * Check if global logger is configured (for optional logging)
 */
export function hasGlobalLogger(): boolean;
```

## Implementation Strategy

### Phase 1: Foundation

Core logger implementation with TDD.

- [ ] Define TypeScript interfaces (LogLevel, LoggerConfig, Logger)
- [ ] Implement LoggerImpl class with level filtering
- [ ] Implement format() for all three modes (pretty/unix/json)
- [ ] Add stream injection for testability
- [ ] Write unit tests

### Phase 2: Global Logger

Global logger pattern for convenient access across codebase.

- [ ] Implement configureGlobalLogger()
- [ ] Implement getGlobalLogger() with error if not configured
- [ ] Implement hasGlobalLogger() for optional checks
- [ ] Add child logger support (prefix chaining)
- [ ] Write tests for global logger

### Phase 3: Integration

Wire into CLI and migrate existing logging.

- [ ] Add configureGlobalLogger() to src/index.ts
- [ ] Add configureGlobalLogger() to src/cli/tana-export.ts
- [ ] Re-export from src/utils/index.ts (if exists)
- [ ] Update documentation

## File Structure

```
src/
├── utils/
│   ├── output-formatter.ts   # [Existing] Uses OutputMode type
│   ├── logger.ts             # [New] Logger implementation
│   └── index.ts              # [Modified] Re-export logger

tests/
└── logger.test.ts            # [New] Unit tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing console.log patterns | Low | Low | Logger is additive, not replacing |
| JSON mode polluting stdout | Medium | Low | stderr used in json mode |
| Verbose flag inconsistency | Low | Low | Centralized verbose handling |
| Performance overhead | Low | Low | isEnabled() check is O(1) |

## Dependencies

### External

None - uses only built-in Bun/Node APIs.

### Internal

- `src/utils/output-formatter.ts` - Uses same `OutputMode` type and `resolveOutputMode()`

## Migration/Deployment

### Compatibility Considerations

The logger is designed as an additive feature:
- Existing `console.log` calls continue to work
- Migration is incremental - commands can adopt logger one at a time
- No breaking changes to existing behavior

### Migration Steps

1. No database migrations needed
2. No environment variables needed
3. No breaking changes

### Future Migration (Out of Scope)

Once logger is stable, a future spec could migrate existing console.log calls:
- ~20+ files with manual verbose checks
- ~60 lines of duplicated patterns

This plan only covers creating the logger utility, not migrating existing code.

## Estimated Complexity

- **New files:** 1 (`src/utils/logger.ts`)
- **Modified files:** 1-2 (`src/index.ts`, optionally `src/utils/index.ts`)
- **Test files:** 1 (`tests/logger.test.ts`)
- **Estimated tasks:** 6-8
- **Lines of code:** ~150 (logger) + ~120 (tests)
