---
feature: "Unified Workspace Resolver"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Unified Workspace Resolver

## Architecture Overview

This plan consolidates workspace resolution logic into a single, well-tested module. The existing `resolveWorkspace()` function in `src/config/paths.ts` provides the core logic; this plan wraps it with consistent error handling, caching, and a cleaner API.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Consumer Commands/Tools                       │
│  (search, stats, create, embed, MCP tools, export commands)      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ resolveWorkspaceContext()
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              src/config/workspace-resolver.ts                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  resolveWorkspaceContext(options?)  ← Main entry point      │ │
│  │  listAvailableWorkspaces()          ← List helper           │ │
│  │  getDefaultWorkspace()              ← Default helper        │ │
│  │  withWorkspace(opts, fn)            ← Callback pattern      │ │
│  │  clearWorkspaceCache()              ← Cache management      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                               │                                  │
│  ┌────────────────────────────┴────────────────────────────────┐ │
│  │  Error Types:                                               │ │
│  │  - WorkspaceNotFoundError                                   │ │
│  │  - WorkspaceDatabaseMissingError                            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                               │                                  │
│  ┌────────────────────────────┴────────────────────────────────┐ │
│  │  Cache: Map<string, ResolvedWorkspace>                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Uses internally
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              src/config/paths.ts (existing)                      │
│  resolveWorkspace() - Core resolution logic (keep as-is)         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              src/config/manager.ts (existing)                    │
│  ConfigManager.getInstance().getConfig()                         │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Testing | bun:test | Existing test framework |
| Database | SQLite (existing) | No database changes needed |

## Constitutional Compliance

- [x] **CLI-First:** Library module enabling CLI commands - exposes no CLI itself but enables consistent CLI behavior across all commands
- [x] **Library-First:** Pure TypeScript module with no side effects, importable by CLI, Export CLI, and MCP Server
- [x] **Test-First:** TDD - write error type tests, then resolver tests, then integration tests before implementation
- [x] **Deterministic:** Pure functions with optional caching; cache can be cleared; no probabilistic behavior
- [x] **Code Before Prompts:** All logic in TypeScript code, no prompts involved

## Data Model

### Entities

```typescript
/**
 * Resolved workspace context - everything needed to work with a workspace
 */
export interface ResolvedWorkspace {
  /** Workspace alias (e.g., 'main', 'books') */
  alias: string;
  /** Full workspace configuration from config file */
  config: WorkspaceConfig;
  /** Absolute path to SQLite database */
  dbPath: string;
  /** Whether this is the default workspace */
  isDefault: boolean;
}

/**
 * Options for workspace resolution
 */
export interface ResolveOptions {
  /** Workspace alias (uses default if not provided) */
  workspace?: string;
  /** Require database to exist (default: true) */
  requireDatabase?: boolean;
  /** Custom config override (for testing) */
  config?: TanaConfig;
}
```

### Database Schema

No database changes required. This module uses existing workspace configuration and database paths.

## API Contracts

### Internal APIs

```typescript
// Main resolver - throws on errors
function resolveWorkspaceContext(options?: ResolveOptions): ResolvedWorkspace

// List all configured workspaces
function listAvailableWorkspaces(config?: TanaConfig): string[]

// Get default workspace alias
function getDefaultWorkspace(config?: TanaConfig): string

// Callback pattern for workspace operations
function withWorkspace<T>(
  options: ResolveOptions | undefined,
  fn: (workspace: ResolvedWorkspace) => T | Promise<T>
): Promise<T>

// Cache management (for MCP server request boundaries)
function clearWorkspaceCache(): void
```

### Error Types

```typescript
// Thrown when workspace alias not found in config
class WorkspaceNotFoundError extends Error {
  readonly alias: string;
  readonly availableWorkspaces: string[];
}

// Thrown when requireDatabase=true and database file missing
class WorkspaceDatabaseMissingError extends Error {
  readonly alias: string;
  readonly dbPath: string;
}
```

## Implementation Strategy

### Phase 1: Foundation (TDD)

Create error types and core resolver with comprehensive tests.

- [ ] Create `src/config/workspace-resolver.ts` with error types
- [ ] Write failing tests for `WorkspaceNotFoundError`
- [ ] Write failing tests for `WorkspaceDatabaseMissingError`
- [ ] Implement error types
- [ ] Write failing tests for `resolveWorkspaceContext()`
- [ ] Write failing tests for `listAvailableWorkspaces()`
- [ ] Write failing tests for `getDefaultWorkspace()`
- [ ] Implement core resolver functions
- [ ] Write failing tests for cache behavior
- [ ] Implement caching with `clearWorkspaceCache()`

### Phase 2: Core Features

Add helper functions and integrate with existing code.

