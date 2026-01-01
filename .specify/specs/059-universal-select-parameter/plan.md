---
feature: "Universal Select Parameter"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Universal Select Parameter

## Architecture Overview

Adds a `--select` (CLI) / `select` (MCP) parameter to all query operations. The projection is applied at the output layer, after query execution, keeping query logic unchanged.

```
┌──────────────────────────────────────────────────────────────┐
│                       Query Request                          │
│  CLI: supertag search "meeting" --select id,name,fields.Due  │
│  MCP: tana_search { query: "meeting", select: ["id","name"] }│
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                 Query Execution Layer                        │
│         (unchanged - returns full result objects)            │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              NEW: Select Projection Layer                    │
│                                                              │
│  1. Parse select paths ("id", "name", "fields.Status")       │
│  2. Apply projection to each result object                   │
│  3. Preserve types (arrays stay arrays, etc.)                │
│  4. Return null for missing paths (no errors)                │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   Output Formatter                           │
│           (JSON, TSV, pretty - already exists)               │
└──────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Path Parsing | Custom | Dot-notation is simple enough |
| Schema Validation | Zod | Already used for MCP schemas |

No new dependencies required.

## Constitutional Compliance

- [x] **CLI-First:** `--select` flag added to all query commands
- [x] **Library-First:** `src/utils/select-projection.ts` as reusable module
- [x] **Test-First:** TDD with unit tests for projection, e2e for integration
- [x] **Deterministic:** Pure function projection, no probabilistic behavior
- [x] **Code Before Prompts:** All logic in TypeScript, no AI prompts

## Data Model

### Entities

```typescript
/**
 * A parsed field path for selection
 */
interface SelectPath {
  /** Original path string (e.g., "fields.Status") */
  raw: string;
  /** Split segments (e.g., ["fields", "Status"]) */
  segments: string[];
}

/**
 * Projection configuration
 */
interface SelectProjection {
  /** Parsed paths to include */
  paths: SelectPath[];
  /** If true, return all fields (no select specified) */
  includeAll: boolean;
}
```

### No Database Changes

This feature operates entirely at the output layer. No schema changes required.

## API Contracts

### Core Projection Function

```typescript
/**
 * Parse a comma-separated select string into paths
 * @example parseSelectPaths("id,name,fields.Status")
 * // => { paths: [{raw: "id", segments: ["id"]}, ...], includeAll: false }
 */
function parseSelectPaths(select: string | string[] | undefined): SelectProjection;

/**
 * Apply projection to a single object
 * @example applyProjection({ id: "1", name: "Test", extra: true }, projection)
 * // => { id: "1", name: "Test" }
 */
function applyProjection<T extends Record<string, unknown>>(
  obj: T,
  projection: SelectProjection
): Partial<T>;

/**
 * Apply projection to an array of objects
 */
function applyProjectionToArray<T extends Record<string, unknown>>(
  arr: T[],
  projection: SelectProjection
): Partial<T>[];
```

### MCP Schema Extension

```typescript
// Added to all query schemas
export const selectSchema = z
  .array(z.string())
  .optional()
  .describe('Fields to include in response (e.g., ["id", "name", "fields.Status"])');

// Example: searchSchema update
export const searchSchema = z.object({
  query: z.string().min(1),
  select: selectSchema,  // NEW
  // ... existing fields
});
```

### CLI Option Extension

```typescript
// Added to all query commands
.option('--select <fields>', 'Comma-separated list of fields to return')
```

## Implementation Strategy

### Phase 1: Foundation (Core Projection Utility)

Build the reusable select-projection module with comprehensive tests.

- [ ] Create `src/utils/select-projection.ts`
- [ ] Implement `parseSelectPaths()` function
- [ ] Implement `applyProjection()` function
- [ ] Implement `applyProjectionToArray()` function
- [ ] Handle nested paths (dot notation)
- [ ] Handle missing paths (return null, don't error)
- [ ] Write unit tests

### Phase 2: MCP Integration

Add select parameter to all MCP query tools.

- [ ] Add `selectSchema` to `src/mcp/schemas.ts`
- [ ] Update `searchSchema` with select
- [ ] Update `taggedSchema` with select
- [ ] Update `semanticSearchSchema` with select
- [ ] Update `nodeSchema` with select
- [ ] Update `fieldValuesSchema` with select
- [ ] Modify each tool to apply projection before returning
- [ ] Write MCP integration tests

### Phase 3: CLI Integration

Add --select flag to all CLI query commands.

- [ ] Add helper for parsing CLI select option
- [ ] Update `search` command
- [ ] Update `nodes show` command
- [ ] Update `tags` command (where applicable)
- [ ] Ensure works with all output formats (json, tsv, pretty)
- [ ] Write CLI e2e tests

### Phase 4: Documentation

- [ ] Update README.md with examples
- [ ] Update SKILL.md with MCP parameter documentation
- [ ] Add inline JSDoc to new functions

## File Structure

```
src/
├── utils/
│   └── select-projection.ts     # [New] Core projection logic
├── mcp/
│   ├── schemas.ts               # [Modified] Add selectSchema
│   └── tools/
│       ├── search.ts            # [Modified] Apply projection
│       ├── tagged.ts            # [Modified] Apply projection
│       ├── semantic-search.ts   # [Modified] Apply projection
│       ├── node.ts              # [Modified] Apply projection
│       └── field-values.ts      # [Modified] Apply projection
├── commands/
│   ├── helpers.ts               # [Modified] Add select parsing helper
│   ├── search.ts                # [Modified] Add --select option
│   └── nodes.ts                 # [Modified] Add --select option

tests/
├── utils/
│   └── select-projection.test.ts  # [New] Unit tests
├── mcp/
│   └── select-parameter.test.ts   # [New] MCP integration tests
└── e2e/
    └── select-cli.test.ts         # [New] CLI e2e tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Nested path performance | Low | Low | Projection is O(n*p) where n=results, p=paths; small numbers |
| Breaking existing API | High | Low | No breaking changes - select is optional, defaults to all |
| Field name confusion | Medium | Medium | Document exact field names in SKILL.md |
| Inconsistent behavior across tools | Medium | Medium | Single projection utility ensures consistency |

## Dependencies

### External

None new required.

### Internal

- `src/mcp/schemas.ts` - Zod schemas for MCP tools
- `src/commands/helpers.ts` - CLI helper utilities
- All existing query tool files

## Migration/Deployment

- [ ] **Database migrations:** None required
- [ ] **Environment variables:** None required
- [ ] **Breaking changes:** None - fully backward compatible

## Estimated Complexity

- **New files:** 1 (`select-projection.ts`)
- **Modified files:** ~10 (schemas, 5 tools, 3 commands, helpers)
- **Test files:** 3 (unit, mcp integration, cli e2e)
- **Estimated tasks:** 15-20
