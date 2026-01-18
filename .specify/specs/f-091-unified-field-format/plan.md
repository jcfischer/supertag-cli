# Technical Plan: F-091 unified-field-format

## Architecture Overview

```
                           ┌─────────────────────────────────────────┐
                           │           User Input                     │
                           │  MCP: {"fields": {"Status": "Done"}}    │
                           │  CLI: {"Status": "Done"} or --Status    │
                           └──────────────────┬──────────────────────┘
                                              │
                                              ▼
                  ┌───────────────────────────────────────────────────┐
                  │              normalizeFieldInput()                 │
                  │     NEW: Single normalization function             │
                  │     - Detects nested "fields" object               │
                  │     - Flattens to canonical format                 │
                  │     - Strips reserved keys (name, supertag, etc.)  │
                  └──────────────────────┬────────────────────────────┘
                                         │
                                         ▼
                  ┌───────────────────────────────────────────────────┐
                  │         Existing: node-builder.ts                 │
                  │           createNode() / buildNodePayload()       │
                  │                                                   │
                  │   Uses UnifiedSchemaService.buildNodePayload()    │
                  │   → Maps field names to attribute IDs             │
                  │   → Validates against supertag schema             │
                  └──────────────────────┬────────────────────────────┘
                                         │
                                         ▼
                  ┌───────────────────────────────────────────────────┐
                  │              Tana Input API                       │
                  │         POST /api/v1/nodes                        │
                  └───────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Validation | Zod | Already used in MCP schemas |
| Testing | bun:test | Project standard |
| Field matching | normalizeName() | Existing utility for case-insensitive matching |

## Key Insight: Root Cause

The problem is **not** in the field mapping logic (which works correctly). The issue is in the **input normalization layer**:

1. **CLI `extractFieldsFromJson()`** (create.ts:445) treats ALL non-reserved keys as field values
2. **MCP `tana_create`** passes `input.fields` directly to `createNode()`

When MCP receives `{"fields": {"Status": "Done"}}`:
- The `fields` property IS passed to createNode
- But CLI's `extractFieldsFromJson()` would skip `fields` as a reserved key!

The fix: Normalize input **before** it reaches the shared `createNode()` function.

## Data Model

### Input Formats (both accepted)

```typescript
// Nested format (common in APIs/MCP)
interface NestedFieldInput {
  name: string;
  supertag: string;
  fields: Record<string, string | string[]>;  // Nested
  children?: ChildNodeInput[];
}

// Flat format (current CLI behavior)
interface FlatFieldInput {
  name: string;
  supertag: string;
  [fieldName: string]: string | string[] | unknown;  // Flat
}
```

### Reserved Keys (never treated as fields)

```typescript
const RESERVED_KEYS = [
  'name',
  'title',
  'label',
  'heading',
  'subject',
  'summary',
  'supertag',
  'children',
  'target',
  'workspace',
  'dryRun',
  'fields',  // The nested container itself
] as const;
```

### Canonical Output

```typescript
// After normalization, always this format
interface NormalizedCreateInput {
  name: string;
  supertag: string;
  fields: Record<string, string | string[]>;  // Always flat
  children?: ChildNodeInput[];
  target?: string;
  workspace?: string;
  dryRun?: boolean;
}
```

## Implementation Phases

### Phase 1: Create normalizeFieldInput() utility

**File:** `src/services/field-normalizer.ts` (NEW)

```typescript
/**
 * Field Input Normalizer
 *
 * Normalizes field input to canonical flat format.
 * Handles both nested {"fields": {...}} and flat {...} formats.
 */

export interface NormalizeOptions {
  /** Include field validation errors in result */
  validate?: boolean;
  /** Schema to validate against (for error messages) */
  schemaFields?: string[];
}

export interface NormalizeResult {
  /** Normalized flat field map */
  fields: Record<string, string | string[]>;
  /** Fields that were not recognized (for error messages) */
  unrecognizedFields?: string[];
  /** Original format detected */
  inputFormat: 'nested' | 'flat' | 'mixed';
}