- [ ] Write failing tests for `withWorkspace()` callback pattern
- [ ] Implement `withWorkspace()`
- [ ] Export from `src/config/index.ts`
- [ ] Update `src/commands/helpers.ts` to use new resolver
- [ ] Verify existing `resolveDbPath()` and `checkDb()` still work

### Phase 3: Migration

Migrate commands to use new resolver (can be done incrementally).

- [ ] Migrate `src/commands/search.ts`
- [ ] Migrate `src/commands/stats.ts`
- [ ] Migrate `src/commands/nodes.ts`
- [ ] Migrate `src/commands/tags.ts`
- [ ] Migrate `src/commands/embed.ts`
- [ ] Migrate `src/commands/create.ts`
- [ ] Migrate `src/commands/sync.ts` (with requireDatabase: false)
- [ ] Migrate `src/mcp/tools/search.ts`
- [ ] Migrate `src/mcp/tools/create.ts`
- [ ] Migrate `src/mcp/tools/query.ts`
- [ ] Migrate `src/export/commands/*.ts`
- [ ] Add `clearWorkspaceCache()` to MCP request handler

### Phase 4: Cleanup

Remove obsolete code and update documentation.

- [ ] Remove redundant workspace resolution from `helpers.ts` if fully superseded
- [ ] Update CLAUDE.md with new pattern
- [ ] Run full test suite
- [ ] Rebuild binary

## File Structure

```
src/
├── config/
│   ├── workspace-resolver.ts   # [New] Main resolver module
│   ├── index.ts                # [Modified] Export new module
│   ├── paths.ts                # [Unchanged] Existing resolveWorkspace
│   └── manager.ts              # [Unchanged] ConfigManager
├── commands/
│   ├── helpers.ts              # [Modified] Use new resolver
│   ├── search.ts               # [Modified] Use new resolver
│   ├── stats.ts                # [Modified] Use new resolver
│   ├── nodes.ts                # [Modified] Use new resolver
│   ├── tags.ts                 # [Modified] Use new resolver
│   ├── embed.ts                # [Modified] Use new resolver
│   ├── create.ts               # [Modified] Use new resolver
│   ├── sync.ts                 # [Modified] Use new resolver
│   └── workspace.ts            # [Modified] Use listAvailableWorkspaces
├── mcp/
│   ├── index.ts                # [Modified] Add cache clear on request
│   └── tools/
│       ├── search.ts           # [Modified] Use new resolver
│       ├── create.ts           # [Modified] Use new resolver
│       └── query.ts            # [Modified] Use new resolver
└── export/
    └── commands/
        └── *.ts                # [Modified] Use new resolver

tests/
├── workspace-resolver.test.ts  # [New] Unit tests for resolver
└── workspace-integration.test.ts # [New] Integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing commands | High | Low | Comprehensive test suite, incremental migration |
| Cache stale data | Medium | Low | Explicit cache clear API, document when to clear |
| Error message inconsistency | Low | Medium | Test error messages explicitly |
| Performance regression | Low | Low | Caching actually improves performance |

## Dependencies

### External

None - uses only built-in Node/Bun APIs.

### Internal

- `src/config/paths.ts` - Uses existing `resolveWorkspace()` function
- `src/config/manager.ts` - Uses `ConfigManager` for config access
- `src/types.ts` - Uses existing `WorkspaceConfig`, `TanaConfig` types

## Migration/Deployment

- [ ] **Database migrations:** Not needed
- [ ] **Environment variables:** Not needed
- [ ] **Breaking changes:** None - internal refactoring only

Migration is backward compatible:
1. New module can be added without changing existing behavior
2. Commands can be migrated one at a time
3. Old patterns continue to work during migration
4. No user-facing changes

## Estimated Complexity

- **New files:** 1 (`src/config/workspace-resolver.ts`)
- **Modified files:** ~15 (commands, MCP tools, exports)
- **Test files:** 2 (`workspace-resolver.test.ts`, `workspace-integration.test.ts`)
- **Estimated tasks:** ~20

## Relationship to Existing Code

### Existing `resolveWorkspace()` in `paths.ts`

The existing function handles:
- Alias lookup
- Node ID / root file ID resolution
- Legacy mode compatibility
- Default workspace fallback

**This plan wraps (not replaces) the existing function**, adding:
- Consistent error types
- Database existence checking
- Caching
- Helper functions

### Existing Helpers in `helpers.ts`

Current helpers:
- `resolveDbPath()` - Returns database path, uses `resolveWorkspace()`
- `checkDb()` - Checks if DB exists, prints error

**Migration path:**
1. Phase 1-2: Keep helpers working with new resolver internally
2. Phase 3: Migrate commands to use new resolver directly
3. Phase 4: Evaluate if helpers are still needed or can be deprecated
