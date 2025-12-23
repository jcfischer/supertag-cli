---
feature: "Input API Consolidation"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Input API Consolidation

## Architecture Overview

Extract shared node creation logic into a new `services/node-builder.ts` module that both CLI and MCP consume. The module follows a functional approach with clear separation between validation, building, and execution.

```
┌─────────────────────────────────────────────────────────────────┐
│                      BEFORE (Current)                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐     ┌─────────────────────┐           │
│  │ commands/create.ts  │     │ mcp/tools/create.ts │           │
│  │  (480 lines)        │     │  (160 lines)        │           │
│  │                     │     │                     │           │
│  │ - parseSupertagInput│     │ - parseSupertagInput│           │
│  │ - buildChildren     │     │ - buildChildren     │           │
│  │ - validateSupertag  │     │ - validateSupertag  │           │
│  │ - buildPayload      │     │ - buildPayload      │           │
│  │ - dryRun logic      │     │ - dryRun logic      │           │
│  │ - postToApi         │     │ - postToApi         │           │
│  └──────────┬──────────┘     └──────────┬──────────┘           │
│             │                           │                       │
│             └───────────┬───────────────┘                       │
│                         ▼                                       │
│              ┌─────────────────────┐                            │
│              │   api/client.ts     │                            │
│              │   schema/registry   │                            │
│              └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       AFTER (Target)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐     ┌─────────────────────┐           │
│  │ commands/create.ts  │     │ mcp/tools/create.ts │           │
│  │  (~200 lines)       │     │  (~60 lines)        │           │
│  │                     │     │                     │           │
│  │ - CLI I/O handling  │     │ - MCP input parsing │           │
│  │ - verbose output    │     │ - result formatting │           │
│  │ - exit codes        │     │                     │           │
│  └──────────┬──────────┘     └──────────┬──────────┘           │
│             │                           │                       │
│             └───────────┬───────────────┘                       │
│                         ▼                                       │
│              ┌─────────────────────────────┐                    │
│              │  services/node-builder.ts   │  ← NEW             │
│              │  (~150 lines)               │                    │
│              │                             │                    │
│              │  - validateSupertags()      │                    │
│              │  - buildChildren()          │                    │
│              │  - buildNodePayload()       │                    │
│              │  - createNode()             │                    │
│              └──────────────┬──────────────┘                    │
│                             ▼                                   │
│              ┌─────────────────────┐                            │
│              │   api/client.ts     │                            │
│              │   schema/registry   │                            │
│              └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, existing codebase |
| Testing | bun:test | Existing test framework |
| Types | Zod | Existing schema validation |

## Constitutional Compliance

- [x] **CLI-First:** Existing CLI interface preserved, no changes to user commands
- [x] **Library-First:** New `services/node-builder.ts` is a reusable module with no I/O dependencies
- [x] **Test-First:** TDD approach - write tests for shared module before extracting code
- [x] **Deterministic:** No LLM calls, no probabilistic behavior in node building
- [x] **Code Before Prompts:** All logic in TypeScript, no prompts involved

## Data Model

### Input Types

```typescript
/**
 * Child node input - unified format for both CLI and MCP
 */
export interface ChildNodeInput {
  /** Child node name (may contain inline refs with <span>) */
  name: string;
  /** Optional node ID for reference type */
  id?: string;
  /** Data type: 'url' for clickable links, 'reference' for node refs */
  dataType?: 'url' | 'reference';
}

/**
 * Node creation input - unified options for both CLI and MCP
 */
export interface CreateNodeInput {
  /** Supertag name(s) - single or comma-separated */
  supertag: string;
  /** Node name/title */
  name: string;
  /** Field values as key-value pairs */
  fields?: Record<string, string | string[]>;
  /** Child nodes */
  children?: ChildNodeInput[];
  /** Target node ID (INBOX, SCHEMA, or specific ID) */
  target?: string;
  /** Validate only, don't post */
  dryRun?: boolean;
}

/**
 * Node creation result - unified response for both CLI and MCP
 */
export interface CreateNodeResult {
  /** Was operation successful */
  success: boolean;
  /** Created node ID (if not dry run) */
  nodeId?: string;
  /** Validated payload (always present) */
  payload: TanaApiNode;
  /** Resolved target node */
  target: string;
  /** Was this a dry run */
  dryRun: boolean;
  /** Error message if failed */
  error?: string;
}
```

### No Database Changes

This refactoring does not modify any database schemas.

## API Contracts

### Internal APIs

```typescript
// services/node-builder.ts