/**
 * Normalize field input to canonical flat format.
 *
 * @example
 * // Nested format
 * normalizeFieldInput({ fields: { Status: "Done" } })
 * // => { fields: { Status: "Done" }, inputFormat: "nested" }
 *
 * @example
 * // Flat format
 * normalizeFieldInput({ Status: "Done" })
 * // => { fields: { Status: "Done" }, inputFormat: "flat" }
 *
 * @example
 * // Mixed format (nested takes precedence)
 * normalizeFieldInput({ Status: "Done", fields: { Priority: "High" } })
 * // => { fields: { Status: "Done", Priority: "High" }, inputFormat: "mixed" }
 */
export function normalizeFieldInput(
  input: Record<string, unknown>,
  options?: NormalizeOptions
): NormalizeResult {
  // Implementation in Phase 1
}
```

**Key behavior:**
- If `input.fields` exists and is an object, extract those fields (nested format)
- Also extract any flat top-level fields (not in RESERVED_KEYS)
- If both exist (mixed), merge them with nested `fields` taking precedence
- Return normalized result with format detection metadata

### Phase 2: Integrate into node-builder.ts

**File:** `src/services/node-builder.ts` (MODIFY)

Add normalization at the entry point of `createNode()`:

```typescript
// At top of createNode()
import { normalizeFieldInput } from './field-normalizer';

export async function createNode(input: CreateNodeInput): Promise<CreateNodeResult> {
  // NEW: Normalize field input before processing
  const normalized = normalizeFieldInput({
    ...input,
    ...(input.fields || {}),
  });

  // Use normalized.fields instead of input.fields
  const processedInput = {
    ...input,
    fields: normalized.fields,
  };

  // ... rest of existing implementation
}
```

### Phase 3: Update MCP tool to use normalizer

**File:** `src/mcp/tools/create.ts` (MODIFY)

Currently, MCP passes `input.fields` directly. After this change:

```typescript
export async function create(input: CreateInput): Promise<CreateResult> {
  // ... existing validation ...

  // NEW: The node-builder now handles normalization internally
  // No changes needed here - createNode() will normalize

  const nodeResult = await createNode({
    supertag: input.supertag,
    name: input.name,
    fields: input.fields,  // Can be nested or flat now
    children,
    target: input.target,
    dryRun: input.dryRun,
  });

  // ... rest unchanged
}
```

### Phase 4: Update CLI to use same normalizer

**File:** `src/commands/create.ts` (MODIFY)

Replace `extractFieldsFromJson()` with the shared normalizer:

```typescript
import { normalizeFieldInput } from '../services/field-normalizer';

// In createCommand(), replace extractFieldsFromJson calls:
// Before:
// fieldValues = extractFieldsFromJson(jsonObj as Record<string, unknown>);

// After:
const normalized = normalizeFieldInput(jsonObj as Record<string, unknown>);
fieldValues = normalized.fields;
```

### Phase 5: Add validation and error messages

**File:** `src/services/field-normalizer.ts` (ENHANCE)

Add optional validation with helpful error messages:

```typescript
export interface FieldValidationError {
  fieldName: string;
  message: string;
  suggestion?: string;
}