/**
 * Validate supertag names exist in registry
 * @returns Array of resolved SupertagSchema objects
 * @throws Error with suggestions if unknown tag
 */
export function validateSupertags(
  registry: SchemaRegistry,
  supertagInput: string
): SupertagSchema[];

/**
 * Build child nodes from input array
 * Handles plain text, URLs, and references
 */
export function buildChildNodes(
  children: ChildNodeInput[]
): TanaApiNode[];

/**
 * Build complete node payload ready for API
 * Uses registry.buildNodePayload internally
 */
export function buildNodePayload(
  registry: SchemaRegistry,
  input: CreateNodeInput
): TanaApiNode;

/**
 * Create node in Tana (or validate in dry run mode)
 * Handles API client creation, posting, and error handling
 */
export async function createNode(
  config: TanaConfig,
  input: CreateNodeInput
): Promise<CreateNodeResult>;
```

## Implementation Strategy

### Phase 1: Foundation (Tests + Types)

Write failing tests for the new shared module before extracting any code.

- [ ] Create `services/node-builder.test.ts` with TDD tests
- [ ] Define types in `services/node-builder.ts` (interfaces only)
- [ ] Verify tests fail (RED state)

**Tests to write:**
1. `validateSupertags()` - valid single tag
2. `validateSupertags()` - valid comma-separated tags
3. `validateSupertags()` - unknown tag with suggestions
4. `buildChildNodes()` - plain text children
5. `buildChildNodes()` - URL children (dataType: 'url')
6. `buildChildNodes()` - reference children (id provided)
7. `buildChildNodes()` - mixed children types
8. `buildNodePayload()` - basic node with supertag
9. `buildNodePayload()` - node with fields
10. `buildNodePayload()` - node with children
11. `createNode()` - dry run mode returns payload
12. `createNode()` - missing API token error

### Phase 2: Core Implementation (Extract + Implement)

Extract logic from existing files into shared module.

- [ ] Implement `validateSupertags()` (extract from both files)
- [ ] Implement `buildChildNodes()` (extract from both files)
- [ ] Implement `buildNodePayload()` (wrapper around registry)
- [ ] Implement `createNode()` (extract common API logic)
- [ ] Verify all new tests pass (GREEN state)

### Phase 3: Integration (Refactor Consumers)

Update CLI and MCP to use shared module.

- [ ] Refactor `commands/create.ts` to use `createNode()`
- [ ] Refactor `mcp/tools/create.ts` to use `createNode()`
- [ ] Verify existing tests still pass
- [ ] Remove duplicated code from both files
- [ ] Run full test suite

### Phase 4: Cleanup

- [ ] Review for any remaining duplication
- [ ] Add JSDoc comments to exported functions
- [ ] Verify >90% test coverage on new module

## File Structure

```
src/
├── services/
│   ├── node-builder.ts        # [NEW] Shared node creation logic
│   └── node-builder.test.ts   # [NEW] Unit tests for shared module
├── commands/
│   └── create.ts              # [MODIFIED] Use shared module
├── mcp/
│   └── tools/
│       └── create.ts          # [MODIFIED] Use shared module
└── types.ts                   # [MODIFIED] Add ChildNodeInput type
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking CLI output format | High | Low | Existing tests validate output format |
| Breaking MCP result structure | High | Low | Existing tests validate result schema |
| Subtle behavior differences | Med | Med | Side-by-side testing before removal |
| Incomplete extraction | Low | Med | Code review checklist |

## Dependencies

### External

None - no new npm packages required.

### Internal

- `schema/registry.ts` - SchemaRegistry for supertag validation and payload building
- `api/client.ts` - TanaApiClient for API communication
- `config/manager.ts` - ConfigManager for configuration
- `types.ts` - Existing type definitions

## Migration/Deployment

- [ ] Database migrations needed? **No**
- [ ] Environment variables? **No changes**
- [ ] Breaking changes? **No - internal refactoring only**

This is a pure refactoring with no user-facing changes.

## Estimated Complexity

- **New files:** 2 (node-builder.ts, node-builder.test.ts)
- **Modified files:** 3 (commands/create.ts, mcp/tools/create.ts, types.ts)
- **Test files:** 1 new + existing tests pass
- **Estimated tasks:** 12-15 atomic tasks
- **Lines reduced:** ~120 lines duplicated → single implementation