export function validateFields(
  fields: Record<string, unknown>,
  schemaFields: Array<{ name: string; normalizedName: string }>
): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    const normalized = normalizeName(fieldName);
    const match = schemaFields.find(f => f.normalizedName === normalized);

    if (!match) {
      // Find similar field names for suggestion
      const similar = findSimilarFields(fieldName, schemaFields);
      errors.push({
        fieldName,
        message: `Field "${fieldName}" not found in supertag schema`,
        suggestion: similar.length > 0
          ? `Did you mean: ${similar.map(f => f.name).join(', ')}?`
          : undefined,
      });
    }
  }

  return errors;
}
```

### Phase 6: Tests

**File:** `src/services/__tests__/field-normalizer.test.ts` (NEW)

```typescript
describe('normalizeFieldInput', () => {
  describe('format detection', () => {
    it('should detect nested format', () => {
      const result = normalizeFieldInput({
        fields: { Status: 'Done' }
      });
      expect(result.inputFormat).toBe('nested');
      expect(result.fields).toEqual({ Status: 'Done' });
    });

    it('should detect flat format', () => {
      const result = normalizeFieldInput({
        Status: 'Done'
      });
      expect(result.inputFormat).toBe('flat');
      expect(result.fields).toEqual({ Status: 'Done' });
    });

    it('should detect mixed format', () => {
      const result = normalizeFieldInput({
        Status: 'Done',
        fields: { Priority: 'High' }
      });
      expect(result.inputFormat).toBe('mixed');
      expect(result.fields).toEqual({ Status: 'Done', Priority: 'High' });
    });
  });

  describe('reserved keys', () => {
    it('should not treat reserved keys as fields', () => {
      const result = normalizeFieldInput({
        name: 'My Task',
        supertag: 'todo',
        Status: 'Done',
      });
      expect(result.fields).toEqual({ Status: 'Done' });
      expect(result.fields).not.toHaveProperty('name');
      expect(result.fields).not.toHaveProperty('supertag');
    });
  });

  describe('precedence', () => {
    it('should prefer nested fields over flat when same key exists', () => {
      const result = normalizeFieldInput({
        Status: 'Flat',
        fields: { Status: 'Nested' }
      });
      expect(result.fields.Status).toBe('Nested');
    });
  });
});
```

**File:** `src/mcp/tools/__tests__/create-fields.test.ts` (NEW)

Integration tests for MCP field handling:

```typescript
describe('MCP tana_create with fields', () => {
  it('should accept nested fields format', async () => {
    const result = await create({
      supertag: 'todo',
      name: 'Test Task',
      fields: { Status: 'Done' },  // Nested format
      dryRun: true,
    });

    expect(result.payload.children).toBeDefined();
    // Verify field was mapped correctly
  });

  it('should produce same result for nested and flat formats', async () => {
    const nestedResult = await create({
      supertag: 'todo',
      name: 'Test',
      fields: { Status: 'Done' },
      dryRun: true,
    });

    // For comparison: what CLI would send
    // (This tests the equivalence requirement)
    const cliInput = {
      supertag: 'todo',
      name: 'Test',
      Status: 'Done',  // Flat format
    };

    // Both should produce equivalent payloads
  });
});
```

## File Structure

```
src/
├── services/
│   ├── node-builder.ts          # MODIFY: Add normalization call
│   ├── field-normalizer.ts      # NEW: Normalization logic
│   └── __tests__/
│       └── field-normalizer.test.ts  # NEW: Unit tests
├── commands/
│   └── create.ts                # MODIFY: Use shared normalizer
├── mcp/
│   └── tools/
│       ├── create.ts            # MINOR: May not need changes
│       └── __tests__/
│           └── create-fields.test.ts  # NEW: Integration tests
└── utils/
    └── normalize-name.ts        # EXISTING: Reuse for field matching
```

## Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| `normalizeName()` | Case-insensitive field matching | Existing |
| `UnifiedSchemaService` | Field schema lookup | Existing |
| `Zod` | Input validation | Existing |

No new external dependencies required.

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing CLI usage | High | Low | Flat format remains default; comprehensive tests |
| Performance regression | Low | Low | Normalization is O(n) on field count, negligible |
| Schema cache stale | Medium | Low | Cache invalidation already handled by sync |
| Mixed format confusion | Medium | Medium | Document precedence rules; warn in verbose mode |

## Backwards Compatibility

1. **Flat format (existing CLI)**: Continues to work unchanged
2. **MCP nested format**: Now works (previously silently failed)
3. **Mixed format**: Both work; nested takes precedence when same field name appears in both

## Testing Strategy

1. **Unit tests** for `normalizeFieldInput()`: Format detection, reserved keys, precedence
2. **Integration tests** for MCP: Nested format acceptance
3. **Integration tests** for CLI: Both formats via `--json`
4. **Regression tests**: Existing test suite must pass unchanged

## Success Criteria

| Criteria | Verification |
|----------|-------------|
| MCP nested fields work | `tana_create` with `{"fields": {...}}` creates correct payload |
| CLI flat fields work | Existing behavior unchanged |
| CLI nested fields work | `--json '{"fields": {...}}'` works |
| Same output for both | Identical payloads regardless of input format |
| Clear error messages | Unknown fields show suggestions |
| All existing tests pass | `bun run test:full` green |

## Implementation Order

1. `field-normalizer.ts` with tests (Phase 1)
2. Integrate into `node-builder.ts` (Phase 2)
3. Update CLI `create.ts` (Phase 4)
4. Add MCP integration tests (Phase 6)
5. Add validation/error messages (Phase 5)
6. Update documentation

## Estimated Scope

- **New files**: 2 (normalizer + tests)
- **Modified files**: 3 (node-builder, CLI create, MCP create)
- **Test additions**: ~30 new test cases
- **Lines of code**: ~150 new, ~50 modified
